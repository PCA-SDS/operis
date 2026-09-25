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

describe('AssignmentConflictService appointment availability', () => {
  function serviceWithOfficialOrganizationRuleSet() {
    const resource = {
      id: 'resource-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      isActive: true,
      availabilityRuleSetId: 'ruleset-1',
      deletedAt: null,
    }
    const ruleSet = {
      id: 'ruleset-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      timezone: 'UTC',
      deletedAt: null,
    }
    const rule = {
      id: 'rule-1',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT13H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      lastCustomerAcceptanceMinutes: 1260,
      timeOverflowMinutes: 60,
    }
    const settings = {
      organizationId: 'organization-1',
      operatingHoursRuleSetId: 'ruleset-1',
      timezone: 'UTC',
      lastCustomerBeforeCloseMinutes: 0,
      timeOverflowMinutes: 0,
    }
    const em = {
      findOne: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.id === resource.id) return resource
        if (where.id === ruleSet.id) return ruleSet
        return null
      }),
      find: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.subjectType === 'resource') return []
        if (where.subjectType === 'ruleset') return [rule]
        if (where.organizationId?.$in) return [settings]
        return []
      }),
      count: jest.fn().mockResolvedValue(0),
    }
    return { em, service: new AssignmentConflictService(em as never) }
  }

  it('allows an appointment assignment to finish during organization overflow', async () => {
    const { service } = serviceWithOfficialOrganizationRuleSet()

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T21:00:00.000Z'),
      endsAt: new Date('2026-09-25T22:30:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toEqual({ valid: true })
  })

  it('rejects a new appointment that starts at operating close', async () => {
    const { service } = serviceWithOfficialOrganizationRuleSet()

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T22:00:00.000Z'),
      endsAt: new Date('2026-09-25T22:30:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

  it('rejects a new appointment after the last customer acceptance time', async () => {
    const { service } = serviceWithOfficialOrganizationRuleSet()

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T21:01:00.000Z'),
      endsAt: new Date('2026-09-25T22:00:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

  it('allows a later service in the same appointment to start in overflow', async () => {
    const { service } = serviceWithOfficialOrganizationRuleSet()

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T22:30:00.000Z'),
      endsAt: new Date('2026-09-25T23:00:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T20:00:00.000Z'),
    })).resolves.toEqual({ valid: true })
  })

  it('does not treat organization overflow as permission to start after operating close', async () => {
    const { service } = serviceWithOfficialOrganizationRuleSet()

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T22:15:00.000Z'),
      endsAt: new Date('2026-09-25T22:30:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

  it('keeps generic resource validation strict when appointment overflow mode is not requested', async () => {
    const { service } = serviceWithOfficialOrganizationRuleSet()

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T21:00:00.000Z'),
      endsAt: new Date('2026-09-25T22:30:00.000Z'),
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })
})
