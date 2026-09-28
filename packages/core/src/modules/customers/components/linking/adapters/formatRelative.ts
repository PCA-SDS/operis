export function formatRelative(dateString: string | null): string {
  if (!dateString) return ''
  try {
    const date = new Date(dateString)
    const now = Date.now()
    const diffMs = now - date.getTime()
    const diffDays = Math.floor(diffMs / 86_400_000)
    if (diffDays <= 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 30) return `${diffDays} days ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
    return `${Math.floor(diffDays / 365)} years ago`
  } catch {
    return ''
  }
}
