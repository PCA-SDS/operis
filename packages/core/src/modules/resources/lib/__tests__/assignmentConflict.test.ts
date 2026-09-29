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

  function serviceWithResourceCutoff(resourceId: string) {
    const resource = {
      id: resourceId,
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
    const organizationRule = {
      id: 'organization-rule',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT13H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      lastCustomerAcceptanceMinutes: 21 * 60,
      timeOverflowMinutes: 60,
    }
    const resourceRule = {
      id: 'resource-rule',
      subjectId: 'resource-a',
      timezone: 'UTC',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT11H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      lastCustomerAcceptanceMinutes: 19 * 60,
      timeOverflowMinutes: 30,
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
        if (where.subjectType === 'resource') return resourceId === 'resource-a' ? [resourceRule] : []
        if (where.subjectType === 'ruleset') return [organizationRule]
        if (where.organizationId?.$in) return [settings]
        return []
      }),
      count: jest.fn().mockResolvedValue(0),
    }
    return new AssignmentConflictService(em as never)
  }

  function serviceWithResourceWindows(
    resourceId: string,
    resourceRules: Array<{
      id: string
      rrule: string
      lastCustomerAcceptanceMinutes?: number
      timeOverflowMinutes?: number
    }>,
  ) {
    const resource = {
      id: resourceId,
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      isActive: true,
      availabilityRuleSetId: 'branch-ruleset',
      deletedAt: null,
    }
    const branchRule = {
      id: 'branch-rule',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT13H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      lastCustomerAcceptanceMinutes: 20 * 60,
      timeOverflowMinutes: 0,
    }
    const settings = {
      organizationId: 'organization-1',
      operatingHoursRuleSetId: 'branch-ruleset',
      timezone: 'UTC',
      lastCustomerBeforeCloseMinutes: 0,
      timeOverflowMinutes: 0,
    }
    const em = {
      findOne: jest.fn().mockImplementation(async (_entity, where) => (
        where.id === resourceId
          ? resource
          : where.id === 'branch-ruleset'
            ? { id: 'branch-ruleset', tenantId: 'tenant-1', organizationId: 'organization-1', timezone: 'UTC', deletedAt: null }
            : null
      )),
      find: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.subjectType === 'resource') return resourceRules
        if (where.subjectType === 'ruleset') return [branchRule]
        if (where.organizationId?.$in) return [settings]
        return []
      }),
      count: jest.fn().mockResolvedValue(0),
    }
    return new AssignmentConflictService(em as never)
  }

  it('allows the resource cutoff and overflow without changing other resources', async () => {
    const resourceAService = serviceWithResourceCutoff('resource-a')
    const resourceBService = serviceWithResourceCutoff('resource-b')

    await expect(resourceAService.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-a',
      startsAt: new Date('2026-09-25T19:00:00.000Z'),
      endsAt: new Date('2026-09-25T20:30:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toEqual({ valid: true })

    await expect(resourceAService.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-a',
      startsAt: new Date('2026-09-25T19:01:00.000Z'),
      endsAt: new Date('2026-09-25T20:00:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })

    await expect(resourceBService.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-b',
      startsAt: new Date('2026-09-25T21:00:00.000Z'),
      endsAt: new Date('2026-09-25T22:00:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toEqual({ valid: true })
  })

  it('caps custom resource operating hours at branch close while allowing its overflow', async () => {
    const resource = {
      id: 'resource-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      isActive: true,
      availabilityRuleSetId: null,
      deletedAt: null,
    }
    const resourceRule = {
      id: 'resource-rule',
      subjectId: 'resource-1',
      timezone: 'UTC',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT13H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      lastCustomerAcceptanceMinutes: 22 * 60,
      timeOverflowMinutes: 60,
    }
    const branchRule = {
      id: 'branch-rule',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT11H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      lastCustomerAcceptanceMinutes: 20 * 60,
      timeOverflowMinutes: 0,
    }
    const settings = {
      organizationId: 'organization-1',
      operatingHoursRuleSetId: 'branch-ruleset',
      timezone: 'UTC',
      lastCustomerBeforeCloseMinutes: 0,
      timeOverflowMinutes: 0,
    }
    const em = {
      findOne: jest.fn().mockImplementation(async (_entity, where) => (
        where.id === resource.id
          ? resource
          : where.id === 'branch-ruleset'
            ? { id: 'branch-ruleset', tenantId: 'tenant-1', organizationId: 'organization-1', timezone: 'UTC', deletedAt: null }
            : null
      )),
      find: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.subjectType === 'resource') return [resourceRule]
        if (where.subjectType === 'ruleset') return [branchRule]
        if (where.organizationId?.$in) return [settings]
        return []
      }),
      count: jest.fn().mockResolvedValue(0),
    }
    const service = new AssignmentConflictService(em as never)

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T19:30:00.000Z'),
      endsAt: new Date('2026-09-25T20:30:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toEqual({ valid: true })

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T20:15:00.000Z'),
      endsAt: new Date('2026-09-25T20:30:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T20:15:00.000Z'),
      endsAt: new Date('2026-09-25T21:00:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T19:00:00.000Z'),
      isChainedService: true,
    })).resolves.toEqual({ valid: true })
  })

  it('accepts an overlapping resource window that satisfies the full appointment range', async () => {
    const resource = {
      id: 'resource-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      isActive: true,
      availabilityRuleSetId: null,
      deletedAt: null,
    }
    const rules = [
      {
        id: 'short-window',
        timezone: 'UTC',
        rrule: 'DTSTART:20260925T090000Z\nDURATION:PT2H\nRRULE:FREQ=DAILY',
        exdates: [],
        kind: 'availability' as const,
      },
      {
        id: 'long-window',
        timezone: 'UTC',
        rrule: 'DTSTART:20260925T100000Z\nDURATION:PT3H\nRRULE:FREQ=DAILY',
        exdates: [],
        kind: 'availability' as const,
      },
    ]
    const em = {
      findOne: jest.fn().mockResolvedValue(resource),
      find: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.subjectType === 'resource') return rules
        return []
      }),
      count: jest.fn().mockResolvedValue(0),
    }
    const service = new AssignmentConflictService(em as never)

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T10:30:00.000Z'),
      endsAt: new Date('2026-09-25T12:30:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toEqual({ valid: true })
  })

  it('applies a resource cutoff to the booking start, not a later service in the same booking', async () => {
    const service = serviceWithResourceCutoff('resource-a')

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-a',
      startsAt: new Date('2026-09-25T19:30:00.000Z'),
      endsAt: new Date('2026-09-25T20:15:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T18:30:00.000Z'),
      isChainedService: true,
  })).resolves.toEqual({ valid: true })
  })

  it('allows a later service on another resource that opens after the appointment anchor', async () => {
    const service = serviceWithResourceWindows('resource-2', [{
      id: 'resource-2-window',
      rrule: 'DTSTART:20260925T100000Z\nDURATION:PT8H\nRRULE:FREQ=DAILY',
      lastCustomerAcceptanceMinutes: 17 * 60,
      timeOverflowMinutes: 30,
    }])

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-2',
      startsAt: new Date('2026-09-25T10:00:00.000Z'),
      endsAt: new Date('2026-09-25T10:30:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T09:00:00.000Z'),
      isChainedService: true,
    })).resolves.toEqual({ valid: true })
  })

  it('matches a later service to its actual split resource window', async () => {
    const service = serviceWithResourceWindows('resource-1', [
      {
        id: 'morning-window',
        rrule: 'DTSTART:20260925T100000Z\nDURATION:PT2H\nRRULE:FREQ=DAILY',
        lastCustomerAcceptanceMinutes: 11 * 60,
      },
      {
        id: 'afternoon-window',
        rrule: 'DTSTART:20260925T140000Z\nDURATION:PT4H\nRRULE:FREQ=DAILY',
        lastCustomerAcceptanceMinutes: 17 * 60,
      },
    ])

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T14:30:00.000Z'),
      endsAt: new Date('2026-09-25T15:00:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T09:00:00.000Z'),
      isChainedService: true,
    })).resolves.toEqual({ valid: true })
  })

  it('allows a later service in the same booking to run within resource overflow', async () => {
    const service = serviceWithResourceCutoff('resource-a')

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-a',
      startsAt: new Date('2026-09-25T20:15:00.000Z'),
      endsAt: new Date('2026-09-25T20:30:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T19:00:00.000Z'),
      isChainedService: true,
    })).resolves.toEqual({ valid: true })
  })

  it('does not allow a new resource booking to start during resource overflow', async () => {
    const service = serviceWithResourceCutoff('resource-a')

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-a',
      startsAt: new Date('2026-09-25T20:15:00.000Z'),
      endsAt: new Date('2026-09-25T20:30:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

  it('does not allow the first service to start during overflow when the anchor is present', async () => {
    const service = serviceWithResourceWindows('resource-1', [{
      id: 'resource-window',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT11H\nRRULE:FREQ=DAILY',
      timeOverflowMinutes: 30,
    }])

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T20:15:00.000Z'),
      endsAt: new Date('2026-09-25T20:30:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T20:15:00.000Z'),
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

  it('does not classify a delayed first service as chained based on the booking anchor', async () => {
    const service = serviceWithResourceCutoff('resource-a')

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-a',
      startsAt: new Date('2026-09-25T20:15:00.000Z'),
      endsAt: new Date('2026-09-25T20:30:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T19:00:00.000Z'),
      isChainedService: false,
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

  it('does not allow a chained resource service to exceed resource overflow', async () => {
    const service = serviceWithResourceCutoff('resource-a')

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-a',
      startsAt: new Date('2026-09-25T20:30:00.000Z'),
      endsAt: new Date('2026-09-25T20:45:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T19:00:00.000Z'),
      isChainedService: true,
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

  it('still enforces a resource cutoff for a new booking without an appointment anchor', async () => {
    const service = serviceWithResourceCutoff('resource-a')

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      resourceId: 'resource-a',
      startsAt: new Date('2026-09-25T19:30:00.000Z'),
      endsAt: new Date('2026-09-25T20:15:00.000Z'),
      availabilityMode: 'appointment',
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

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
      isChainedService: true,
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

  it('uses direct resource rules instead of widening them with the linked ruleset', async () => {
    const resource = {
      id: 'resource-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      isActive: true,
      availabilityRuleSetId: 'ruleset-1',
      deletedAt: null,
    }
    const directRule = {
      id: 'direct-rule',
      rrule: 'DTSTART:20260925T100000Z\nDURATION:PT2H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
    }
    const ruleSetRule = {
      id: 'ruleset-rule',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT8H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
    }
    const em = {
      findOne: jest.fn().mockResolvedValue(resource),
      find: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.subjectType === 'resource') return [directRule]
        if (where.subjectType === 'ruleset') return [ruleSetRule]
        return []
      }),
      count: jest.fn().mockResolvedValue(0),
    }
    const service = new AssignmentConflictService(em as never)

    await expect(service.validateAssignment({
      ...BASE_PARAMS,
      startsAt: new Date('2026-09-25T09:00:00.000Z'),
      endsAt: new Date('2026-09-25T10:00:00.000Z'),
    })).resolves.toMatchObject({ valid: false, error: { code: 'OUTSIDE_AVAILABILITY' } })
  })

  it('uses a linked custom resource ruleset instead of the inherited organization policy', async () => {
    const resource = {
      id: 'resource-1',
      tenantId: 'tenant-1',
      organizationId: 'child-organization',
      isActive: true,
      availabilityRuleSetId: 'resource-ruleset',
      deletedAt: null,
    }
    const organizationRuleSet = {
      id: 'organization-ruleset',
      tenantId: 'tenant-1',
      organizationId: 'parent-organization',
      timezone: 'UTC',
      deletedAt: null,
    }
    const resourceRule = {
      id: 'resource-rule',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT15H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      timeOverflowMinutes: 60,
    }
    const organizationRule = {
      id: 'organization-rule',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT13H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      lastCustomerAcceptanceMinutes: 21 * 60,
      timeOverflowMinutes: 60,
    }
    const settings = {
      organizationId: 'parent-organization',
      operatingHoursRuleSetId: 'organization-ruleset',
      lastCustomerBeforeCloseMinutes: 0,
      timeOverflowMinutes: 0,
    }
    const em = {
      findOne: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.id === resource.id) return resource
        if (where.id === organizationRuleSet.id) return organizationRuleSet
        return null
      }),
      find: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.subjectType === 'resource') return []
        if (where.subjectType === 'ruleset' && where.subjectId === 'resource-ruleset') return [resourceRule]
        if (where.subjectType === 'ruleset' && where.subjectId === 'organization-ruleset') return [organizationRule]
        if (where.organizationId?.$in) return [settings]
        return []
      }),
      count: jest.fn().mockResolvedValue(0),
    }
    const service = new AssignmentConflictService(em as never)

    await expect(service.validateAssignment({
      tenantId: 'tenant-1',
      organizationId: 'child-organization',
      organizationIds: ['child-organization', 'parent-organization'],
      resourceId: 'resource-1',
      startsAt: new Date('2026-09-25T22:15:00.000Z'),
      endsAt: new Date('2026-09-25T22:30:00.000Z'),
      availabilityMode: 'appointment',
      availabilityAnchorStartAt: new Date('2026-09-25T20:00:00.000Z'),
      isChainedService: true,
    })).resolves.toEqual({ valid: true })
  })
})
