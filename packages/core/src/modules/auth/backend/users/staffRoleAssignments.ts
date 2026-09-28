export function dedupeRoleOptionsByLabel<T extends { label: string }>(options: readonly T[]): T[] {
  const optionsByLabel = new Map<string, T>()
  for (const option of options) {
    const labelKey = option.label.trim()
    if (!optionsByLabel.has(labelKey)) optionsByLabel.set(labelKey, option)
  }
  return Array.from(optionsByLabel.values())
}
