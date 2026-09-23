import { getAppointmentPermissionSet } from '../permissions'

describe('appointment permissions', () => {
  it('keeps every appointment action unavailable until the chrome payload is ready', () => {
    expect(getAppointmentPermissionSet(['appointments.*'], false)).toEqual({
      canCreate: false,
      canManage: false,
      canManageSettings: false,
      canViewSeatPlanner: false,
    })
  })

  it('maps granular grants to the corresponding appointment actions', () => {
    expect(getAppointmentPermissionSet([
      'appointments.view',
      'appointments.create',
      'appointments.seat_planner.view',
    ], true)).toEqual({
      canCreate: true,
      canManage: false,
      canManageSettings: false,
      canViewSeatPlanner: true,
    })
  })

  it('supports wildcard appointment grants', () => {
    expect(getAppointmentPermissionSet(['appointments.*'], true)).toEqual({
      canCreate: true,
      canManage: true,
      canManageSettings: true,
      canViewSeatPlanner: true,
    })
  })
})
