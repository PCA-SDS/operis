# Client i18n Dictionary Delivery

**Status:** draft — analysis complete, implementation not started
**Owner:** shared / app (frontend architecture)
**Date:** 2026-09-15
**Related:** [`2026-05-13-frontend-client-boundary-ram-reduction.md`](2026-05-13-frontend-client-boundary-ram-reduction.md) · [`2026-05-26-missing-translations-audit-and-remediation.md`](2026-05-26-missing-translations-audit-and-remediation.md)

## TLDR

Every full page load of this app embeds the **entire merged UI dictionary** in the
RSC flight payload: **20,558 keys / 1,336,210 bytes raw / 251,241 gzipped / 196,905
brotli**, merged from 54 module dictionaries. A page uses a few dozen of those keys.

The cost is not only bytes — the browser must also parse ~1.3 MB of embedded flight
data on the main thread during hydration.

This spec records the measurement, **rejects the obvious fix**, and specifies the one
that works. It is written because the change touches `AppProviders` and the app's
render path, which the frontend-architecture spec puts under ADR + blocking review.

## Measurements (2026-09-15)

| Metric | Value |
|---|---|
| Merged `en` dictionary | 20,558 keys |
| Raw JSON | 1,336,210 B (1,305 KiB) |
| gzip | 251,241 B (245 KiB) |
| brotli | 196,905 B (192 KiB) |
| Contributing module dictionaries | 54 |
| Largest contributors | customers 2,911 · sales 1,482 · warranty_claims 1,268 · staff 1,240 · workflows 1,204 · wms 1,052 |
| `GET /login` response, gzipped | 260,835 B — i.e. the dictionary is ~96% of that page |

`/login` is the cheap measurement harness: it is public, and it goes through the
root layout, so a before/after can be taken without authenticating.

## Where it enters the payload

Two places, not one:

1. `apps/mercato/src/app/layout.tsx:32` — root layout passes `dict` to `AppProviders`
2. `apps/mercato/src/components/AppProviders.tsx:28` — `"use client"`, renders `I18nProvider`

`apps/mercato/src/app/(backend)/backend/layout.tsx` used to render a **second, nested**
`I18nProvider` with the same object. That nesting has been removed (2026-09-15) — the
root provider already covers every route, and the nested one additionally reset
`localeLocked` to `false` for everything under `/backend`, silently discarding
`OM_FORCE_LOCALE`. Because `loadDictionary` returns a process-cached object, both props
were the *same reference* and React Flight dedupes repeated references, so removing the
nested provider is expected to be byte-neutral — **this was not measured** and is the
first thing to confirm.

**Removing `dict` from the backend layout alone therefore saves nothing. Any real fix
must remove the root-layout prop.**

## Rejected: route- or entitlement-scoped dictionaries

The obvious idea is "ship only the current route's module". It cannot satisfy "no
visible text change, in any locale", because cross-module client components render on
**every** backend page:

- **Sidebar footer** — `staff/widgets/injection-table.ts` targets `backend:sidebar:nav:footer`;
  its widget calls `useT('staff.timesheets.sidebar.timerRunning')`. A user on
  `/backend/catalog/products` needs a `staff.*` key.
- **Notification bell** — `notifications.client.generated.ts` statically imports renderers
  from sales, warranty_claims, wms, communication_channels, ai_assistant, inbox_ops,
  checkout and customer_accounts. Which one renders depends on *what notification
  arrives*, not on the current route.
- **Sidebar nav** — `AppShell` resolves every menu label client-side with
  `t(item.labelKey, …)`; the route metadata spans **38 namespaces**.
- **Widget injection generally** — 55 injection widgets from 26 modules; wms injects into
  catalog and sales, eudr into catalog/sales/customers, warranty_claims into sales and
  customers.

Entitlement scoping (ship only modules the tenant has) is the only defensible scoping
axis, and for a tenant with all modules enabled it degrades to the full dictionary —
i.e. it does nothing for the users who matter most.

Static pruning of unreferenced keys is also unsafe: 335 call sites build keys with
template literals (e.g. ``t(`${prefix}.${suffix}`)`` in `ui/src/backend/detail/*`), so
"statically unreferenced" does not imply dead.

Failure mode if we get scoping wrong: 3,757 `t('key')` call sites have **no fallback**
and render the raw dotted key; 11,900 have an English fallback and would silently render
English to a non-English user. The second is worse — and partly invisible in QA, because
13–21% of `pl`/`es`/`de` values are already byte-identical to English.

## Proposed: immutable, cacheable per-locale asset

The dictionary is build-time immutable — the `translations` module translates entity
*records*, not UI strings, and the only cache invalidation is at bootstrap registration.
So it can be content-hashed and cached forever.

1. Build step emits `public/i18n/<locale>.<contenthash>.js` for each of the 8 locales
   (`en, pl, es, de, ko, vi, fr, zh`), each assigning a global.
2. `next.config.ts` `headers()` serves that path `public, max-age=31536000, immutable`.
3. Root layout injects it as a `beforeInteractive` script.
4. `AppProviders` / `I18nProvider` read the global; the `dict` prop becomes optional.

**Verified feasible** against the installed `next@16.3.3`: in App Router,
`beforeInteractive` pushes onto `self.__next_s`, and `appBootstrap` (`next/dist/client/app-bootstrap.js:22-66`)
awaits each script's `onload` **before** calling `hydrate()`. The existing inline
`om-theme-init` script in the root layout is precedent. CSP already allows `'self'` for
`script-src`.

**The 404 hazard is the main design risk.** `loadScriptsInSequence` catches and hydrates
anyway, so a missing asset would render raw keys for 3,757 call sites. The provider must
therefore keep a server-embedded fallback, or the layout must inline a small always-needed
core and let the asset carry the rest.

Cost: ~11 MB of build artifacts (8 locales × ~1.3 MB).

## Acceptance criteria

1. Measured before/after of `GET /login` gzipped size (the dictionary is ~96% of it).
2. A degraded-mode test proving a missing/blocked asset cannot produce raw keys.
3. The content hash changes whenever any of the 61 dictionary files changes.
4. No visible text change in any locale — spot-checked on a non-English locale, since
   the fallback path renders English and would otherwise pass unnoticed.

## Out of scope

- The 6,017 statically-unreferenced keys. Worth an audit, but only after the 335
  template-literal call sites are resolved; not on this critical path.
- Any change to the `useT()` / `resolveTranslations()` contract.

## Changelog

- 2026-09-15 — Spec created. Measurements taken; nested backend `I18nProvider` removed;
  route/entitlement scoping investigated and rejected with evidence.
