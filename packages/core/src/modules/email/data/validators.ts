import { z } from 'zod'

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const clearableStringSchema = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

const templateKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/)

const jsonObjectSchema = z.record(z.string(), z.unknown())

export const emailTemplateStatusSchema = z.enum(['draft', 'published', 'archived'])
export type EmailTemplateStatus = z.infer<typeof emailTemplateStatusSchema>

export const emailTemplateBlockSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    type: z.string().trim().min(1).max(80),
    label: z.string().trim().max(160).optional(),
    props: jsonObjectSchema.default({}),
    children: z.array(z.unknown()).default([]),
  })
  .strict()

export const accountingTemplateMetadataSchema = z
  .object({
    workflowKey: z.string().trim().max(120).optional(),
    ruleKeys: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    sourceTemplateId: z.string().trim().max(160).optional().nullable(),
    migratedFrom: z.string().trim().max(160).optional().nullable(),
    fields: z.array(z.string().trim().min(1).max(120)).max(200).default([]).optional(),
    defaultValues: z.record(z.string(), z.string()).default({}).optional(),
    rules: jsonObjectSchema.default({}).optional(),
    sortOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

const templateShape = {
  id: uuid().optional(),
  template_key: templateKeySchema,
  name: z.string().trim().min(1).max(200),
  description: clearableStringSchema(2000),
  category: z.string().trim().min(1).max(100).default('accounting'),
  status: emailTemplateStatusSchema.default('draft'),
  subject: z.string().trim().min(1).max(500),
  preheader: clearableStringSchema(500),
  design: jsonObjectSchema.default({}),
  blocks: z.array(emailTemplateBlockSchema).default([]),
  variables: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  accounting_metadata: accountingTemplateMetadataSchema.nullable().optional(),
}

const baseTemplateSchema = z.object(templateShape)

export const createEmailTemplateSchema = baseTemplateSchema.strict()

const updateTemplateShape = {
  ...templateShape,
  category: z.string().trim().min(1).max(100).optional(),
  status: emailTemplateStatusSchema.optional(),
  design: jsonObjectSchema.optional(),
  blocks: z.array(emailTemplateBlockSchema).optional(),
  variables: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
}

export const updateEmailTemplateSchema = z
  .object(updateTemplateShape)
  .partial()
  .extend({
    id: uuid(),
    expected_updated_at: z.string().datetime().optional(),
  })
  .strict()

export const deleteEmailTemplateSchema = z
  .object({
    id: uuid(),
    expected_updated_at: z.string().datetime().optional(),
  })
  .strict()

export const emailTemplateQuerySchema = z
  .object({
    id: uuid().optional(),
    ids: z.string().optional(),
    search: z.string().trim().max(200).optional(),
    category: z.string().trim().max(100).optional(),
    status: emailTemplateStatusSchema.optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
    sort: z.string().trim().max(100).optional(),
    order: z.enum(['asc', 'desc']).optional(),
  })
  .strict()

export const emailAccountingDefaultsSchema = z
  .object({
    expected_updated_at: z.string().datetime().optional(),
    default_sender_name: clearableStringSchema(200),
    default_reply_to: z.preprocess(emptyStringToNull, z.string().email().max(320).nullable().optional()),
    placeholders: jsonObjectSchema.default({}),
    link_placeholders: jsonObjectSchema.default({}),
    rules: jsonObjectSchema.default({}),
  })
  .strict()

export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>
export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>
export type EmailAccountingDefaultsInput = z.infer<typeof emailAccountingDefaultsSchema>
