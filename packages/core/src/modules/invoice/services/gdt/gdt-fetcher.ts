import type { GdtClient } from '../gdt-client-implementation'
import type { GdtFetchWindow, GdtStream, GdtWireRecord } from './types'

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function iterateGdtWindows(fromDate: Date, toDate: Date, windowDays = 31): GdtFetchWindow[] {
  const windows: GdtFetchWindow[] = []
  const cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()))
  const end = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()))
  while (cursor <= end) {
    const windowEnd = new Date(cursor)
    windowEnd.setUTCDate(windowEnd.getUTCDate() + windowDays - 1)
    if (windowEnd > end) windowEnd.setTime(end.getTime())
    windows.push({ fromDate: isoDate(cursor), toDate: isoDate(windowEnd) })
    cursor.setUTCDate(windowEnd.getUTCDate() + 1)
  }
  return windows
}

export async function* fetchGdtRecords(input: {
  client: GdtClient
  stream: GdtStream
  token: string
  fromDate: Date
  toDate: Date
  pageSize?: number
  windowDays?: number
}): AsyncGenerator<GdtWireRecord> {
  const windowDays = input.windowDays ?? positiveInteger(process.env.GDT_FETCH_WINDOW_DAYS, 31)
  const pageSize = input.pageSize ?? positiveInteger(process.env.GDT_PAGE_SIZE, 15)
  const pacingMs = nonNegativeInteger(process.env.GDT_REQUEST_PACING_MS, 400)
  let firstRequest = true
  for (const window of iterateGdtWindows(input.fromDate, input.toDate, windowDays)) {
    let cursor: string | undefined
    while (true) {
      if (!firstRequest && pacingMs > 0) await new Promise((resolve) => setTimeout(resolve, pacingMs))
      firstRequest = false
      const result = await input.client.fetchPage({
        stream: input.stream,
        token: input.token,
        fromDate: window.fromDate,
        toDate: window.toDate,
        cursor,
        pageSize,
      })
      for (const item of result.items) yield item
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export class GdtFetcherService {
  constructor(private readonly client: GdtClient) {}

  fetch(input: Omit<Parameters<typeof fetchGdtRecords>[0], 'client'>): AsyncGenerator<GdtWireRecord> {
    return fetchGdtRecords({ ...input, client: this.client })
  }
}

export function createGdtFetcherService(client: GdtClient): GdtFetcherService {
  return new GdtFetcherService(client)
}
