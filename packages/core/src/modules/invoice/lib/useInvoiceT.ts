'use client'

import { useCallback } from 'react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import english from '@open-mercato/core/modules/invoice/i18n/en.json'

export function useInvoiceT(): TranslateFn {
  const translate = useT()
  return useCallback<TranslateFn>((key, fallbackOrParams, params) => {
    const fallback = typeof fallbackOrParams === 'string'
      ? fallbackOrParams
      : (english as Record<string, string>)[key]
    return translate(key, fallback, typeof fallbackOrParams === 'object' ? fallbackOrParams : params)
  }, [translate])
}
