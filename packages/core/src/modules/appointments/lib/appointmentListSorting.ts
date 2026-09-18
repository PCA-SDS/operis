type AppointmentListSortRow = {
  scheduleConfirmationStatus: 'confirmed' | 'unconfirmed' | 'not_applicable'
  createdAt: string
  requestedStartAt: string
}

export function compareAppointmentListRows(
  left: AppointmentListSortRow,
  right: AppointmentListSortRow,
): number {
  const leftPinned = left.scheduleConfirmationStatus === 'unconfirmed'
  const rightPinned = right.scheduleConfirmationStatus === 'unconfirmed'
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1

  const urgencyOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt)
  if (urgencyOrder !== 0) return urgencyOrder
  return Date.parse(right.requestedStartAt) - Date.parse(left.requestedStartAt)
}
