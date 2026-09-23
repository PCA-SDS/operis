import { AppointmentSeatPlannerService, resolveSeatPlannerAssignment } from '../seatPlannerService'

const confirmedAssignment = {
  id: 'confirmed-assignment',
  resourceId: 'resource-1',
  state: 'confirmed' as const,
  startsAt: '2026-09-21T09:00:00.000Z',
  endsAt: '2026-09-21T10:00:00.000Z',
  assignedMemberIds: ['member-1'],
  sourceModule: 'appointment',
  sourceEntityType: 'appointment_line',
  sourceEntityId: 'line-1',
  createdAt: '2026-09-21T08:00:00.000Z',
  updatedAt: '2026-09-21T08:00:00.000Z',
}

const draftAssignment = {
  ...confirmedAssignment,
  id: 'draft-assignment',
  state: 'draft' as const,
  resourceId: 'resource-2',
  updatedAt: '2026-09-21T08:30:00.000Z',
}

describe('resolveSeatPlannerAssignment', () => {
  it('prefers the draft over the confirmed baseline', () => {
    expect(resolveSeatPlannerAssignment([confirmedAssignment, draftAssignment])).toBe(draftAssignment)
  })

  it('hides both draft and confirmed assignments after clear', () => {
    expect(resolveSeatPlannerAssignment(
      [confirmedAssignment, draftAssignment],
      new Date('2026-09-21T09:00:00.000Z'),
    )).toBeUndefined()
  })

  it('shows the confirmed assignment when no draft exists and the line was not cleared', () => {
    expect(resolveSeatPlannerAssignment([confirmedAssignment])).toBe(confirmedAssignment)
  })

  it('shows a newly saved draft after the cleared marker is removed', () => {
    expect(resolveSeatPlannerAssignment([draftAssignment], null)).toBe(draftAssignment)
  })
})

describe('AppointmentSeatPlannerService.clearDraft', () => {
  it('persists the cleared marker without changing the confirmed assignment', async () => {
    const line = {
      id: 'line-1',
      seatPlannerClearedAt: null,
    }
    const em = {
      findOne: jest.fn().mockImplementation((_entity, where) => where.id === 'line-1' ? line : null),
      flush: jest.fn(),
    }
    const service = new AppointmentSeatPlannerService(em as never)

    await service.clearDraft({
      appointmentId: 'appointment-1',
      lineId: 'line-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(line.seatPlannerClearedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
