import type { CSSProperties } from 'react'

import { isTaskItem } from '../../components/calendar/types'
import type { CalendarItem, CalendarTaskItem } from '../../components/calendar/types'

/**
 * Event card colouring.
 *
 * A mature calendar fills an event with its calendar's colour and picks the ink
 * from that fill's brightness, rather than tinting the fill and leaving the
 * text on the page's own ink. The fill is the primary signal — you read the
 * grid by colour before you read a single title — so it has to be solid, and
 * solid means the ink has to adapt or half the palette becomes unreadable.
 *
 * Everything here is pure and takes the colour as data (it arrives from the
 * tenant's activity-type dictionary), so it is unit-testable and never bakes a
 * literal palette into the components.
 */

/** Bands the ink decision, and with it every derived surface. */
export type ToneInk = 'onLight' | 'onDark'

export type EventTone = {
  /** Utility classes that need no runtime colour — state tones use these. */
  surfaceClassName: string
  titleClassName: string
  subClassName: string
  /** Runtime colour, when the entry carries one. */
  style?: CSSProperties
  ink: ToneInk
  /** True when the fill is the entry's own colour rather than a state tone. */
  coloured: boolean
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function expandHex(hex: string): string {
  if (hex.length !== 4) return hex
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
}

/** sRGB channel to its linear-light value, per WCAG's relative-luminance definition. */
function linearize(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

/**
 * WCAG relative luminance, 0 (black) to 1 (white).
 *
 * Returns null for anything that is not a hex literal — a tenant may store
 * `oklch(...)`, a named colour or a CSS variable, none of which can be measured
 * without a layout pass. Callers fall back to a fill that works either way.
 */
export function relativeLuminance(color: string): number | null {
  if (!HEX_COLOR.test(color)) return null
  const hex = expandHex(color)
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue)
}

/**
 * The two inks a solid fill can take.
 *
 * These are deliberately literal rather than theme tokens. The fill they sit on
 * is a literal too — it comes from the tenant's activity-type dictionary and
 * does not change between light and dark — so an ink bound to `var(--fore
 * ground)` would flip underneath a fill that did not, and land near-black text
 * on a mid-indigo card in dark mode (measured at 2.9:1, below AA). Contrast is
 * a property of the pair, so both halves of the pair have to be fixed.
 *
 * Off-white and off-black rather than pure #fff/#000: the same softening the
 * theme's own ink uses, and it costs almost nothing in contrast.
 */
const INK_ON_DARK = '#ffffff'
const INK_ON_LIGHT = '#1a1a1a'

const INK_LUMINANCE: Record<ToneInk, number> = {
  onDark: relativeLuminance(INK_ON_DARK) as number,
  onLight: relativeLuminance(INK_ON_LIGHT) as number,
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Pick the ink that actually contrasts better against `color`.
 *
 * Comparing the two ratios beats a hand-tuned luminance threshold, which is
 * only ever right for the ink pair it was tuned against and silently picks the
 * worse ink either side of the crossover — a mid blue like `#3b82f6` reads at
 * 3.7:1 with white ink and 4.6:1 with dark, and a threshold set by eye gets it
 * backwards.
 */
export function inkForFill(color: string): ToneInk {
  const luminance = relativeLuminance(color)
  if (luminance === null) return 'onDark'
  const onDark = contrastRatio(luminance, INK_LUMINANCE.onDark)
  const onLight = contrastRatio(luminance, INK_LUMINANCE.onLight)
  return onLight > onDark ? 'onLight' : 'onDark'
}

/** Solid fill styling for an entry that carries a colour. */
export function solidFillStyle(color: string, ink: ToneInk): CSSProperties {
  return {
    backgroundColor: color,
    borderColor: color,
    color: ink === 'onDark' ? INK_ON_DARK : INK_ON_LIGHT,
  }
}

/**
 * The muted, hollow treatment a calendar gives an entry that has already
 * happened or been called off — outlined rather than filled, so the grid's
 * colour weight sits on what is still ahead.
 */
export function outlineFillStyle(color: string): CSSProperties {
  return {
    backgroundColor: 'transparent',
    borderColor: color,
    color: 'var(--foreground)',
  }
}

const CANCELED_TONE: EventTone = {
  surfaceClassName: 'border border-border bg-surface',
  titleClassName: 'text-muted-foreground line-through',
  subClassName: 'text-muted-foreground/70 line-through',
  ink: 'onLight',
  coloured: false,
}

const PAST_TONE: EventTone = {
  surfaceClassName: 'border border-border bg-surface-muted',
  titleClassName: 'text-muted-foreground',
  subClassName: 'text-muted-foreground',
  ink: 'onLight',
  coloured: false,
}

const DEFAULT_TONE: EventTone = {
  surfaceClassName: 'border border-primary bg-primary text-primary-foreground',
  titleClassName: 'text-primary-foreground',
  subClassName: 'text-primary-foreground/80',
  ink: 'onDark',
  coloured: false,
}

/**
 * A task's tone.
 *
 * Tasks read as a different kind of thing from events on purpose: an event is a
 * commitment that fills its slot, so it is filled solid; a task is a deadline,
 * so it is a light card with a status-coloured leading edge. The status itself
 * is always the Task Manager's — the calendar only decides how to draw it, and
 * it draws every working status the same rather than mirroring the board's
 * palette, which would be a second copy of a vocabulary that is free to change.
 * The exact status is shown as text on the card and in its popover instead.
 */
function taskTone(item: CalendarTaskItem): EventTone {
  const status = item.status
  if (status === 'canceled') {
    return {
      surfaceClassName: 'border border-s-2 border-border bg-surface-muted',
      titleClassName: 'text-muted-foreground line-through',
      subClassName: 'text-muted-foreground/70',
      ink: 'onLight',
      coloured: false,
    }
  }
  if (status === 'done') {
    return {
      surfaceClassName: 'border border-s-2 border-status-success-border bg-status-success-bg',
      titleClassName: 'text-status-success-text line-through',
      subClassName: 'text-status-success-text',
      ink: 'onLight',
      coloured: false,
    }
  }
  return {
    surfaceClassName: 'border border-s-2 border-primary bg-surface',
    titleClassName: 'text-foreground',
    subClassName: 'text-muted-foreground',
    ink: 'onLight',
    coloured: false,
  }
}

/**
 * The tone one entry renders with.
 *
 * Cancelled and finished entries lose their fill entirely — that is how a
 * calendar says "this is no longer competing for your attention" — and only a
 * live entry gets the solid colour.
 */
export function resolveEventTone(item: CalendarItem, nowMs: number): EventTone {
  if (isTaskItem(item)) return taskTone(item)
  if (item.status === 'canceled') {
    if (!item.color) return CANCELED_TONE
    return {
      ...CANCELED_TONE,
      surfaceClassName: 'border',
      style: { ...outlineFillStyle(item.color), opacity: 0.7 },
    }
  }
  if (item.status === 'done' || item.end.getTime() < nowMs) {
    if (!item.color) return PAST_TONE
    return {
      ...PAST_TONE,
      surfaceClassName: 'border',
      style: outlineFillStyle(item.color),
      titleClassName: 'text-foreground/70',
      subClassName: 'text-muted-foreground',
    }
  }
  if (item.color) {
    const ink = inkForFill(item.color)
    return {
      surfaceClassName: 'border',
      titleClassName: '',
      subClassName: ink === 'onDark' ? 'opacity-85' : 'opacity-70',
      style: solidFillStyle(item.color, ink),
      ink,
      coloured: true,
    }
  }
  return DEFAULT_TONE
}

/**
 * The dot a month pill or overflow row shows before its title. Cancelled and
 * finished entries keep the dot hollow so the row still reads as inactive.
 */
export function toneDotStyle(item: CalendarItem, nowMs: number): CSSProperties | undefined {
  // A task's dot is painted from its status token classes, not a runtime colour.
  if (isTaskItem(item) || !item.color) return undefined
  const inactive = item.status === 'canceled' || item.status === 'done' || item.end.getTime() < nowMs
  if (!inactive) return { backgroundColor: item.color }
  return { backgroundColor: 'transparent', boxShadow: `inset 0 0 0 1.5px ${item.color}` }
}
