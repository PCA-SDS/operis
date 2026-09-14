import { Invoice } from '../../data/entities'
import { hashInvoicePublicToken, invoicePublicTokenSchema } from '../../data/validators'
import { InvoiceTrackingService } from '../invoice-tracking-service'

const token = invoicePublicTokenSchema.parse('a'.repeat(64))
const tokenHash = hashInvoicePublicToken(token)
const invoiceId = '11111111-1111-4111-8111-111111111111'

function buildService(findOneResult: unknown, nativeUpdateResult = 1) {
  const em = {
    findOne: jest.fn().mockResolvedValue(findOneResult),
    nativeUpdate: jest.fn().mockResolvedValue(nativeUpdateResult),
  }
  return { em, service: new InvoiceTrackingService(em as never) }
}

describe('InvoiceTrackingService', () => {
  it('records only the first open with a scoped conditional update', async () => {
    const { em, service } = buildService({
      id: invoiceId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      openedAt: null,
    })

    await expect(service.recordOpen(token)).resolves.toBe('matched')
    expect(em.findOne).toHaveBeenCalledWith(Invoice, {
      emailTrackingTokenHash: tokenHash,
      deletedAt: null,
    }, expect.any(Object))
    expect(em.nativeUpdate).toHaveBeenCalledWith(Invoice, expect.objectContaining({
      id: invoiceId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      emailTrackingTokenHash: tokenHash,
      openedAt: null,
      deletedAt: null,
    }), expect.objectContaining({ openedAt: expect.any(Date) }))
  })

  it('does not mutate missing or repeated tokens', async () => {
    const missing = buildService(null)
    await expect(missing.service.recordOpen(token)).resolves.toBe('not-matched')
    expect(missing.em.nativeUpdate).not.toHaveBeenCalled()

    const repeated = buildService({ id: invoiceId, openedAt: new Date(), tenantId: 'tenant-1', organizationId: 'org-1' })
    await expect(repeated.service.recordOpen(token)).resolves.toBe('repeated')
    expect(repeated.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('treats a concurrent conditional-update miss as a repeated open', async () => {
    const { service, em } = buildService({ id: invoiceId, openedAt: null, tenantId: 'tenant-1', organizationId: 'org-1' }, 0)

    await expect(service.recordOpen(token)).resolves.toBe('repeated')
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
  })
})
