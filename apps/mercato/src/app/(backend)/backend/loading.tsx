"use client"

import { usePathname } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { BackendModuleFrame } from '@open-mercato/ui/backend/module-nav/BackendModuleFrame'
import { ModuleSidebarSkeletonRow } from '@open-mercato/ui/backend/module-nav/ModuleSidebar'
import {
  DashboardSkeleton,
  DetailPageSkeleton,
  ListPageSkeleton,
  PageLoadingIndicator,
  SkeletonBar,
  SkeletonRegion,
} from '@open-mercato/ui/backend/skeletons/PageSkeletons'
import { useBackendRouteShape } from '@open-mercato/ui/backend/skeletons/BackendRouteShapesProvider'
import { CalendarPageSkeleton } from '@open-mercato/core/modules/customers/components/calendar/CalendarPageSkeleton'

/**
 * Route-level Suspense fallback for the whole backend tree.
 *
 * The backend catch-all is `force-dynamic` and resolves auth, the request
 * container, the feature-check context and two RBAC round trips before it can
 * return any markup. Without a boundary Next.js holds the previous page on
 * screen for that entire time, so clicking a nav item or a table row produced
 * no observable change at all until the server answered.
 *
 * This sits inside `(backend)/backend/layout.tsx`, so the AppShell chrome stays
 * mounted and only the content pane swaps. Covers `/backend` and every
 * `/backend/[...slug]` route beneath it.
 *
 * The fallback frames the page the way the page will frame itself: the layout
 * hands down each route's shape (its `moduleSidebar`, its module and parent
 * link, and the `loadingSkeleton` it declared), so the module's real sidebar is
 * in place before the page arrives. Inside it, a page that declared a skeleton
 * gets that skeleton, which is built to its measurements; any other page gets a
 * quiet spinner, because a guessed shape is exactly what made the old fallback
 * resolve into something that looked nothing like it. Those pages still load
 * into their own skeletons: a `DataTable` draws skeleton rows in its real
 * columns and a `CrudForm` draws its real sections.
 *
 * Kept free of data fetching on purpose: a Suspense fallback that awaited
 * anything would suspend itself. `usePathname` and the route shapes are
 * already in hand, which is why the shape can be chosen here at all.
 */
export default function BackendLoading() {
  const pathname = usePathname() ?? '/backend'
  const shape = useBackendRouteShape(pathname)
  if (pathname.replace(/\/+$/, '') === '/backend') return <DashboardSkeleton />
  if (shape?.skeleton === 'conversation') return <ConversationSkeleton withTranscript={shape.pattern !== '/backend/chat'} />

  const content =
    shape?.skeleton === 'list' ? <ListPageSkeleton />
      : shape?.skeleton === 'detail' ? <DetailPageSkeleton />
        : shape?.skeleton === 'calendar' ? <CalendarPageSkeleton />
          : <PageLoadingIndicator />

  return (
    <BackendModuleFrame
      enabled={shape?.moduleSidebar !== false}
      routeGroupId={shape?.group ?? null}
      routeParentHref={shape?.parentHref ?? null}
    >
      {content}
    </BackendModuleFrame>
  )
}

/**
 * The chat routes declare this shape: `ChatShell` on its `fill` page, with no
 * module sidebar. The rail is the conversation list's search and New chat rows
 * and the three rows it shows while loading, drawn with the sidebar's own
 * placeholder row, as the list draws them; the card
 * beside it is blank on the list route, as the real one is until a
 * conversation is chosen, and holds a transcript inside a conversation.
 */
function ConversationSkeleton({ withTranscript }: { withTranscript: boolean }) {
  return (
    <BackendModuleFrame enabled={false}>
      <Page fill>
        <PageBody fill>
          <SkeletonRegion className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
            <aside className={withTranscript ? 'hidden min-h-0 flex-col lg:flex' : 'flex min-h-0 flex-col'}>
              <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
                <ModuleSidebarSkeletonRow width="w-28" />
                <ModuleSidebarSkeletonRow width="w-20" />
                <div className="flex min-h-0 flex-1 flex-col gap-1">
                  <ModuleSidebarSkeletonRow width="w-32" avatar />
                  <ModuleSidebarSkeletonRow width="w-24" avatar />
                  <ModuleSidebarSkeletonRow width="w-28" avatar />
                </div>
              </div>
            </aside>

            <section
              className={withTranscript
                ? 'flex min-h-0 flex-col overflow-hidden rounded-xl border border-card-edge bg-surface'
                : 'hidden min-h-0 flex-col overflow-hidden rounded-xl border border-card-edge bg-surface lg:flex'}
            >
              {withTranscript ? (
                <>
                  <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                    <SkeletonBar className="size-8 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <SkeletonBar className="h-3.5 w-40" />
                      <SkeletonBar className="h-3 w-24" />
                    </div>
                  </div>

                  {/* Weighted to the bottom, alternating sides, ragged widths: a
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
                        <SkeletonBar className={`h-9 rounded-2xl ${row.width} ${row.mine ? 'bg-primary-soft' : ''}`} />
                      </div>
                    ))}
                  </div>

                  <div className="px-4 py-3">
                    <SkeletonBar className="h-11 w-full rounded-xl" />
                  </div>
                </>
              ) : null}
            </section>
          </SkeletonRegion>
        </PageBody>
      </Page>
    </BackendModuleFrame>
  )
}
