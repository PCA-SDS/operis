import {
  resolveOrganizationAvailabilityWindows,
  validateResourceAvailabilityRuleSetWithinOrganization,
  validateBookingRuntimeAgainstOrganizationAvailability,
  validateBookingAgainstOrganizationAvailability,
} from '../lib/organizationAvailability'

const policy = {
  organizationId: 'org-1',
  operatingHoursRuleSetId: 'ruleset-1',
  timezone: 'UTC',
  lastCustomerBeforeCloseMinutes: 60,
  timeOverflowMinutes: 60,
  rules: [{
    id: 'rule-1',
    rrule: 'DTSTART:20260925T090000Z\nDURATION:PT13H\nRRULE:FREQ=DAILY',
    exdates: [],
    kind: 'availability' as const,
    lastCustomerBeforeCloseMinutes: 60,
    lastCustomerAcceptanceMinutes: null,
    timeOverflowMinutes: 60,
  }],
}

describe('organization availability policy', () => {
  it('keeps last customer before close while extending runtime by overflow', () => {
    const windows = resolveOrganizationAvailabilityWindows(policy, {
      start: new Date('2026-09-25T00:00:00.000Z'),
      end: new Date('2026-09-26T00:00:00.000Z'),
    })

    expect(windows).toHaveLength(1)
    expect(windows[0]?.operatingEnd.toISOString()).toBe('2026-09-25T22:00:00.000Z')
    expect(windows[0]?.latestNewBookingStart.toISOString()).toBe('2026-09-25T21:00:00.000Z')
    expect(windows[0]?.end.toISOString()).toBe('2026-09-25T23:00:00.000Z')
  })

  it('accepts a booking at the last-customer boundary and rejects one minute later', () => {
    expect(validateBookingAgainstOrganizationAvailability(policy, {
      startsAt: new Date('2026-09-25T21:00:00.000Z'),
      endsAt: new Date('2026-09-25T22:00:00.000Z'),
    }).valid).toBe(true)

    expect(validateBookingAgainstOrganizationAvailability(policy, {
      startsAt: new Date('2026-09-25T21:01:00.000Z'),
      endsAt: new Date('2026-09-25T22:01:00.000Z'),
    })).toMatchObject({ valid: false, code: 'BOOKING_START_AFTER_LAST_CUSTOMER' })
  })

  it('allows runtime inside overflow but rejects the next minute', () => {
    expect(validateBookingAgainstOrganizationAvailability(policy, {
      startsAt: new Date('2026-09-25T21:00:00.000Z'),
      endsAt: new Date('2026-09-25T23:00:00.000Z'),
    }).valid).toBe(true)

    expect(validateBookingAgainstOrganizationAvailability(policy, {
      startsAt: new Date('2026-09-25T21:00:00.000Z'),
      endsAt: new Date('2026-09-25T23:01:00.000Z'),
    })).toMatchObject({ valid: false, code: 'BOOKING_END_AFTER_OVERFLOW' })
  })

  it('uses the policy configured on the resolved window instead of the legacy organization fallback', () => {
    const windows = resolveOrganizationAvailabilityWindows({
      ...policy,
      lastCustomerBeforeCloseMinutes: 0,
      timeOverflowMinutes: 0,
      rules: [{
        ...policy.rules[0],
        lastCustomerBeforeCloseMinutes: 30,
        timeOverflowMinutes: 90,
      }],
    }, {
      start: new Date('2026-09-25T00:00:00.000Z'),
      end: new Date('2026-09-26T00:00:00.000Z'),
    })

    expect(windows[0]?.latestNewBookingStart.toISOString()).toBe('2026-09-25T21:30:00.000Z')
    expect(windows[0]?.end.toISOString()).toBe('2026-09-25T23:30:00.000Z')
  })

  it('uses the latest policy when legacy duplicate operating windows overlap exactly', () => {
    const windows = resolveOrganizationAvailabilityWindows({
      ...policy,
      rules: [
        {
          ...policy.rules[0],
          id: 'older-rule',
          lastCustomerAcceptanceMinutes: 22 * 60,
          timeOverflowMinutes: 0,
          updatedAt: '2026-09-25T07:47:05.231Z',
        },
        {
          ...policy.rules[0],
          id: 'newer-rule',
          lastCustomerAcceptanceMinutes: 21 * 60,
          timeOverflowMinutes: 60,
          updatedAt: '2026-09-25T08:24:54.357Z',
        },
      ],
    }, {
      start: new Date('2026-09-25T00:00:00.000Z'),
      end: new Date('2026-09-26T00:00:00.000Z'),
    })

    expect(windows).toHaveLength(1)
    expect(windows[0]?.latestNewBookingStart.toISOString()).toBe('2026-09-25T21:00:00.000Z')
    expect(windows[0]?.end.toISOString()).toBe('2026-09-25T23:00:00.000Z')
  })

  it('keeps separate date-specific windows with their own acceptance and overflow policy', () => {
    const windows = resolveOrganizationAvailabilityWindows({
      ...policy,
      rules: [
        {
          ...policy.rules[0],
          id: 'morning-rule',
          rrule: 'DTSTART:20260925T090000Z\nDURATION:PT2H\nRRULE:FREQ=DAILY;COUNT=1',
          lastCustomerAcceptanceMinutes: 10 * 60,
          timeOverflowMinutes: 15,
        },
        {
          ...policy.rules[0],
          id: 'afternoon-rule',
          rrule: 'DTSTART:20260925T140000Z\nDURATION:PT2H\nRRULE:FREQ=DAILY;COUNT=1',
          lastCustomerAcceptanceMinutes: 15 * 60,
          timeOverflowMinutes: 60,
        },
      ],
    }, {
      start: new Date('2026-09-25T00:00:00.000Z'),
      end: new Date('2026-09-26T00:00:00.000Z'),
    })

    expect(windows).toHaveLength(2)
    expect(windows.map((window) => ({
      start: window.start.toISOString(),
      operatingEnd: window.operatingEnd.toISOString(),
      latestNewBookingStart: window.latestNewBookingStart.toISOString(),
      end: window.end.toISOString(),
    }))).toEqual([
      {
        start: '2026-09-25T09:00:00.000Z',
        operatingEnd: '2026-09-25T11:00:00.000Z',
        latestNewBookingStart: '2026-09-25T10:00:00.000Z',
        end: '2026-09-25T11:15:00.000Z',
      },
      {
        start: '2026-09-25T14:00:00.000Z',
        operatingEnd: '2026-09-25T16:00:00.000Z',
        latestNewBookingStart: '2026-09-25T15:00:00.000Z',
        end: '2026-09-25T17:00:00.000Z',
      },
    ])
  })

  it('uses an absolute acceptance time when configured on the window', () => {
    const windows = resolveOrganizationAvailabilityWindows({
      ...policy,
      rules: [{
        ...policy.rules[0],
        lastCustomerBeforeCloseMinutes: null,
        lastCustomerAcceptanceMinutes: 21 * 60,
      }],
    }, {
      start: new Date('2026-09-25T00:00:00.000Z'),
      end: new Date('2026-09-26T00:00:00.000Z'),
    })

    expect(windows[0]?.latestNewBookingStart.toISOString()).toBe('2026-09-25T21:00:00.000Z')
  })

  it('allows an existing booking to finish during overflow without applying last customer cutoff', () => {
    expect(validateBookingRuntimeAgainstOrganizationAvailability(policy, {
      startsAt: new Date('2026-09-25T21:30:00.000Z'),
      endsAt: new Date('2026-09-25T22:30:00.000Z'),
    }).valid).toBe(true)
  })

  it('rejects an existing booking that starts after operating close', () => {
    expect(validateBookingRuntimeAgainstOrganizationAvailability(policy, {
      startsAt: new Date('2026-09-25T22:01:00.000Z'),
      endsAt: new Date('2026-09-25T22:30:00.000Z'),
    })).toMatchObject({ valid: false, code: 'BOOKING_START_OUTSIDE_OPERATING_HOURS' })
  })

  it('resolves absolute acceptance time in the ruleset timezone', () => {
    const windows = resolveOrganizationAvailabilityWindows({
      ...policy,
      timezone: 'Asia/Ho_Chi_Minh',
      rules: [{
        ...policy.rules[0],
        rrule: 'DTSTART:20260925T020000Z\nDURATION:PT13H\nRRULE:FREQ=DAILY',
        lastCustomerBeforeCloseMinutes: null,
        lastCustomerAcceptanceMinutes: 21 * 60,
      }],
    }, {
      start: new Date('2026-09-25T00:00:00.000Z'),
      end: new Date('2026-09-26T00:00:00.000Z'),
    })

    expect(windows[0]?.operatingEnd.toISOString()).toBe('2026-09-25T15:00:00.000Z')
    expect(windows[0]?.latestNewBookingStart.toISOString()).toBe('2026-09-25T14:00:00.000Z')
  })

  it('validates a child resource ruleset against an inherited organization policy', async () => {
    const resourceRuleSet = {
      id: 'resource-ruleset',
      tenantId: 'tenant-1',
      organizationId: 'child-organization',
      timezone: 'UTC',
      deletedAt: null,
    }
    const organizationRuleSet = {
      id: 'organization-ruleset',
      tenantId: 'tenant-1',
      organizationId: 'parent-organization',
      timezone: 'UTC',
      deletedAt: null,
    }
    const settings = {
      organizationId: 'parent-organization',
      operatingHoursRuleSetId: 'organization-ruleset',
      lastCustomerBeforeCloseMinutes: 0,
      timeOverflowMinutes: 0,
    }
    const organizationRule = {
      id: 'organization-rule',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT8H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
    }
    const resourceRule = {
      id: 'resource-rule',
      rrule: 'DTSTART:20260925T090000Z\nDURATION:PT9H\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
    }
    const em = {
      findOne: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.id === resourceRuleSet.id) return resourceRuleSet
        if (where.id === organizationRuleSet.id) return organizationRuleSet
        return null
      }),
      find: jest.fn().mockImplementation(async (_entity, where) => {
        if (!where.subjectType) return [settings]
        if (where.subjectId === organizationRuleSet.id) return [organizationRule]
        if (where.subjectId === resourceRuleSet.id) return [resourceRule]
        return []
      }),
    }

    await expect(validateResourceAvailabilityRuleSetWithinOrganization(em as never, {
      tenantId: 'tenant-1',
      organizationId: 'child-organization',
      organizationIds: ['child-organization', 'parent-organization'],
      resourceRuleSetId: 'resource-ruleset',
    })).resolves.toEqual({
      valid: false,
      code: 'RESOURCE_AVAILABILITY_EXCEEDS_STORE_HOURS',
    })
  })
})
