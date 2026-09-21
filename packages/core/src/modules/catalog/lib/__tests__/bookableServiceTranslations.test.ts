import type { BookableService } from "../bookableServices";
import { applyBookableServiceTranslationRows } from "../bookableServiceTranslations";

const TENANT_ORG = "tenant-org";
const BRANCH_ORG = "branch-org";
const UNRELATED_ORG = "unrelated-org";

const service: BookableService = {
  id: "service-id",
  title: "Base service",
  subtitle: null,
  description: null,
  handle: null,
  sku: null,
  categoryPath: [
    {
      id: "category-id",
      name: "Base category",
      slug: "nail",
      description: null,
      parentId: null,
    },
  ],
  currencyCode: null,
  unitPriceNet: null,
  unitPriceGross: null,
  durationMinutes: null,
  categoryId: "category-id",
  categoryName: "Base category",
  organizationId: BRANCH_ORG,
  tenantId: "tenant-id",
  optionGroups: [
    {
      id: "group-id",
      name: "Base group",
      description: null,
      requirement: "required",
      selectMode: "single",
      options: [
        {
          id: "option-id",
          code: null,
          name: "Base option",
          description: null,
          note: null,
          unit: null,
          priceFlat: null,
          priceMin: null,
          priceMax: null,
          durationMinutes: null,
          isAddon: false,
          nextGroups: [],
        },
      ],
    },
  ],
};

describe("applyBookableServiceTranslationRows", () => {
  it("localizes nested catalog content from the branch or its ancestor scope", () => {
    const rows = [
      {
        entity_type: "catalog:catalog_product",
        entity_id: "service-id",
        organization_id: TENANT_ORG,
        translations: { vi: { title: "Dịch vụ" } },
      },
      {
        entity_type: "catalog:catalog_product_category",
        entity_id: "category-id",
        organization_id: TENANT_ORG,
        translations: { vi: { name: "Móng" } },
      },
      {
        entity_type: "catalog:catalog_product_option_group",
        entity_id: "group-id",
        organization_id: BRANCH_ORG,
        translations: { vi: { name: "Nhóm" } },
      },
      {
        entity_type: "catalog:catalog_product_option",
        entity_id: "option-id",
        organization_id: BRANCH_ORG,
        translations: { vi: { name: "Tuỳ chọn" } },
      },
    ];

    const [localized] = applyBookableServiceTranslationRows(
      [service],
      rows,
      "vi",
      new Map([[BRANCH_ORG, [TENANT_ORG]]]),
    );

    expect(localized.title).toBe("Dịch vụ");
    expect(localized.categoryPath[0].name).toBe("Móng");
    expect(localized.categoryName).toBe("Móng");
    expect(localized.optionGroups[0].name).toBe("Nhóm");
    expect(localized.optionGroups[0].options[0].name).toBe("Tuỳ chọn");
    expect(localized.optionGroups[0].options[0]).not.toHaveProperty("_locale");
  });

  it("ignores translations from unrelated organization scopes and preserves untranslated fields", () => {
    const rows = [
      {
        entity_type: "catalog:catalog_product",
        entity_id: "service-id",
        organization_id: UNRELATED_ORG,
        translations: { vi: { title: "Wrong tenant service" } },
      },
    ];

    const [localized] = applyBookableServiceTranslationRows(
      [service],
      rows,
      "vi",
      new Map(),
    );

    expect(localized.title).toBe("Base service");
    expect(localized.description).toBeNull();
  });

  it("uses tenant-level translations when there is no matching organization translation", () => {
    const rows = [
      {
        entity_type: "catalog:catalog_product",
        entity_id: "service-id",
        organization_id: null,
        translations: { vi: { title: "Dịch vụ tenant" } },
      },
    ];

    const [localized] = applyBookableServiceTranslationRows(
      [service],
      rows,
      "vi",
      new Map(),
    );

    expect(localized.title).toBe("Dịch vụ tenant");
  });
});
