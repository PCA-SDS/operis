# Entity Update Safety — `withAtomicFlush`

Long-form procedure for `packages/core`. The hard rules live in
[`packages/core/AGENTS.md`](../../packages/core/AGENTS.md) § Entity Update
Safety; this file carries the reasoning and the worked examples, per the
instruction-budget split described in
[`agent-instructions.md`](agent-instructions.md).

Spec: [`SPEC-018`](../specs/implemented/SPEC-018-2026-02-05-safe-entity-flush.md).

MikroORM's identity-map and subscriber infrastructure can silently discard pending scalar changes when a query (`em.find`, `em.findOne`, etc.) runs on the same `EntityManager` before an explicit `em.flush()`. Additionally, multiple `em.flush()` calls without transaction wrapping risk partial commits. See [SPEC-018](../../.ai/specs/implemented/SPEC-018-2026-02-05-safe-entity-flush.md) for the full analysis.

## Rules

- Use `withAtomicFlush(em, phases, options)` from
  `@open-mercato/shared/lib/commands/flush` when a command mutates
  entities across multiple phases that include queries on the same `EntityManager`.
- **NEVER** run `em.find` / `em.findOne` / sync helpers between scalar
  mutations and `em.flush()` on the same `EntityManager` without using `withAtomicFlush`.
- Enable `{ transaction: true }` when atomicity matters (all-or-nothing semantics).
- Keep `emitCrudSideEffects` / `emitCrudUndoSideEffects` calls **OUTSIDE** `withAtomicFlush`
  — side effects should only fire after the DB changes are committed.
- Cache invalidation follows the same rule as side effects: invalidate **after** the DB write commits, never inside the `withAtomicFlush` block. For the opt-in always-consistent read-projection tail (`OM_CACHE_SAFETY_ALWAYS_CONSISTENT`, default OFF) see `.ai/specs/2026-06-05-cache-safety-always-consistent.md`.
- This applies to **both** `execute` methods (update commands) and `undo` handlers.

## Commit-boundary guarantee (defense in depth)

`withAtomicFlush` flushes after **each** phase, then runs a final **pending-changes guard** before the transaction commits: it re-checks the `UnitOfWork` and, if any change set still lingers (a phase mutated a managed entity after its own flush boundary), flushes it defensively inside the same transaction and logs a dev warning naming `options.label`. The transaction therefore can never commit unflushed scalar work — even if a per-phase flush was missed. Pass `{ label: '<module>.<command>' }` so the warning is actionable. The guard is a safety net, **not** a license to interleave mutate→read in one phase: structure phases correctly; let the guard catch only genuine slips.

## Wrong

```typescript
// BUG: changes to `record` are silently lost
record.name = 'New Name'
record.status = 'active'
await syncEntityTags(em, record, tags)   // internal em.find() resets UoW tracking
await em.flush()                          // no UPDATE issued
```

## Correct

```typescript
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'

await withAtomicFlush(em, [
  () => {
    record.name = 'New Name'
    record.status = 'active'
  },
  () => syncEntityTags(em, record, tags),
], { transaction: true })

// Side effects AFTER the atomic flush
await emitCrudSideEffects({ ... })
```

## Preferred: `runCrudCommandWrite` for entity + custom fields + side effects

For commands that write an entity, optionally write custom fields, and emit CRUD/index side effects in one logical operation, prefer `runCrudCommandWrite` over composing `withAtomicFlush` + `setCustomFieldsIfAny` + `emitCrudSideEffects` by hand. The helper owns the EM fork, the atomic flush boundary, the custom-field write, and the side-effect queue in the only correct order, and fails closed if any earlier step throws.

```typescript
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'

await runCrudCommandWrite({
  ctx,
  entityId: 'my_module:my_entity',
  action: 'updated',
  scope: { tenantId: record.tenantId, organizationId: record.organizationId },
  customFields: custom,
  events: myCrudEvents,
  indexer: myCrudIndexer,
  sideEffect: () => ({
    entity: record,
    identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
  }),
  phases: [
    () => {
      record.name = parsed.name
      record.status = parsed.status
    },
    () => syncEntityTags(em, record, parsed.tags),
  ],
})
```

Reference migration: `customers.deals.update` in `packages/core/src/modules/customers/commands/deals.ts`. Keep `withAtomicFlush` for cases the helper doesn't fit (multiple separate transactions per command, etc.).
