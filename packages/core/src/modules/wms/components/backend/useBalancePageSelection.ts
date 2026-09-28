import * as React from 'react'

/**
 * Row checkboxes for the current page of a balances table: toggle one row, toggle the whole page,
 * and the header checkbox state. The selected ids stay page state because the pages also read and
 * clear them elsewhere.
 */
export function useBalancePageSelection(
  pagedBalances: ReadonlyArray<{ id: string }>,
  selectedBalanceIds: ReadonlySet<string>,
  setSelectedBalanceIds: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  const toggleBalanceSelection = React.useCallback((balanceId: string, selected: boolean) => {
    setSelectedBalanceIds((current) => {
      const next = new Set(current)
      if (selected) next.add(balanceId)
      else next.delete(balanceId)
      return next
    })
  }, [setSelectedBalanceIds])

  const togglePageSelection = React.useCallback((selected: boolean) => {
    setSelectedBalanceIds((current) => {
      const next = new Set(current)
      for (const row of pagedBalances) {
        if (selected) next.add(row.id)
        else next.delete(row.id)
      }
      return next
    })
  }, [pagedBalances, setSelectedBalanceIds])

  const pageSelectionState = React.useMemo(() => {
    if (pagedBalances.length === 0) {
      return { checked: false, indeterminate: false }
    }
    const selectedOnPage = pagedBalances.filter((row) => selectedBalanceIds.has(row.id)).length
    return {
      checked: selectedOnPage === pagedBalances.length,
      indeterminate: selectedOnPage > 0 && selectedOnPage < pagedBalances.length,
    }
  }, [pagedBalances, selectedBalanceIds])

  return { toggleBalanceSelection, togglePageSelection, pageSelectionState }
}
