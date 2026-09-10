# Email Templates Module

The `email` module stores tenant-owned email template definitions and accounting defaults. It does not send email yet; delivery remains owned by channel modules such as Gmail or IMAP/SMTP.

## PCA Accounting Parity

The first migration target is the old `pca_accounting` template workflow:

- Store reusable accounting email templates with subject, body blocks, variables, default values, and rule metadata.
- Preserve the five PCA source templates as tenant-owned migration/source data for PCA, not as global defaults for every Operis customer.
- Replace hard-coded customer Google Drive and Sheets links with safe `https://example.com/...` placeholders.
- Keep company/contact data outside the template record. Operis companies are business customers; linked people provide recipients and greeting/contact variables during future compose.

Legacy PCA fields map into Operis as follows:

| `pca_accounting` field | Operis field |
| --- | --- |
| `key` | `template_key` |
| `label` | `name` |
| `description` | `description` |
| `category` | `category` |
| `subject` | `subject` |
| `bodyHtml` | `blocks` plus `design.html` |
| `fields` | `variables` and `accounting_metadata.fields` |
| `defaultValues` | `accounting_metadata.defaultValues` |
| `rules` | `accounting_metadata.rules` |
| `sortOrder` | `accounting_metadata.sortOrder` |
| `isActive` / `activeOnly` | `status = published` and `accounting_metadata.isActive` |

Recovered PCA source template keys:

- `quarterly-info` — quarterly accounting document request.
- `quarterly-tax-with-activity` — VAT/PIT report when tax is payable.
- `quarterly-tax-no-activity` — VAT/PIT report when no tax is payable.
- `q3-cit` — Q3 tax report with provisional CIT details.
- `q4-cit` — Q4 tax report with annual CIT details.

The recovered source catalog lives in `data/pca-source-templates.ts`. It is not used by `setup.ts` and is not seeded for every tenant; it exists so a PCA-specific migration/import can copy these templates into the PCA tenant only.

Parity status from the old PCA stories:

| PCA capability | Operis status |
| --- | --- |
| Sidebar Templates tab | Backend route pages are discoverable under the `email` module. |
| Template list/detail/create/update/delete APIs | Implemented through scoped CRUD routes and command writes. |
| Template list search and active-only loading | Implemented with `search`, `status = published`, and `accounting_metadata.isActive`. |
| Template label/key/category/subject/body fields | Implemented as `name`, `template_key`, `category`, `subject`, and builder `blocks`. |
| Template variables/default values/rules/sort order | Implemented in `variables` and `accounting_metadata`. |
| Client/company compose workspace | Implemented as preview-only `/backend/email/compose` using scoped Customers APIs. |
| Copy-ready generated draft | Implemented for recipients, subject, and rendered HTML body with plain-text fallback. |
| Per-user Gmail connection / Gmail draft creation | Not implemented in this module yet. Operis communication-channel send-as-user currently creates an outbound message and enqueues real delivery; `channel-gmail` sends via `gmail.users.messages.send`. PCA-style Gmail Drafts need a future communication-channel draft bridge instead of a direct Gmail call from this module. |
| Seed five PCA templates for all tenants | Intentionally not implemented; PCA templates are source data for the PCA tenant only. |
| Real email sending | Intentionally deferred to Gmail/IMAP/SMTP channel integrations. |

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
- Rule metadata is edited through non-technical controls such as email purpose, quarter, activity, CIT, and selection priority; raw JSON stays hidden from tenant users.

This prevents users from retyping company/contact facts already stored in the Customers module.

## Compose Preview

`/backend/email/compose` provides a preview-only compose surface for published tenant templates. It lets users test selected template output with an Operis company, linked people, and accounting values before the later email-sending workflow exists.

- Company values represent the business customer selected from Operis Customers/Companies.
- People values represent linked contacts/recipients for that company.
- If no people are linked yet, company variables still render, while contact/recipient variables stay empty or must be entered manually in preview.
- Company and people values are loaded through existing scoped Customers APIs instead of direct cross-module imports or relationships.
- The page never sends email, never creates Gmail drafts, and does not persist recipient data.
- Future compose integration should reuse this scoped lookup path when adding draft/send actions. Gmail Drafts must be added through the communication-channel boundary because the existing send-as-user facade is a real-send path, not a draft path.

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
