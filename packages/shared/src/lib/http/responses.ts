import { NextResponse } from 'next/server'
import { resolveTranslations } from '../i18n/server'

/** A 401 with the translated `api.errors.unauthorized` message. */
export async function unauthorizedResponse() {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

/** A JSON `Response` (status 200 unless `init` says otherwise) that keeps any headers `init` adds. */
export function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}
