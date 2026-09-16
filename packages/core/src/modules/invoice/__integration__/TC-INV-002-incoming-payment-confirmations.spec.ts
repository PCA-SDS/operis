import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { expect, test } from '@playwright/test'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

import { InvoicePaymentConfirmationsService } from '../services/payment-confirmations-service'
import type { InvoiceService } from '../services/invoice-service'

type InvoiceScope = { tenantId: string; organizationId: string }
type IncomingFixture = {
  companyIds: string[]
  invoiceIds: string[]
  confirmationId: string
  payerInvoiceId: string
  receiverInvoiceId: string
  receiverScope: InvoiceScope
}

async function createIncomingFixture(
  client: IntegrationDbClient,
  receiverScope: InvoiceScope,
): Promise<IncomingFixture> {
  const payerScope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const payerCompanyId = randomUUID()
  const receiverCompanyId = randomUUID()
  const payerInvoiceId = randomUUID()
  const receiverInvoiceId = randomUUID()
  const confirmationId = randomUUID()
  const identity = {
    sellerTaxCode: `SELLER-${randomUUID()}`,
    buyerTaxCode: `BUYER-${randomUUID()}`,
    symbol: `SYM-${randomUUID()}`,
    number: `NUM-${randomUUID()}`,
    date: new Date('2026-09-01T00:00:00.000Z'),
  }

  for (const company of [
    { id: payerCompanyId, scope: payerScope, taxCode: identity.sellerTaxCode, name: 'Payer Supplier' },
    { id: receiverCompanyId, scope: receiverScope, taxCode: identity.buyerTaxCode, name: 'Receiver Buyer' },
  ]) {
    await client.query(
      `insert into invoice_companies
        (id, organization_id, tenant_id, tax_code, country_code, name, search_text, created_at, updated_at)
       values ($1, $2, $3, $4, 'VN', $5, '', now(), now())`,
      [company.id, company.scope.organizationId, company.scope.tenantId, company.taxCode, company.name],
    )
  }

  for (const invoice of [
    { id: payerInvoiceId, scope: payerScope, companyId: payerCompanyId, direction: 'AP' },
    { id: receiverInvoiceId, scope: receiverScope, companyId: receiverCompanyId, direction: 'AR' },
  ]) {
    await client.query(
      `insert into invoice_invoices
        (id, organization_id, tenant_id, source_invoice_id, direction, company_id,
         seller_tax_code, seller_name, buyer_tax_code, buyer_name, invoice_symbol,
         invoice_number, invoice_date, gross_amount, paid_amount, outstanding_amount,
         created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'Seller', $8, 'Buyer', $9, $10, $11,
         '100.0000', '0.0000', '100.0000', now(), now())`,
      [
        invoice.id,
        invoice.scope.organizationId,
        invoice.scope.tenantId,
        `source-${invoice.id}`,
        invoice.direction,
        invoice.companyId,
        identity.sellerTaxCode,
        identity.buyerTaxCode,
        identity.symbol,
        identity.number,
        identity.date,
      ],
    )
  }

  await client.query(
    `insert into invoice_payment_confirmations
      (id, organization_id, tenant_id, invoice_id, recipient_email, token_hash,
       status, expires_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'receiver@example.com', $5, 'PENDING', now() + interval '1 day', now(), now())`,
    [confirmationId, payerScope.organizationId, payerScope.tenantId, payerInvoiceId, randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')],
  )

  return {
    companyIds: [payerCompanyId, receiverCompanyId],
    invoiceIds: [payerInvoiceId, receiverInvoiceId],
    confirmationId,
    payerInvoiceId,
    receiverInvoiceId,
    receiverScope,
  }
}

async function cleanupFixture(client: IntegrationDbClient, fixture: IncomingFixture): Promise<void> {
  await client.query('delete from invoice_payment_confirmations where id = $1', [fixture.confirmationId])
  await client.query('delete from invoice_invoices where id = any($1::uuid[])', [fixture.invoiceIds])
  await client.query('delete from invoice_companies where id = any($1::uuid[])', [fixture.companyIds])
}

async function readState(client: IntegrationDbClient, fixture: IncomingFixture) {
  const confirmation = await client.query<{ status: string }>(
    'select status from invoice_payment_confirmations where id = $1',
    [fixture.confirmationId],
  )
  const invoices = await client.query<{ id: string; settlement_status: string }>(
    'select id, settlement_status from invoice_invoices where id = any($1::uuid[]) order by id',
    [fixture.invoiceIds],
  )
  return {
    confirmationStatus: confirmation.rows[0]?.status,
    invoiceStates: new Map(invoices.rows.map((row) => [row.id, row.settlement_status])),
  }
}

test.describe('TC-INV-002: incoming payment confirmation coordination', () => {
  test('accepts and rejects matching claims through authenticated APIs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tokenScope = getTokenScope(token)
    const receiverScope = {
      tenantId: tokenScope.tenantId,
      organizationId: tokenScope.organizationId,
    }

    await withClient(async (client) => {
      const accepted = await createIncomingFixture(client, receiverScope)
      const rejected = await createIncomingFixture(client, receiverScope)
      try {
        const acceptResponse = await apiRequest(
          request,
          'POST',
          `/api/invoice/invoices/${accepted.receiverInvoiceId}/incoming-confirmation/accept`,
          { token, data: {} },
        )
        expect(acceptResponse.status()).toBe(200)
        const acceptedState = await readState(client, accepted)
        expect(acceptedState.confirmationStatus).toBe('CONFIRMED')
        expect(acceptedState.invoiceStates.get(accepted.payerInvoiceId)).toBe('SETTLED')
        expect(acceptedState.invoiceStates.get(accepted.receiverInvoiceId)).toBe('SETTLED')

        const rejectResponse = await apiRequest(
          request,
          'POST',
          `/api/invoice/invoices/${rejected.receiverInvoiceId}/incoming-confirmation/reject`,
          { token, data: {} },
        )
        expect(rejectResponse.status()).toBe(200)
        const rejectedState = await readState(client, rejected)
        expect(rejectedState.confirmationStatus).toBe('REJECTED')
        expect(rejectedState.invoiceStates.get(rejected.payerInvoiceId)).toBe('UNSETTLED')
        expect(rejectedState.invoiceStates.get(rejected.receiverInvoiceId)).toBe('UNSETTLED')
      } finally {
        await cleanupFixture(client, accepted)
        await cleanupFixture(client, rejected)
      }
    })
  })

  test('allows only one concurrent action and hides receiver invoices from another scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tokenScope = getTokenScope(token)
    const receiverScope = {
      tenantId: tokenScope.tenantId,
      organizationId: tokenScope.organizationId,
    }

    await withClient(async (client) => {
      const fixture = await createIncomingFixture(client, receiverScope)
      const foreign = await createIncomingFixture(client, {
        tenantId: randomUUID(),
        organizationId: randomUUID(),
      })
      try {
        const responses = await Promise.all([
          apiRequest(request, 'POST', `/api/invoice/invoices/${fixture.receiverInvoiceId}/incoming-confirmation/accept`, { token, data: {} }),
          apiRequest(request, 'POST', `/api/invoice/invoices/${fixture.receiverInvoiceId}/incoming-confirmation/reject`, { token, data: {} }),
        ])
        expect(responses.map((response) => response.status()).sort()).toEqual([200, 409])

        const foreignResponse = await apiRequest(
          request,
          'POST',
          `/api/invoice/invoices/${foreign.receiverInvoiceId}/incoming-confirmation/accept`,
          { token, data: {} },
        )
        expect(foreignResponse.status()).toBe(404)
      } finally {
        await cleanupFixture(client, fixture)
        await cleanupFixture(client, foreign)
      }
    })
  })

  test('requires every identity field and excludes expired, installment, and ambiguous claims', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tokenScope = getTokenScope(token)
    const receiverScope = {
      tenantId: tokenScope.tenantId,
      organizationId: tokenScope.organizationId,
    }

    await withClient(async (client) => {
      const fixture = await createIncomingFixture(client, receiverScope)
      try {
        const identityMutations = [
          ['seller_tax_code', `OTHER-${randomUUID()}`],
          ['buyer_tax_code', `OTHER-${randomUUID()}`],
          ['invoice_symbol', `OTHER-${randomUUID()}`],
          ['invoice_number', `OTHER-${randomUUID()}`],
          ['invoice_date', new Date('2026-09-02T00:00:00.000Z')],
        ] as const

        for (const [column, value] of identityMutations) {
          const original = await client.query<Record<string, unknown>>(
            `select ${column} as value from invoice_invoices where id = $1`,
            [fixture.receiverInvoiceId],
          )
          await client.query(`update invoice_invoices set ${column} = $2 where id = $1`, [fixture.receiverInvoiceId, value])
          const response = await apiRequest(
            request,
            'POST',
            `/api/invoice/invoices/${fixture.receiverInvoiceId}/incoming-confirmation/accept`,
            { token, data: {} },
          )
          expect(response.status(), `${column} must be part of incoming identity`).toBe(409)
          await client.query(`update invoice_invoices set ${column} = $2 where id = $1`, [
            fixture.receiverInvoiceId,
            original.rows[0]?.value,
          ])
        }

        await client.query(
          "update invoice_payment_confirmations set expires_at = now() - interval '1 second' where id = $1",
          [fixture.confirmationId],
        )
        const expiredResponse = await apiRequest(
          request,
          'POST',
          `/api/invoice/invoices/${fixture.receiverInvoiceId}/incoming-confirmation/accept`,
          { token, data: {} },
        )
        expect(expiredResponse.status()).toBe(409)

        const installmentId = randomUUID()
        await client.query(
          `insert into invoice_installments
            (id, organization_id, tenant_id, invoice_id, sequence, principal_amount,
             interest_rate, interest_amount, total_amount, due_date, status, created_at, updated_at)
           select $1, organization_id, tenant_id, id, 1, '100.0000', '0.0000', '0.0000',
             '100.0000', now() + interval '1 day', 'PENDING', now(), now()
           from invoice_invoices where id = $2`,
          [installmentId, fixture.payerInvoiceId],
        )
        await client.query(
          "update invoice_payment_confirmations set expires_at = now() + interval '1 day', installment_id = $2 where id = $1",
          [fixture.confirmationId, installmentId],
        )
        const installmentResponse = await apiRequest(
          request,
          'POST',
          `/api/invoice/invoices/${fixture.receiverInvoiceId}/incoming-confirmation/accept`,
          { token, data: {} },
        )
        expect(installmentResponse.status()).toBe(409)

        await client.query(
          'update invoice_payment_confirmations set installment_id = null where id = $1',
          [fixture.confirmationId],
        )
        await client.query(
          `insert into invoice_payment_confirmations
            (id, organization_id, tenant_id, invoice_id, recipient_email, token_hash,
             status, expires_at, created_at, updated_at)
           select $1, organization_id, tenant_id, invoice_id, recipient_email, $2,
             'PENDING', now() + interval '1 day', now(), now()
           from invoice_payment_confirmations where id = $3`,
          [randomUUID(), randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''), fixture.confirmationId],
        )
        const ambiguousResponse = await apiRequest(
          request,
          'POST',
          `/api/invoice/invoices/${fixture.receiverInvoiceId}/incoming-confirmation/accept`,
          { token, data: {} },
        )
        expect(ambiguousResponse.status()).toBe(409)
      } finally {
        await cleanupFixture(client, fixture)
      }
    })
  })

  test('rolls back every state change when either AP or AR settlement fails', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tokenScope = getTokenScope(token)
    const receiverScope = {
      tenantId: tokenScope.tenantId,
      organizationId: tokenScope.organizationId,
    }

    await withClient(async (client) => {
      const apFailureFixture = await createIncomingFixture(client, receiverScope)
      const arFailureFixture = await createIncomingFixture(client, receiverScope)
      try {
        const container = await createRequestContainer()
        const baseEm = container.resolve<EntityManager>('em')
        const invoiceService = container.resolve<InvoiceService>('invoiceService')
        const apFailureService = new InvoicePaymentConfirmationsService(baseEm.fork(), {} as never, {
          forTransaction() {
            return {
              applyInvoicePayment: async () => {
                throw new Error('[internal] Injected AP settlement failure')
              },
            }
          },
        } as never)

        await expect(apFailureService.acceptIncoming(receiverScope, apFailureFixture.receiverInvoiceId)).rejects.toThrow(
          '[internal] Injected AP settlement failure',
        )
        const apFailureState = await readState(client, apFailureFixture)
        expect(apFailureState.confirmationStatus).toBe('PENDING')
        expect(apFailureState.invoiceStates.get(apFailureFixture.payerInvoiceId)).toBe('UNSETTLED')
        expect(apFailureState.invoiceStates.get(apFailureFixture.receiverInvoiceId)).toBe('UNSETTLED')

        const failingInvoiceService = {
          forTransaction(tx: EntityManager) {
            const transactionService = invoiceService.forTransaction(tx)
            return {
              applyInvoicePayment: transactionService.applyInvoicePayment.bind(transactionService),
              updateReceivableSettlement: async () => {
                throw new Error('[internal] Injected AR settlement failure')
              },
            }
          },
        }
        const service = new InvoicePaymentConfirmationsService(baseEm.fork(), {} as never, failingInvoiceService as never)

        await expect(service.acceptIncoming(receiverScope, arFailureFixture.receiverInvoiceId)).rejects.toThrow(
          '[internal] Injected AR settlement failure',
        )
        const state = await readState(client, arFailureFixture)
        expect(state.confirmationStatus).toBe('PENDING')
        expect(state.invoiceStates.get(arFailureFixture.payerInvoiceId)).toBe('UNSETTLED')
        expect(state.invoiceStates.get(arFailureFixture.receiverInvoiceId)).toBe('UNSETTLED')
      } finally {
        await cleanupFixture(client, apFailureFixture)
        await cleanupFixture(client, arFailureFixture)
      }
    })
  })
})
