import { fetchGdtRecords, iterateGdtWindows } from '../gdt/gdt-fetcher'
import type { GdtClient } from '../gdt'

describe('GDT fetcher', () => {
  it('creates contiguous inclusive date windows', () => {
    expect(iterateGdtWindows(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'), 31)).toEqual([
      { fromDate: '2026-01-01', toDate: '2026-01-31' },
      { fromDate: '2026-02-01', toDate: '2026-02-01' },
    ])
  })

  it('iterates pages for both date windows', async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce({ items: [{ id: 1 }], hasNext: true })
      .mockResolvedValueOnce({ items: [{ id: 2 }], hasNext: false })
    const records = []
    for await (const record of fetchGdtRecords({
      client: { fetchPage } as unknown as GdtClient,
      stream: 'purchased',
      token: 'secret',
      fromDate: new Date('2026-01-01T00:00:00Z'),
      toDate: new Date('2026-01-01T00:00:00Z'),
    })) records.push(record)

    expect(records).toEqual([{ id: 1 }, { id: 2 }])
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ stream: 'purchased', pageSize: 100, page: 1 }))
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
  })
})
