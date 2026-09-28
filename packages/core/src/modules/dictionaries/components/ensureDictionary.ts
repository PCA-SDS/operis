import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type DictionarySummary = {
  id: string
  key: string
  name: string
}

export async function ensureDictionary(key: string, name: string): Promise<DictionarySummary | null> {
  const listCall = await apiCall<{ items?: DictionarySummary[] }>('/api/dictionaries')
  const items = Array.isArray(listCall.result?.items) ? listCall.result?.items ?? [] : []
  const existing = items.find((item) => item && item.key === key)
  if (existing) return existing
  if (!listCall.ok) return null
  const created = await apiCallOrThrow<DictionarySummary>(
    '/api/dictionaries',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, name }),
    },
  )
  const result = created.result as DictionarySummary | undefined
  if (result && result.id && result.key) return result
  return null
}
