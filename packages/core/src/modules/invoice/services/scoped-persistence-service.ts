import type { EntityClass, EntityData, EntityManager, FilterQuery, FindOptions } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

import { Invoice, InvoiceCompany } from '../data/entities'
import {
  assignInvoiceScope,
  assertInvoiceSameScope,
  invoiceScopeWhere,
  type InvoiceScope,
  type InvoiceScopedRecord,
} from '../data/scope'

type InvoiceEntity = InvoiceScopedRecord & { id: string; deletedAt?: Date | null }
type InvoiceEntityClass<TEntity extends InvoiceEntity> = EntityClass<TEntity>

const SOFT_DELETE_ENTITY_NAMES = new Set<string>([Invoice.name, InvoiceCompany.name])

function detailWhere<TEntity extends InvoiceEntity>(
  entity: InvoiceEntityClass<TEntity>,
  where: FilterQuery<TEntity>,
): FilterQuery<TEntity> {
  if (!SOFT_DELETE_ENTITY_NAMES.has(entity.name)) return where
  return { ...(where as Record<string, unknown>), deletedAt: null } as FilterQuery<TEntity>
}

export class InvoiceScopedPersistenceService {
  constructor(private readonly em: EntityManager) {}

  findOne<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    where: FilterQuery<TEntity>,
    options?: FindOptions<TEntity>,
  ): Promise<TEntity | null> {
    return this.em.findOne(entity, invoiceScopeWhere(scope, where as Record<string, unknown>) as FilterQuery<TEntity>, options)
  }

  findById<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    id: string,
    options?: FindOptions<TEntity>,
  ): Promise<TEntity | null> {
    return this.findOne(entity, scope, detailWhere(entity, { id } as FilterQuery<TEntity>), options)
  }

  findMany<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    where: FilterQuery<TEntity> = {} as FilterQuery<TEntity>,
    options?: FindOptions<TEntity>,
  ): Promise<TEntity[]> {
    return this.em.find(entity, invoiceScopeWhere(scope, where as Record<string, unknown>) as FilterQuery<TEntity>, options)
  }

  createScoped<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    payload: EntityData<TEntity>,
  ): TEntity {
    const record = this.em.create(
      entity,
      assignInvoiceScope(payload as Record<string, unknown>, scope) as unknown as EntityData<TEntity>,
    )
    assertInvoiceSameScope(record, scope)
    return record
  }

  async requireById<TEntity extends InvoiceEntity>(
    entity: InvoiceEntityClass<TEntity>,
    scope: InvoiceScope,
    id: string,
    options?: FindOptions<TEntity>,
  ): Promise<TEntity> {
    const record = await this.findById(entity, scope, id, options)
    if (!record) throw new CrudHttpError(404, { error: 'Invoice record not found.' })
    return record
  }
}

export function createInvoiceScopedPersistenceService(em: EntityManager): InvoiceScopedPersistenceService {
  return new InvoiceScopedPersistenceService(em)
}
