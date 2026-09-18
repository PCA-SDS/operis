/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { useDebouncedValue } from '../useDebouncedValue'

function Harness({ value, delayMs }: { value: string; delayMs?: number }) {
  const debouncedValue = useDebouncedValue(value, delayMs)
  return <output data-testid="value">{debouncedValue}</output>
}

describe('useDebouncedValue', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('keeps the previous value until the delay elapses', () => {
    const { rerender } = render(<Harness value="" delayMs={300} />)

    rerender(<Harness value="sales" delayMs={300} />)
    expect(screen.getByTestId('value')).toHaveTextContent('')

    act(() => jest.advanceTimersByTime(299))
    expect(screen.getByTestId('value')).toHaveTextContent('')

    act(() => jest.advanceTimersByTime(1))
    expect(screen.getByTestId('value')).toHaveTextContent('sales')
  })

  it('cancels an obsolete value when typing continues', () => {
    const { rerender } = render(<Harness value="" delayMs={300} />)

    rerender(<Harness value="s" delayMs={300} />)
    act(() => jest.advanceTimersByTime(200))
    rerender(<Harness value="sa" delayMs={300} />)
    act(() => jest.advanceTimersByTime(299))
    expect(screen.getByTestId('value')).toHaveTextContent('')

    act(() => jest.advanceTimersByTime(1))
    expect(screen.getByTestId('value')).toHaveTextContent('sa')
  })
})
