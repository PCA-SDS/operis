# ADR-0004 — Scope the compatibility contract to persisted identifiers

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

Open Mercato ships `@open-mercato/*` to npm and an ecosystem of third-party
developers builds modules against those packages. `BACKWARD_COMPATIBILITY.md`
exists to protect them: it classifies 14 contract-surface categories as
FROZEN / STABLE / ADDITIVE-ONLY and requires a deprecation protocol —
deprecate, bridge, document, spec — before any of them changes.

`AGENTS.md` made that binding, instructing every contributor and coding agent
to "Follow `BACKWARD_COMPATIBILITY.md` before touching any contract surface."

Inherited verbatim, that document forbids Operis from changing its own
internals. It freezes exported names, function signatures, import paths, DI
keys, CLI command names, widget spot IDs, and the shape of every module
convention file. Renaming an internal helper would formally require a
deprecation window and a re-export bridge.

The premise does not transfer. Verified 2026-08-23:

- Operis publishes nothing. Every `@open-mercato/*` dependency in this
  repository resolves via `workspace:*` — no manifest pulls one from a
  registry.
- There are no third-party Operis module authors.
- The whole monorepo is refactored atomically, and typecheck proves call
  sites are updated.

## Decision

Re-scope the contract from *"protect external consumers of published
packages"* to *"protect state that outlives the code."*

The test is now a single question: **does anything outside the code depend on
this identifier?**

**Frozen — changing these is a data migration, not a refactor:**

| Identifier | Persisted in |
|---|---|
| ACL feature IDs | `role_acls.features_json`, `user_acls.features_json`, `customer_role_acls.features_json`, `customer_user_acls.features_json`, `scheduled_jobs.require_feature`, `inbox_proposal_actions.required_feature` |
| Event IDs | `business_rules.event_type`, `carrier_webhook_events.event_type`, `gateway_webhook_events.event_type` |
| Notification type IDs | `notification_preferences.notification_type_id`, `notification_type_overrides.notification_type_id`, `push_notification_deliveries.notification_type_id` |
| Database schema | the schema itself |

**Free — internal, change in one commit:** import paths, exported names,
function signatures, public TypeScript types, DI keys, CLI command names,
widget injection spot IDs, module convention file shapes.

## Reason

The distinction is not stylistic, it is about where the identifier lives.

A renamed export is caught by the compiler. A renamed **ACL feature ID** is
not: the string sits in a `features_json` array in the database, the code stops
matching it, and a role silently loses a permission — or a wildcard grant stops
covering a feature it used to cover. That is a security regression that
typecheck, lint and unit tests all pass through. The same applies to event IDs
referenced by stored `business_rules` triggers and notification type IDs in
saved user preferences.

So the discipline is kept exactly where it earns its cost, and dropped where it
was protecting an ecosystem this repository does not have.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the contract as inherited | Freezes our own internals to protect npm consumers that do not exist. This is precisely the upstream constraint the fork exists to remove. |
| Delete `BACKWARD_COMPATIBILITY.md` entirely | Throws away real protection. The persisted-identifier hazard is genuine and non-obvious, and the category sections are an accurate map of where each surface is consumed. |
| Enforce the split with a test | No mechanical way to detect "this string is also a row value" without a live database. The migration requirement is a review-time judgement. |

## Security impact

Net positive, and the point of the exercise. The inherited document buried the
one genuinely dangerous case — renaming a persisted ACL feature ID silently
dropping a grant — inside thirteen other categories that carry no such risk.
Contributors who learn that "everything is frozen" apply the rule uniformly and
stop reading. Naming the four data-backed categories explicitly, and saying why,
makes the dangerous case the memorable one.

The Emergency Security Exception is retained unchanged.

## Migration impact

None. No code changes; this is a change to review policy and its documentation.
The category sections of `BACKWARD_COMPATIBILITY.md` are retained as reference
for blast radius, with a new preamble stating which now bind.

## Future implications

If Operis ever publishes packages, or admits third-party module authors, this
ADR must be revisited — the upstream framing would become correct again for the
surfaces those consumers touch.

Once Operis is deployed, its own database and stored integration configuration
become the external consumer. The persisted-identifier rule already covers that
case, which is why it is phrased around persistence rather than around
"internal versus external".
