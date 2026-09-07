/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { useAvailableHeight } from '../useAvailableHeight'

const MIN = 320

function Harness({ top, minimum = MIN }: { top: number; minimum?: number }) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const height = useAvailableHeight(ref, minimum)
  return (
    <div
      ref={(node) => {
        if (node) {
          node.getBoundingClientRect = () => ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) })
        }
        ref.current = node
      }}
      data-testid="target"
      data-height={height ?? ''}
    />
  )
}

function measured(view: ReturnType<typeof render>): number | null {
  const raw = view.getByTestId('target').getAttribute('data-height')
  return raw ? Number(raw) : null
}

afterEach(() => {
  cleanup()
})

describe('useAvailableHeight', () => {
  it('gives the element everything between its top and the fold', () => {
    window.innerHeight = 900
    const view = render(<Harness top={200} />)
    // 900 viewport − 200 top − 16 bottom gutter.
    expect(measured(view)).toBe(684)
  })

  it('shrinks as the element is pushed further down the page', () => {
    window.innerHeight = 900
    const high = render(<Harness top={100} />)
    const highValue = measured(high)
    cleanup()
    const low = render(<Harness top={400} />)
    expect(measured(low)).toBeLessThan(highValue as number)
  })

  it('never returns less than the floor, however little room is left', () => {
    // Without a floor a short window would collapse the grid to nothing.
    window.innerHeight = 300
    const view = render(<Harness top={280} />)
    expect(measured(view)).toBe(MIN)
  })

  it('re-measures when the window resizes', () => {
    window.innerHeight = 900
    const view = render(<Harness top={200} />)
    expect(measured(view)).toBe(684)

    act(() => {
      window.innerHeight = 700
      window.dispatchEvent(new Event('resize'))
    })

    expect(measured(view)).toBe(484)
  })

  it('ignores sub-pixel churn so a settling layout does not re-render forever', () => {
    window.innerHeight = 900
    const view = render(<Harness top={200} />)
    const first = measured(view)

    act(() => {
      window.innerHeight = 901
      window.dispatchEvent(new Event('resize'))
    })

    expect(measured(view)).toBe(first)
  })
})
