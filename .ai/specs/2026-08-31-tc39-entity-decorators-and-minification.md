# TC39 Entity Decorators — Unblocking Production Minification

**Status:** implemented
**Owner:** shared / core / cli
**Date:** 2026-08-31

## TLDR

Both Next.js minifiers were disabled in every environment, production included, because
MikroORM's **legacy** decorators key entity metadata off `target.constructor.name`. A minifier
mangles distinct entity classes down to the same short identifier, their metadata buckets
collide, and `next build` dies with
`MetadataError: Multiple property decorators used on 'I.comments'`. The cost was ~62 MB of
unminified client JS.

All 269 entity classes across 48 files now use the **TC39 (Stage-3)** decorators, which receive
the class name as a compile-time string literal and attach metadata per class through the
decorator context. Mangling is therefore harmless, and both minifiers are on.

Measured on a full production build:

| | before | after | reduction |
|---|---|---|---|
| raw client JS (parse/compile cost) | 59.90 MB | 21.77 MB | **63.7%** |
| gzip (wire) | 9.24 MB | 5.65 MB | 38.9% |
| brotli (wire) | 8.25 MB | 5.18 MB | **37.2%** |

`yarn db:generate` reports **zero schema drift** against the committed snapshots, which is the
load-bearing verification: 269 entities and 3,726 properties map to byte-identically the same
columns, types, nullability and indexes as before.

## Why this was safe to do now

The `mikro.ts` comment warned that entities relied on `emitDecoratorMetadata` +
`reflect-metadata` for type inference, and that "inferred types are silently wrong at runtime"
without it. That was true when written; it is no longer true of this codebase. An audit found:

- **3,726 / 3,726** property-style decorators already declare an explicit `type:`.
- **0** properties depend on inferred nullability (3 apparent hits were `| null` inside a
  generic type argument, not the property's own type).

So there was nothing left for `ReflectMetadataProvider` to infer, and v7's default provider
covers the migration. `reflect-metadata`, `ReflectMetadataProvider` and `emitDecoratorMetadata`
are all removed.

Blast radius was also far smaller than the flags suggest: exactly **one** non-entity file in the
repo uses decorator syntax, and it is a test fixture inside a template string that ships its own
legacy tsconfig.

**`useDefineForClassFields` is deliberately left `false`.** Standard decorators do not require
`define` semantics, and flipping it would change class-field initialization for every class in
the monorepo — a much wider blast radius than this migration needs. Only
`experimentalDecorators` and `emitDecoratorMetadata` changed.

## Two upstream defects this had to work around

`@mikro-orm/decorators@7.1.8`'s ES decorators have two real bugs that the legacy ones do not.
Both are worked around in `packages/shared/src/lib/db/decorators.ts`, which every
`data/entities.ts` now imports from — one place to decide the decorator flavour, and one place a
future entity file cannot bypass.

### 1. `@Index` / `@Unique` leak into the parent entity

`Indexed.js` does `meta[key] ??= []`. Under Stage-3 decorators a subclass's `context.metadata`
prototypally **inherits** from its parent's, so `??=` sees the inherited array as present, never
creates an own property, and `push()` mutates the *parent's* array. Upstream's own `Property.js`
guards the analogous case with `Object.hasOwn`; `Indexed.js` misses it.

Reproduced minimally — parent collects both indexes, child gets none:

```
legacy   BaseRow => [["tenantId"]]        ChildRow => [["slug"]]      <- correct
es       BaseRow => [["tenantId"],["slug"]]  ChildRow => []           <- wrong
```

10 entity classes inherit (9 `extends WmsScopedEntity`, plus
`CheckoutLink extends CheckoutLinkTemplate`), and all 10 declare class-level indexes. It
surfaced as `Entity CheckoutLinkTemplate has wrong index definition: 'slug' does not exist`.

The wrapper gives each class its own **empty** array before delegating — a copy of the parent's
would duplicate the parent's indexes onto the child. Verified against the legacy output above.

### 2. An explicit column `name:` is dropped

`Property.js` builds `prop` by spreading `opts`, *then* calls
`Utils.renameKey(options, 'name', 'fieldName')` — which mutates the caller's `options` object,
not the `prop` it already built. So `prop.fieldName` is never set and `prop.name` is overwritten
with the property name: the column name is simply lost. (`PrimaryKey.js` and `Enum.js` have the
same shape with the spread ordered the other way, so a user `name` overwrites the property name
instead.)

This is invisible for the ~3,200 properties whose column *is* the underscored property name
(`entityId` → `entity_id`), because the naming strategy re-derives the same string. It bites
exactly where the two genuinely differ. On this repo that was 5 columns, and `yarn db:generate`
proposed to **rename live columns**:

```
role       -> participant_role     (customers)
name       -> label                (customers)
position   -> order                (customers)
notes      -> notes_text           (sales)
references -> email_references     (inbox_ops)
```

The wrapper passes the column as `fieldName` up front, which is what upstream's `renameKey` was
trying to achieve — so this restores the intended semantics rather than changing them.

Both wrappers carry an explicit removal condition: delete them and re-export upstream directly
once `@mikro-orm/decorators` guards `indexes`/`uniques` like it guards `properties`, and applies
its rename to the property it builds.

## Changes

| File(s) | Change |
|---|---|
| `packages/shared/src/lib/db/decorators.ts` *(new)* | The repo's entity decorator surface: re-exports the TC39 decorators and wraps `Index`/`Unique`/`Property`/`PrimaryKey`/`Enum` with the two fixes above |
| 48 × `data/entities.ts` | Import decorators from the shim instead of `@mikro-orm/decorators/legacy` |
| `tsconfig.base.json` | `experimentalDecorators: false`, `emitDecoratorMetadata: false`; `useDefineForClassFields` deliberately unchanged |
| `packages/cli/tsconfig.json` | Dropped its `experimentalDecorators`/`emitDecoratorMetadata` overrides so it inherits the base — it typechecks core's entities and was the only package re-enabling the legacy mode |
| `packages/shared/src/lib/db/mikro.ts` | Removed `ReflectMetadataProvider` and `import 'reflect-metadata'` |
| `packages/cli/src/lib/db/commands.ts` | Removed both `ReflectMetadataProvider` usages, and switched the **runtime** `ts.transpileModule` of entity files to TC39 — transpiling ES decorators with the legacy transform produced entities with no usable metadata, surfacing as `Cannot convert undefined or null to object` during schema diffing |
| `packages/cli/src/lib/generators/openapi.ts` | Refreshed a comment that described the decorator mode as legacy |
| `apps/mercato/next.config.ts` | `serverMinification` / `turbopackMinify` no longer disabled |
| `eslint.config.mjs` | `no-restricted-imports` banning `@mikro-orm/decorators*` outside the shim |
| `packages/shared/src/lib/db/__tests__/entity-decorator-boundary.test.ts` *(new)* | The CI gate for that boundary, in both directions |

## Verification

- **Zero schema drift**: `yarn db:generate` produces no migrations and no snapshot changes.
- **Minification proof**: built the documented collision case (`comments` as `@OneToMany` on one
  entity, scalar `@Property` on another) with `esbuild --minify` and read MikroORM's metadata
  back. Class bindings mangle to `x`/`M`/`P` while the decorator still receives
  `"CollideCustomer"` as a string literal; the two `comments` properties keep distinct
  `1:m` / `scalar` kinds. `__name` count 0, so this was genuine mangling, not `keepNames`.
- Full gate green: `build:packages`, `generate`, `typecheck` (24/24), `lint` (0 errors),
  `test` (51/51 tasks), `build:app`, `i18n:check-sync`, `agents:check-budget`.

## Risks

- **The shim is load-bearing**, and is now enforced structurally rather than by convention:
  - `no-restricted-imports` in `eslint.config.mjs` bans `@mikro-orm/decorators` and
    `@mikro-orm/decorators/*` outside the shim, giving the signal at the keystroke. `turbo run
    lint` only runs in `apps/mercato`, so in CI this covers that workspace; editors resolve the
    root config for `packages/**` too.
  - `packages/shared/src/lib/db/__tests__/entity-decorator-boundary.test.ts` is the gate that
    covers every entity file under `yarn test`. It asserts both directions: no source outside
    the shim imports upstream, AND every `data/entities.ts` declaring an `@Entity` sources its
    decorators from the shim. The second assertion catches what a package-name rule cannot —
    an entity file importing decorators from `@mikro-orm/core`, or from a hand-rolled local
    re-export.

  Both were verified to fail on a deliberate violation before being kept.
- **Runtime ORM behaviour is verified by schema diff and the unit suite, not by an integration
  run against a populated database.** The integration harness could not authenticate against the
  dev database in this environment. A QA pass over entity CRUD is warranted before release.
- If any future change reintroduces the legacy decorators anywhere in the entity graph, the
  minifiers must go back off.

## Changelog

- **2026-08-31** — implemented. 48 entity files migrated, decorator shim added with two upstream
  workarounds, `reflect-metadata` chain removed, minification enabled. 59.90 MB → 21.77 MB raw
  client JS, 8.25 MB → 5.18 MB brotli. Shim boundary enforced by an ESLint rule plus a
  bidirectional guard test.
