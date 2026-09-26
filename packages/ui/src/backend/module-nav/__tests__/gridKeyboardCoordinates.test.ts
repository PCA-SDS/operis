/**
 * @jest-environment jsdom
 */

import type { SensorContext } from '@dnd-kit/core'
import { createGridKeyboardCoordinates } from '../SortableModuleGrid'

const KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

function rectAt(index: number) {
  const column = index % 3
  const row = Math.floor(index / 3)
  return { left: 140 + column * 123, top: 124 + row * 72, width: 119, height: 68 }
}

function contextOver(overId: string | null): SensorContext {
  const droppableRects = new Map(KEYS.map((key, index) => [key, rectAt(index)]))
  return { over: overId ? { id: overId } : null, droppableRects } as unknown as SensorContext
}

function press(code: string, overId: string | null, active = 'a') {
  const event = new KeyboardEvent('keydown', { code, cancelable: true })
  const coordinates = createGridKeyboardCoordinates(KEYS)(event, {
    active,
    currentCoordinates: { x: 0, y: 0 },
    context: contextOver(overId),
  })
  return { coordinates, prevented: event.defaultPrevented }
}

describe('createGridKeyboardCoordinates', () => {
  it('moves one place in reading order with Left and Right, wrapping to the next row', () => {
    expect(press('ArrowRight', 'a').coordinates).toEqual({ x: rectAt(1).left, y: rectAt(1).top })
    expect(press('ArrowRight', 'c').coordinates).toEqual({ x: rectAt(3).left, y: rectAt(3).top })
    expect(press('ArrowLeft', 'e').coordinates).toEqual({ x: rectAt(3).left, y: rectAt(3).top })
  })

  it('moves one row with Up and Down, never sideways', () => {
    expect(press('ArrowDown', 'b').coordinates).toEqual({ x: rectAt(4).left, y: rectAt(4).top })
    expect(press('ArrowUp', 'e').coordinates).toEqual({ x: rectAt(1).left, y: rectAt(1).top })
  })

  it('starts from the lifted tile when nothing is under it yet', () => {
    expect(press('ArrowRight', null, 'b').coordinates).toEqual({ x: rectAt(2).left, y: rectAt(2).top })
  })

  it('stays put past either end of the grid, but still keeps the arrow from scrolling the page', () => {
    const beforeFirst = press('ArrowLeft', 'a')
    expect(beforeFirst.coordinates).toBeUndefined()
    expect(beforeFirst.prevented).toBe(true)
    expect(press('ArrowDown', 'e').coordinates).toBeUndefined()
    expect(press('ArrowUp', 'b').coordinates).toBeUndefined()
  })

  it('ignores keys that are not arrows', () => {
    const tab = press('Tab', 'a')
    expect(tab.coordinates).toBeUndefined()
    expect(tab.prevented).toBe(false)
  })
})
