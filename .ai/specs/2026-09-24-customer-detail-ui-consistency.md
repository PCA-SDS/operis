# Customer detail pages — Calendar-consistent UI

## TLDR

The person (`/backend/customers/people-v2/[id]`) and company (`/backend/customers/companies-v2/[id]`)
detail pages, and the dialogs they open, now follow the Calendar event editor's rules: tinted
field wells, soft buttons, one 36px control height, 16px icons, a fixed dialog body height, an
unruled footer, required fields marked up front, and no layout shift when something is toggled.
Every shared change is an **opt-in prop**; shared defaults are unchanged, so the deal detail page
and other consumers render as before.

## Overview

The Calendar editor (commit c7cde79a) set the house style. The two customer detail pages predate it.
A computed-style audit as the least-privileged `employee` role found controls at 8 heights
(20–38px), 3 font sizes, white bordered `outline sm` buttons throughout, white custom-attribute
fields among tinted ones, tabs that changed width when selected, and dialogs with no fixed height,
footer rules and silent validation.

## Problem Statement

- Inconsistent control height, type and fill across one surface.
- Custom-attribute fields were white: `CrudForm` wrapped custom-field sections in the
  `data-crud-section` panel even in `collapsibleGroups` mode, and that panel's CSS flips fields to
  `--surface`.
- Layout moved on interaction: tabs (semibold active label), filter chips, "Clear filters", company
  People filters, "New category" in Manage tags.
- Dialogs grew and shrank with their content, drew a rule above the footer, and some had no
  `Cmd/Ctrl+Enter`, required markers or `role="alert"` errors.

## Proposed Solution

### Shared opt-ins (defaults unchanged)

| Component | Opt-in |
|---|---|
| `ui/primitives/icon-button` | `variant="soft"` (brand-soft fill, floating shadow) |
| `ui/primitives/search-input` | `tone="well"` (`--input-bg` field well) |
| `ui/primitives/tabs` | `reserveActiveWidth` — reserves the semibold label width via `::after` |
| `ui/backend/CrudForm` | `flatCustomFieldSections`; `dialogBodyClassName` (fixed `data-dialog-form` body, unruled footer below it; `extraActions` render only in that footer) |
| `ui/backend/forms/FormSection` | `panel={false}` |
| `ui/backend/crud/CollapsibleZoneLayout` | `toggleTone="soft"` |
| `ui/backend/detail/AttachmentsSection`, `AddressTiles`, `messages/EmailThreadsPanel` | `actionVariant="soft"` |
| `ui/backend/messages/SendObjectMessageDialog` | `buttonVariant="soft"` |
| `ui/backend/version-history/VersionHistoryAction` | `buttonVariant="soft"`, `buttonSize="lg"` |
| `ui/backend/inputs/PhoneNumberField` | `tone="well"` |
| `dictionaries/components/DictionaryEntrySelect` | `addButtonVariant="soft"` |
| `customers/components/formConfig` `DictionarySelectField` | `addButtonVariant` (person/company builders pass `soft`; deal forms keep `outline`) |
| customers `ObjectHistoryButton`, `ActivitiesSection`, `ActivityTimelineFilters`, `ChangelogTab`, `ChangelogFilters` | `tone="soft"` |

### Customers surfaces

Headers, tabs, form zone, roles, activity feed, emails, companies, addresses, tasks, change log,
company people and KPI bar: `outline sm` → `soft` default size; icon-only → `IconButton soft lg`;
icons `size-4`; primary actions stay `default`. Conditional controls stay laid out (`invisible`)
so showing them moves nothing.

### Dialogs

`EntityTagsDialog`, `ManageTagsDialog`, `ScheduleActivityDialog` (+ `schedule/*` fields),
`TaskForm`/`TaskDialog`, `AssignRoleDialog`, `ComposeEmailDialog`, `CreatePersonDialog`,
`LinkEntityDialog`, company-select add dialog, dictionary add-entry dialog:
`data-dialog-form="true"`, a fixed body height (`detail/dialogChrome.ts`), unruled footer, soft
Cancel, `Cmd/Ctrl+Enter` / `Escape`, `FormFieldLabel required`, reserved `role="alert"` lines.
`DialogContent` fixed heights carry an `sm:h-[…]` twin because the base variant sets `sm:h-auto`.

## Architecture

No new modules, entities, routes, events or ACL features. UI-only; one new file
`customers/components/detail/dialogChrome.ts` (body-height class constants).

## Data Models

None.

## API Contracts

None. Three new i18n keys (all 8 customers locales): `customers.schedule.typeSwitcher`,
`customers.schedule.linkType.label`, `customers.tags.manage.categoryMode.label`.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A shared opt-in leaks to another consumer | Medium | Every prop defaults to prior behaviour; unit tests cover default + opt-in | Low |
| Dialogs changed on the deal page too (`ScheduleActivityDialog`, `LinkEntityDialog`) | Low | The dialog itself was fixed, not restyled per host | Accepted |
| Calendar `CONTROL_BOX` uses `--surface-muted` while fields use `--input-bg` | Low | Not changed; flagged for a follow-up decision | Open |
| `EmailThreadsPanel` Retry button still outline | Low | Error-state only | Open |
| Removed the non-functional recurrence "Edit" button in `DateTimeFields` | Low | It had no handler | None |

Out of scope: `ActivityDialog`, `AppearanceDialog`, `DealDialog`, `ConfirmDialog`, the version
history panel, and the rich-text editor toolbar.

## Final Compliance Report

- Browser, `employee` role, both pages, every tab and dialog: toolbar controls 36px / 14px / 500 /
  16px icons; fields `#E7EEF8`; tab switch, filter chips, Save enabling, dialog type switch and
  validation errors — measured max shift 0px; dialog footers constant across states.
- Deal page as `employee` returns 404 (`customers.deals.manage`); its file is untouched and passes
  none of the opt-ins.
- Gates: ui + core typecheck, lint (0 errors), ui 2155 tests, core 13545 tests, `build:packages`.
  `i18n:check-sync` reports only the pre-existing unsorted appointments keys. `ds:code-connect:check`
  cannot run: the installed Code Connect CLI v2 rejects the repo's parser config.

## Changelog

- 2026-09-24 — Implemented on branch `fix-client-page`.
