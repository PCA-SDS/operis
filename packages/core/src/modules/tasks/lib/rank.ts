// Board ordering. `rank` is a double so a move can bisect two neighbours
// without renumbering the column; a move to the top or bottom steps outside the
// current range instead.

export const RANK_STEP = 1024

export type RankedRow = { id: string; rank: number }

/** Rank for a task appended to the bottom of a column. */
export function bottomRank(currentMaxRank: number | null | undefined): number {
  return (currentMaxRank ?? 0) + RANK_STEP
}

/**
 * Rank that positions `movedId` directly after `afterTaskId` in `column`.
 *
 * - `afterTaskId === null` → the top of the column.
 * - an `afterTaskId` that is not in the column (stale client state) → the
 *   bottom, so the move still lands somewhere sensible.
 *
 * `column` MUST be ordered ascending by rank and MUST NOT contain the moved
 * task itself.
 */
export function rankForMove(column: readonly RankedRow[], afterTaskId: string | null): number {
  if (afterTaskId === null) {
    const first = column[0]
    return first ? first.rank - RANK_STEP : RANK_STEP
  }

  const index = column.findIndex((row) => row.id === afterTaskId)
  if (index === -1) {
    const last = column[column.length - 1]
    return last ? last.rank + RANK_STEP : RANK_STEP
  }

  const afterRank = column[index]?.rank ?? 0
  const next = column[index + 1]
  return next ? (afterRank + next.rank) / 2 : afterRank + RANK_STEP
}
