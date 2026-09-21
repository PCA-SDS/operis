import {
  blocksToHtml,
  buildTemplateBlocks,
  customTemplateValues,
  customTemplateVariables,
  parseJsonObject,
  splitCsv,
  type TemplateBlockFormValue,
  type TemplateStatus,
} from './templateHtml'

export type TemplateBuilderFormValue = {
  templateKey: string
  name: string
  description: string
  category: string
  status: TemplateStatus
  subject: string
  preheader: string
  variables: string
  fields: string
  defaultValues: string
  variableTypes: string
  rules: string
  ruleNotes: string
  workflowKey: string
  sortOrder: string
  isActive: boolean
  blocks: TemplateBlockFormValue[]
}

export const DEFAULT_TEMPLATE_CATEGORY = 'accounting'

/** Marks a body written by the builder, as opposed to the PCA migration's. */
const DESIGN_SOURCE = 'operis-email-template-builder'

export type EmailTemplatePayload = ReturnType<typeof buildTemplateApiPayload>

/**
 * The one request body for POST and PUT `/api/email/templates`.
 *
 * Create and edit each carried their own copy of this, so a field added to one
 * silently stopped being persisted from the other. `design.body.html` is
 * rendered from the same blocks that are persisted, which is what keeps the
 * builder body and the migrated-row fallback from drifting apart.
 */
export function buildTemplateApiPayload(form: TemplateBuilderFormValue, linkFallbackLabel?: string) {
  const variables = customTemplateVariables(form.variables)
  const fields = splitCsv(form.fields)
  const defaultValues = parseJsonObject(form.defaultValues, 'Default values')
  const variableTypes = parseJsonObject(form.variableTypes, 'Variable types')
  const rules = parseJsonObject(form.rules, 'Rules')
  const html = blocksToHtml(form.blocks, linkFallbackLabel)
  const sortOrder = Number.parseInt(form.sortOrder, 10)

  return {
    template_key: form.templateKey.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    category: form.category.trim() || DEFAULT_TEMPLATE_CATEGORY,
    status: form.status,
    subject: form.subject.trim(),
    preheader: form.preheader.trim() || null,
    variables,
    blocks: buildTemplateBlocks(form.blocks),
    design: { version: 1, source: DESIGN_SOURCE, body: { format: 'blocks+html', html } },
    accounting_metadata: {
      workflowKey: form.workflowKey.trim() || undefined,
      ruleKeys: Object.entries(rules).map(([key, value]) => `${key}:${String(value)}`),
      migratedFrom: null,
      sourceTemplateId: null,
      fields,
      defaultValues: customTemplateValues(defaultValues),
      variableTypes,
      rules,
      ruleNotes: form.ruleNotes.trim() || undefined,
      sortOrder: Number.isFinite(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
      isActive: form.isActive && form.status !== 'archived',
    },
  }
}
