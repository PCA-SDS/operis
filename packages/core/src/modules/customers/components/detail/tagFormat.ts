export function humanizeCategoryKind(kind: string): string {
  return kind
    .split(/[-_]+/)
    .filter((part) => part.trim().length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
