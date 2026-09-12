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
})
