import handle from '../appointment-created-notification'

const createForFeatureMock = jest.fn(async () => {})
const resolveNotificationServiceMock = jest.fn(() => ({ createForFeature: createForFeatureMock }))
const buildFeatureNotificationFromTypeMock = jest.fn(() => ({ type: 'appointments.appointment.created' }))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))
jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildFeatureNotificationFromType: (...args: unknown[]) => buildFeatureNotificationFromTypeMock(...args),
}))
jest.mock('@open-mercato/core/modules/appointments/notifications', () => ({
  notificationTypes: [
    {
      type: 'appointments.appointment.created',
      module: 'appointments',
      titleKey: 'appointments.notifications.appointment.created.title',
    },
  ],
}))

describe('appointment-created-notification subscriber', () => {
  const ctx = { resolve: jest.fn() }
  const payload = {
    id: 'appointment-1',
    tenantId: 'tenant-1',
    organizationId: 'organization-1',
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('fans out to users with appointment access in the appointment organization', async () => {
    await handle(payload, ctx)

    expect(resolveNotificationServiceMock).toHaveBeenCalledWith(ctx)
    expect(buildFeatureNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'appointments.appointment.created' }),
      expect.objectContaining({
        requiredFeature: 'appointments.view',
        sourceEntityType: 'appointment',
        sourceEntityId: 'appointment-1',
        linkHref: '/backend/appointments/appointment-1',
        groupKey: 'appointment.created:appointment-1',
      }),
    )
    expect(createForFeatureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'appointments.appointment.created',
        restrictRecipientsToOrganization: true,
      }),
      { tenantId: 'tenant-1', organizationId: 'organization-1' },
    )
  })
})
