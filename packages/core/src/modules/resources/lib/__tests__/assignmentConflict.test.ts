import { AssignmentConflictService } from '../assignmentConflict'

const BASE_PARAMS = {
  tenantId: 'tenant-1',
  organizationId: 'organization-1',
  resourceId: 'resource-1',
}

function serviceWithNoLookups() {
  const em = { findOne: jest.fn(), find: jest.fn(), count: jest.fn() }
  return { em, service: new AssignmentConflictService(em as never) }
}

describe('AssignmentConflictService.validateAssignment interval guard', () => {
  it('rejects a reversed interval before touching the database', async () => {
    const { em, service } = serviceWithNoLookups()

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-07-01T11:00:00.000Z'),
      endsAt: new Date('2026-07-01T10:00:00.000Z'),
    })).resolves.toEqual({
      valid: false,
      error: { code: 'INVALID_INTERVAL', message: 'Assignment end must be after its start' },
    })

    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.count).not.toHaveBeenCalled()
  })

  it('rejects a zero-length interval', async () => {
    const { service } = serviceWithNoLookups()
    const instant = new Date('2026-07-01T10:00:00.000Z')

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: instant,
      endsAt: new Date(instant),
    })).resolves.toMatchObject({ valid: false, error: { code: 'INVALID_INTERVAL' } })
  })

  it('rejects an unparseable interval rather than writing it', async () => {
    const { service } = serviceWithNoLookups()

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('not-a-date'),
      endsAt: new Date('2026-07-01T10:00:00.000Z'),
    })).resolves.toMatchObject({ valid: false, error: { code: 'INVALID_INTERVAL' } })
  })

  it('lets a well-formed interval through to the resource lookup', async () => {
    const em = { findOne: jest.fn().mockResolvedValue(null), find: jest.fn(), count: jest.fn() }
    const service = new AssignmentConflictService(em as never)

    const result = await service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    })

    expect(result.error?.code).not.toBe('INVALID_INTERVAL')
    expect(em.findOne).toHaveBeenCalled()
  })
})
