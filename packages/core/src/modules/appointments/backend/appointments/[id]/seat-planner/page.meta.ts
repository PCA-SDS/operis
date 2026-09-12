import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['appointments.view', 'appointments.seat_planner.view'],
  titleKey: 'appointments.seatPlanner.title',
  title: 'Seat Planner',
}

export default metadata
