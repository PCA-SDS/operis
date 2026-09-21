import { createHash } from 'node:crypto'
import { InvoicePaymentConfirmationsService } from '../payment-confirmations-service'

jest.mock('../../events', () => ({
  emitInvoiceEvent: jest.fn(async () => undefined),
}))

const token = 'a'.repeat(64)
const tokenHash = createHash('sha256').update(token).digest('hex')
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function confirmation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'confirmation-1',
    ...scope,
    tokenHash,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    invoice: {
      id: 'invoice-1',
      buyerName: 'Buyer',
      sellerName: 'Supplier',
      invoiceSymbol: 'INV',
      invoiceNumber: '1001',
      outstandingAmount: '100.0000',
      currencyCode: 'USD',
      company: { name: 'Supplier' },
    },
    installment: null,
    ...overrides,
  } as never
}

function harness(record = confirmation()) {
  const tx = {
    findOne: jest.fn(async () => record),
    nativeUpdate: jest.fn(async () => 1),
  }
  const em = {
    findOne: jest.fn(async () => record),
    transactional: jest.fn(async (work: (manager: typeof tx) => Promise<unknown>) => work(tx)),
  }
  const invoiceService = {
    forTransaction: jest.fn(() => ({
      applyInvoicePayment: jest.fn(async () => undefined),
    })),
  }
  const service = new InvoicePaymentConfirmationsService(em as never, {} as never, invoiceService as never)
  return { service, em, tx, invoiceService }
}

describe('public payment confirmation service', () => {
  it('rejects malformed tokens before database lookup', async () => {
    const { service, em } = harness()
    await expect(service.getPublicPreview('bad-token')).rejects.toMatchObject({ status: 404 })
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('returns only the safe preview contract', async () => {
    const { service } = harness()
    const result = await service.getPublicPreview(token)
    expect(result).toMatchObject({
      status: 'PENDING',
      payerName: 'Buyer',
      payeeName: 'Supplier',
      invoice: { symbol: 'INV', number: '1001', amount: '100.0000', currencyCode: 'USD' },
      installment: null,
    })
    expect(JSON.stringify(result)).not.toContain(token)
    expect(JSON.stringify(result)).not.toContain(tokenHash)
  })

  it('confirms through InvoiceService and is idempotent', async () => {
    const { service, tx, invoiceService } = harness()
    await expect(service.confirmPublic(token)).resolves.toEqual({ status: 'CONFIRMED' })
    expect(tx.nativeUpdate).toHaveBeenCalledWith(expect.anything(), { tokenHash, status: 'PENDING' }, expect.objectContaining({ status: 'CONFIRMED' }))
    expect(invoiceService.forTransaction).toHaveBeenCalled()
  })

  it('rejects without applying invoice payment', async () => {
    const { service, invoiceService } = harness()
    await expect(service.rejectPublic(token)).resolves.toEqual({ status: 'REJECTED' })
    expect(invoiceService.forTransaction).not.toHaveBeenCalled()
  })

  it('returns success when the target terminal state already exists', async () => {
    const { service } = harness(confirmation({ status: 'CONFIRMED' }))
    await expect(service.confirmPublic(token)).resolves.toEqual({ status: 'CONFIRMED' })
  })

  it('returns conflict for the opposite terminal state', async () => {
    const { service } = harness(confirmation({ status: 'REJECTED' }))
    await expect(service.confirmPublic(token)).rejects.toMatchObject({ status: 409 })
  })
})
