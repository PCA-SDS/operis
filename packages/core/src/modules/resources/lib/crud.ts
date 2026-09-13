import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type {
  ResourcesResource,
  ResourcesResourceActivity,
  ResourcesResourceArea,
  ResourcesResourceAreaType,
  ResourcesResourceComment,
  ResourcesResourceTagAssignment,
  ResourcesResourceType,
} from '../data/entities'

function buildCrudEvents<TEntity>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'resources',
    entity,
    persistent: true,
    buildPayload: (ctx) => ({
      id: ctx.identifiers.id,
      organizationId: ctx.identifiers.organizationId,
      tenantId: ctx.identifiers.tenantId,
    }),
  }
}

export const resourcesResourceCrudEvents = buildCrudEvents<ResourcesResource>('resource')
export const resourcesResourceTypeCrudEvents = buildCrudEvents<ResourcesResourceType>('resource_type')
export const resourcesResourceCommentCrudEvents = buildCrudEvents<ResourcesResourceComment>('comment')
export const resourcesResourceActivityCrudEvents = buildCrudEvents<ResourcesResourceActivity>('activity')
export const resourcesResourceTagAssignmentCrudEvents = buildCrudEvents<ResourcesResourceTagAssignment>('resource_tag_assignment')
export const resourcesResourceAreaCrudEvents = buildCrudEvents<ResourcesResourceArea>('resource_area')
export const resourcesResourceAreaTypeCrudEvents = buildCrudEvents<ResourcesResourceAreaType>('area_type')
