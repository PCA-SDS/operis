import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'resources',
  hosts: {
    resourcesTable: dataTableExtensionHost({ tableId: 'resources.resources.list', source: 'backend/resources/resources/page.tsx' }),
    resourceTypesTable: dataTableExtensionHost({ tableId: 'resources.resource-types.list', source: 'backend/resources/resource-types/page.tsx' }),
    resourceAreasTable: dataTableExtensionHost({ tableId: 'resources.resource-areas.list', source: 'backend/resources/areas/page.tsx' }),
    areaTypesTable: dataTableExtensionHost({ tableId: 'resources.area-types.list', source: 'backend/resources/area-types/page.tsx' }),
  },
})

export default extensionPoints
