/**
 * The width rules behind the contextual panel.
 *
 * Two things are being protected. Neither pane may be squeezed to the point of
 * uselessness however hard the divider is dragged, and a width remembered from
 * one screen must never be applied literally to a smaller one — that is how a
 * stored preference turns into a horizontal scrollbar.
 */

import {
  CHAT_PANEL_WIDTH,
  clampPanelWidth,
  maxPanelWidthFor,
  minimumSplitWidth,
} from '../components/contextPanel'

const WIDE = 1600
const LAPTOP = 1100

describe('split feasibility', () => {
  it('needs room for a usable transcript and a usable panel, plus the handle', () => {
    expect(minimumSplitWidth()).toBe(
      CHAT_PANEL_WIDTH.minChat + CHAT_PANEL_WIDTH.min + CHAT_PANEL_WIDTH.handle,
    )
  })

  it('does not claim a split fits in a container that cannot hold both', () => {
    // The number itself matters less than the relationship: whatever the
    // minimums are, a container one pixel under their sum is not splittable.
    const container = minimumSplitWidth() - 1
    expect(maxPanelWidthFor(container)).toBeLessThan(CHAT_PANEL_WIDTH.min)
  })
})

describe('maximum width', () => {
  it('never leaves the transcript below its minimum', () => {
    for (const container of [800, 1000, LAPTOP, 1440, WIDE, 2560]) {
      const panel = maxPanelWidthFor(container)
      if (panel < CHAT_PANEL_WIDTH.min) continue
      expect(container - panel - CHAT_PANEL_WIDTH.handle).toBeGreaterThanOrEqual(
        CHAT_PANEL_WIDTH.minChat,
      )
    }
  })

  it('caps the panel on a very wide monitor rather than letting it sprawl', () => {
    // A list of pins is not a second document. Without the absolute cap, the
    // fraction alone would hand it 1150px on an ultrawide.
    expect(maxPanelWidthFor(2560)).toBe(CHAT_PANEL_WIDTH.max)
  })

  it('caps by share of the container before the absolute cap bites', () => {
    expect(maxPanelWidthFor(LAPTOP)).toBeLessThan(CHAT_PANEL_WIDTH.max)
  })
})

describe('clamping a requested width', () => {
  it('keeps a reasonable width untouched', () => {
    expect(clampPanelWidth(360, WIDE)).toBe(360)
  })

  it('refuses to go below the panel minimum', () => {
    expect(clampPanelWidth(10, WIDE)).toBe(CHAT_PANEL_WIDTH.min)
  })

  it('refuses to go above the maximum for that container', () => {
    expect(clampPanelWidth(5000, WIDE)).toBe(maxPanelWidthFor(WIDE))
  })

  it('shrinks a width remembered from a bigger screen', () => {
    // The saved preference is 520 on a 1600px container; the same reader opens
    // a 1100px window. Honouring 520 literally would push the transcript under
    // its minimum, which is the overflow this clamp exists to prevent (§9).
    const remembered = clampPanelWidth(CHAT_PANEL_WIDTH.max, WIDE)
    const fitted = clampPanelWidth(remembered, LAPTOP)
    expect(fitted).toBeLessThan(remembered)
    expect(LAPTOP - fitted - CHAT_PANEL_WIDTH.handle).toBeGreaterThanOrEqual(
      CHAT_PANEL_WIDTH.minChat,
    )
  })

  it('falls back to the minimum rather than a negative width when nothing fits', () => {
    // Below the split threshold the caller shows a drawer instead, but the
    // arithmetic must still not produce something absurd for the render that
    // happens on the way there.
    expect(clampPanelWidth(300, 400)).toBe(CHAT_PANEL_WIDTH.min)
  })

  it('is stable: clamping an already-clamped width changes nothing', () => {
    const once = clampPanelWidth(9999, LAPTOP)
    expect(clampPanelWidth(once, LAPTOP)).toBe(once)
  })

  it('returns whole pixels', () => {
    expect(Number.isInteger(clampPanelWidth(333.7, WIDE))).toBe(true)
  })
})

describe('the default width', () => {
  it('sits inside the allowed range on an ordinary laptop', () => {
    expect(clampPanelWidth(CHAT_PANEL_WIDTH.default, 1440)).toBe(CHAT_PANEL_WIDTH.default)
  })

  it('is not below the minimum', () => {
    expect(CHAT_PANEL_WIDTH.default).toBeGreaterThanOrEqual(CHAT_PANEL_WIDTH.min)
  })
})

describe('standing the conversation rail down', () => {
  /**
   * On a laptop the module spends the rail's width before the conversation gets
   * anything, which left too little for a transcript and a panel side by side.
   * The rail goes only when keeping it is the reason a split will not fit.
   */
  const { CHAT_RAIL, railStandsDownForPanel } = require('../components/contextPanel') as typeof import('../components/contextPanel')

  it('keeps the rail when everything already fits', () => {
    // A wide monitor holds rail, transcript and panel at once.
    const roomy = minimumSplitWidth() + CHAT_RAIL.totalWidth
    expect(railStandsDownForPanel(roomy)).toBe(false)
  })

  it('stands the rail down exactly when that is what buys the split', () => {
    // One pixel under "everything fits": without the rail there is room, with
    // it there is not.
    const tight = minimumSplitWidth() + CHAT_RAIL.totalWidth - 1
    expect(railStandsDownForPanel(tight)).toBe(true)
    expect(tight - CHAT_RAIL.totalWidth).toBeLessThan(minimumSplitWidth())
    expect(tight).toBeGreaterThanOrEqual(minimumSplitWidth())
  })

  it('leaves the rail alone when even the whole shell is too narrow', () => {
    // Removing it would cost the reader their navigation and still not produce
    // a usable split — that width belongs to the drawer.
    expect(railStandsDownForPanel(minimumSplitWidth() - 1)).toBe(false)
  })

  it('does the right thing on a 1280 laptop', () => {
    // The measured shell width at a 1280 viewport, once the app's own
    // navigation and page padding are taken out. With the rail the conversation
    // gets 632, which is under the split minimum; without it, 912.
    const shellAt1280 = 912
    expect(shellAt1280 - CHAT_RAIL.totalWidth).toBeLessThan(minimumSplitWidth())
    expect(railStandsDownForPanel(shellAt1280)).toBe(true)
    // And what the transcript is left with is comfortably readable.
    expect(shellAt1280 - CHAT_PANEL_WIDTH.default - CHAT_PANEL_WIDTH.handle).toBeGreaterThan(500)
  })

  it('ignores an unmeasured container', () => {
    expect(railStandsDownForPanel(0)).toBe(false)
  })
})
