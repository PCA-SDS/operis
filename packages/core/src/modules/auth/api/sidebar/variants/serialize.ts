import type { SidebarVariantRecord } from '../../../services/sidebarPreferencesService'
import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'

export function serializeVariant(record: SidebarVariantRecord) {
  return {
    id: record.id,
    name: record.name,
    isActive: record.isActive,
    settings: {
      version: record.settings.version ?? SIDEBAR_PREFERENCES_VERSION,
      groupOrder: record.settings.groupOrder ?? [],
      groupLabels: record.settings.groupLabels ?? {},
      itemLabels: record.settings.itemLabels ?? {},
      hiddenItems: record.settings.hiddenItems ?? [],
      itemOrder: record.settings.itemOrder ?? {},
    },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
  }
}
