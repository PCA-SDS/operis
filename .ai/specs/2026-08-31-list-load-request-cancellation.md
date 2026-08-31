# List-Load Request Cancellation

**Status:** implemented
**Owner:** core / ui / webhooks
**Date:** 2026-08-31

## TLDR

Load effects across the backend and portal guarded their state writes with a `cancelled` flag
but never cancelled the request itself. The flag prevents a stale response from overwriting
fresh state — correctness was fine — but the server still runs the whole CRUD list pipeline (DI
container, auth, RBAC, org scope, query engine, custom-field decoration, access logging) to
produce a response nobody reads. Paging, sorting and filtering re-fire those effects constantly.

171 request-bearing load effects across 138 files now open an `AbortController` alongside the
flag, thread its signal into every `apiCall` / `apiCallOrThrow` / `readApiResultOrThrow`, and
abort in the same cleanup (170 added here plus 1 that already had it). A guard test pins the
convention repo-wide.

## Convention

The repo has no shared abortable-fetch hook and this change does not add one; the established
idiom is an inline controller per effect, which
`customers/backend/customers/people/page.tsx` already used for its staff-options effect.

```ts
React.useEffect(() => {
  let cancelled = false
  const controller = new AbortController()
  async function load() {
    try {
      const call = await apiCall<Payload>(url, { signal: controller.signal }, { fallback })
      if (cancelled) return
      // ...
    } catch (err) {
      if (cancelled) return        // REQUIRED — see below
      flash(message, 'error')
    }
  }
  load()
  return () => {
    cancelled = true               // MUST precede the abort
    controller.abort()
  }
}, [deps])
```

Two rules follow from `apiCall` **rejecting** on abort
(`packages/ui/src/backend/utils/apiCall.ts` throws an `AbortError` rather than returning a
fallback):

1. **Flip the flag before aborting.** The abort rejects synchronously into the effect's own
   `catch`; if `cancelled` is not already `true` the handler runs.
2. **Any `catch` that surfaces the failure to the user must check `cancelled`.** Otherwise every
   navigation mid-load flashes an error toast on the page the user just moved to. All but one
   effect was already written this way; `resources/backend/resources/resources/[id]/page.tsx`
   was not, and had the guard added.

## Scope

- **In scope:** effects whose `cancelled` flag guards a request.
- **Out of scope:** effects where the flag guards an animation-frame loop or a timer — 22 of
  them. There is no request to abort, and adding a controller would be noise. The kanban board's
  scroll animation is the clearest example.
- **No mutations are cancelled.** Every write inside a cancellable effect turned out to be
  `POST /api/auth/feature-check`, a side-effect-free permission query (8 files). Real mutations
  live in event handlers and command callbacks, not in load effects, so nothing that writes can
  be interrupted mid-flight.

## Regression protection

`packages/core/src/__tests__/list-load-request-cancellation.test.ts` scans every tracked
`.ts`/`.tsx` source and asserts four properties of each request-bearing load effect:

1. it exists at all (a floor of 50, so renaming the flag cannot quietly empty the guard),
2. it opens an `AbortController`,
3. every request helper it calls carries `signal: controller.signal`,
4. no `catch` surfaces an error without checking `cancelled`.

The guard immediately earned its place: it found 69 effects beyond the first sweep's list, in
portal hooks, feature-access hooks and detail pages whose fetches do not paginate.

## Verification

- The guard test passes across the repo (4/4).
- Full gate green: `build:packages`, `generate`, `typecheck` (24/24), `lint` (0 errors),
  `test` (51/51 tasks), `build:app`, `i18n:check-sync`.
- Five test assertions that pinned exact `apiCall` arguments were updated to expect the signal
  (`expect.objectContaining({ signal: expect.anything() })`). Two assertions in the sync_excel
  widget were deliberately **left** expecting `undefined`: that call is a polling refresh in a
  `useCallback`, not part of the cancellable restore effect.

## Not measured

The saving is server work avoided on abandoned requests, which needs production traffic to
quantify — the win scales with how often users page, sort, filter and navigate away mid-load.
No client-side latency improvement is claimed: the user-visible behaviour is unchanged.

## Changelog

- **2026-08-31** — implemented across 138 files (171 effects), plus the repo-wide guard test.
