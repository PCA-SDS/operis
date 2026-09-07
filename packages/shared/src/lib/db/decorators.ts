/**
 * The entity decorator surface for this repo. Every `data/entities.ts` imports from here
 * rather than from `@mikro-orm/decorators/*` directly, so the decorator flavour is decided in
 * one place and the `@Index` / `@Unique` inheritance fix below cannot be bypassed by a new
 * entity file importing upstream directly.
 *
 * Flavour: TC39 (Stage-3) decorators. The legacy TypeScript decorators keyed entity metadata
 * off `target.constructor.name`, which a minifier mangles — two entity classes collapsing to
 * the same short identifier merged their metadata buckets and threw
 * `Multiple property decorators used on 'I.comments'`. That is why both Next minifiers had to
 * be disabled. The Stage-3 decorators receive the class name as a compile-time string literal,
 * so mangling is harmless. See `tsconfig.base.json` and `apps/mercato/next.config.ts`.
 */
import {
  Enum as UpstreamEnum,
  Index as UpstreamIndex,
  PrimaryKey as UpstreamPrimaryKey,
  Property as UpstreamProperty,
  Unique as UpstreamUnique,
} from '@mikro-orm/decorators/es'

export {
  Entity,
  ManyToOne,
  OneToMany,
  OneToOne,
  ManyToMany,
  Check,
  Embeddable,
  Embedded,
  Filter,
  Formula,
} from '@mikro-orm/decorators/es'

type DecoratorMetadata = Record<PropertyKey, unknown>
type MetadataContext = { metadata: DecoratorMetadata }

/**
 * Give this class its OWN `indexes` / `uniques` array before upstream pushes into it.
 *
 * Upstream's `Indexed.js` does `meta[key] ??= []` — and under Stage-3 decorators a subclass's
 * `context.metadata` prototypally inherits from its parent's. `??=` sees the inherited array as
 * present, so it never creates an own property and `push()` mutates the PARENT's array: the
 * parent silently collects the child's indexes and the child ends up with none. On this repo
 * that surfaced as `Entity CheckoutLinkTemplate has wrong index definition: 'slug' does not
 * exist` during `yarn db:generate`, because `CheckoutLink extends CheckoutLinkTemplate`.
 *
 * Upstream's own `Property.js` already guards the analogous case with
 * `Object.hasOwn(meta, 'properties')`; `Indexed.js` simply misses it.
 *
 * A fresh array — not a copy of the inherited one — is what restores the legacy decorators'
 * behaviour, verified against both flavours: each class collects only the indexes it declares
 * itself, and the parent keeps only its own.
 *
 * DO NOT remove this wrapper just because upstream stopped mutating the parent. 7.1.14 adds an
 * `ensureOwnMetadataArray` helper that does `meta[key] = [...(meta[key] ?? [])]` — an own array,
 * but seeded with a COPY of the parent's. Measured on 7.1.14 against the same fixture:
 *
 *     legacy      BaseRow [tenantId]   ChildRow [slug]              <- what this repo's schema is
 *     7.1.14      BaseRow [tenantId]   ChildRow [tenantId, slug]    <- child inherits the parent's
 *
 * Ten entities extend a shared base here (`WmsScopedEntity`, `CheckoutLinkTemplate`), so
 * dropping this wrapper on 7.1.14 would add the base's indexes to all ten child tables — a
 * silent schema change, not a no-op. Only remove it after confirming `yarn db:generate` still
 * reports zero drift without it.
 */
function withOwnCollection<Args extends unknown[], Result>(
  key: 'indexes' | 'uniques',
  decorate: (...args: Args) => (value: unknown, context: MetadataContext) => Result,
) {
  return (...args: Args) => {
    const applyUpstream = decorate(...args)
    return (value: unknown, context: MetadataContext): Result => {
      const metadata = context?.metadata
      if (metadata && !Object.hasOwn(metadata, key)) metadata[key] = []
      return applyUpstream(value, context)
    }
  }
}

/** Defines a database index on a property or entity class. */
export const Index = withOwnCollection('indexes', UpstreamIndex as never) as typeof UpstreamIndex

/** Defines a unique constraint on a property or entity class. */
export const Unique = withOwnCollection('uniques', UpstreamUnique as never) as typeof UpstreamUnique


/**
 * Send an explicit column name as `fieldName` rather than `name`.
 *
 * `@Property({ name: 'role' }) participantRole` means "this property maps to the column
 * `role`". Upstream's `Property.js` tries to express that by rewriting the option:
 *
 *     const prop = { kind, ...opts }                        // opts still has `name: 'role'`
 *     if (context.name !== name) Utils.renameKey(options, 'name', 'fieldName')
 *     if (context.kind === 'field') prop.name = context.name
 *
 * but `renameKey` mutates `options` AFTER `prop` was spread from it, so `prop.fieldName` is
 * never set and `prop.name` is overwritten with the property name. The column name is simply
 * lost. `PrimaryKey.js` and `Enum.js` have the same shape with the spread ordered the other
 * way, so a user `name` there overwrites the property name instead.
 *
 * It stays invisible for the ~3200 properties whose column IS the underscored property name
 * (`entityId` -> `entity_id`), because the naming strategy re-derives the same string. It bites
 * exactly where the two genuinely differ — on this repo, 5 columns that `yarn db:generate`
 * proposed to RENAME (`role`->`participant_role`, `name`->`label`, `position`->`order`,
 * `notes`->`notes_text`, `references`->`email_references`), which would have silently
 * rewritten live columns.
 *
 * Passing `fieldName` up front is what upstream's `renameKey` was trying to achieve, so this
 * is the intended semantics rather than a behavioural change: verified by `yarn db:generate`
 * reporting no schema drift against the pre-migration snapshots.
 *
 * Still unfixed as of 7.1.14: `Property.js` there calls the same
 * `Utils.renameKey(options, 'name', 'fieldName')` after `prop` is built. This wrapper stays
 * until upstream applies its rename to the property it builds rather than to the caller's
 * options object.
 */
function withExplicitFieldName<Options extends { name?: string }, Result>(
  decorate: (options?: Options) => (value: unknown, context: { name: string | symbol }) => Result,
) {
  return (options?: Options) => (value: unknown, context: { name: string | symbol }) => {
    if (!options || typeof options.name !== 'string' || options.name === context.name) {
      return decorate(options)(value, context)
    }
    const { name, ...rest } = options
    return decorate({ ...rest, fieldName: name } as unknown as Options)(value, context)
  }
}

/** Defines a scalar property on an entity. */
export const Property = withExplicitFieldName(UpstreamProperty as never) as typeof UpstreamProperty

/** Marks a property as the primary key of an entity. */
export const PrimaryKey = withExplicitFieldName(UpstreamPrimaryKey as never) as typeof UpstreamPrimaryKey

/** Defines an enum property on an entity. */
export const Enum = withExplicitFieldName(UpstreamEnum as never) as typeof UpstreamEnum
