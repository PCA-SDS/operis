const TPS_BOOKING_MARKER_PATTERN = /^\[tps-booking-id:[^\]]+\]/i

export function getAppointmentSourceMarker(value: string | null | undefined): string | null {
  const firstLine = value?.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return TPS_BOOKING_MARKER_PATTERN.test(firstLine) ? firstLine : null
}

export function getVisibleAppointmentExternalNotes(value: string | null | undefined): string | null {
  if (!value) return null
  const visible = getAppointmentSourceMarker(value)
    ? value.replace(TPS_BOOKING_MARKER_PATTERN, '').replace(/^\s*\r?\n?/, '').trim()
    : value.trim()
  return visible || null
}

export function preserveAppointmentSourceMarker(
  existingValue: string | null | undefined,
  visibleValue: string | null | undefined,
): string | null {
  const marker = getAppointmentSourceMarker(existingValue)
  const visible = visibleValue?.trim() || ''
  if (!marker) return visible || null
  return visible ? `${marker}\n${visible}` : marker
}
