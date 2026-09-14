import { buildEmailTemplateListFilters } from '../api/templates/route'

/**
 * `buildFilters` runs on the detail path too — `[id]/route.ts` rewrites the
 * request to `?id=<uuid>` and re-enters the list GET. Defaulting archived rows
 * out therefore made an archived template unreachable by id, so Edit and the
 * global-search deep link both 404'd with no route back through the UI.
 */
describe('email template list filters', () => {
  it('hides archived templates from an unfiltered list', () => {
    expect(buildEmailTemplateListFilters({})).toEqual({ status: { $ne: 'archived' } })
  })

  it('does not hide archived templates on a lookup by id', () => {
    expect(buildEmailTemplateListFilters({ id: 'abc' })).toEqual({ id: 'abc' })
  })

  it('does not hide archived templates on a lookup by ids', () => {
    expect(buildEmailTemplateListFilters({ ids: 'a,b' })).toEqual({ id: { $in: ['a', 'b'] } })
  })

  it('honours an explicit status over the archived default', () => {
    expect(buildEmailTemplateListFilters({ status: 'archived' })).toEqual({ status: 'archived' })
  })

  it('lets includeArchived widen an unfiltered list', () => {
    expect(buildEmailTemplateListFilters({ includeArchived: true })).toEqual({})
  })

  it('lets activeOnly override everything', () => {
    expect(buildEmailTemplateListFilters({ activeOnly: true })).toEqual({ status: 'published' })
  })
})
