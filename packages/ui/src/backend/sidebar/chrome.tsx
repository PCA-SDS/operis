import * as React from 'react'
import Image from 'next/image'

import { OperisLogo } from '../brand/OperisLogo'

/**
 * The sidebar's chrome, declared once for every surface that paints it.
 *
 * Four renderers put a navigation row on screen: the desktop rail, the section
 * (Settings / Profile) nav, the mobile drawer, and the customization editor's
 * live preview. They must emit the SAME box, or the sidebar reads as several
 * lists stacked together and the preview stops previewing — which is exactly
 * how the preview drifted into a different component: a light card ground under
 * a navy rail, `gap-2` rows with no fixed height, unboxed icons at their own
 * intrinsic sizes, and an active-state marker bar the rail had already dropped.
 * Importing from here is the contract that keeps the four one component in
 * everything but the JSX that hosts them.
 *
 * The rail is painted in the CTA navy (`bg-sidebar`), so every class here comes
 * from the `sidebar-*` family rather than from the content-side neutrals: a
 * `surface-muted` hover or a `muted-foreground` icon is tuned for a light
 * ground and disappears on navy. Active is a pale `sidebar-primary` pill with
 * the rail's own colour as its ink — the row reads as cut out of the rail —
 * and there is no separate marker bar, because the pill already carries the
 * state and a bar on top of a fill is two signals for one fact. Idle rows use
 * FULL ink with a quiet icon: a sidebar is a reading surface, and dimming every
 * label to make one stand out costs more than it buys. */
export const SIDEBAR_ITEM_BASE =
  'relative flex items-center rounded-lg text-sm font-medium transition-colors outline-none focus-visible:shadow-focus'

export function sidebarItemStateClass(active: boolean): string {
  return active
    ? 'bg-sidebar-primary text-sidebar-primary-foreground [&_svg]:text-sidebar-primary-foreground'
    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:text-sidebar-muted-foreground hover:[&_svg]:text-sidebar-accent-foreground'
}

/* ── The rail's one horizontal grid ──────────────────────────────────────────
 *
 * The aside owns a 12px gutter (`px-3`). Every box below spans that full inner
 * width, and every box that carries an icon pads another 12px, so the logo, the
 * search glyph, the group overlines and every row icon all start at the same
 * x — 24px from the rail's edge. Nothing here may add a stray negative margin
 * or an extra right pad: that is exactly how the nav rows ended up 4px narrower
 * than the search field above them. */
export const SIDEBAR_GUTTER = 'px-3'

/** Row box for a top-level item: fixed height so rows scan as a rhythm. */
export const SIDEBAR_ITEM_BOX = 'w-full h-10 px-3 gap-3'
/** Children sit one step shorter and one 12px step in. With the guide line gone
 *  the indent is the only depth cue, so it is a real step rather than a nudge —
 *  a child icon lands where a parent label starts. */
export const SIDEBAR_CHILD_BOX = 'w-full h-9 pl-6 pr-3 gap-3'
/** Labels must be allowed to shrink: a flex item defaults to `min-width: auto`,
 *  which pins it to its content width and lets `truncate` overflow the row
 *  instead of clipping. Long titles ("Customer Related Tasks") make this real. */
export const SIDEBAR_ITEM_LABEL = 'min-w-0 flex-1 truncate text-left'
/* Group heading — a quiet overline, not a button that competes with the rows.
 *
 * `text-xs` rather than the 11px `text-overline`: this string is rendered
 * through `Button`, whose base carries `text-sm`, and `tailwind-merge` reads
 * the custom `text-overline` utility as a text COLOUR — so it never displaced
 * the button's size and the overline silently rendered at 14px. A real size on
 * the Tailwind scale is what makes the merge resolve. */
export const SIDEBAR_GROUP_LABEL =
  'w-full h-8 px-3 gap-2 justify-between flex text-xs font-bold uppercase tracking-wide text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'

/* Icons come from lucide, from injected modules and from serialized markup, each
 * at its own intrinsic size. Pinning them to one box is what keeps every label in
 * the sidebar starting at the same x. */
export const SIDEBAR_ICON_BOX = 'flex size-5 shrink-0 items-center justify-center [&_svg]:size-4'

/* The brand name, wherever it is painted. The desktop rail and the mobile
 * drawer render their own brand rows (the drawer's carries a close button and a
 * full-bleed rule, so it cannot simply reuse the desktop one) and the two had
 * drifted to different weights for the same string. Declared once so they
 * cannot drift again. */
export const SIDEBAR_BRAND_LABEL = `${SIDEBAR_ITEM_LABEL} text-sm font-medium text-sidebar-foreground`

/* ── The drawer's half of the same grid ──────────────────────────────────────
 *
 * The mobile drawer's chrome rows (brand, view tabs) sit DIRECTLY on the aside,
 * outside the nav's own `p-3` gutter, so they have to carry the full 24px inset
 * themselves. That is what puts the drawer's logo, its tab labels and every nav
 * icon below them on one x — they were on three (16px, 16px, 24px) before.
 *
 * The injected slot keeps the 12px inset instead: its content is a full-width
 * BOX, and the box that matters for it is the nav's search field directly
 * below, whose edge the drawer's `p-3` puts at 12px. */
export const DRAWER_CHROME_INSET = 'px-6'
export const DRAWER_SLOT_INSET = 'px-3'

/* The nav search sits ON the rail, so it takes the search primitive's `sidebar`
 * tone — the light-ground chrome would read as a piece of the page that fell
 * into the sidebar. `size="lg"` is the rail's `h-10 / px-3` grid: the glyph then
 * lands on the same icon column as every row below it. */
export const SIDEBAR_SEARCH_SIZE = 'lg' as const
export const SIDEBAR_SEARCH_TONE = 'sidebar' as const

/* Group separator — inset to the row edges, not bled to the rail's. It divides
 * two items in one list, so it belongs to the list's width; the sticky footer's
 * rule is the one that bleeds, because it divides the column itself. 12px above
 * pairs with the 12px the nav's own gap puts below it. */
export const SIDEBAR_GROUP_DIVIDER = 'mt-3 border-t border-sidebar-border'


/* The row a nav item gets when it declares no icon. Every renderer needs it —
 * the rail, the section navs and the customization preview — and the preview
 * used to draw a small circle here while the rail drew this list glyph, so the
 * one row a user is most likely to be looking at (the one they forgot to give
 * an icon) previewed as something the sidebar never renders. */
export const SidebarDefaultIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

/* ── The brand mark ──────────────────────────────────────────────────────────
 *
 * Three surfaces paint it: the rail's header, the mobile drawer's header and
 * the customization preview. The preview used to hardcode `/operis.svg` in a
 * `rounded-full` <Image>, so a whitelabel install previewed somebody else's
 * brand — and an external SVG cannot take the rail's ink, which is why the
 * built-in mark is inlined below rather than loaded as a file. */
export type ShellLogo = {
  src: string
  alt?: string
  preserveAspectRatio?: boolean
}

export function shouldBypassLogoOptimization(src?: string | null): boolean {
  const value = src ?? ''
  return /^https?:\/\//.test(value) || /^\/api\/attachments\/(?:image|file)\//.test(value)
}

/**
 * The built-in wordmark spells "Operis" itself, so the header text beside it
 * would say the name twice. A whitelabel name gets the mark plus its own text.
 */
export function usesBuiltInWordmark(logo: ShellLogo | undefined, brandName: string): boolean {
  return !logo?.src && brandName.trim().toLowerCase() === 'operis'
}

export function ShellBrandLogo({
  logo,
  brandName,
  unoptimized,
  mobile = false,
}: {
  logo?: ShellLogo
  brandName: string
  unoptimized?: boolean
  mobile?: boolean
}) {
  const src = logo?.src
  const alt = logo?.alt ?? brandName
  const isCustomLogo = Boolean(src)
  const preserveAspectRatio = Boolean(logo?.preserveAspectRatio)

  if (!isCustomLogo) {
    // Inline rather than <Image src="/operis.svg">: an external SVG renders in
    // its own document, where `currentColor` cannot reach the sidebar's ink —
    // and the rail is navy, so the mark has to take the rail's ink to be seen.
    const showWordmark = usesBuiltInWordmark(logo, brandName)
    return (
      <OperisLogo
        variant={showWordmark ? 'wordmark' : 'mark'}
        title={showWordmark ? brandName : null}
        className={`w-auto shrink-0 text-sidebar-foreground ${
          showWordmark ? (mobile ? 'h-5' : 'h-6') : mobile ? 'h-6' : 'h-7'
        }`}
      />
    )
  }

  if (!preserveAspectRatio) {
    return (
      <Image
        src={src as string}
        alt={alt}
        width={mobile ? 28 : 40}
        height={mobile ? 28 : 40}
        className={`${mobile ? 'rounded' : 'rounded-full'} shrink-0 object-cover`}
        unoptimized={unoptimized ? true : undefined}
      />
    )
  }

  const width = mobile ? 96 : 120
  const height = mobile ? 28 : 40
  const className = mobile
    ? 'h-7 max-w-24 w-auto shrink-0 object-contain'
    : 'h-10 max-w-[120px] w-auto shrink-0 object-contain'

  return (
    <Image
      src={src as string}
      alt={alt}
      width={width}
      height={height}
      className={className}
      unoptimized={unoptimized ? true : undefined}
    />
  )
}
