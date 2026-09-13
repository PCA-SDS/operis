export const translatableFields: Record<string, string[]> = {
  'catalog:catalog_product': ['title', 'subtitle', 'description', 'seoTitle', 'seoDescription'],
  'catalog:catalog_product_variant': ['name'],
  'catalog:catalog_offer': ['title', 'subtitle', 'description'],
  'catalog:catalog_option_schema_template': ['name', 'description'],
  'catalog:catalog_product_category': ['name', 'description'],
  'catalog:catalog_product_tag': ['label'],
  'catalog:catalog_product_option_group': ['name', 'description'],
  'catalog:catalog_product_option': ['name', 'description', 'note', 'unit'],
}

export default translatableFields
