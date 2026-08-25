import { Skeleton } from '@open-mercato/ui/primitives/skeleton'

/**
 * Route-level Suspense fallback for the whole backend tree.
 *
 * The backend catch-all is `force-dynamic` and resolves auth, the request
 * container, the feature-check context and two RBAC round trips before it can
 * return any markup. Without a boundary Next.js holds the previous page on
 * screen for that entire time, so clicking a nav item or a table row produced
 * no observable change at all until the server answered.
 *
 * This sits inside `(backend)/backend/layout.tsx`, so the AppShell chrome —
 * nav rail, sidebar, header — stays mounted and only the content pane swaps.
 * The shape below mirrors the common list page (title, toolbar, rows) so the
 * swap to real content does not shift layout.
 *
 * Covers `/backend` and every `/backend/[...slug]` route beneath it.
 *
 * Kept synchronous on purpose: this renders as a Suspense *fallback*, which
 * Next.js prefetches and shows instantly. Awaiting anything here (translations,
 * cookies) would make the fallback itself suspend and defeat the point.
 * `Skeleton` already carries its own `role="status"`/`aria-busy`, so no extra
 * announcement is needed — matching `PortalShell`'s SidebarNavSkeleton.
 */
export default function BackendLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="ml-auto h-9 w-32" />
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="flex items-center gap-4 border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/5" />
          <Skeleton className="h-4 w-1/6" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
