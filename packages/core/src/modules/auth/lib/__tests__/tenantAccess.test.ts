import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceTenantSelection,
  resolveIsSuperAdmin,
} from '@open-mercato/core/modules/auth/lib/tenantAccess'

/** The 403 body every rejection must produce — asserted, never assumed. */
const FORBIDDEN = {
  status: 403,
  body: { error: 'Not authorized to target this tenant.' },
} as const

/** A container whose rbacService returns the given ACL, or throws. */
function containerWith(acl: { isSuperAdmin?: boolean } | Error) {
  const loadAcl = jest.fn(async () => {
    if (acl instanceof Error) throw acl
    return acl
  })
  return { resolve: jest.fn(() => ({ loadAcl })), loadAcl }
}

describe('enforceTenantSelection', () => {
  it('allows superadmin to target a tenant different from the current header tenant', async () => {
    const resolve = jest.fn(() => ({
      loadAcl: jest.fn(),
    }))

    await expect(
      enforceTenantSelection(
        {
          auth: {
            sub: 'user-1',
            tenantId: 'tenant-header',
            orgId: 'org-header',
            isSuperAdmin: true,
          },
          container: { resolve },
        },
        'tenant-form',
      ),
    ).resolves.toBe('tenant-form')

    expect(resolve).not.toHaveBeenCalled()
  })

  it('rejects non-superadmin targeting a tenant different from the current header tenant', async () => {
    const resolve = jest.fn(() => ({
      loadAcl: jest.fn(),
    }))

    await expect(
      enforceTenantSelection(
        {
          auth: {
            sub: 'user-1',
            tenantId: 'tenant-header',
            orgId: 'org-header',
            isSuperAdmin: false,
          },
          container: { resolve },
        },
        'tenant-form',
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 403,
      body: { error: 'Not authorized to target this tenant.' },
    })
  })

  it('falls back to the current tenant when non-superadmin omits tenant selection', async () => {
    const resolve = jest.fn(() => ({
      loadAcl: jest.fn(),
    }))

    await expect(
      enforceTenantSelection(
        {
          auth: {
            sub: 'user-1',
            tenantId: 'tenant-header',
            orgId: 'org-header',
            isSuperAdmin: false,
          },
          container: { resolve },
        },
        undefined,
      ),
    ).resolves.toBe('tenant-header')
  })
})

/**
 * Adversarial coverage for the tenant-selection guard.
 *
 * `enforceTenantSelection` is what turns a client-supplied `?tenantId=` into a
 * 403 rather than a cross-tenant read. It was verified by hand against a live
 * two-tenant deployment; these tests encode that matrix so it keeps holding.
 *
 * The three tests above all set `auth.isSuperAdmin` directly, which
 * short-circuits `resolveIsSuperAdmin` before it ever reaches RBAC. That left
 * the entire RBAC path — including what happens when it throws — unexercised.
 */
describe('enforceTenantSelection — adversarial', () => {
  const actor = { sub: 'user-1', tenantId: 'tenant-a', orgId: 'org-a' }

  describe('a non-superadmin cannot escape its own tenant', () => {
    it.each([
      ['another tenant id', 'tenant-b'],
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['an explicit null (global scope)', null],
      ['a non-string value', 42],
      ['an object', { tenantId: 'tenant-b' }],
    ])('rejects %s', async (_label, requested) => {
      const c = containerWith({ isSuperAdmin: false })
      await expect(
        enforceTenantSelection({ auth: actor, container: c }, requested),
      ).rejects.toMatchObject<Partial<CrudHttpError>>(FORBIDDEN)
    })

    it('accepts its own tenant id echoed back', async () => {
      const c = containerWith({ isSuperAdmin: false })
      await expect(
        enforceTenantSelection({ auth: actor, container: c }, 'tenant-a'),
      ).resolves.toBe('tenant-a')
    })
  })

  describe('super-admin status comes from RBAC when auth does not assert it', () => {
    it('grants cross-tenant selection when RBAC says super-admin', async () => {
      const c = containerWith({ isSuperAdmin: true })
      await expect(
        enforceTenantSelection({ auth: actor, container: c }, 'tenant-b'),
      ).resolves.toBe('tenant-b')
      expect(c.loadAcl).toHaveBeenCalledWith('user-1', {
        tenantId: 'tenant-a',
        organizationId: 'org-a',
      })
    })

    it('denies cross-tenant selection when RBAC says otherwise', async () => {
      const c = containerWith({ isSuperAdmin: false })
      await expect(
        enforceTenantSelection({ auth: actor, container: c }, 'tenant-b'),
      ).rejects.toMatchObject<Partial<CrudHttpError>>(FORBIDDEN)
    })

    it('FAILS CLOSED when RBAC throws — an unavailable ACL is not a promotion', async () => {
      const c = containerWith(new Error('rbac unavailable'))
      await expect(resolveIsSuperAdmin({ auth: actor, container: c })).resolves.toBe(false)
      await expect(
        enforceTenantSelection({ auth: actor, container: c }, 'tenant-b'),
      ).rejects.toMatchObject<Partial<CrudHttpError>>(FORBIDDEN)
    })

    it('treats a caller with no subject as not super-admin, without consulting RBAC', async () => {
      const c = containerWith({ isSuperAdmin: true })
      await expect(
        resolveIsSuperAdmin({ auth: { tenantId: 'tenant-a' }, container: c }),
      ).resolves.toBe(false)
      expect(c.loadAcl).not.toHaveBeenCalled()
    })
  })

  describe('a caller with no tenant of its own', () => {
    it('cannot claim one', async () => {
      const c = containerWith({ isSuperAdmin: false })
      await expect(
        enforceTenantSelection(
          { auth: { sub: 'user-1', tenantId: null }, container: c },
          'tenant-b',
        ),
      ).rejects.toMatchObject<Partial<CrudHttpError>>(FORBIDDEN)
    })

    it('resolves to null when it asks for nothing', async () => {
      const c = containerWith({ isSuperAdmin: false })
      await expect(
        enforceTenantSelection({ auth: { sub: 'user-1', tenantId: null }, container: c }, undefined),
      ).resolves.toBeNull()
    })

    it('rejects an unauthenticated caller reaching for a tenant', async () => {
      const c = containerWith({ isSuperAdmin: false })
      await expect(
        enforceTenantSelection({ auth: null, container: c }, 'tenant-b'),
      ).rejects.toMatchObject<Partial<CrudHttpError>>(FORBIDDEN)
    })
  })

  describe('super-admin retains deliberate global scope', () => {
    it('may select an explicit null to act across tenants', async () => {
      const c = containerWith({ isSuperAdmin: true })
      await expect(
        enforceTenantSelection({ auth: actor, container: c }, null),
      ).resolves.toBeNull()
    })

    it('falls back to its own tenant when it selects nothing', async () => {
      const c = containerWith({ isSuperAdmin: true })
      await expect(
        enforceTenantSelection({ auth: actor, container: c }, undefined),
      ).resolves.toBe('tenant-a')
    })
  })

  it('caches the super-admin verdict per context, never across contexts', async () => {
    const c = containerWith({ isSuperAdmin: true })
    const ctx = { auth: actor, container: c }
    await enforceTenantSelection(ctx, 'tenant-b')
    await enforceTenantSelection(ctx, 'tenant-c')
    expect(c.loadAcl).toHaveBeenCalledTimes(1)

    // A different caller must be resolved on its own merits, not inherit the
    // previous verdict — the cache is keyed on the context object.
    const denied = containerWith({ isSuperAdmin: false })
    await expect(
      enforceTenantSelection({ auth: actor, container: denied }, 'tenant-b'),
    ).rejects.toMatchObject<Partial<CrudHttpError>>(FORBIDDEN)
  })
})
