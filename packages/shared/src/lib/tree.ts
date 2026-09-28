/**
 * Label for an entry in a flattened tree select: nested entries are indented
 * with non-breaking spaces (two per level below the first) and marked `↳`, so
 * the hierarchy survives in a plain `<option>` list.
 */
export function formatTreeLabel(name: string, depth: number): string {
  if (depth <= 0) return name
  const indent = '\u00A0'.repeat(Math.max(0, (depth - 1) * 2))
  return `${indent}↳ ${name}`
}
