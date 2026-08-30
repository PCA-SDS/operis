"use client";

import * as React from "react";
import { extensionPoints } from "@open-mercato/core/modules/catalog/extension-points";
import { useRouter, useSearchParams } from "next/navigation";
import type { ZodType } from "zod";
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import {
  CrudForm,
  type CrudFormGroup,
  type CrudFormGroupComponentProps,
} from "@open-mercato/ui/backend/CrudForm";
import { createCrud } from "@open-mercato/ui/backend/utils/crud";
import { createCrudFormError } from "@open-mercato/ui/backend/utils/serverErrors";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { TagsInput } from "@open-mercato/ui/backend/inputs/TagsInput";
import MarkdownField from "@open-mercato/ui/backend/inputs/MarkdownField";
import { Button } from "@open-mercato/ui/primitives/button";
import { Input } from "@open-mercato/ui/primitives/input";
import { Label } from "@open-mercato/ui/primitives/label";
import { RadioGroup, Radio } from "@open-mercato/ui/primitives/radio";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-mercato/ui/primitives/select";
import { cn } from "@open-mercato/shared/lib/utils";
import {
  Plus,
  Trash2,
  FileText,
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Settings,
} from "lucide-react";
import {
  apiCall,
  readApiResultOrThrow,
} from "@open-mercato/ui/backend/utils/apiCall";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { E } from "#generated/entities.ids.generated";
import {
  ProductMediaManager,
  type ProductMediaItem,
} from "@open-mercato/core/modules/catalog/components/products/ProductMediaManager";
import { ProductCategorizeSection } from "@open-mercato/core/modules/catalog/components/products/ProductCategorizeSection";
import { OptionDraftBuilder } from "@open-mercato/core/modules/catalog/components/products/OptionDraftBuilder";
import { OptionTreeEditor } from "@open-mercato/core/modules/catalog/components/products/OptionTreeEditor";
import {
  PRODUCT_FORM_STEPS,
  type PriceKindSummary,
  type PriceKindApiPayload,
  type TaxRateSummary,
  type ProductOptionInput,
  type VariantPriceValue,
  type VariantDraft,
  type ProductFormValues,
  type ProductUnitConversionDraft,
  type ProductUnitPriceReferenceUnit,
  type ProductUnitRoundingMode,
  productFormSchema,
  createInitialProductFormValues,
  createVariantDraft,
  buildOptionValuesKey,
  haveSameOptionValues,
  normalizePriceKindSummary,
  formatTaxRateLabel,
  slugify,
  createLocalId,
  buildOptionSchemaDefinition,
  buildVariantCombinations,
  normalizeProductDimensions,
  normalizeProductWeight,
  sanitizeProductDimensions,
  sanitizeProductWeight,
  updateDimensionValue,
  updateWeightValue,
  isConfigurableProductType,
  buildComplianceProductPayload,
} from "@open-mercato/core/modules/catalog/components/products/productForm";
import { CATALOG_PRODUCT_TYPES } from "@open-mercato/core/modules/catalog/data/types";
import {
  buildAttachmentImageUrl,
  slugifyAttachmentFileName,
} from "@open-mercato/core/modules/attachments/lib/imageUrls";
import { ProductUomSection } from "@open-mercato/core/modules/catalog/components/products/ProductUomSection";
import { ProductComplianceSection } from "@open-mercato/core/modules/catalog/components/products/ProductComplianceSection";
import { canonicalizeUnitCode } from "@open-mercato/core/modules/catalog/lib/unitCodes";
import {
  UNIT_PRICE_REFERENCE_UNITS,
  toTrimmedOrNull,
  parseNumericInput,
  toPositiveNumberOrNull,
  toIntegerInRangeOrDefault,
  normalizeProductConversionInputs,
  type ProductUnitConversionInput,
} from "@open-mercato/core/modules/catalog/components/products/productFormUtils";
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'

const logger = createLogger('catalog')

const productFormTypedSchema =
  productFormSchema as unknown as ZodType<ProductFormValues>;

type VariantPriceRequest = {
  variantDraftId: string;
  priceKindId: string;
  currencyCode: string;
  amount?: number;
  priceMin?: number;
  priceMax?: number;
  displayMode: PriceKindSummary["displayMode"];
  taxRateId: string | null;
  taxRateValue: number | null;
};

type ProductFormStep = (typeof PRODUCT_FORM_STEPS)[number];

const TRUE_BOOLEAN_VALUES = new Set(["true", "1", "yes", "y", "t"]);

const matchField = (fieldId: string) => (value: string) =>
  value === fieldId ||
  value.startsWith(`${fieldId}.`) ||
  value.startsWith(`${fieldId}[`);
const matchPrefix = (prefix: string) => (value: string) =>
  value.startsWith(prefix);

const STEP_FIELD_MATCHERS: Record<
  ProductFormStep,
  ((value: string) => boolean)[]
> = {
  general: [
    matchField("title"),
    matchField("sku"),
    matchField("productType"),
    matchField("description"),
    matchField("mediaItems"),
    matchField("mediaDraftId"),
    matchPrefix("defaultMedia"),
    matchPrefix("dimensions"),
    matchPrefix("weight"),
  ],
  organize: [
    matchField("categoryIds"),
    matchField("channelIds"),
    matchField("tags"),
  ],
  uom: [
    matchField("defaultUnit"),
    matchField("defaultSalesUnit"),
    matchField("defaultSalesUnitQuantity"),
    matchField("uomRoundingScale"),
    matchField("uomRoundingMode"),
    matchField("unitPriceEnabled"),
    matchField("unitPriceReferenceUnit"),
    matchField("unitPriceBaseQuantity"),
    matchPrefix("unitConversions"),
  ],
  compliance: [
    matchField("countryOfOriginCode"),
    matchField("pkwiuCode"),
    matchField("cnCode"),
    matchField("hsCode"),
    matchField("taxClassificationCode"),
    matchField("gtuCodes"),
    matchField("ageMin"),
    matchField("isExciseGood"),
    matchField("exciseCategory"),
    matchField("requiresPrescription"),
    matchPrefix("hazmat"),
    matchField("unNumber"),
    matchField("containsLithiumBattery"),
    matchField("launchAt"),
    matchField("endOfLifeAt"),
    matchField("availableFrom"),
    matchField("availableUntil"),
    matchField("minOrderQty"),
    matchField("maxOrderQty"),
    matchField("orderQtyIncrement"),
    matchField("requiresShipping"),
    matchField("isQuoteOnly"),
    matchField("seoTitle"),
    matchField("seoDescription"),
    matchField("canonicalUrl"),
  ],
  options: [
    matchPrefix("options"),
  ],
  variants: [
    matchField("hasVariants"),
    matchPrefix("variants"),
  ],
};

function resolveStepForField(fieldId: string): ProductFormStep | null {
  const normalized = fieldId?.trim();
  if (!normalized) return null;
  for (const step of PRODUCT_FORM_STEPS) {
    const matchers = STEP_FIELD_MATCHERS[step];
    if (matchers.some((matcher) => matcher(normalized))) return step;
  }
  return null;
}

function resolveBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (TRUE_BOOLEAN_VALUES.has(normalized)) return true;
    if (["false", "0", "no", "n", "f"].includes(normalized)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return false;
}


interface InboxProductDraft {
  actionId: string;
  proposalId: string;
  payload: Record<string, unknown>;
}

function readInboxProductDraft(): InboxProductDraft | null {
  try {
    const raw = sessionStorage.getItem("inbox_ops.productDraft");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InboxProductDraft;
    if (!parsed.actionId || !parsed.proposalId || !parsed.payload) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function CreateCatalogProductPage() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromInboxAction = searchParams.get("fromInboxAction");

  const inboxDraft = React.useMemo<InboxProductDraft | null>(() => {
    if (!fromInboxAction) return null;
    return readInboxProductDraft();
  }, [fromInboxAction]);

  const initialValuesRef = React.useRef<ProductFormValues | null>(null);
  if (!initialValuesRef.current) {
    const initial = createInitialProductFormValues();
    if (inboxDraft?.payload) {
      const p = inboxDraft.payload;
      if (typeof p.title === "string" && p.title.trim()) initial.title = p.title.trim();
      if (typeof p.description === "string" && p.description.trim()) initial.description = p.description.trim();
    }
    initialValuesRef.current = initial;
  }
  const [priceKinds, setPriceKinds] = React.useState<PriceKindSummary[]>([]);
  const [taxRates, setTaxRates] = React.useState<TaxRateSummary[]>([]);
  React.useEffect(() => {
    const loadPriceKinds = async () => {
      try {
        const payload = await readApiResultOrThrow<{
          items?: PriceKindApiPayload[];
        }>("/api/catalog/price-kinds?pageSize=100", undefined, {
          errorMessage: t(
            "catalog.priceKinds.errors.load",
            "Failed to load price kinds.",
          ),
        });
        const items = Array.isArray(payload.items) ? payload.items : [];
        setPriceKinds(
          items
            .map((item) => normalizePriceKindSummary(item))
            .filter((item): item is PriceKindSummary => item !== null),
        );
      } catch (err) {
        logger.error('catalog.price-kinds.fetch failed', { err });
        setPriceKinds([]);
      }
    };
    loadPriceKinds().catch(() => {});
  }, [t]);

  React.useEffect(() => {
    const loadTaxRates = async () => {
      try {
        const payload = await readApiResultOrThrow<{
          items?: Array<Record<string, unknown>>;
        }>("/api/sales/tax-rates?pageSize=100", undefined, {
          errorMessage: t(
            "catalog.products.create.taxRates.error",
            "Failed to load tax rates.",
          ),
          fallback: { items: [] },
        });
        const items = Array.isArray(payload.items) ? payload.items : [];
        setTaxRates(
          items.map((item) => {
            const rawRate =
              typeof item.rate === "number"
                ? item.rate
                : Number(item.rate ?? Number.NaN);
            return {
              id: String(item.id),
              name:
                typeof item.name === "string" && item.name.trim().length
                  ? item.name
                  : t(
                      "catalog.products.create.taxRates.unnamed",
                      "Untitled tax rate",
                    ),
              code:
                typeof item.code === "string" && item.code.trim().length
                  ? item.code
                  : null,
              rate: Number.isFinite(rawRate) ? rawRate : null,
              isDefault: resolveBooleanFlag(
                typeof item.isDefault !== "undefined"
                  ? item.isDefault
                  : item.is_default,
              ),
            };
          }),
        );
      } catch (err) {
        logger.error('sales.tax-rates.fetch failed', { err });
        setTaxRates([]);
      }
    };
    loadTaxRates().catch(() => {});
  }, [t]);

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: "builder",
        column: 1,
        component: ({
          values,
          setValue,
          errors,
          requiredFieldIds,
        }: CrudFormGroupComponentProps) => (
          <ProductBuilder
            values={values as ProductFormValues}
            setValue={setValue}
            errors={errors}
            priceKinds={priceKinds}
            taxRates={taxRates}
            requiredFieldIds={requiredFieldIds}
          />
        ),
      },
      {
        id: "product-meta",
        column: 2,
        title: t("catalog.products.create.meta.title", "Product meta"),
        description: t(
          "catalog.products.create.meta.description",
          "Manage subtitle and handle for storefronts.",
        ),
        component: ({
          values,
          setValue,
          errors,
        }: CrudFormGroupComponentProps) => (
          <ProductMetaSection
            values={values as ProductFormValues}
            setValue={setValue}
            errors={errors}
            taxRates={taxRates}
          />
        ),
      },
    ],
    [priceKinds, taxRates, t],
  );

  return (
    <Page>
      <PageBody>
        <CrudForm<ProductFormValues>
          title={t("catalog.products.create.title", "Create Product")}
          backHref="/backend/catalog/products"
          fields={[]}
          groups={groups}
          injectionSpotId={extensionPoints.hosts.productForm.spotId}
          initialValues={
            initialValuesRef.current ?? createInitialProductFormValues()
          }
          schema={productFormTypedSchema}
          submitLabel={t("catalog.products.create.submit", "Create")}
          cancelHref="/backend/catalog/products"
          onSubmit={async (formValues) => {
            const title = formValues.title?.trim();
            if (!title) {
              throw createCrudFormError(
                t(
                  "catalog.products.create.errors.title",
                  "Provide a product title.",
                ),
                {
                  title: t(
                    "catalog.products.create.errors.title",
                    "Provide a product title.",
                  ),
                },
              );
            }
            const handle = formValues.handle?.trim() || undefined;
            const description = formValues.description?.trim() || undefined;
            const defaultMediaId =
              typeof formValues.defaultMediaId === "string" &&
              formValues.defaultMediaId.trim().length
                ? formValues.defaultMediaId
                : null;
            const mediaItems = Array.isArray(formValues.mediaItems)
              ? formValues.mediaItems
              : [];
            const attachmentIds = mediaItems
              .map((item) => (typeof item.id === "string" ? item.id : null))
              .filter((value): value is string => !!value);
            const mediaDraftId =
              typeof formValues.mediaDraftId === "string"
                ? formValues.mediaDraftId
                : "";
            const defaultMediaEntry = defaultMediaId
              ? mediaItems.find((item) => item.id === defaultMediaId)
              : null;
            const defaultMediaUrl = defaultMediaEntry
              ? buildAttachmentImageUrl(defaultMediaEntry.id, {
                  slug: slugifyAttachmentFileName(defaultMediaEntry.fileName),
                })
              : null;
            const optionSchemaDefinition = buildOptionSchemaDefinition(
              formValues.options,
              title,
            );
            const dimensions = sanitizeProductDimensions(
              formValues.dimensions ?? null,
            );
            const weight = sanitizeProductWeight(formValues.weight ?? null);
            const resolveTaxRateValue = (taxRateId?: string | null) => {
              if (!taxRateId) return null;
              const match = taxRates.find((rate) => rate.id === taxRateId);
              return typeof match?.rate === "number" ? match.rate : null;
            };
            const productLevelTaxRateId = formValues.taxRateId ?? null;
            const productTaxRate = resolveTaxRateValue(productLevelTaxRateId);
            const resolveVariantTax = (variant: VariantDraft) => {
              const resolvedVariantTaxRateId =
                variant.taxRateId ?? productLevelTaxRateId;
              const resolvedVariantTaxRate =
                resolveTaxRateValue(resolvedVariantTaxRateId) ??
                (resolvedVariantTaxRateId ? null : (productTaxRate ?? null));
              return { resolvedVariantTaxRateId, resolvedVariantTaxRate };
            };
            const defaultUnit = canonicalizeUnitCode(formValues.defaultUnit);
            const defaultSalesUnit = canonicalizeUnitCode(
              formValues.defaultSalesUnit,
            );
            const defaultSalesUnitQuantity =
              toPositiveNumberOrNull(formValues.defaultSalesUnitQuantity) ?? 1;
            const uomRoundingScale = toIntegerInRangeOrDefault(
              formValues.uomRoundingScale,
              0,
              6,
              4,
            );
            const uomRoundingMode: ProductUnitRoundingMode =
              formValues.uomRoundingMode === "down" ||
              formValues.uomRoundingMode === "up"
                ? formValues.uomRoundingMode
                : "half_up";
            const unitPriceEnabled = Boolean(formValues.unitPriceEnabled);
            const unitPriceReferenceUnit = canonicalizeUnitCode(
              formValues.unitPriceReferenceUnit,
            );
            const unitPriceBaseQuantity = toPositiveNumberOrNull(
              formValues.unitPriceBaseQuantity,
            );
            if (defaultSalesUnit && !defaultUnit) {
              const message = t(
                "catalog.products.uom.errors.baseRequired",
                "Base unit is required when default sales unit is set.",
              );
              throw createCrudFormError(message, { defaultSalesUnit: message });
            }
            const conversionInputs = normalizeProductConversionInputs(
              formValues.unitConversions,
              t(
                "catalog.products.uom.errors.duplicateConversion",
                "Duplicate conversion unit is not allowed.",
              ),
            );
            if (conversionInputs.length && !defaultUnit) {
              const message = t(
                "catalog.products.uom.errors.baseRequiredForConversions",
                "Base unit is required when conversions are configured.",
              );
              throw createCrudFormError(message, { defaultUnit: message });
            }
            const defaultUnitKey = defaultUnit?.toLowerCase() ?? null;
            const defaultSalesUnitKey = defaultSalesUnit?.toLowerCase() ?? null;
            if (
              defaultUnitKey &&
              defaultSalesUnitKey &&
              defaultSalesUnitKey !== defaultUnitKey
            ) {
              const hasDefaultSalesConversion = conversionInputs.some(
                (entry) =>
                  entry.isActive &&
                  entry.unitCode.toLowerCase() === defaultSalesUnitKey,
              );
              if (!hasDefaultSalesConversion) {
                const message = t(
                  "catalog.products.uom.errors.defaultSalesConversionRequired",
                  "Active conversion for default sales unit is required when it differs from base unit.",
                );
                throw createCrudFormError(message, {
                  defaultSalesUnit: message,
                  unitConversions: message,
                });
              }
            }
            if (unitPriceEnabled) {
              if (
                !unitPriceReferenceUnit ||
                !UNIT_PRICE_REFERENCE_UNITS.has(
                  unitPriceReferenceUnit as ProductUnitPriceReferenceUnit,
                )
              ) {
                const message = t(
                  "catalog.products.unitPrice.errors.referenceUnit",
                  "Reference unit is required when unit price display is enabled.",
                );
                throw createCrudFormError(message, {
                  unitPriceReferenceUnit: message,
                });
              }
              if (unitPriceBaseQuantity === null) {
                const message = t(
                  "catalog.products.unitPrice.errors.baseQuantity",
                  "Base quantity is required when unit price display is enabled.",
                );
                throw createCrudFormError(message, {
                  unitPriceBaseQuantity: message,
                });
              }
            }
            const productPayload: Record<string, unknown> = {
              title,
              subtitle: formValues.subtitle?.trim() || undefined,
              description,
              handle,
              sku: formValues.sku?.trim() || undefined,
              productType: formValues.productType || "simple",
              taxRateId: formValues.taxRateId ?? null,
              taxRate: productTaxRate ?? null,
              isConfigurable: isConfigurableProductType(
                formValues.productType || "simple",
              ),
              defaultMediaId: defaultMediaId ?? undefined,
              defaultMediaUrl: defaultMediaUrl ?? undefined,
              dimensions,
              weightValue: weight?.value ?? null,
              weightUnit: weight?.unit ?? null,
              defaultUnit: defaultUnit ?? null,
              defaultSalesUnit: defaultSalesUnit ?? defaultUnit ?? null,
              defaultSalesUnitQuantity,
              uomRoundingScale,
              uomRoundingMode,
              unitPriceEnabled,
              unitPriceReferenceUnit: unitPriceEnabled
                ? unitPriceReferenceUnit
                : undefined,
              unitPriceBaseQuantity: unitPriceEnabled
                ? unitPriceBaseQuantity
                : undefined,
              ...buildComplianceProductPayload(formValues),
            };
            if (optionSchemaDefinition) {
              productPayload.optionSchema = optionSchemaDefinition;
            }
            const categoryIds = Array.isArray(formValues.categoryIds)
              ? formValues.categoryIds
                  .map((id) => (typeof id === "string" ? id.trim() : ""))
                  .filter((id) => id.length)
              : [];
            if (categoryIds.length) {
              productPayload.categoryIds = Array.from(new Set(categoryIds));
            }
            const tags = Array.isArray(formValues.tags)
              ? Array.from(
                  new Set(
                    formValues.tags
                      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
                      .filter((tag) => tag.length),
                  ),
                )
              : [];
            if (tags.length) {
              productPayload.tags = tags;
            }
            const channelIds = Array.isArray(formValues.channelIds)
              ? formValues.channelIds
                  .map((id) => (typeof id === "string" ? id.trim() : ""))
                  .filter((id) => id.length)
              : [];
            if (channelIds.length) {
              productPayload.offers = channelIds.map((channelId) => ({
                channelId,
                title,
                description,
                defaultMediaId: defaultMediaId ?? undefined,
                defaultMediaUrl: defaultMediaUrl ?? undefined,
              }));
            }

            const variantDrafts =
              (Array.isArray(formValues.variants) && formValues.variants.length
                ? formValues.variants
                : [
                    createVariantDraft(formValues.taxRateId ?? null, {
                      isDefault: true,
                    }),
                  ]) ?? [];
            const priceRequests: VariantPriceRequest[] = [];
            for (const variant of variantDrafts) {
              const { resolvedVariantTaxRateId, resolvedVariantTaxRate } =
                resolveVariantTax(variant);
              for (const priceKind of priceKinds) {
                const amountStr = variant.prices?.[priceKind.id]?.amount?.trim();
                const minStr = variant.prices?.[priceKind.id]?.priceMin?.trim();
                const maxStr = variant.prices?.[priceKind.id]?.priceMax?.trim();
                
                if (!amountStr && !minStr && !maxStr) continue;
                
                let amountNum: number | undefined;
                if (amountStr) {
                  amountNum = Number(amountStr);
                  if (Number.isNaN(amountNum) || !Number.isFinite(amountNum) || amountNum < 0) {
                    throw createCrudFormError(t("catalog.products.create.errors.priceNonNegative", "Prices must be zero or greater."));
                  }
                }
                
                let minNum: number | undefined;
                if (minStr) {
                  minNum = Number(minStr);
                  if (Number.isNaN(minNum) || !Number.isFinite(minNum) || minNum < 0) {
                    throw createCrudFormError(t("catalog.products.create.errors.priceNonNegative", "Prices must be zero or greater."));
                  }
                }
                
                let maxNum: number | undefined;
                if (maxStr) {
                  maxNum = Number(maxStr);
                  if (Number.isNaN(maxNum) || !Number.isFinite(maxNum) || maxNum < 0) {
                    throw createCrudFormError(t("catalog.products.create.errors.priceNonNegative", "Prices must be zero or greater."));
                  }
                }
                
                const currencyCode =
                  typeof priceKind.currencyCode === "string" &&
                  priceKind.currencyCode.trim().length
                    ? priceKind.currencyCode.trim().toUpperCase()
                    : "";
                if (!currencyCode) {
                  throw createCrudFormError(
                    t(
                      "catalog.products.create.errors.currency",
                      "Provide a currency for all price kinds.",
                    ),
                    {},
                  );
                }
                priceRequests.push({
                  variantDraftId: variant.id,
                  priceKindId: priceKind.id,
                  currencyCode,
                  amount: amountNum,
                  priceMin: minNum,
                  priceMax: maxNum,
                  displayMode: priceKind.displayMode,
                  taxRateId: resolvedVariantTaxRateId ?? null,
                  taxRateValue: resolvedVariantTaxRate ?? null,
                });
              }
            }

            const cleanupState: {
              productId: string | null;
              variantIds: string[];
            } = { productId: null, variantIds: [] };
            try {
              const { result: created } = await createCrud<{ id?: string }>(
                "catalog/products",
                productPayload,
              );
              const productId = created?.id;
              if (!productId) {
                throw createCrudFormError(
                  t(
                    "catalog.products.create.errors.id",
                    "Product id missing after create.",
                  ),
                );
              }
              cleanupState.productId = productId;

              if (formValues.optionTreeGroups && formValues.optionTreeGroups.length > 0) {
                const optionTreePayload = {
                  groups: formValues.optionTreeGroups.map((g: any) => ({
                    id: g.id,
                    name: g.name,
                    description: g.description,
                    requirement: g.requirement,
                    selectMode: g.select_mode,
                    sortOrder: g.sort_order,
                    isActive: g.is_active,
                    parentOptionId: g.parent_option_id,
                    metadata: g.metadata,
                  })),
                  options: (formValues.optionTreeOptions || []).map((o: any) => ({
                    id: o.id,
                    groupId: o.group_id,
                    name: o.name,
                    code: o.code,
                    description: o.description,
                    priceFlat: o.price_flat,
                    priceMin: o.price_min,
                    priceMax: o.price_max,
                    durationValue: o.duration_value,
                    durationUnit: o.duration_unit,
                    durationMin: o.duration_min,
                    durationMax: o.duration_max,
                    isAddon: o.is_addon,
                    sortOrder: o.sort_order,
                    isActive: o.is_active,
                    metadata: o.metadata,
                    note: o.note,
                    unit: o.unit,
                  }))
                };
                await apiCall(`/api/catalog/products/${productId}/option-tree`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(optionTreePayload),
                });
              }

              for (const conversion of conversionInputs) {
                await createCrud("catalog/product-unit-conversions", {
                  productId,
                  unitCode: conversion.unitCode,
                  toBaseFactor: conversion.toBaseFactor,
                  sortOrder: conversion.sortOrder,
                  isActive: conversion.isActive,
                });
              }

              const variantIdMap: Record<string, string> = {};
              for (const variant of variantDrafts) {
                const { resolvedVariantTaxRateId, resolvedVariantTaxRate } =
                  resolveVariantTax(variant);
                const variantPayload: Record<string, unknown> = {
                  productId,
                  name:
                    variant.title?.trim() ||
                    Object.values(variant.optionValues).join(" / ") ||
                    "Variant",
                  sku: variant.sku?.trim() || undefined,
                  isDefault: Boolean(variant.isDefault),
                  isActive: true,
                  optionValues: Object.keys(variant.optionValues).length
                    ? variant.optionValues
                    : undefined,
                  taxRateId: resolvedVariantTaxRateId ?? null,
                  taxRate: resolvedVariantTaxRate ?? null,
                  durationValue: variant.durationValue ? parseInt(variant.durationValue, 10) : undefined,
                  durationUnit: variant.durationUnit || undefined,
                  durationMin: variant.durationMin ? parseInt(variant.durationMin, 10) : undefined,
                  durationMax: variant.durationMax ? parseInt(variant.durationMax, 10) : undefined,
                };
                const { result: variantResult } = await createCrud<{
                  id?: string;
                  variantId?: string;
                }>("catalog/variants", variantPayload);
                const variantId = variantResult?.variantId ?? variantResult?.id;
                if (!variantId) {
                  throw createCrudFormError(
                    t(
                      "catalog.products.create.errors.variant",
                      "Failed to create variant.",
                    ),
                  );
                }
                variantIdMap[variant.id] = variantId;
                cleanupState.variantIds.push(variantId);
              }

              for (const draft of priceRequests) {
                const variantId = variantIdMap[draft.variantDraftId];
                if (!variantId) continue;
                const pricePayload: Record<string, unknown> = {
                  productId,
                  variantId,
                  currencyCode: draft.currencyCode,
                  priceKindId: draft.priceKindId,
                };
                if (draft.displayMode === "including-tax") {
                  if (draft.amount !== undefined) pricePayload.unitPriceGross = draft.amount;
                  if (draft.priceMin !== undefined) pricePayload.priceMin = draft.priceMin;
                  if (draft.priceMax !== undefined) pricePayload.priceMax = draft.priceMax;
                } else {
                  if (draft.amount !== undefined) pricePayload.unitPriceNet = draft.amount;
                  if (draft.priceMin !== undefined) pricePayload.priceMin = draft.priceMin;
                  if (draft.priceMax !== undefined) pricePayload.priceMax = draft.priceMax;
                }
                if (draft.taxRateId) {
                  pricePayload.taxRateId = draft.taxRateId;
                } else if (
                  typeof draft.taxRateValue === "number" &&
                  Number.isFinite(draft.taxRateValue)
                ) {
                  pricePayload.taxRate = draft.taxRateValue;
                }
                if (draft.displayMode === "including-tax") {
                  pricePayload.unitPriceGross = draft.amount;
                } else {
                  pricePayload.unitPriceNet = draft.amount;
                }
                await createCrud("catalog/prices", pricePayload);
              }

              if (mediaDraftId && attachmentIds.length) {
                const transfer = await apiCall<{
                  ok?: boolean;
                  error?: string;
                }>(
                  "/api/attachments/transfer",
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      entityId: E.catalog.catalog_product,
                      attachmentIds,
                      fromRecordId: mediaDraftId,
                      toRecordId: productId,
                    }),
                  },
                  { fallback: null },
                );
                if (!transfer.ok) {
                  logger.error("attachments.transfer.failed", { err: transfer.result?.error });
                }
              }

              if (inboxDraft) {
                try {
                  sessionStorage.removeItem("inbox_ops.productDraft");
                } catch { /* ignore */ }
                try {
                  await apiCall(
                    `/api/inbox_ops/proposals/${inboxDraft.proposalId}/actions/${inboxDraft.actionId}/complete`,
                    {
                      method: "PATCH",
                      body: JSON.stringify({
                        createdEntityId: productId,
                        createdEntityType: "catalog_product",
                      }),
                    },
                  );
                } catch {
                  flash(
                    t(
                      "inbox_ops.flash.complete_failed",
                      "Product created but failed to update inbox action status.",
                    ),
                    "warning",
                  );
                }
              }

              flash(
                t("catalog.products.create.success", "Product created."),
                "success",
              );
              if (inboxDraft) {
                router.push(
                  `/backend/inbox-ops/proposals/${encodeURIComponent(inboxDraft.proposalId)}`,
                );
              } else {
                router.push(`/backend/catalog/products/${productId}`);
              }
            } catch (err) {
              await cleanupFailedProduct(
                cleanupState.productId,
                cleanupState.variantIds,
              );
              throw err;
            }
          }}
        />
      </PageBody>
    </Page>
  );
}

async function cleanupFailedProduct(
  productId: string | null,
  variantIds: string[],
): Promise<void> {
  if (!productId && variantIds.length === 0) return;
  if (variantIds.length) {
    const variantDeletes = variantIds.map((variantId) =>
      apiCall(`/api/catalog/variants?id=${encodeURIComponent(variantId)}`, {
        method: "DELETE",
      }).catch(() => null),
    );
    await Promise.allSettled(variantDeletes);
  }
  if (productId) {
    await apiCall(`/api/catalog/products?id=${encodeURIComponent(productId)}`, {
      method: "DELETE",
    }).catch(() => null);
  }
}

type ProductBuilderProps = {
  values: ProductFormValues;
  setValue: (id: string, value: unknown) => void;
  errors: Record<string, string>;
  priceKinds: PriceKindSummary[];
  taxRates: TaxRateSummary[];
  requiredFieldIds?: ReadonlySet<string>;
};

type ProductMetaSectionProps = {
  values: ProductFormValues;
  setValue: (id: string, value: unknown) => void;
  errors: Record<string, string>;
  taxRates: TaxRateSummary[];
};

type ProductDimensionsSectionProps = {
  values: ProductFormValues;
  setValue: (id: string, value: unknown) => void;
};

function ProductDimensionsFields({
  values,
  setValue,
}: ProductDimensionsSectionProps) {
  const t = useT();
  const dimensionValues = normalizeProductDimensions(values.dimensions);
  const weightValues = normalizeProductWeight(values.weight);

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">
        {t("catalog.products.edit.dimensions", "Dimensions & weight")}
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.dimensions.width", "Width")}
          </Label>
          <Input
            type="number"
            value={dimensionValues?.width ?? ""}
            onChange={(event) =>
              setValue(
                "dimensions",
                updateDimensionValue(
                  values.dimensions ?? null,
                  "width",
                  event.target.value,
                ),
              )
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.dimensions.height", "Height")}
          </Label>
          <Input
            type="number"
            value={dimensionValues?.height ?? ""}
            onChange={(event) =>
              setValue(
                "dimensions",
                updateDimensionValue(
                  values.dimensions ?? null,
                  "height",
                  event.target.value,
                ),
              )
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.dimensions.depth", "Depth")}
          </Label>
          <Input
            type="number"
            value={dimensionValues?.depth ?? ""}
            onChange={(event) =>
              setValue(
                "dimensions",
                updateDimensionValue(
                  values.dimensions ?? null,
                  "depth",
                  event.target.value,
                ),
              )
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.dimensions.unit", "Size unit")}
          </Label>
          <Input
            value={dimensionValues?.unit ?? ""}
            onChange={(event) =>
              setValue(
                "dimensions",
                updateDimensionValue(
                  values.dimensions ?? null,
                  "unit",
                  event.target.value,
                ),
              )
            }
            placeholder="cm"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.weight.value", "Weight")}
          </Label>
          <Input
            type="number"
            value={weightValues?.value ?? ""}
            onChange={(event) =>
              setValue(
                "weight",
                updateWeightValue(
                  values.weight ?? null,
                  "value",
                  event.target.value,
                ),
              )
            }
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">
            {t("catalog.products.edit.weight.unit", "Weight unit")}
          </Label>
          <Input
            value={weightValues?.unit ?? ""}
            onChange={(event) =>
              setValue(
                "weight",
                updateWeightValue(
                  values.weight ?? null,
                  "unit",
                  event.target.value,
                ),
              )
            }
            placeholder="kg"
          />
        </div>
      </div>
    </div>
  );
}

function DefaultVariantBuilder({
  values,
  setVariantField,
  setVariantPrice,
  priceKinds,
  taxRates,
  defaultTaxRateLabel,
  inventoryDisabledHint,
  t,
}: {
  values: any;
  setVariantField: (id: string, field: any, value: any) => void;
  setVariantPrice: (id: string, priceKindId: string, field: "amount" | "priceMin" | "priceMax", value: string) => void;
  priceKinds: any[];
  taxRates: any[];
  defaultTaxRateLabel: string | null;
  inventoryDisabledHint?: string;
  t: any;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-6 bg-muted/20">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("catalog.products.create.variantsBuilder.defaultVariantLabel", "Default Variant")}
        </h3>
        
        <div className="grid gap-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t("catalog.products.form.variants", "Variant title")}</Label>
              <Input
                value={(values.variants?.[0] || {}).title || ""}
                onChange={(event) =>
                  setVariantField(
                    (values.variants?.[0] || {}).id || "",
                    "title",
                    event.target.value,
                  )
                }
                placeholder={t(
                  "catalog.products.create.variantsBuilder.titlePlaceholder",
                  "Variant title",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("catalog.products.create.variantsBuilder.sku", "SKU")}</Label>
              <Input
                value={(values.variants?.[0] || {}).sku || ""}
                onChange={(event) =>
                  setVariantField(
                    (values.variants?.[0] || {}).id || "",
                    "sku",
                    event.target.value,
                  )
                }
                placeholder={t("catalog.products.create.variantsBuilder.skuPlaceholder", "SKU")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("catalog.products.create.variantsBuilder.vatColumn", "Tax class")}</Label>
              <Select
                value={(values.variants?.[0] || {}).taxRateId || undefined}
                onValueChange={(value) =>
                  setVariantField((values.variants?.[0] || {}).id || "", "taxRateId", value || null)
                }
                disabled={!taxRates.length}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      defaultTaxRateLabel
                        ? t(
                            "catalog.products.create.variantsBuilder.vatOptionDefault",
                            "Use product tax class ({{label}})",
                          ).replace("{{label}}", defaultTaxRateLabel)
                        : t(
                            "catalog.products.create.variantsBuilder.vatOptionNone",
                            "No tax class",
                          )
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {taxRates.map((rate) => (
                    <SelectItem key={rate.id} value={rate.id}>
                      {formatTaxRateLabel(rate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              {t("catalog.variants.form.pricesLabel", "Prices")}
            </h4>
            <div className="flex flex-wrap gap-6">
              {priceKinds.map((kind) => {
                const variantId = (values.variants?.[0] || {}).id || "";
                const val = (values.variants?.[0] || {}).prices?.[kind.id]?.amount ?? "";
                const minVal = (values.variants?.[0] || {}).prices?.[kind.id]?.priceMin ?? "";
                const maxVal = (values.variants?.[0] || {}).prices?.[kind.id]?.priceMax ?? "";
                return (
                  <div key={kind.id} className="flex-1 basis-72 min-w-72 space-y-3 rounded-lg border bg-surface p-4 shadow-sm">
                    <Label className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <span>
                        {t(
                          "catalog.products.create.variantsBuilder.priceColumn",
                          "Price {{title}}",
                        ).replace("{{title}}", kind.title)}
                      </span>
                    </Label>
                    
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("catalog.products.create.variantsBuilder.fixedPrice", "Fixed Price")}
                      </Label>
                      <div className="relative">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                          <span className="text-sm font-medium text-muted-foreground">
                            {kind.currencyCode?.toUpperCase()}
                          </span>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          className="pl-14 font-mono text-sm w-full"
                          value={val}
                          onChange={(event) =>
                            setVariantPrice(variantId, kind.id, "amount", event.target.value)
                          }
                        />
                      </div>
                    </div>

                    {values.productType === "service" ? (
                      <div className="space-y-1.5 pt-2 border-t">
                        <Label className="text-xs text-muted-foreground">
                          {t("catalog.products.create.variantsBuilder.priceRange", "Price Range")}
                        </Label>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1 min-w-0">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
                              <span className="text-xs font-medium text-muted-foreground">
                                {kind.currencyCode?.toUpperCase()}
                              </span>
                            </div>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              placeholder="Min"
                              className="pl-9 w-full font-mono text-xs"
                              value={minVal}
                              onChange={(event) =>
                                setVariantPrice(variantId, kind.id, "priceMin", event.target.value)
                              }
                            />
                          </div>
                          <span className="text-muted-foreground">-</span>
                          <div className="relative flex-1 min-w-0">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
                              <span className="text-xs font-medium text-muted-foreground">
                                {kind.currencyCode?.toUpperCase()}
                              </span>
                            </div>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              placeholder="Max"
                              className="pl-9 w-full font-mono text-xs"
                              value={maxVal}
                              onChange={(event) =>
                                setVariantPrice(variantId, kind.id, "priceMax", event.target.value)
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {values.productType === "service" ? (
            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                {t("catalog.variants.form.durationLabel", "Duration")}
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    {t("catalog.variants.form.durationFixed", "Fixed Duration")}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      className="flex-1"
                      placeholder="e.g. 60"
                      value={(values.variants?.[0] || {}).durationValue || ""}
                      onChange={(e) =>
                        setVariantField(
                          (values.variants?.[0] || {}).id || "",
                          "durationValue",
                          e.target.value
                        )
                      }
                    />
                    <Select
                      value={(values.variants?.[0] || {}).durationUnit || "minute"}
                      onValueChange={(val) =>
                        setVariantField(
                          (values.variants?.[0] || {}).id || "",
                          "durationUnit",
                          val
                        )
                      }
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minute">
                          {t("catalog.variants.form.durationUnit.minute", "Minutes")}
                        </SelectItem>
                        <SelectItem value="hour">
                          {t("catalog.variants.form.durationUnit.hour", "Hours")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    {t("catalog.variants.form.durationRange", "Duration Range")}
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <Input
                        type="number"
                        min="0"
                        placeholder="Min"
                        className="w-full"
                        value={(values.variants?.[0] || {}).durationMin || ""}
                        onChange={(e) =>
                          setVariantField(
                            (values.variants?.[0] || {}).id || "",
                            "durationMin",
                            e.target.value
                          )
                        }
                      />
                    </div>
                    <span className="text-muted-foreground">-</span>
                    <div className="flex-1 min-w-0">
                      <Input
                        type="number"
                        min="0"
                        placeholder="Max"
                        className="w-full"
                        value={(values.variants?.[0] || {}).durationMax || ""}
                        onChange={(e) =>
                          setVariantField(
                            (values.variants?.[0] || {}).id || "",
                            "durationMax",
                            e.target.value
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("catalog.variants.form.durationHint", "Fill out min and max if the duration varies.")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                {t("catalog.variants.form.inventory", "Inventory")}
              </h4>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-50"
                    checked={(values.variants?.[0] || {}).manageInventory ?? false}
                    onChange={(event) =>
                      setVariantField(
                        (values.variants?.[0] || {}).id || "",
                        "manageInventory",
                        event.target.checked,
                      )
                    }
                    disabled={!!inventoryDisabledHint}
                    title={inventoryDisabledHint}
                  />
                  {t(
                    "catalog.products.create.variantsBuilder.manageInventory",
                    "Managed inventory",
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-50"
                    checked={(values.variants?.[0] || {}).allowBackorder ?? false}
                    onChange={(event) =>
                      setVariantField(
                        (values.variants?.[0] || {}).id || "",
                        "allowBackorder",
                        event.target.checked,
                      )
                    }
                    disabled={!!inventoryDisabledHint}
                    title={inventoryDisabledHint}
                  />
                  {t(
                    "catalog.products.create.variantsBuilder.allowBackorder",
                    "Allow backorder",
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-50"
                    checked={(values.variants?.[0] || {}).hasInventoryKit ?? false}
                    onChange={(event) =>
                      setVariantField(
                        (values.variants?.[0] || {}).id || "",
                        "hasInventoryKit",
                        event.target.checked,
                      )
                    }
                    disabled={!!inventoryDisabledHint}
                    title={inventoryDisabledHint}
                  />
                  {t(
                    "catalog.products.create.variantsBuilder.inventoryKit",
                    "Has inventory kit",
                  )}
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductBuilder({
  values,
  setValue,
  errors,
  priceKinds,
  taxRates,
  requiredFieldIds,
}: ProductBuilderProps) {
  const t = useT();
  const steps = React.useMemo(() => {
    if (
      values.productType === "simple" ||
      values.productType === "downloadable"
    ) {
      return PRODUCT_FORM_STEPS.filter(
        (s) => s !== "options" && s !== "variants"
      );
    }
    return PRODUCT_FORM_STEPS;
  }, [values.productType]);
  const [currentStep, setCurrentStep] = React.useState(0);
  React.useEffect(() => {
    if (currentStep >= steps.length) {
      setCurrentStep(Math.max(0, steps.length - 1));
    }
  }, [steps.length, currentStep]);
  const defaultTaxRate = React.useMemo(
    () =>
      values.taxRateId
        ? (taxRates.find((rate) => rate.id === values.taxRateId) ?? null)
        : null,
    [taxRates, values.taxRateId],
  );
  React.useEffect(() => {
    if (values.taxRateId) return;
    if (!taxRates.length) return;
    const fallback = taxRates.find((rate) => rate.isDefault);
    if (!fallback) return;
    setValue("taxRateId", fallback.id);
  }, [taxRates, setValue, values.taxRateId]);
  const stepErrors = React.useMemo(() => {
    const map = steps.reduce<Record<ProductFormStep, string[]>>(
      (acc, step) => {
        acc[step] = [];
        return acc;
      },
      {} as Record<ProductFormStep, string[]>,
    );
    Object.entries(errors).forEach(([fieldId, message]) => {
      const step = resolveStepForField(fieldId);
      if (!step) return;
      const text =
        typeof message === "string" && message.trim().length
          ? message.trim()
          : null;
      if (text) map[step] = [...map[step], text];
    });
    return map;
  }, [errors, steps]);
  const errorSignature = React.useMemo(
    () => Object.keys(errors).sort((a, b) => a.localeCompare(b)).join("|"),
    [errors],
  );
  const lastErrorSignatureRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!errorSignature || errorSignature === lastErrorSignatureRef.current)
      return;
    lastErrorSignatureRef.current = errorSignature;
    const currentStepKey = steps[currentStep];
    if (currentStepKey && stepErrors[currentStepKey]?.length) return;
    const fallbackIndex = steps.findIndex(
      (step) => (stepErrors[step] ?? []).length > 0,
    );
    if (fallbackIndex >= 0 && fallbackIndex !== currentStep) {
      setCurrentStep(fallbackIndex);
    }
  }, [currentStep, errorSignature, setCurrentStep, stepErrors, steps]);
  const defaultTaxRateLabel = defaultTaxRate
    ? formatTaxRateLabel(defaultTaxRate)
    : null;
  const inventoryDisabledHint = t(
    "catalog.products.create.variantsBuilder.inventoryDisabled",
    "Inventory tracking controls are not available yet.",
  );

  React.useEffect(() => {
    if (currentStep >= steps.length) setCurrentStep(0);
  }, [currentStep, steps.length]);

  const currentStepKey = steps[currentStep] ?? steps[0];

  const mediaItems = React.useMemo(
    () => (Array.isArray(values.mediaItems) ? values.mediaItems : []),
    [values.mediaItems],
  );

  const handleMediaItemsChange = React.useCallback(
    (nextItems: ProductMediaItem[]) => {
      setValue("mediaItems", nextItems);
      const hasCurrent = nextItems.some(
        (item) => item.id === values.defaultMediaId,
      );
      if (!hasCurrent) {
        const fallbackId = nextItems[0]?.id ?? null;
        setValue("defaultMediaId", fallbackId);
        if (fallbackId && nextItems[0]) {
          setValue(
            "defaultMediaUrl",
            buildAttachmentImageUrl(fallbackId, {
              slug: slugifyAttachmentFileName(nextItems[0].fileName),
            }),
          );
        } else {
          setValue("defaultMediaUrl", "");
        }
      }
    },
    [setValue, values.defaultMediaId],
  );

  const handleDefaultMediaChange = React.useCallback(
    (attachmentId: string | null) => {
      setValue("defaultMediaId", attachmentId);
      if (!attachmentId) {
        setValue("defaultMediaUrl", "");
        return;
      }
      const target = mediaItems.find((item) => item.id === attachmentId);
      if (target) {
        setValue(
          "defaultMediaUrl",
          buildAttachmentImageUrl(target.id, {
            slug: slugifyAttachmentFileName(target.fileName),
          }),
        );
      }
    },
    [mediaItems, setValue],
  );

  const ensureVariants = React.useCallback(() => {
    const optionDefinitions = Array.isArray(values.options)
      ? values.options
      : [];
    if (!values.hasVariants || !optionDefinitions.length) {
      if (!values.variants || !values.variants.length) {
        setValue("variants", [
          createVariantDraft(values.taxRateId ?? null, { isDefault: true }),
        ]);
      }
      return;
    }
    const combos = buildVariantCombinations(optionDefinitions);
    const existing = Array.isArray(values.variants) ? values.variants : [];
    const existingByKey = new Map(
      existing.map((variant) => [
        buildOptionValuesKey(variant.optionValues),
        variant,
      ]),
    );
    let hasDefault = existing.some((variant) => variant.isDefault);
    let changed = existing.length !== combos.length;
    const nextVariants: VariantDraft[] = combos.map((combo, index) => {
      const key = buildOptionValuesKey(combo);
      const existingMatch = existingByKey.get(key);
      if (existingMatch) {
        if (existingMatch.isDefault) hasDefault = true;
        if (!haveSameOptionValues(existingMatch.optionValues, combo)) {
          changed = true;
          return { ...existingMatch, optionValues: combo };
        }
        if (existing[index] !== existingMatch) {
          changed = true;
        }
        return existingMatch;
      }
      changed = true;
      return createVariantDraft(values.taxRateId ?? null, {
        title: Object.values(combo).join(" / "),
        optionValues: combo,
      });
    });
    if (!nextVariants.length) return;
    if (!hasDefault) {
      changed = true;
      nextVariants[0] = { ...nextVariants[0], isDefault: true };
    }
    if (changed) {
      setValue("variants", nextVariants);
    }
  }, [
    values.options,
    values.variants,
    values.hasVariants,
    values.taxRateId,
    setValue,
  ]);

  React.useEffect(() => {
    ensureVariants();
  }, [ensureVariants]);

  React.useEffect(() => {
    if (!values.taxRateId) return;
    const variants = Array.isArray(values.variants) ? values.variants : [];
    if (!variants.length) return;
    let changed = false;
    const nextVariants = variants.map((variant) => {
      if (variant.taxRateId) return variant;
      changed = true;
      return { ...variant, taxRateId: values.taxRateId };
    });
    if (changed) {
      setValue("variants", nextVariants);
    }
  }, [values.taxRateId, values.variants, setValue]);
  const setVariantField = React.useCallback(
    (variantId: string, field: keyof VariantDraft, value: unknown) => {
      const next = (Array.isArray(values.variants) ? values.variants : []).map(
        (variant) => {
          if (variant.id !== variantId) return variant;
          return { ...variant, [field]: value };
        },
      );
      setValue("variants", next);
    },
    [values.variants, setValue],
  );

  const setVariantPrice = React.useCallback(
    (variantId: string, priceKindId: string, field: "amount" | "priceMin" | "priceMax", value: string) => {
      if (value.trim().startsWith("-")) return;
      const next = (Array.isArray(values.variants) ? values.variants : []).map(
        (variant) => {
          if (variant.id !== variantId) return variant;
          const nextPrices = { ...(variant.prices ?? {}) };
          const current = nextPrices[priceKindId] ?? { amount: "" };
          
          const nextCurrent = { ...current, [field]: value };
          if (!nextCurrent.amount && !nextCurrent.priceMin && !nextCurrent.priceMax) {
            delete nextPrices[priceKindId];
          } else {
            nextPrices[priceKindId] = nextCurrent;
          }
          
          return {
            ...variant,
            prices: nextPrices,
          };
        },
      );
      setValue("variants", next);
    },
    [values.variants, setValue],
  );





  return (
    <div className="space-y-6">
      <nav className="flex gap-6 border-b pb-2 text-sm font-medium">
        {steps.map((step, index) => (
          <Button
            key={step}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "relative h-auto rounded-none px-0 py-1 pb-2 font-medium",
              currentStep === index
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setCurrentStep(index)}
          >
            {step === "general" &&
              t("catalog.products.create.steps.general", "General data")}
            {step === "organize" &&
              t("catalog.products.create.steps.organize", "Organize")}
            {step === "uom" &&
              t("catalog.products.uom.title", "Units of measure")}
            {step === "compliance" &&
              t("catalog.products.compliance.title", "Compliance & commerce")}
            {step === "options" &&
              (values.productType === "service"
                ? t("catalog.options.title", "Option Tree")
                : t("catalog.products.form.options", "Options"))}
            {step === "variants" &&
              t("catalog.products.create.steps.variants", "Variants")}
            {(stepErrors[step]?.length ?? 0) > 0 ? (
              <span
                className="absolute -right-2 top-0 h-2 w-2 rounded-full bg-destructive"
                aria-hidden="true"
              />
            ) : null}
            {currentStep === index ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary rounded-full" />
            ) : null}
          </Button>
        ))}
      </nav>

      {currentStepKey === "general" ? (
        <div className="space-y-6">
          <div className="space-y-2" data-crud-field-id="title">
            <Label className="flex items-center gap-1">
              {t("catalog.products.form.title", "Title")}
              <span className="text-status-error-text">*</span>
            </Label>
            <Input
              value={values.title}
              onChange={(event) => setValue("title", event.target.value)}
              placeholder={t(
                "catalog.products.create.placeholders.title",
                "e.g., Summer sneaker",
              )}
            />
            {errors.title ? (
              <p className="text-xs text-status-error-text">{errors.title}</p>
            ) : null}
          </div>

          <div className="space-y-2" data-crud-field-id="description">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1">
                {t("catalog.products.form.description", "Description")}
                {requiredFieldIds?.has("description") ? (
                  <span className="text-status-error-text">*</span>
                ) : null}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setValue("useMarkdown", !values.useMarkdown)}
                className="gap-2 text-xs"
              >
                {values.useMarkdown ? (
                  <AlignLeft className="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                {values.useMarkdown
                  ? t(
                      "catalog.products.create.actions.usePlain",
                      "Use plain text",
                    )
                  : t(
                      "catalog.products.create.actions.useMarkdown",
                      "Use markdown",
                    )}
              </Button>
            </div>
            {values.useMarkdown ? (
              <MarkdownField
                value={values.description}
                onChange={(val) => setValue("description", val ?? "")}
              />
            ) : (
              <textarea
                className="min-h-[180px] w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={values.description}
                onChange={(event) =>
                  setValue("description", event.target.value)
                }
                placeholder={t(
                  "catalog.products.create.placeholders.description",
                  "Describe the product...",
                )}
              />
            )}
            {errors.description ? (
              <p className="text-xs text-status-error-text">{errors.description}</p>
            ) : null}
          </div>

          <ProductMediaManager
            entityId={E.catalog.catalog_product}
            draftRecordId={values.mediaDraftId}
            items={mediaItems}
            defaultMediaId={values.defaultMediaId ?? null}
            onItemsChange={handleMediaItemsChange}
            onDefaultChange={handleDefaultMediaChange}
          />

          <ProductDimensionsFields
            values={values as ProductFormValues}
            setValue={setValue}
          />
        </div>
      ) : null}

      {currentStepKey === "organize" ? (
        <ProductCategorizeSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
        />
      ) : null}

      {currentStepKey === "uom" ? (
        <ProductUomSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          embedded
        />
      ) : null}

      {currentStepKey === "compliance" ? (
        <ProductComplianceSection
          values={values as ProductFormValues}
          setValue={setValue}
          errors={errors}
          embedded
        />
      ) : null}

      {currentStepKey === "options" ? (
        values.productType === "service" ? (
          <OptionTreeEditor
            groups={values.optionTreeGroups || []}
            options={values.optionTreeOptions || []}
            onChangeGroups={(groups) => setValue("optionTreeGroups", groups)}
            onChangeOptions={(opts) => setValue("optionTreeOptions", opts)}
          />
        ) : (
          <OptionDraftBuilder
            options={Array.isArray(values.options) ? values.options : []}
            onChange={(opts) => setValue("options", opts)}
            t={t}
          />
        )
      ) : null}

      {currentStepKey === "variants" ? (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border"
                checked={values.hasVariants}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setValue("hasVariants", checked);
                  if (values.productType !== "service") {
                    if (checked && !isConfigurableProductType(values.productType || "simple")) {
                      setValue("productType", "configurable");
                    } else if (!checked && isConfigurableProductType(values.productType || "simple")) {
                      setValue("productType", "simple");
                    }
                  }
                }}
              />
              {t(
                "catalog.products.create.variantsBuilder.toggle",
                "Yes, this is a product with variants",
              )}

            </label>
          </div>

          <DefaultVariantBuilder 
            values={values} 
            setVariantField={setVariantField} 
            setVariantPrice={setVariantPrice} 
            priceKinds={priceKinds} 
            taxRates={taxRates}
            defaultTaxRateLabel={defaultTaxRateLabel}
            inventoryDisabledHint={inventoryDisabledHint}
            t={t} 
          />
        </div>
      ) : null}

      <div className="flex justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("catalog.products.create.steps.previous", "Previous")}
        </Button>
        {currentStepKey !== "variants" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setCurrentStep(Math.min(steps.length - 1, currentStep + 1))
            }
            className="gap-2"
          >
            {t("catalog.products.create.steps.continue", "Continue")}
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function ProductMetaSection({
  values,
  setValue,
  errors,
  taxRates,
}: ProductMetaSectionProps) {
  const t = useT();
  const handleValue = typeof values.handle === "string" ? values.handle : "";
  const titleSource = typeof values.title === "string" ? values.title : "";
  const autoHandleEnabledRef = React.useRef(handleValue.trim().length === 0);

  React.useEffect(() => {
    if (!autoHandleEnabledRef.current) return;
    const normalizedTitle = titleSource.trim();
    if (!normalizedTitle) {
      if (handleValue) {
        setValue("handle", "");
      }
      return;
    }
    const nextHandle = slugify(normalizedTitle);
    if (nextHandle !== handleValue) {
      setValue("handle", nextHandle);
    }
  }, [titleSource, handleValue, setValue]);

  const handleHandleInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      autoHandleEnabledRef.current = nextValue.trim().length === 0;
      setValue("handle", nextValue);
    },
    [setValue],
  );

  const handleGenerateHandle = React.useCallback(() => {
    const slug = slugify(titleSource);
    autoHandleEnabledRef.current = true;
    setValue("handle", slug);
  }, [titleSource, setValue]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t("catalog.products.form.subtitle", "Subtitle")}</Label>
        <Input
          value={typeof values.subtitle === "string" ? values.subtitle : ""}
          onChange={(event) => setValue("subtitle", event.target.value)}
          placeholder={t(
            "catalog.products.create.placeholders.subtitle",
            "Optional subtitle",
          )}
        />
        {errors.subtitle ? (
          <p className="text-xs text-status-error-text">{errors.subtitle}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>{t("catalog.products.form.handle", "Handle")}</Label>
        <div className="flex gap-2">
          <Input
            value={handleValue}
            onChange={handleHandleInputChange}
            placeholder={t(
              "catalog.products.create.placeholders.handle",
              "e.g., summer-sneaker",
            )}
            className="font-mono lowercase"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleGenerateHandle}
          >
            {t("catalog.products.create.actions.generateHandle", "Generate")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "catalog.products.create.handleHelp",
            "Handle is used for URLs and must be unique.",
          )}
        </p>
        {errors.handle ? (
          <p className="text-xs text-status-error-text">{errors.handle}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>{t("catalog.products.form.sku", "SKU")}</Label>
        <Input
          value={values.sku}
          onChange={(event) => setValue("sku", event.target.value)}
          placeholder={t(
            "catalog.products.create.placeholders.sku",
            "e.g., PROD-001",
          )}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          {t(
            "catalog.products.create.skuHelp",
            "Unique product identifier. Letters, numbers, hyphens, underscores, periods.",
          )}
        </p>
        {errors.sku ? (
          <p className="text-xs text-status-error-text">{errors.sku}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>
          {t("catalog.products.form.productType", "Product type")}
        </Label>
        <Select
          value={values.productType || "simple"}
          onValueChange={(value) => {
            const nextType = value;
            setValue("productType", nextType);
            const nextIsConfigurable = isConfigurableProductType(nextType);
            if (nextIsConfigurable && !values.hasVariants) {
              setValue("hasVariants", true);
            } else if (!nextIsConfigurable && values.hasVariants) {
              setValue("hasVariants", false);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATALOG_PRODUCT_TYPES.map((type) => {
              const isDisabled = type === "bundle" || type === "grouped";
              return (
                <SelectItem key={type} value={type} disabled={isDisabled}>
                  {t(`catalog.products.types.${type}`, type)}
                  {isDisabled ? ` (${t("common.comingSoon", "Coming soon")})` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {errors.productType ? (
          <p className="text-xs text-status-error-text">
            {errors.productType}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>
            {t("catalog.products.create.taxRates.label", "Tax class")}
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.open(
                  "/backend/config/sales?section=tax-rates",
                  "_blank",
                  "noopener,noreferrer",
                );
              }
            }}
            title={t(
              "catalog.products.create.taxRates.manage",
              "Manage tax classes",
            )}
            className="text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
            <span className="sr-only">
              {t(
                "catalog.products.create.taxRates.manage",
                "Manage tax classes",
              )}
            </span>
          </Button>
        </div>
        <Select
          value={values.taxRateId || undefined}
          onValueChange={(value) => setValue("taxRateId", value || null)}
          disabled={!taxRates.length}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                taxRates.length
                  ? t("catalog.products.create.taxRates.noneSelected", "No tax class selected")
                  : t("catalog.products.create.taxRates.emptyOption", "No tax classes available")
              }
            />
          </SelectTrigger>
          <SelectContent>
            {taxRates.map((rate) => (
              <SelectItem key={rate.id} value={rate.id}>
                {formatTaxRateLabel(rate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {taxRates.length
            ? t(
                "catalog.products.create.taxRates.help",
                "Applied to new prices unless overridden per variant.",
              )
            : t(
                "catalog.products.create.taxRates.empty",
                "Define tax classes under Sales → Configuration.",
              )}
        </p>
        {errors.taxRateId ? (
          <p className="text-xs text-status-error-text">{errors.taxRateId}</p>
        ) : null}
      </div>
    </div>
  );
}
