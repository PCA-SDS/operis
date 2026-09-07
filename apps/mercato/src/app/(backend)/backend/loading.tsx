"use client"

import { usePathname } from 'next/navigation'
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
 *
 * Covers `/backend` and every `/backend/[...slug]` route beneath it.
 *
 * Kept free of data fetching on purpose: this renders as a Suspense *fallback*,
 * which Next.js prefetches and shows instantly. Awaiting anything here
 * (translations, cookies) would make the fallback itself suspend and defeat the
 * point. `usePathname` reads from the router and suspends nothing, which is why
 * the shape can be chosen here at all — `loading.tsx` is handed no params.
 *
 * `Skeleton` already carries its own `role="status"`/`aria-busy`, so no extra
 * announcement is needed — matching `PortalShell`'s SidebarNavSkeleton.
 */
export default function BackendLoading() {
  const pathname = usePathname()
  return pathname?.startsWith('/backend/chat') ? <ConversationSkeleton /> : <ListSkeleton />
}

/**
 * The list-page shape: title, toolbar, rows.
 *
 * The default because most of the backend is a `DataTable`, and matching the
 * common case means the swap to real content does not shift layout.
 */
function ListSkeleton() {
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

/**
 * Chat is the one backend surface that is not a list, and the list shape was
 * actively wrong for it: eight full-width table rows resolved into a two-pane
 * transcript, so the whole content area moved on arrival.
 *
 * The grid, the `16rem` rail and the `bg-surface` transcript card mirror
 * `ChatShell`, so the only thing that changes when the real page lands is that
 * the placeholders become words.
 */
function ConversationSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 p-4 md:p-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
      <aside className="hidden min-h-0 flex-col gap-4 lg:flex">
        <Skeleton className="h-9 w-full rounded-lg" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-2.5">
              <Skeleton shape="circle" className="size-7" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Skeleton shape="circle" className="size-8" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>

        {/* Weighted to the bottom, alternating sides, ragged widths — a
            transcript scrolled to the latest message, which is what arrives. */}
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 px-4 py-3">
          {[
            { mine: false, width: 'w-3/5' },
            { mine: false, width: 'w-2/5' },
            { mine: true, width: 'w-1/2' },
            { mine: false, width: 'w-3/4' },
            { mine: true, width: 'w-1/3' },
            { mine: true, width: 'w-3/5' },
          ].map((row, index) => (
            <div key={index} className={row.mine ? 'flex w-full justify-end' : 'flex w-full'}>
              <Skeleton
                className={`h-9 rounded-2xl ${row.width} ${row.mine ? 'bg-primary-soft' : 'bg-surface-muted'}`}
              />
            </div>
          ))}
        </div>

        <div className="px-4 py-3">
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      </section>
    </div>
  )
}
