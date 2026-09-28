import type React from 'react'
import { toDateInputValue as toDateInputValueOrNull } from '@open-mercato/shared/lib/date/format'

export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function toDateInputValue(value: string | null | undefined): string {
  return toDateInputValueOrNull(value) ?? ''
}

export function openNativeDatePicker(event: React.SyntheticEvent<HTMLInputElement>) {
  const input = event.currentTarget
  if (typeof input.showPicker === 'function') {
    input.showPicker()
  }
}
