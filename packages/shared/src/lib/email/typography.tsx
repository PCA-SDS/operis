import * as React from 'react'
import { Font } from '@react-email/components'

/**
 * Canonical email typography.
 *
 * The product UI is set in Figtree (self-hosted, see `apps/mercato/src/app/fonts.css`).
 * Transactional mail is the one surface that cannot rely on that stylesheet, so the
 * stack is repeated here instead of being imported from the app.
 *
 * Every template MUST spread `emailBodyFont` onto its `<Body>` rather than writing
 * its own `fontFamily`, so a change to the product typeface is a one-file change.
 *
 * Webfonts in mail are best-effort by design: Apple Mail and iOS Mail honour the
 * `<Font>` link, while Gmail, Outlook and most webmail strip it and fall through to
 * the native stack below. That fallback is deliberate and is why the list leads with
 * the system UI faces rather than jumping straight to Helvetica — an unstyled mail
 * should still look like the recipient's platform, not like a 1998 document.
 */
export const EMAIL_FONT_FAMILY =
  "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif"

/** Tabular/code runs inside mail — mirrors the product's DM Mono. */
export const EMAIL_MONO_FONT_FAMILY =
  "'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace"

/** Spread onto a `<Body style={{ ... }}>` to set the family without repeating it. */
export const emailBodyFont = { fontFamily: EMAIL_FONT_FAMILY } as const

/** Spread onto monospaced runs (reference numbers, totals, codes). */
export const emailMonoFont = { fontFamily: EMAIL_MONO_FONT_FAMILY } as const

/**
 * Drop inside `<Head>` so clients that support webfonts pull Figtree.
 * Renders nothing the stripping clients can misinterpret — they simply ignore it.
 */
export function EmailFont(): React.ReactElement {
  return (
    <Font
      fontFamily="Figtree"
      fallbackFontFamily={['Helvetica', 'Arial', 'sans-serif']}
      webFont={{
        url: 'https://fonts.gstatic.com/s/figtree/v9/_Xms-HUzqDCFdgfMm4S9DaRvzig.woff2',
        format: 'woff2',
      }}
      fontStyle="normal"
      fontWeight={400}
    />
  )
}
