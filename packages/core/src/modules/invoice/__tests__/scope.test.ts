import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

import {
  assignInvoiceScope,
  assertInvoiceSameScope,
  invoiceScopeWhere,
  requireInvoiceScope,
  type InvoiceScopeContext,
} from '../data/scope'

describe('invoice scope helpers', () => {
  it('derives tenant and selected organization from trusted context', () => {
    const ctx: InvoiceScopeContext = {
      auth: { tenantId: 'tenant-1', orgId: 'org-auth' },
      selectedOrganizationId: 'org-selected',
      organizationScope: { selectedId: 'org-scope' },
    }

    expect(requireInvoiceScope(ctx)).toEqual({ tenantId: 'tenant-1', organizationId: 'org-selected' })
  })

  it('falls back to organizationScope then auth org id', () => {
    expect(requireInvoiceScope({
      auth: { tenantId: 'tenant-1', orgId: 'org-auth' },
      organizationScope: { selectedId: 'org-scope' },
    })).toEqual({ tenantId: 'tenant-1', organizationId: 'org-scope' })

    expect(requireInvoiceScope({
      auth: { tenantId: 'tenant-1', orgId: 'org-auth' },
    })).toEqual({ tenantId: 'tenant-1', organizationId: 'org-auth' })
  })

  it('fails closed when trusted tenant or organization is missing', () => {
    expect(() => requireInvoiceScope({ auth: { orgId: 'org-1' } })).toThrow(CrudHttpError)
    expect(() => requireInvoiceScope({ auth: { tenantId: 'tenant-1' } })).toThrow(CrudHttpError)
  })

  it('merges trusted scope last for reads and writes', () => {
    const scope = { tenantId: 'tenant-trusted', organizationId: 'org-trusted' }

    expect(invoiceScopeWhere(scope, {
      id: 'record-1',
      tenantId: 'tenant-forged',
      organizationId: 'org-forged',
    })).toEqual({
      id: 'record-1',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    })

    expect(assignInvoiceScope({
      name: 'Partner',
      tenantId: 'tenant-forged',
      organizationId: 'org-forged',
    }, scope)).toEqual({
      name: 'Partner',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    })
  })

  it('rejects loaded entities outside the trusted scope', () => {
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

    expect(() => assertInvoiceSameScope({ tenantId: 'tenant-1', organizationId: 'org-2' }, scope)).toThrow(CrudHttpError)
  })
})
