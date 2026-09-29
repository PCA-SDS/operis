import {
  buildTpsSearchReindexArgs,
  parseTpsMigrateFlags,
  reindexTpsSearch,
  tpsSearchEntityTypes,
} from '../lib'

describe('TPS search reindexing', () => {
  it('targets every searchable entity written by the importer', () => {
    expect(tpsSearchEntityTypes).toEqual([
      'catalog:catalog_product_category',
      'catalog:catalog_product',
      'catalog:catalog_product_variant',
      'catalog:catalog_product_option_group',
      'catalog:catalog_product_option',
      'catalog:catalog_price_kind',
      'customers:customer_entity',
      'customers:customer_person_profile',
      'resources:resources_resource_area_type',
      'resources:resources_resource_type',
      'resources:resources_resource_area',
      'resources:resources_resource',
      'planner:planner_availability_rule_set',
      'planner:planner_availability_rule',
      'staff:staff_team_role',
      'staff:staff_team_member',
      'auth:user',
    ])
  })

  it('builds tenant-scoped query-index commands without vector reindexing', () => {
    expect(buildTpsSearchReindexArgs('tenant-1', ['customers:customer_entity'])).toEqual([
      [
        'query_index',
        'reindex',
        '--tenant',
        'tenant-1',
        '--entity',
        'customers:customer_entity',
        '--force',
      ],
    ])
  })

  it('runs each entity reindex sequentially after the caller transaction commits', async () => {
    const runCommand = jest.fn().mockResolvedValue(undefined)

    await reindexTpsSearch('tenant-1', ['catalog:catalog_product', 'customers:customer_entity'], runCommand)

    expect(runCommand).toHaveBeenNthCalledWith(1, [
      'query_index',
      'reindex',
      '--tenant',
      'tenant-1',
      '--entity',
      'catalog:catalog_product',
      '--force',
    ])
    expect(runCommand).toHaveBeenNthCalledWith(2, [
      'query_index',
      'reindex',
      '--tenant',
      'tenant-1',
      '--entity',
      'customers:customer_entity',
      '--force',
    ])
  })

  it('supports skipping the automatic rebuild for the all-command orchestration', () => {
    expect(parseTpsMigrateFlags(['tenant-1', 'org-1', '--replace', '--skip-search-reindex'])).toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      replace: true,
      skipSearchReindex: true,
    })
  })
})
