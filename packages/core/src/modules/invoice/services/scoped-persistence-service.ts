import type {
  EntityClass,
  EntityData,
  EntityManager,
  FilterQuery,
  FindOneOptions,
  FindOptions,
} from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'

import { Invoice, InvoiceCompany } from '../data/entities'
import {
  assignInvoiceScope,
  invoiceScopeWhere,
  type InvoiceScope,
  type InvoiceScopedRecord,
} from '../data/scope'

type InvoiceEntity = InvoiceScopedRecord & { id: string; deletedAt?: Date | null }
type InvoiceEntityClass<TEntity extends InvoiceEntity> = EntityClass<TEntity>
type InvoiceScopedFindOptions<TEntity extends InvoiceEntity> = FindOptions<TEntity> & { includeDeleted?: boolean }
type InvoiceScopedFindOneOptions<TEntity extends InvoiceEntity> = FindOneOptions<TEntity> & { includeDeleted?: boolean }

/**
 * Every invoice entity that declares a `deleted_at` column. Reads for these are
 * filtered to live rows unless the caller opts in with `includeDeleted`, so a
 * new soft-deletable entity missing from this list would silently return
 * deleted rows — the module's unit tests pin the list against `data/entities.ts`.
 */
export const INVOICE_SOFT_DELETABLE_ENTITIES: readonly EntityClass<InvoiceEntity>[] = [
  Invoice as EntityClass<InvoiceEntity>,
  InvoiceCompany as EntityClass<InvoiceEntity>,
]

const SOFT_DELETE_FIELDS = new Map<EntityClass<InvoiceEntity>, keyof InvoiceEntity>(
  INVOICE_SOFT_DELETABLE_ENTITIES.map((entity) => [entity, 'deletedAt'] as const),
)

function softDeleteFieldFor<TEntity extends InvoiceEntity>(
  entity: InvoiceEntityClass<TEntity>,
): keyof InvoiceEntity | null {
  return SOFT_DELETE_FIELDS.get(entity as EntityClass<InvoiceEntity>) ?? null
}

function readWhere<TEntity extends InvoiceEntity>(
  entity: InvoiceEntityClass<TEntity>,
  where: FilterQuery<TEntity>,
  includeDeleted?: boolean,
): FilterQuery<TEntity> {
  const softDeleteField = softDeleteFieldFor(entity)
  if (includeDeleted || !softDeleteField) return where
  return { ...(where as Record<string, unknown>), [softDeleteField]: null } as FilterQuery<TEntity>
}

function findOptions<TEntity extends InvoiceEntity>(
  options?: InvoiceScopedFindOptions<TEntity>,
): FindOptions<TEntity> | undefined {
  if (!options) return undefined
  const { includeDeleted: _includeDeleted, ...ormOptions } = options
  return ormOptions as FindOptions<TEntity>
}

function findOneOptions<TEntity extends InvoiceEntity>(
  options?: InvoiceScopedFindOneOptions<TEntity>,
): FindOneOptions<TEntity> | undefined {
  if (!options) return undefined
  const { includeDeleted: _includeDeleted, ...ormOptions } = options
  return ormOptions as FindOneOptions<TEntity>
}

export class InvoiceScopedPersistenceService {
  constructor(private readonly em: EntityManager) {}

  findOne<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    where: FilterQuery<TEntity>,
    options?: InvoiceScopedFindOneOptions<TEntity>,
  ): Promise<TEntity | null> {
    const scopedWhere = invoiceScopeWhere(
      scope,
      readWhere(entity, where, options?.includeDeleted) as Record<string, unknown>,
    ) as FilterQuery<TEntity>

    return this.em.findOne(entity, scopedWhere, findOneOptions(options))
  }

  findById<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    id: string,
    options?: InvoiceScopedFindOneOptions<TEntity>,
  ): Promise<TEntity | null> {
    return this.findOne(entity, scope, { id } as FilterQuery<TEntity>, options)
  }

  findMany<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    where: FilterQuery<TEntity> = {} as FilterQuery<TEntity>,
    options?: InvoiceScopedFindOptions<TEntity>,
  ): Promise<TEntity[]> {
    const scopedWhere = invoiceScopeWhere(
      scope,
      readWhere(entity, where, options?.includeDeleted) as Record<string, unknown>,
    ) as FilterQuery<TEntity>

    return this.em.find(entity, scopedWhere, findOptions(options))
  }

  createScoped<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    payload: EntityData<TEntity>,
  ): TEntity {
    return this.em.create(
      entity,
      assignInvoiceScope(payload as Record<string, unknown>, scope) as unknown as EntityData<TEntity>,
    )
  }

  async requireById<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    id: string,
    options?: InvoiceScopedFindOneOptions<TEntity>,
  ): Promise<TEntity> {
    const record = await this.findById(entity, scope, id, options)
    if (!record) throw notFound('[internal] Invoice scoped record not found')
    return record
  }
}

export function createInvoiceScopedPersistenceService(em: EntityManager): InvoiceScopedPersistenceService {
  return new InvoiceScopedPersistenceService(em)
}
