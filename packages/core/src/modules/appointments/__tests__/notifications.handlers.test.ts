import { notificationHandlers } from '../notifications.handlers'

describe('appointments notification handlers', () => {
  it('shows a toast with a link to the created appointment', () => {
    const toast = jest.fn()
    const navigate = jest.fn()

    const handler = notificationHandlers[0]
    handler.handle(
      {
        id: 'notification-1',
        type: 'appointments.appointment.created',
        title: 'New appointment',
        body: 'A new appointment has been created.',
        severity: 'info',
        status: 'unread',
        linkHref: '/backend/appointments/appointment-1',
        actions: [],
        createdAt: new Date().toISOString(),
      },
      {
        features: ['appointments.view'],
        currentPath: '/backend/appointments',
        toast,
        popup: jest.fn(),
        emitEvent: jest.fn(),
        refreshNotifications: jest.fn(),
        navigate,
        markAsRead: jest.fn(),
        dismiss: jest.fn(),
      },
    )

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New appointment',
      body: 'A new appointment has been created.',
      severity: 'info',
    }))

    const toastOptions = toast.mock.calls[0][0] as { action?: { onClick: () => void } }
    toastOptions.action?.onClick()
    expect(navigate).toHaveBeenCalledWith('/backend/appointments/appointment-1')
  })
})
