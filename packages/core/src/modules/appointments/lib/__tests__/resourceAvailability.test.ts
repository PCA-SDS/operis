import { loadResourceAvailabilityWindows } from '../resourceAvailability'

describe('loadResourceAvailabilityWindows', () => {
  it('uses organization overflow for resources linked to the official operating-hours ruleset', async () => {
    const resource = {
      id: 'resource-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
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
      rrule: 'DTSTART:20260925T090000Z\\nDURATION:PT13H\\nRRULE:FREQ=DAILY',
      exdates: [],
      kind: 'availability' as const,
      lastCustomerAcceptanceMinutes: 20 * 60,
      timeOverflowMinutes: 60,
      updatedAt: new Date('2026-09-25T08:00:00.000Z'),
    }
    const settings = {
      organizationId: 'organization-1',
      operatingHoursRuleSetId: 'ruleset-1',
      lastCustomerBeforeCloseMinutes: 0,
      timeOverflowMinutes: 0,
    }
    const em = {
      find: jest.fn().mockImplementation(async (_entity, where) => {
        if (where.subjectType === 'ruleset') return [rule]
        if (where.subjectType === 'resource') return []
        if (where.id?.$in) return [resource]
        if (where.organizationId?.$in) return [settings]
        return []
      }),
      findOne: jest.fn().mockResolvedValue(ruleSet),
    }

    const windows = await loadResourceAvailabilityWindows(em as never, {
      tenantId: 'tenant-1',
      organizationIds: ['organization-1'],
      resourceIds: ['resource-1'],
      range: {
        start: new Date('2026-09-25T00:00:00.000Z'),
        end: new Date('2026-09-26T00:00:00.000Z'),
      },
    })

    expect(windows.get('resource-1')).toEqual([{
      startsAt: '2026-09-25T09:00:00.000Z',
      endsAt: '2026-09-25T23:00:00.000Z',
    }])
  })
})
