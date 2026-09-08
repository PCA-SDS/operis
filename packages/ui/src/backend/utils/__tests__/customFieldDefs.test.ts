import { fetchCustomFieldDefs, normalizeEntityIds } from '../customFieldDefs'

/**
 * A real `Response` exposes `text()` as well as `json()`, and the code under test
 * reads the body through the shared `readJsonSafe`. The stub used to provide
 * only `json()`, so it was asserting against a shape `fetch` never returns.
 */
const createFetchStub = (payload: unknown) => {
  const json = jest.fn().mockResolvedValue(payload)
  const text = jest.fn().mockResolvedValue(JSON.stringify(payload))
  return Object.assign(jest.fn().mockResolvedValue({ json, text }), { json, text })
}

describe('customFieldDefs utilities', () => {
  it('normalizes entity ids and removes duplicates', () => {
    expect(normalizeEntityIds([' alpha ', 'ALPHA', 'beta', null as any])).toEqual(['alpha', 'ALPHA', 'beta'])
  })

  it('fetches definitions via provided fetch implementation and sorts by priority', async () => {
    const stub = createFetchStub({
      items: [
        { key: 'b', priority: 5 },
        { key: 'a', priority: 1 },
        { key: 'c' },
      ],
    })
    const defs = await fetchCustomFieldDefs(['entity.one'], stub as unknown as typeof fetch)
    expect(stub).toHaveBeenCalledWith('/api/entities/definitions?entityId=entity.one', expect.any(Object))
    expect(defs.map((d) => d.key)).toEqual(['c', 'a', 'b'])
  })
})
