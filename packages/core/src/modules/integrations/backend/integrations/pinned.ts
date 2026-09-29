export const DEFAULT_PINNED_INTEGRATION_IDS: readonly string[] = [
  'resend',
  'ai_anthropic',
  'sync_excel',
  'channel_gmail',
  'ai_google',
  'ai_groq',
  'ai_openai',
]

export const PINNED_INTEGRATIONS_STORAGE_KEY = 'om:integrations:marketplace:pinned:v1'

export function parsePinnedIntegrationIds(raw: string | null): string[] {
  if (raw === null) return [...DEFAULT_PINNED_INTEGRATION_IDS]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_PINNED_INTEGRATION_IDS]
    return Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)))
  } catch {
    return [...DEFAULT_PINNED_INTEGRATION_IDS]
  }
}

export function readPinnedIntegrationIds(): string[] {
  try {
    return parsePinnedIntegrationIds(window.localStorage.getItem(PINNED_INTEGRATIONS_STORAGE_KEY))
  } catch {
    return [...DEFAULT_PINNED_INTEGRATION_IDS]
  }
}

export function writePinnedIntegrationIds(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(PINNED_INTEGRATIONS_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    return
  }
}

export function clearPinnedIntegrationIds(): void {
  try {
    window.localStorage.removeItem(PINNED_INTEGRATIONS_STORAGE_KEY)
  } catch {
    return
  }
}

export function togglePinnedIntegrationId(ids: readonly string[], id: string, pinned: boolean): string[] {
  const without = ids.filter((existing) => existing !== id)
  return pinned ? [...without, id] : without
}
