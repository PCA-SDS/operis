import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppointmentLine } from '@open-mercato/core/modules/appointments/data/entities'
import type { CatalogProductOption, CatalogProductOptionGroup } from '@open-mercato/core/modules/catalog/data/entities'
import {
  buildSelectedOptions,
  createOptionSnapshots,
  type SelectedOptions,
} from '../appointmentOptionSnapshots'

function option(id: string, groupId: string, name: string): CatalogProductOption {
  return { id, group: { id: groupId }, name } as unknown as CatalogProductOption
}

function group(
  id: string,
  name: string,
  parentOptionId?: string,
  selectMode: 'single' | 'multiple' = 'single',
): CatalogProductOptionGroup {
  return {
    id,
    name,
    requirement: 'required',
    selectMode,
    sortOrder: 0,
    parentOption: parentOptionId ? { id: parentOptionId } : null,
  } as unknown as CatalogProductOptionGroup
}

describe('TPS appointment option snapshots', () => {
  const productId = 'product-1'
  const builderGroupId = 'builder-group'
  const lengthGroupId = 'length-group'
  const scopeGroupId = 'scope-group'
  const alternateLengthGroupId = 'alternate-length-group'
  const alternateScopeGroupId = 'alternate-scope-group'
  const builderOption = option('builder-option', builderGroupId, 'CND™ Plexigel Build Overlay')
  const lengthOption = option('length-option', lengthGroupId, 'Short / Medium')
  const scopeOption = option('scope-option', scopeGroupId, 'Manicure')
  const alternateLengthOption = option('alternate-length-option', alternateLengthGroupId, 'Long / Extra Long')
  const alternateScopeOption = option('alternate-scope-option', alternateScopeGroupId, 'Manicure')
  const optionsBySource = new Map<string, CatalogProductOption[]>([
    [`${productId}:plexigel-overlay`, [builderOption]],
    [`${productId}:length-short`, [lengthOption]],
    [`${productId}:scope-mani`, [alternateScopeOption, scopeOption]],
  ])

  it('keeps every option in a TPS nested selection path', () => {
    const groupsById = new Map([
      [builderGroupId, group(builderGroupId, 'Builder Type', undefined, 'multiple')],
      [lengthGroupId, group(lengthGroupId, 'Nail Length', builderOption.id)],
      [scopeGroupId, group(scopeGroupId, 'Service Scope', lengthOption.id)],
      [alternateLengthGroupId, group(alternateLengthGroupId, 'Nail Length', builderOption.id)],
      [alternateScopeGroupId, group(alternateScopeGroupId, 'Service Scope', alternateLengthOption.id)],
    ])
    expect(buildSelectedOptions(productId, [{
      path: [
        { optionId: 'plexigel-overlay' },
        { optionId: 'length-short' },
      ],
      optionId: 'scope-mani',
    }], optionsBySource, groupsById)).toEqual({
      [builderGroupId]: [builderOption.id],
      [lengthGroupId]: lengthOption.id,
      [scopeGroupId]: scopeOption.id,
    })
  })

  it('writes consistent group labels while preserving nested parent relationships', () => {
    const groupsById = new Map([
      [builderGroupId, group(builderGroupId, 'Builder Type')],
      [lengthGroupId, group(lengthGroupId, 'Nail Length', builderOption.id)],
      [scopeGroupId, group(scopeGroupId, 'Service Scope', lengthOption.id)],
    ])
    const optionsById = new Map([
      [builderOption.id, builderOption],
      [lengthOption.id, lengthOption],
      [scopeOption.id, scopeOption],
    ])
    const selectedOptions: SelectedOptions = {
      [builderGroupId]: builderOption.id,
      [lengthGroupId]: lengthOption.id,
      [scopeGroupId]: scopeOption.id,
    }
    const persisted: unknown[] = []
    const em = {
      create: (_entity: unknown, data: unknown) => data,
      persist: (entity: unknown) => persisted.push(entity),
    } as unknown as EntityManager

    createOptionSnapshots(em, {} as AppointmentLine, selectedOptions, groupsById, optionsById)

    const snapshots = persisted.filter((entity): entity is { groupName: string; breadcrumbPath: string; parentOptionId: string | null } => (
      typeof entity === 'object' && entity !== null && 'groupName' in entity && 'breadcrumbPath' in entity
    ))
    expect(snapshots.map((snapshot) => [snapshot.groupName, snapshot.breadcrumbPath, snapshot.parentOptionId])).toEqual([
      ['Builder Type', 'Builder Type', null],
      ['Nail Length', 'Nail Length', builderOption.id],
      ['Service Scope', 'Service Scope', lengthOption.id],
    ])
  })
})
