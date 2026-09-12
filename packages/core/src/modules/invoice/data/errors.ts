import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TranslateParams } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'

const ERROR_KEY_FIELD = 'errorKey'
const ERROR_PARAMS_FIELD = 'errorParams'

/**
 * Invoice domain errors are raised in the services, where no request translator
 * is in scope, and every one of them leaves through a route funnel that returns
 * `err.body` verbatim. Carrying the key on the body lets that funnel translate
 * it — `#353` set the convention with `context.translate('invoice.errors.…')`
 * at the route, and this is the same contract for throws that happen deeper.
 *
 * The English text stays on the body as the fallback, so a locale missing the
 * key renders exactly what it rendered before.
 */
export function invoiceError(
  status: number,
  key: string,
  fallback: string,
  params?: TranslateParams,
): CrudHttpError {
  return new CrudHttpError(status, {
    error: fallback,
    [ERROR_KEY_FIELD]: key,
    ...(params ? { [ERROR_PARAMS_FIELD]: params } : {}),
  })
}

export function invoiceBadRequest(key: string, fallback: string, params?: TranslateParams): CrudHttpError {
  return invoiceError(400, key, fallback, params)
}

export function invoiceNotFound(key: string, fallback: string, params?: TranslateParams): CrudHttpError {
  return invoiceError(404, key, fallback, params)
}

export function invoiceConflict(key: string, fallback: string, params?: TranslateParams): CrudHttpError {
  return invoiceError(409, key, fallback, params)
}

/**
 * Resolves a keyed body for the response and drops the routing fields. A body
 * without a key is returned untouched, so errors raised by shared helpers pass
 * through unchanged.
 */
export function translateInvoiceErrorBody(
  body: Record<string, unknown>,
  translate: TranslateWithFallbackFn,
): Record<string, unknown> {
  const key = body[ERROR_KEY_FIELD]
  if (typeof key !== 'string') return body

  const { [ERROR_KEY_FIELD]: _key, [ERROR_PARAMS_FIELD]: rawParams, ...rest } = body
  const params = rawParams && typeof rawParams === 'object' ? rawParams as TranslateParams : undefined
  const fallback = typeof body.error === 'string' ? body.error : undefined

  return { ...rest, error: translate(key, fallback, params) }
}
