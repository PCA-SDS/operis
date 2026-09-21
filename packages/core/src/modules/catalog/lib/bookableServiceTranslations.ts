import type { EntityManager } from "@mikro-orm/postgresql";
import { Organization } from "@open-mercato/core/modules/directory/data/entities";
import { applyLocalizedContent } from "@open-mercato/shared/lib/localization/resolver";
import type {
  BookableService,
  BookableServiceOption,
  BookableServiceOptionGroup,
} from "./bookableServices";

export type BookableServiceTranslationRecord = {
  entity_type: string;
  entity_id: string;
  organization_id: string | null;
  translations: Record<string, Record<string, unknown>> | null;
};

type Localizable = { id: string };
type TranslationDatabase = {
  entity_translations: {
    entity_type: string;
    entity_id: string;
    organization_id: string | null;
    tenant_id: string;
    translations: Record<string, Record<string, unknown>> | null;
  };
};

const entityTypes = {
  product: "catalog:catalog_product",
  category: "catalog:catalog_product_category",
  optionGroup: "catalog:catalog_product_option_group",
  option: "catalog:catalog_product_option",
} as const;

function overlay<T extends Localizable>(
  item: T,
  translationsByLocale: Record<string, Record<string, unknown>> | null,
  locale: string,
): T {
  const localized = applyLocalizedContent(
    item as T & Record<string, unknown>,
    translationsByLocale,
    locale,
  );
  const {
    _locale: ignoredLocale,
    _translated: ignoredFields,
    ...translatedItem
  } = localized;
  void ignoredLocale;
  void ignoredFields;
  return translatedItem as T;
}

function collectIds(items: BookableService[]): string[] {
  const ids = new Set<string>();
  const collectOption = (option: BookableServiceOption) => {
    ids.add(option.id);
    option.nextGroups.forEach(collectGroup);
  };
  const collectGroup = (group: BookableServiceOptionGroup) => {
    ids.add(group.id);
    group.options.forEach(collectOption);
  };

  for (const item of items) {
    ids.add(item.id);
    item.categoryPath.forEach((category) => ids.add(category.id));
    item.optionGroups.forEach(collectGroup);
  }
  return Array.from(ids);
}

function localizeOption(
  option: BookableServiceOption,
  organizationIds: string[],
  rowsByEntity: Map<string, BookableServiceTranslationRecord[]>,
  locale: string,
): BookableServiceOption {
  const nextGroups = option.nextGroups.map((group) =>
    localizeGroup(group, organizationIds, rowsByEntity, locale),
  );
  return overlay(
    { ...option, nextGroups },
    findTranslations(
      rowsByEntity.get(`${entityTypes.option}:${option.id}`),
      organizationIds,
    ),
    locale,
  );
}

function localizeGroup(
  group: BookableServiceOptionGroup,
  organizationIds: string[],
  rowsByEntity: Map<string, BookableServiceTranslationRecord[]>,
  locale: string,
): BookableServiceOptionGroup {
  const options = group.options.map((option) =>
    localizeOption(option, organizationIds, rowsByEntity, locale),
  );
  return overlay(
    { ...group, options },
    findTranslations(
      rowsByEntity.get(`${entityTypes.optionGroup}:${group.id}`),
      organizationIds,
    ),
    locale,
  );
}

function findTranslations(
  rows: BookableServiceTranslationRecord[] | undefined,
  organizationIds: string[],
): Record<string, Record<string, unknown>> | null {
  if (!rows) return null;
  for (const organizationId of organizationIds) {
    const row = rows.find(
      (candidate) => candidate.organization_id === organizationId,
    );
    if (row?.translations) return row.translations;
  }
  return (
    rows.find((candidate) => candidate.organization_id === null)
      ?.translations ?? null
  );
}

export function applyBookableServiceTranslationRows(
  items: BookableService[],
  rows: BookableServiceTranslationRecord[],
  locale: string,
  ancestorOrganizationsById: Map<string, string[]>,
): BookableService[] {
  const rowsByEntity = new Map<string, BookableServiceTranslationRecord[]>();
  for (const row of rows) {
    const key = `${row.entity_type}:${row.entity_id}`;
    rowsByEntity.set(key, [...(rowsByEntity.get(key) ?? []), row]);
  }

  return items.map((item) => {
    const organizationIds = [
      item.organizationId,
      ...(ancestorOrganizationsById.get(item.organizationId) ?? []),
    ];
    const categoryPath = item.categoryPath.map((category) =>
      overlay(
        category,
        findTranslations(
          rowsByEntity.get(`${entityTypes.category}:${category.id}`),
          organizationIds,
        ),
        locale,
      ),
    );
    const optionGroups = item.optionGroups.map((group) =>
      localizeGroup(group, organizationIds, rowsByEntity, locale),
    );
    const localizedItem = overlay(
      { ...item, categoryPath, optionGroups },
      findTranslations(
        rowsByEntity.get(`${entityTypes.product}:${item.id}`),
        organizationIds,
      ),
      locale,
    );
    return {
      ...localizedItem,
      categoryName: categoryPath.at(-1)?.name ?? item.categoryName,
    };
  });
}

export async function localizeBookableServices(
  em: EntityManager,
  items: BookableService[],
  tenantId: string,
  locale: string | undefined,
): Promise<BookableService[]> {
  if (!locale || items.length === 0) return items;

  const organizationIds = Array.from(
    new Set(items.map((item) => item.organizationId)),
  );
  const organizations = await em.find(
    Organization,
    { id: { $in: organizationIds }, tenant: tenantId },
    { fields: ["id", "ancestorIds"] },
  );
  const ancestorOrganizationsById = new Map(
    organizations.map((organization) => [
      organization.id,
      Array.isArray(organization.ancestorIds)
        ? organization.ancestorIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    ]),
  );
  const scopedOrganizationIds = Array.from(
    new Set([
      ...organizationIds,
      ...Array.from(ancestorOrganizationsById.values()).flat(),
    ]),
  );
  const entityIds = collectIds(items);
  const db = em.getKysely<TranslationDatabase>();
  const rows = await db
    .selectFrom("entity_translations")
    .select(["entity_type", "entity_id", "organization_id", "translations"])
    .where("entity_type", "in", Object.values(entityTypes))
    .where("entity_id", "in", entityIds)
    .where("tenant_id", "=", tenantId)
    .where((expressionBuilder) =>
      expressionBuilder.or([
        expressionBuilder("organization_id", "in", scopedOrganizationIds),
        expressionBuilder("organization_id", "is", null),
      ]),
    )
    .execute();

  return applyBookableServiceTranslationRows(
    items,
    rows,
    locale,
    ancestorOrganizationsById,
  );
}
