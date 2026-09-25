import { ResourceAssignmentService } from '../resourceAssignmentService'
import { AssignmentConflictService } from '../assignmentConflict'

describe('ResourceAssignmentService.confirmDrafts', () => {
  it('leaves an existing confirmed assignment untouched when there is no draft', async () => {
    const em = {
      find: jest.fn().mockResolvedValueOnce([]),
      flush: jest.fn(),
    }
    const service = new ResourceAssignmentService(em as never)

    await expect(service.confirmDrafts({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: 'line-1',
    })).resolves.toEqual([])

    expect(em.find).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects confirming a draft when its version is stale', async () => {
    const em = {
      find: jest.fn().mockResolvedValueOnce([{
        id: 'assignment-1',
        sourceEntityId: 'line-1',
        updatedAt: new Date('2026-09-14T10:00:00.000Z'),
      }]),
      flush: jest.fn(),
    }
    const service = new ResourceAssignmentService(em as never)

    await expect(service.confirmDrafts({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: 'line-1',
      expectedUpdatedAt: '2026-09-14T09:00:00.000Z',
    })).rejects.toMatchObject({ status: 409 })

    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('ResourceAssignmentService.upsertDraft', () => {
  it('preserves a confirmed assignment when requested', async () => {
    const confirmed = {
      id: 'assignment-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: 'line-1',
      resource: { id: 'resource-1' },
      state: 'confirmed' as const,
      startsAt: new Date('2026-09-21T09:00:00.000Z'),
      endsAt: new Date('2026-09-21T10:00:00.000Z'),
      assignedMemberId: 'member-1',
      assignedMemberIds: ['member-1'],
      title: 'Service',
      createdAt: new Date('2026-09-21T08:00:00.000Z'),
      updatedAt: new Date('2026-09-21T08:00:00.000Z'),
    }
    const em = {
      find: jest.fn().mockResolvedValue([confirmed]),
      assign: jest.fn((target, values) => Object.assign(target, values)),
      flush: jest.fn(),
      refresh: jest.fn(),
    }
    const validation = jest.spyOn(AssignmentConflictService.prototype, 'validateAssignment').mockResolvedValue({ valid: true })

    try {
      const service = new ResourceAssignmentService(em as never)
      const result = await service.upsertDraft({
        tenantId: 'tenant-1',
        organizationId: 'organization-1',
        sourceModule: 'appointment',
        sourceEntityType: 'appointment_line',
        sourceEntityId: 'line-1',
        resourceId: 'resource-2',
        startsAt: new Date('2026-09-21T10:00:00.000Z'),
        endsAt: new Date('2026-09-21T11:00:00.000Z'),
        assignedMemberId: 'member-2',
        preserveState: true,
      })

      expect(result.state).toBe('confirmed')
      expect(confirmed.state).toBe('confirmed')
      expect(confirmed.startsAt.toISOString()).toBe('2026-09-21T10:00:00.000Z')
      expect(confirmed.endsAt.toISOString()).toBe('2026-09-21T11:00:00.000Z')
      expect(em.flush).toHaveBeenCalledTimes(1)
    } finally {
      validation.mockRestore()
    }
  })
})

describe('ResourceAssignmentService.getWorkspace', () => {
  it('orders resources by area order and then resource order', async () => {
    const em = {
      find: jest.fn()
        .mockResolvedValueOnce([
          { id: 'resource-b', name: 'B', areaId: 'area-2', sortOrder: 0, code: 'B' },
          { id: 'resource-a', name: 'A', areaId: 'area-1', sortOrder: 10, code: 'A' },
          { id: 'resource-c', name: 'C', areaId: 'area-1', sortOrder: 1, code: 'C' },
        ])
        .mockResolvedValueOnce([
          { id: 'area-2', name: 'Second area', sortOrder: 20 },
          { id: 'area-1', name: 'First area', sortOrder: 10 },
        ])
        .mockResolvedValueOnce([]),
    }
    const service = new ResourceAssignmentService(em as never)

    await expect(service.getWorkspace({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
    })).resolves.toMatchObject({
      resources: [
        { id: 'resource-c', areaName: 'First area' },
        { id: 'resource-a', areaName: 'First area' },
        { id: 'resource-b', areaName: 'Second area' },
      ],
    })
  })
})

describe('ResourceAssignmentService.clearDraft', () => {
  it('rejects clearing a draft when its version is stale', async () => {
    const em = {
      findOne: jest.fn().mockResolvedValue({
        id: 'assignment-1',
        updatedAt: new Date('2026-09-14T10:00:00.000Z'),
      }),
      flush: jest.fn(),
    }
    const service = new ResourceAssignmentService(em as never)

    await expect(service.clearDraft({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: 'line-1',
      expectedUpdatedAt: '2026-09-14T09:00:00.000Z',
    })).rejects.toMatchObject({ status: 409 })

    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('ResourceAssignmentService.cancelAssignmentsForSourceEntities', () => {
  it('cancels active assignments for the scoped source entities', async () => {
    const assignments = [
      { cancelledAt: null, updatedAt: new Date('2026-09-18T10:00:00.000Z') },
      { cancelledAt: null, updatedAt: new Date('2026-09-18T10:00:00.000Z') },
    ]
    const em = {
      find: jest.fn().mockResolvedValue(assignments),
      flush: jest.fn(),
    }
    const service = new ResourceAssignmentService(em as never)

    await expect(service.cancelAssignmentsForSourceEntities({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityIds: ['line-1', 'line-2'],
    })).resolves.toBe(2)

    expect(em.find).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      sourceModule: 'appointment',
      sourceEntityType: 'appointment_line',
      sourceEntityId: { $in: ['line-1', 'line-2'] },
      cancelledAt: null,
    })
    expect(assignments.every((assignment) => assignment.cancelledAt instanceof Date)).toBe(true)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
