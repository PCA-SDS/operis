import { Skeleton } from '@open-mercato/ui/primitives/skeleton'

/**
 * Route-level Suspense fallback for the customer portal / storefront catch-all.
 *
 * Renders inside `(frontend)/layout.tsx`, so on client-side navigation within
 * the portal the shell stays mounted and only the content pane swaps — instead
 * of the previous page sitting frozen until the server answers.
 *
 * Note this does not cover the layout's own work (customer auth, the
 * Organization lookup and the feature-toggle read all run above this
 * boundary); it covers page rendering, which is where in-portal navigation
 * spends its time.
 *
 * Synchronous by design — see the note in the backend sibling.
 */
export default function FrontendLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-32" />
            <Skeleton shape="text" lines={2} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton shape="text" lines={4} />
      </div>
    </div>
  )
}
