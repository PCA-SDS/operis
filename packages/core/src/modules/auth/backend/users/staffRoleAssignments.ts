export function normalizeRoleName(label: string): string {
  return label.trim()
}

export function dedupeRoleOptionsByLabel<T extends { label: string }>(options: readonly T[]): T[] {
  const optionsByLabel = new Map<string, T>()
  for (const option of options) {
    const labelKey = normalizeRoleName(option.label)
    if (!optionsByLabel.has(labelKey)) optionsByLabel.set(labelKey, option)
  }
  return Array.from(optionsByLabel.values())
}
