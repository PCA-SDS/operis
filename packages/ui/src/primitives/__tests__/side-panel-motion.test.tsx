/** @jest-environment jsdom */

import * as React from 'react'
import { act, renderHook, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  SIDE_PANEL_EXIT_MS,
  SIDE_PANEL_MOTION,
  SIDE_PANEL_SCRIM_MOTION,
  useSidePanelDismiss,
  useSidePanelPresence,
} from '../side-panel-motion'
import { Dialog, DialogContent, DialogTitle } from '../dialog'
import { Drawer, DrawerContent, DrawerTitle } from '../drawer'
import { Sheet, SheetContent, SheetTitle } from '../sheet'

function classes(element: Element | null): string[] {
  return (element?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('side panel motion', () => {
  it('slides the whole way in from the edge on the sheet curve, 500ms in and 300ms out', () => {
    expect(SIDE_PANEL_MOTION.right.split(' ')).toEqual(expect.arrayContaining([
      'data-[state=open]:slide-in-from-right',
      'data-[state=closed]:slide-out-to-right',
      'data-[state=open]:duration-500',
      'data-[state=closed]:duration-300',
      'data-[state=closed]:fill-mode-forwards',
      'ease-panel',
    ]))
    expect(SIDE_PANEL_MOTION.left).toContain('data-[state=open]:slide-in-from-left')
    expect(SIDE_PANEL_SCRIM_MOTION).toContain('data-[state=open]:fade-in-0')
    expect(SIDE_PANEL_SCRIM_MOTION).toContain('data-[state=closed]:duration-300')
  })

  it('gives Drawer, Sheet and a side Dialog the same motion, and the same scrim fade', () => {
    renderWithProviders(
      <>
        <Drawer open>
          <DrawerContent data-testid="drawer" aria-describedby={undefined}>
            <DrawerTitle>Drawer</DrawerTitle>
          </DrawerContent>
        </Drawer>
        <Sheet open>
          <SheetContent data-testid="sheet" aria-describedby={undefined}>
            <SheetTitle>Sheet</SheetTitle>
          </SheetContent>
        </Sheet>
        <Dialog open>
          <DialogContent side="right" data-testid="dialog" aria-describedby={undefined}>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </>,
    )
    const motion = SIDE_PANEL_MOTION.right.split(' ')
    for (const id of ['drawer', 'sheet', 'dialog']) {
      expect(classes(screen.getByTestId(id))).toEqual(expect.arrayContaining(motion))
    }
    // The modal's rise-and-fade is declared outside Tailwind's layers and would
    // beat the slide, so a side Dialog must not carry it at all.
    expect(classes(screen.getByTestId('dialog'))).not.toContain('animate-fadeInUp')
    expect(classes(document.querySelector('[data-slot="dialog-overlay"]'))).toEqual(
      expect.arrayContaining(SIDE_PANEL_SCRIM_MOTION.split(' ')),
    )
    expect(classes(document.querySelector('[data-slot="dialog-overlay"]'))).not.toContain('animate-fadeIn')
    expect(classes(document.querySelector('[data-slot="drawer-overlay"]'))).toEqual(
      expect.arrayContaining(SIDE_PANEL_SCRIM_MOTION.split(' ')),
    )
  })

  it('keeps a centred Dialog as the modal it was', () => {
    renderWithProviders(
      <Dialog open>
        <DialogContent data-testid="dialog" aria-describedby={undefined}>
          <DialogTitle>Dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const dialog = screen.getByTestId('dialog')
    expect(classes(dialog)).toEqual(expect.arrayContaining(['left-1/2', 'top-1/2', 'animate-fadeInUp']))
    expect(dialog).toHaveAttribute('data-side', 'center')
  })
})

describe('useSidePanelPresence', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('stays present for the slide out, then unmounts', () => {
    const { result, rerender } = renderHook(({ open }) => useSidePanelPresence(open), {
      initialProps: { open: true },
    })
    expect(result.current).toEqual({ present: true, state: 'open' })

    rerender({ open: false })
    expect(result.current).toEqual({ present: true, state: 'closed' })

    act(() => {
      jest.advanceTimersByTime(SIDE_PANEL_EXIT_MS - 1)
    })
    expect(result.current.present).toBe(true)
    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(result.current).toEqual({ present: false, state: 'closed' })
  })

  it('slides straight back when reopened during the exit', () => {
    const { result, rerender } = renderHook(({ open }) => useSidePanelPresence(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    act(() => {
      jest.advanceTimersByTime(SIDE_PANEL_EXIT_MS / 2)
    })
    rerender({ open: true })
    act(() => {
      jest.advanceTimersByTime(SIDE_PANEL_EXIT_MS)
    })
    expect(result.current).toEqual({ present: true, state: 'open' })
  })

  it('renders nothing for a panel that starts closed', () => {
    const { result } = renderHook(() => useSidePanelPresence(false))
    expect(result.current.present).toBe(false)
  })
})

describe('useSidePanelDismiss', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('closes itself first and tells the parent once the slide out has played', () => {
    const onClose = jest.fn()
    const { result } = renderHook(() => useSidePanelDismiss(onClose))
    expect(result.current.open).toBe(true)

    act(() => result.current.dismiss())
    expect(result.current.open).toBe(false)
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(SIDE_PANEL_EXIT_MS)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('runs a saved handler in place of onClose', () => {
    const onClose = jest.fn()
    const after = jest.fn()
    const { result } = renderHook(() => useSidePanelDismiss(onClose))
    act(() => result.current.dismissThen(after))
    act(() => {
      jest.advanceTimersByTime(SIDE_PANEL_EXIT_MS)
    })
    expect(after).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays quiet when the parent unmounts it first', () => {
    const onClose = jest.fn()
    const { result, unmount } = renderHook(() => useSidePanelDismiss(onClose))
    act(() => result.current.dismiss())
    unmount()
    act(() => {
      jest.advanceTimersByTime(SIDE_PANEL_EXIT_MS)
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})
