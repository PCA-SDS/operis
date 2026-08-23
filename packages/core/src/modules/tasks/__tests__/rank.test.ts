import { RANK_STEP, bottomRank, rankForMove } from '../lib/rank'

describe('bottomRank', () => {
  it('starts a column at one step', () => {
    expect(bottomRank(null)).toBe(RANK_STEP)
    expect(bottomRank(undefined)).toBe(RANK_STEP)
  })

  it('steps past the current maximum', () => {
    expect(bottomRank(2048)).toBe(2048 + RANK_STEP)
  })
})

describe('rankForMove', () => {
  const column = [
    { id: 'a', rank: 1000 },
    { id: 'b', rank: 2000 },
    { id: 'c', rank: 3000 },
  ]

  it('bisects the two neighbours', () => {
    expect(rankForMove(column, 'a')).toBe(1500)
    expect(rankForMove(column, 'b')).toBe(2500)
  })

  it('steps below the first row when dropping at the top', () => {
    expect(rankForMove(column, null)).toBe(1000 - RANK_STEP)
  })

  it('steps past the last row when dropping after it', () => {
    expect(rankForMove(column, 'c')).toBe(3000 + RANK_STEP)
  })

  it('appends when the anchor is not in the column', () => {
    // Stale client state — the move should still land somewhere sensible
    // rather than throwing or silently going to the top.
    expect(rankForMove(column, 'gone')).toBe(3000 + RANK_STEP)
  })

  it('starts an empty column at one step regardless of the anchor', () => {
    expect(rankForMove([], null)).toBe(RANK_STEP)
    expect(rankForMove([], 'anything')).toBe(RANK_STEP)
  })

  it('keeps bisecting without ever colliding', () => {
    let rows = [
      { id: 'a', rank: 1000 },
      { id: 'b', rank: 2000 },
    ]
    const seen = new Set(rows.map((row) => row.rank))
    for (let index = 0; index < 20; index++) {
      const rank = rankForMove(rows, 'a')
      expect(seen.has(rank)).toBe(false)
      seen.add(rank)
      rows = [rows[0]!, { id: `n${index}`, rank }, ...rows.slice(1)].sort((a, b) => a.rank - b.rank)
    }
  })
})
