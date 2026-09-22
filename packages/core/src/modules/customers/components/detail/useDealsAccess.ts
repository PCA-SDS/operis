"use client"

import * as React from 'react'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { DEALS_IN_PRODUCT } from '@open-mercato/shared/lib/product-scope'

export type DealsAccess = {
  canViewDeals: boolean
  isReady: boolean
}

export function useDealsAccess(): DealsAccess {
  const { payload, isReady } = useBackendChrome()
  const canViewDeals = React.useMemo(
    () =>
      DEALS_IN_PRODUCT && hasFeature(payload?.grantedFeatures ?? [], 'customers.deals.view'),
    [payload?.grantedFeatures],
  )
  return { canViewDeals, isReady }
}
