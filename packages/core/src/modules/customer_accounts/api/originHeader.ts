import { NextResponse } from 'next/server'

export const ORIGIN_HEADER_NAME = process.env.CUSTOMER_DOMAIN_ORIGIN_HEADER ?? 'X-Open-Mercato-Origin'

export function withOriginHeader(response: NextResponse): NextResponse {
  response.headers.set(ORIGIN_HEADER_NAME, '1')
  return response
}
