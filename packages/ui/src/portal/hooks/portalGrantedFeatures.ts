import { apiCall } from '../../backend/utils/apiCall'

export type PortalFeatureCheckResponse = {
  ok: boolean
  granted?: string[]
}

export async function readPortalGrantedFeatures(features: string[]): Promise<Set<string>> {
  if (features.length === 0) return new Set()
  try {
    const { ok, result: data } = await apiCall<PortalFeatureCheckResponse>('/api/customer_accounts/portal/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features }),
    })
    if (!ok || !data?.ok) return new Set()
    return new Set(data.granted ?? [])
  } catch {
    return new Set()
  }
}
