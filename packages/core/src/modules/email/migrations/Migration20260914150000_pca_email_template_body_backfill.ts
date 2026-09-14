import { Migration } from '@mikro-orm/migrations'

import { pcaAccountingSourceTemplates } from '../data/pca-source-templates'

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlJson(value: unknown): string {
  return `${sqlString(JSON.stringify(value))}::jsonb`
}

function templateBlocks(templateKey: string, bodyHtml: string): unknown[] {
  return [
    {
      id: `pca-${templateKey}-body`,
      type: 'rich-text-html',
      label: 'Body text',
      props: { html: bodyHtml, order: 0 },
      children: [],
    },
  ]
}

export class Migration20260914150000_pca_email_template_body_backfill extends Migration {
  override up(): void | Promise<void> {
    for (const template of pcaAccountingSourceTemplates) {
      const design = {
        version: 1,
        source: 'pca-accounting-migration',
        body: { format: 'blocks+html', html: template.bodyHtml },
      }
      const accountingMetadata = {
        workflowKey: template.rules.type,
        ruleKeys: Object.entries(template.rules).map(([key, value]) => `${key}:${String(value)}`),
        migratedFrom: 'pca-accounting',
        sourceTemplateId: template.templateKey,
        fields: template.fields,
        defaultValues: template.defaultValues,
        variableTypes: template.variableTypes,
        rules: template.rules,
        ruleNotes: template.ruleNotes,
        sortOrder: template.sortOrder,
        isActive: template.isActive,
      }

      this.addSql(`
        update "email_templates" as templates
        set
          "design" = ${sqlJson(design)},
          "blocks" = ${sqlJson(templateBlocks(template.templateKey, template.bodyHtml))},
          "variables" = ${sqlJson(template.fields)},
          "accounting_metadata" = ${sqlJson(accountingMetadata)},
          "updated_at" = now()
        from "tenants"
        join "organizations" on "organizations"."tenant_id" = "tenants"."id" and "organizations"."deleted_at" is null
        where templates."organization_id" = "organizations"."id"
          and templates."tenant_id" = "tenants"."id"
          and templates."template_key" = ${sqlString(template.templateKey)}
          and templates."deleted_at" is null
          and templates."accounting_metadata"->>'migratedFrom' = 'pca-accounting'
          and (
            coalesce(jsonb_array_length(templates."blocks"), 0) = 0
            or coalesce(templates."design"->'body'->>'html', '') = ''
          )
          and "tenants"."deleted_at" is null
          and (
            "tenants"."name" ilike 'PCA%'
            or "tenants"."name" ilike '%PCA Company Services%'
            or "organizations"."name" ilike 'PCA%'
            or "organizations"."name" ilike '%PCA Company Services%'
          );
      `)
    }
  }
}
