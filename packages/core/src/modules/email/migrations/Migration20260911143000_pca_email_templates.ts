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
      props: {
        html: bodyHtml,
        order: 0,
      },
      children: [],
    },
  ]
}

export class Migration20260911143000_pca_email_templates extends Migration {
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
        insert into "email_templates" (
          "organization_id",
          "tenant_id",
          "template_key",
          "name",
          "description",
          "category",
          "status",
          "subject",
          "preheader",
          "design",
          "blocks",
          "variables",
          "accounting_metadata",
          "created_at",
          "updated_at"
        )
        select
          "organizations"."id",
          "tenants"."id",
          ${sqlString(template.templateKey)},
          ${sqlString(template.name)},
          ${sqlString(template.description)},
          ${sqlString(template.category)},
          'published',
          ${sqlString(template.subject)},
          null,
          ${sqlJson(design)},
          ${sqlJson(templateBlocks(template.templateKey, template.bodyHtml))},
          ${sqlJson(template.fields)},
          ${sqlJson(accountingMetadata)},
          now(),
          now()
        from "tenants"
        join "organizations" on "organizations"."tenant_id" = "tenants"."id" and "organizations"."deleted_at" is null
        where "tenants"."deleted_at" is null
          and (
            "tenants"."name" ilike 'PCA%'
            or "tenants"."name" ilike '%PCA Company Services%'
            or "organizations"."name" ilike 'PCA%'
            or "organizations"."name" ilike '%PCA Company Services%'
          )
        on conflict ("organization_id", "tenant_id", "template_key")
        where "deleted_at" is null
        do update set
          "name" = excluded."name",
          "description" = excluded."description",
          "category" = excluded."category",
          "status" = excluded."status",
          "subject" = excluded."subject",
          "preheader" = excluded."preheader",
          "design" = excluded."design",
          "blocks" = excluded."blocks",
          "variables" = excluded."variables",
          "accounting_metadata" = excluded."accounting_metadata",
          "updated_at" = now();
      `)
    }
  }
}
