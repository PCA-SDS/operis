const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * Render a byte count for display.
 *
 * Five near-copies of this existed (WMS import dialog, sync_excel upload widget,
 * the attachment library, the chat composer and the attachment metadata dialog)
 * and they disagreed: 1500 bytes rendered as `1 KB` in one and `1.5 KB` in the
 * others, and a non-finite value produced `NaN B`, `—` or an empty string
 * depending on which screen you were on. This is the single behaviour.
 *
 * Bytes stay whole (`512 B`); every larger unit carries one decimal
 * (`1.5 KB`, `5.0 MB`). A non-finite input renders as an em dash rather than
 * `NaN B`.
 */
export function formatFileSize(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value <= 0) return '0 B'

  let index = 0
  let current = value
  while (current >= 1024 && index < FILE_SIZE_UNITS.length - 1) {
    current /= 1024
    index += 1
  }

  return `${current.toFixed(index === 0 ? 0 : 1)} ${FILE_SIZE_UNITS[index]}`
}
