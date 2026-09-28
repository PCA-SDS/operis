import { resolveLocaleFromAcceptLanguage } from '@open-mercato/shared/lib/i18n/locale'
import { readCookieFromHeader } from '@open-mercato/shared/lib/http/cookies'

function parseAcceptLanguage(accept: string): string | null {
  return resolveLocaleFromAcceptLanguage(accept)
}

export function resolveLocaleFromRequest(request: Request): string | null {
  const url = new URL(request.url)
  const queryLocale = url.searchParams.get('locale')
  if (queryLocale && queryLocale.length >= 2 && queryLocale.length <= 10) return queryLocale

  const headerLocale = request.headers.get('x-locale')
  if (headerLocale && headerLocale.length >= 2 && headerLocale.length <= 10) return headerLocale

  const cookieHeader = request.headers.get('cookie')
  if (cookieHeader) {
    const cookieLocale = readCookieFromHeader(cookieHeader, 'locale')
    if (cookieLocale && cookieLocale.length >= 2 && cookieLocale.length <= 10) return cookieLocale
  }

  const acceptLang = request.headers.get('accept-language')
  if (acceptLang) {
    const parsed = parseAcceptLanguage(acceptLang)
    if (parsed) return parsed
  }

  return null
}
