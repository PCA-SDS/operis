"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  FORM_FIELD_HINT,
  FORM_FIELD_LABEL,
  FORM_FIELD_REQUIRED_MARK,
  FORM_SECTION,
  FORM_SECTION_ATTR,
  FORM_SECTION_DESCRIPTION,
  FORM_SECTION_HEADER,
  FORM_SECTION_PANEL,
  FORM_SECTION_TITLE,
} from './formChrome'

export type FormSectionProps = {
  /** Section heading. Sentence case — uppercase in a form belongs to field labels. */
  title?: React.ReactNode
  /** Supporting copy under the title. */
  description?: React.ReactNode
  /** Controls that belong to the section rather than to the form (Manage, Save…). */
  actions?: React.ReactNode
  /** Applied to the panel, not the wrapper, so callers can tune the fill area. */
  className?: string
  children: React.ReactNode
}

/**
 * One titled block of a form: a heading above a filled, borderless panel.
 *
 * Every form surface in the product renders through this — `CrudForm` groups,
 * custom-field fieldsets, and the hand-built create forms — so a section looks
 * the same wherever it appears. The chrome itself lives in `formChrome.ts`.
 *
 * The panel carries `data-crud-section`, which one stylesheet rule uses to strip
 * borders from whatever controls it holds.
 */
export function FormSection({
  title,
  description,
  actions,
  className,
  children,
}: FormSectionProps) {
  const hasHeader = Boolean(title || description || actions)
  return (
    <section className={FORM_SECTION}>
      {hasHeader ? (
        <header
          className={cn(
            FORM_SECTION_HEADER,
            // PCA's page-header rule: actions drop below the title rather than
            // crowding it once the row is too narrow to hold both.
            'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between',
          )}
        >
          {/* No glyph beside a section title. The reference form chrome titles
              its sections with words alone, and every `CrudForm` group already
              did — only the deal-create sections passed an icon, so they were
              the odd block out on an otherwise plain stack. */}
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="min-w-0">
              {title ? <h2 className={FORM_SECTION_TITLE}>{title}</h2> : null}
              {description ? <p className={FORM_SECTION_DESCRIPTION}>{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(FORM_SECTION_PANEL, className)} {...FORM_SECTION_ATTR}>
        {children}
      </div>
    </section>
  )
}

export type FormFieldLabelProps = {
  htmlFor?: string
  id?: string
  required?: boolean
  /** Shown inline after the label, opting back out of the uppercase. */
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * The micro-label above a form control — the only uppercase text in a form.
 * Shared so a hand-built form and a `CrudForm` field read identically.
 */
export function FormFieldLabel({
  htmlFor,
  id,
  required,
  hint,
  className,
  children,
}: FormFieldLabelProps) {
  return (
    <label id={id} htmlFor={htmlFor} className={cn(FORM_FIELD_LABEL, className)}>
      {children}
      {required ? (
        <span className={FORM_FIELD_REQUIRED_MARK} aria-hidden="true">
          *
        </span>
      ) : null}
      {hint ? <span className={FORM_FIELD_HINT}>{hint}</span> : null}
    </label>
  )
}
