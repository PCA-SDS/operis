import { hasFeature } from '@open-mercato/shared/security/features'

export type AppointmentPermissionSet = {
  canCreate: boolean
  canManage: boolean
  canManageSettings: boolean
  canViewSeatPlanner: boolean
}

export function getAppointmentPermissionSet(
  grantedFeatures: readonly string[] | undefined,
  isReady: boolean,
): AppointmentPermissionSet {
  return {
    canCreate: isReady && hasFeature(grantedFeatures, 'appointments.create'),
    canManage: isReady && hasFeature(grantedFeatures, 'appointments.manage'),
    canManageSettings: isReady && hasFeature(grantedFeatures, 'appointments.settings.manage'),
    canViewSeatPlanner: isReady && hasFeature(grantedFeatures, 'appointments.seat_planner.view'),
  }
}
