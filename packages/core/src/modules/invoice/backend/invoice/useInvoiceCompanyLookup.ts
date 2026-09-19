'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { isValidSingaporeUen, normalizeSingaporeUen, type InvoiceCompanyLookupResult } from '../../data/validators'

const LOOKUP_DEBOUNCE_MS = 500

export type InvoiceCompanyLookupState = {
  company: InvoiceCompanyLookupResult['company']
  isLoading: boolean
  notFound: boolean
  unavailable: boolean
}

class InvoiceCompanyLookupRequestError extends Error {
  constructor(readonly status: number) {
    super('[internal] Invoice company lookup request failed')
    this.name = 'InvoiceCompanyLookupRequestError'
  }
}

export function useInvoiceCompanyLookup(
  identifier: string,
  countryCode: string,
  enabled = true,
): InvoiceCompanyLookupState {
  const [debouncedIdentifier, setDebouncedIdentifier] = useState(() => normalizeSingaporeUen(identifier))

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedIdentifier(normalizeSingaporeUen(identifier)), LOOKUP_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [identifier])

  const normalizedIdentifier = normalizeSingaporeUen(debouncedIdentifier)
  const shouldLookup = enabled && countryCode === 'SG' && isValidSingaporeUen(normalizedIdentifier)
  const query = useQuery<InvoiceCompanyLookupResult, InvoiceCompanyLookupRequestError>({
    queryKey: ['invoice', 'company-lookup', countryCode, normalizedIdentifier],
    enabled: shouldLookup,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const queryParams = new URLSearchParams({ country: 'SG' })
      const call = await apiCall<InvoiceCompanyLookupResult>(
        `/api/invoice/company-lookup/${encodeURIComponent(normalizedIdentifier)}?${queryParams.toString()}`,
        { signal },
      )
      if (!call.ok) throw new InvoiceCompanyLookupRequestError(call.status)
      if (!call.result) throw new InvoiceCompanyLookupRequestError(503)
      return call.result
    },
  })

  return {
    company: query.data?.company ?? null,
    isLoading: shouldLookup && query.isFetching,
    notFound: query.error?.status === 404,
    unavailable: query.error != null && query.error.status !== 404 && query.error.status !== 400,
  }
}
