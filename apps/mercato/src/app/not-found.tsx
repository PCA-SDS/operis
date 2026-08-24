import Link from 'next/link'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

/**
 * Custom 404.
 *
 * Next.js ships a built-in not-found page whose markup carries an inline
 * `font-family: system-ui` style. That inline rule beats the cascade, so the
 * stock page is the one screen in the product that never renders in Figtree.
 * Defining this file replaces it outright: it renders inside the root layout,
 * so it inherits the app stylesheet, the theme tokens and the product typeface
 * like every other page.
 */
export default async function NotFound() {
  const { t } = await resolveTranslations()

  return (
    <main
      role="main"
      className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground"
    >
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        {/* Deliberately plain Tailwind sizes rather than the `text-page-title` /
            `text-section-title` design tokens: globals.css notes that Tailwind 4
            only emits a `text-X` utility from an `@theme inline` `--font-size-X`
            when the scanner finds the literal elsewhere first, and this page
            would be the only user. Matches global-error.tsx, its sibling. */}
        <p className="text-3xl font-semibold tabular-nums">404</p>
        <h1 className="text-xl font-semibold tracking-tight">
          {t('app.notFound.title', 'This page could not be found')}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {t(
            'app.notFound.description',
            'The page you are looking for may have been moved, renamed, or never existed.',
          )}
        </p>
        <Link
          href="/backend"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('app.notFound.backToApp', 'Back to Operis')}
        </Link>
      </div>
    </main>
  )
}
