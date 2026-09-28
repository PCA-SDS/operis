/** @jest-environment jsdom */
import * as React from 'react'
import { act, renderHook } from '@testing-library/react'
import { useBalancePageSelection } from '../useBalancePageSelection'

function useHarness(pagedBalances: Array<{ id: string }>, initial: string[] = []) {
  const [selectedBalanceIds, setSelectedBalanceIds] = React.useState<Set<string>>(() => new Set(initial))
  const controls = useBalancePageSelection(pagedBalances, selectedBalanceIds, setSelectedBalanceIds)
  return { selectedBalanceIds, ...controls }
}

describe('useBalancePageSelection', () => {
  const page = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('reports an empty page as unchecked', () => {
    const { result } = renderHook(() => useHarness([]))
    expect(result.current.pageSelectionState).toEqual({ checked: false, indeterminate: false })
  })

  it('toggles single rows and derives the header state', () => {
    const { result } = renderHook(() => useHarness(page))
    act(() => result.current.toggleBalanceSelection('b', true))
    expect([...result.current.selectedBalanceIds]).toEqual(['b'])
    expect(result.current.pageSelectionState).toEqual({ checked: false, indeterminate: true })
    act(() => result.current.toggleBalanceSelection('b', false))
    expect(result.current.selectedBalanceIds.size).toBe(0)
  })

  it('selects and clears the whole page without touching rows on other pages', () => {
    const { result } = renderHook(() => useHarness(page, ['z']))
    act(() => result.current.togglePageSelection(true))
    expect([...result.current.selectedBalanceIds].sort()).toEqual(['a', 'b', 'c', 'z'])
    expect(result.current.pageSelectionState).toEqual({ checked: true, indeterminate: false })
    act(() => result.current.togglePageSelection(false))
    expect([...result.current.selectedBalanceIds]).toEqual(['z'])
  })
})
