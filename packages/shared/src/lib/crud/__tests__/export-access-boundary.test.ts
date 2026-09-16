import { shouldDropUserFiltersForExport } from '@open-mercato/shared/lib/crud/factory'

/**
 * `exportScope=full` used to replace `buildFilters` with `{}` unconditionally. On a list
 * that had set `omitAutomaticTenantOrgScope`, `buildFilters` was the only thing applying
 * the tenant predicate, so one query parameter turned an ordinary list into a
 * cross-tenant dump — reproduced against a running instance as a tenant-scoped admin
 * holding nothing but `scheduler.jobs.view`: 8 rows became 28, 16 of them owned by two
 * other tenants.
 */
describe('export access boundary', () => {
  describe('when the query engine still applies its automatic tenant predicate', () => {
    it('drops user filters for a full export, which is the point of the button', () => {
      expect(shouldDropUserFiltersForExport(true, undefined)).toBe(true)
      expect(shouldDropUserFiltersForExport(true, false)).toBe(true)
    })

    it('keeps user filters for an ordinary view export', () => {
      expect(shouldDropUserFiltersForExport(false, undefined)).toBe(false)
      expect(shouldDropUserFiltersForExport(false, false)).toBe(false)
    })
  })

  describe('when the list has opted out of automatic tenant scoping', () => {
    it('NEVER drops its filters, because they are the tenant boundary', () => {
      expect(shouldDropUserFiltersForExport(true, true)).toBe(false)
    })

    it('keeps them on a view export too', () => {
      expect(shouldDropUserFiltersForExport(false, true)).toBe(false)
    })
  })

  // The invariant stated plainly: no combination of inputs may drop the filters of a
  // route that owns its own scoping. If a future refactor reintroduces that, this fails.
  it('cannot be talked into dropping the boundary on a self-scoped route', () => {
    for (const exportFull of [true, false]) {
      expect(shouldDropUserFiltersForExport(exportFull, true)).toBe(false)
    }
  })
})
