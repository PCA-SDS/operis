# Email Templates Module

The `email` module stores tenant-owned email template definitions and PCA accounting defaults. It does not send email yet; delivery remains owned by channel modules such as Gmail or IMAP/SMTP.

## PCA Accounting Parity

The first migration target is the old `pca_accounting` template workflow:

- Store reusable accounting email templates with subject, body blocks, variables, default values, and rule metadata.
- Preserve PCA starter templates for quarterly document requests, quarterly tax with activity, quarterly tax without activity, Q3 CIT, and Q4 CIT.
- Replace hard-coded customer Google Drive and Sheets links with safe `https://example.com/...` placeholders.
- Keep company/contact data outside the template record. Operis companies are business customers; linked people provide recipients and greeting/contact variables during future compose.

## Data Model

- `EmailTemplate` is scoped by `tenant_id` and `organization_id`.
- `template_key` is unique only inside the active tenant/organization scope.
- `blocks` store the visual-builder payload.
- `design` stores generated render metadata and HTML snapshots.
- `variables` stores custom accounting variables only.
- `accounting_metadata` stores workflow keys, rule keys, default values, sort order, and whether a template should appear in a future accounting generator.
- `EmailAccountingDefaults` stores tenant-owned sender defaults, common placeholder samples, safe link placeholder samples, and rule-selection notes.

## Variable Ownership

Template variables are split into two groups:

- System variables are read-only in the builder and will be filled from Operis data later: `companyName`, `companyCode`, `companyEmail`, `contactNames`, `recipientEmails`, and `greeting`.
- Custom accounting variables are edited by users: examples include `quarterPeriod`, `declarationDeadline`, `vatPitReportsLink`, `taxTrackingLink`, `vatPayable`, and `citPayable`.

This prevents users from retyping company/contact facts already stored in the Customers module.

## Rules And Workflow Selection

`rules` and `ruleKeys` are stored now but do not execute workflow selection yet. Future compose/generator work should:

1. Resolve the selected company and linked people through Customers APIs or query-engine lookups.
2. Build system variables from that scoped company/contact data.
3. Match accounting context against `accounting_metadata.rules`.
4. Select active templates only when `status` is `published` and `accounting_metadata.isActive` is true.
5. Merge system variables, accounting defaults, template default values, and user-entered accounting values before rendering.

No rule path should hard-code PCA behavior in app bootstrap or another module.

## Security

- All API routes require auth and feature-based RBAC.
- Reads and writes are tenant/organization scoped.
- User-editable writes use optimistic-lock headers.
- The custom accounting-defaults route runs mutation guards before saving.
- Search indexes only templates and excludes large/sensitive payload fields: `design`, `blocks`, and `accounting_metadata`.
