import type { GdtClient } from '../gdt'
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
  for (const window of iterateGdtWindows(input.fromDate, input.toDate, input.windowDays ?? 31)) {
    let page = 1
    while (true) {
      const result = await input.client.fetchPage({
        stream: input.stream,
        token: input.token,
        fromDate: window.fromDate,
        toDate: window.toDate,
        page,
        pageSize: input.pageSize ?? 100,
      })
      for (const item of result.items) yield item
      if (!result.hasNext || result.items.length === 0) break
      page += 1
    }
  }
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
