import { ResourceAssignmentService } from '../resourceAssignmentService'

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
