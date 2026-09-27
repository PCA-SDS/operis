import * as React from 'react'
import Image from 'next/image'

import { OperisLogo } from '../brand/OperisLogo'

/**
 * The navy sidebar chrome the customization editor previews, declared once.
 *
 * The global rail is gone (modules now carry their own in-page sidebars, see
 * `module-nav/`), but the customization editor still draws a live navy preview
 * of the navigation, and the brand mark is also painted in the topbar. What
 * remains here is what those two surfaces share.
 *
 * The preview is painted in the CTA navy (`bg-sidebar`), so every class here
 * comes from the `sidebar-*` family rather than from the content-side
 * neutrals: a `surface-muted` hover or a `muted-foreground` icon is tuned for a
 * light ground and disappears on navy. */
export const SIDEBAR_ITEM_BASE =
  'relative flex items-center rounded-lg text-xs font-medium transition-colors outline-none focus-visible:shadow-focus'

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
/** Labels must be allowed to shrink: a flex item defaults to `min-width: auto`,
 *  which pins it to its content width and lets `truncate` overflow the row
 *  instead of clipping. Long titles ("Customer Related Tasks") make this real. */
export const SIDEBAR_ITEM_LABEL = 'min-w-0 flex-1 truncate text-left'

/* Group heading — a quiet overline, not a button that competes with the rows.
 *
 * `text-overline` (11px) sits one step under the 12px rows it labels, which is
 * the hierarchy this heading is supposed to carry. It could not be used until
 * `cn` taught tailwind-merge that `text-overline` is a font-size: the heading
 * renders through `Button`, whose base carries `text-sm`, and the stock merge
 * classifies `text-<word>` as a text COLOUR — so the class was kept but never
 * displaced the button's size, and the overline silently rendered at 14px,
 * LARGER than the rows beneath it. See `cn` in shared/lib/utils.ts; do not
 * revert that extension without putting this back to `text-xs`. */
/** Geometry of the heading row, split out from its skin so the loading
 *  placeholder can sit on exactly the same box — same height, same x — instead
 *  of restating the numbers and drifting from them. */
export const SIDEBAR_GROUP_LABEL_BOX = 'w-full h-8 px-3 gap-3'
export const SIDEBAR_GROUP_LABEL =
  `${SIDEBAR_GROUP_LABEL_BOX} justify-between flex text-overline font-bold uppercase tracking-wide text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`

/* Icons come from lucide, from injected modules and from serialized markup, each
 * at its own intrinsic size. Pinning them to one box is what keeps every label in
 * the sidebar starting at the same x. */
export const SIDEBAR_ICON_BOX = 'flex size-5 shrink-0 items-center justify-center [&_svg]:size-4'

/* The brand name beside a whitelabel logo in the navy preview. */
export const SIDEBAR_BRAND_LABEL = `${SIDEBAR_ITEM_LABEL} text-xs font-medium text-sidebar-foreground`

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

/* The heading icon for a group that declares none (injected groups, app
 * modules). A group heading is never blank, so the collapsed rail never shows an
 * empty row where a heading stood. */
export const SidebarGroupDefaultIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
)

/* ── The brand mark ──────────────────────────────────────────────────────────
 *
 * Two surfaces paint it: the topbar and the customization preview. An external
 * SVG cannot take the surface's ink, which is why the built-in mark is inlined
 * below rather than loaded as a file. */
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

/** `sidebar` inks the mark for the navy preview; `surface` for the light topbar. */
export type ShellBrandTone = 'sidebar' | 'surface'

export function ShellBrandLogo({
  logo,
  brandName,
  unoptimized,
  tone = 'sidebar',
}: {
  logo?: ShellLogo
  brandName: string
  unoptimized?: boolean
  tone?: ShellBrandTone
}) {
  const src = logo?.src
  const alt = logo?.alt ?? brandName

  if (!src) {
    const showWordmark = usesBuiltInWordmark(logo, brandName)
    return (
      <OperisLogo
        variant={showWordmark ? 'wordmark' : 'mark'}
        title={showWordmark ? brandName : null}
        className={`w-auto shrink-0 ${tone === 'surface' ? 'text-primary' : 'text-sidebar-foreground'} ${showWordmark ? 'h-6' : 'h-7'}`}
      />
    )
  }

  if (!logo?.preserveAspectRatio) {
    return (
      <Image
        src={src}
        alt={alt}
        width={tone === 'surface' ? 32 : 40}
        height={tone === 'surface' ? 32 : 40}
        className={`rounded-full shrink-0 object-cover ${tone === 'surface' ? 'size-8' : ''}`}
        unoptimized={unoptimized ? true : undefined}
      />
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={120}
      height={40}
      className={`${tone === 'surface' ? 'h-8' : 'h-10'} max-w-[120px] w-auto shrink-0 object-contain`}
      unoptimized={unoptimized ? true : undefined}
    />
  )
}
