# Invoice Send and Company Email Memory UX

## TLDR

Migrate the proven invoice-send recipient workflow from the legacy PCA ERP UI
into the Operis invoice detail page. Eligible AR invoices get a send/resend
panel, remembered company emails are offered through the existing CAP-006 API,
and manual valid email addresses remain allowed. Submission uses the existing
CAP-001 send command route and then reloads the invoice detail so the UI shows
authoritative `lastSentAt` and `openedAt` values.

This work adds no mail provider, token, pixel, database, or alternative email
memory logic.

## Overview

### Goal

Give a user with `invoice.manage` permission one clear workflow to send an AR
invoice from its detail page, using either a remembered company recipient or a
manually entered valid email address.

### Source of truth

The behavior reference is the legacy PCA ERP invoice module:

- `pca_erp/apps/frontend/src/modules/invoice/features/invoices/pages/InvoiceDetailPage.tsx`
- `pca_erp/apps/frontend/src/modules/invoice/features/invoices/components/SendInvoicePanel.tsx`
- `pca_erp/apps/frontend/src/modules/invoice/features/invoices/components/CompanyEmailField.tsx`
- `pca_erp/apps/frontend/src/modules/invoice/features/invoices/hooks/use-send-invoice.ts`
- `pca_erp/apps/frontend/src/modules/invoice/features/invoices/hooks/use-company-emails.ts`

The Operis API and design-system contracts are authoritative where they differ
from the legacy implementation.

### Scope

- Show an invoice send/resend surface on AR detail pages only.
- Load remembered recipients for the invoice `companyId`.
- Let the user select a remembered email or enter one valid custom email.
- Let the user remove a remembered email from the suggestion workflow.
- Send through `POST /api/invoice/invoices/[id]/send`.
- Show loading, validation, success, failure, and retry states.
- Reload invoice detail after success.
- Display backend-derived sent/open state.
- Add focused Playwright browser coverage.
- Add all new user-facing text to invoice locale files.

### Out of scope

- Mail provider or email content changes.
- Tracking-token generation, hashing, storage, or frontend state.
- Tracking-pixel mutation behavior.
- A second recipient store or direct frontend email persistence.
- Payment confirmation emails.
- AP invoice sending.
- New Invoice Core send behavior or API contract changes.
- AI Helper work.

### Success criteria

- An authorized user can send and resend an AR invoice from detail view.
- AP detail pages do not render a send action, dialog, or recipient request.
- Remembered recipients are loaded only for the invoice company and are shown
  newest first in the order returned by CAP-006.
- A remembered recipient and a new valid recipient can each be submitted.
- An invalid recipient is rejected before a send request is made.
- A failed send keeps the entered email and gives a retry path.
- A successful send closes/resets composition, gives success feedback, and
  reloads invoice detail before showing its updated sent/open state.
- Removing a remembered recipient uses CAP-006 and does not change past send
  history.
- No raw tracking token is requested, returned, logged, or stored by UI code.
- The five required browser scenarios are self-contained and deterministic.

## Problem Statement

CAP-001 and CAP-006 are already implemented in Operis, but the current invoice
detail page only displays invoice data and payment summary. Users cannot reach
the send capability from the UI and cannot reuse company recipient history.

The legacy UI proves the main interaction model: an AR-only panel presents
sent/open state, expands a recipient composer, supports remembered email
selection and deletion, sends the invoice, invalidates recipient memory, and
refreshes detail state. A direct copy is not suitable because Operis must use
its own guarded mutation flow, shared inputs/buttons, i18n, semantic design
tokens, and `apiCall` response shape.

## Proposed Solution

### User flow

1. Load invoice detail with `GET /api/invoice/invoices/[id]`.
2. If `direction !== 'AR'`, render no send surface and make no company-email
   request.
3. For AR, render a compact send-status panel in the detail sidebar.
4. On **Send invoice** or **Resend invoice**, open a focused dialog.
5. When the dialog opens and `companyId` exists, load remembered emails with
   `GET /api/invoice/company-emails?companyId=...`.
6. Let the user choose a suggestion or type a custom email.
7. Validate the trimmed address locally. Server validation stays authoritative.
8. Submit through the guarded mutation flow to
   `POST /api/invoice/invoices/[id]/send` with `{ email }` and the invoice
   optimistic-lock header derived from `updatedAt`.
9. On success, show translated success feedback, close/reset the dialog,
   reload detail, and reload company email memory.
10. On failure, keep the dialog and email value open, show an inline translated
    error, and allow retry.

### Eligibility and permissions

- Direction is the product eligibility rule: only `AR` can send.
- The page remains protected by `invoice.view`.
- The send and email-memory writes require `invoice.manage`. The UI should hide
  or disable mutation controls when the current user lacks this feature; the
  API remains the security boundary.
- A missing `companyId` must not call CAP-006. Manual entry can still be used
  because the send API accepts an email and CAP-006 recording is best effort.
- Settlement status, origin, prior send state, and open state do not block a
  resend unless Invoice Core later exposes a stronger eligibility contract.

### State model

| State | Panel | Dialog / action |
| --- | --- | --- |
| AP invoice | No send panel | No send action |
| AR, never sent | “Not sent yet” | **Send invoice** |
| AR, sent, not opened | Last sent time + “Not opened yet” | **Resend invoice** |
| AR, opened | Last sent time + opened time | **Resend invoice** |
| Recipient list loading | Existing panel unchanged | Input available; suggestion area shows loading |
| Sending | Existing panel unchanged | Input/remove/cancel disabled; submit shows spinner |
| Send failed | Existing panel unchanged | Dialog remains open with inline error and retry |
| Send succeeded | Reloading detail | Dialog closes; success flash; refreshed status appears |

### Recipient behavior

- Use `ComboboxInput` from
  `@open-mercato/ui/backend/inputs/ComboboxInput` with
  `allowCustomValues` for single-recipient autocomplete.
- Map CAP-006 items to `{ value: email, label: email }`; do not reorder them.
- Match/filter case-insensitively through the shared combobox behavior.
- Trim before local validation and submission.
- Use the same email rules as the backend schema where a shared browser-safe
  validator is available. Otherwise use native `type=email` semantics plus a
  small UI schema aligned with `invoiceSendSchema`; backend errors remain final.
- Selecting a remembered address fills the one recipient value; this is not a
  multi-recipient flow.
- Deletion is a secondary action next to remembered entries. Because the stock
  `ComboboxInput` does not expose per-option actions, add a small invoice-local
  wrapper only if needed. Reuse its input/list accessibility behavior and DS
  tokens rather than copying the legacy hand-built list.
- Confirm removal only if the shared interaction pattern requires it. Removal
  is limited to memory and does not cancel or alter old invoice sends.
- The send endpoint, not the frontend, records/touches the selected or custom
  recipient after successful delivery.

### Feedback copy intent

All exact copy must use `invoice.send.*` translation keys in every shipped
invoice locale. English intent:

- Panel: “Not sent yet”, “Last sent {date}”, “Opened {date}”, “Not opened yet”.
- Actions: “Send invoice”, “Resend invoice”, “Cancel”, “Send”, “Retry”.
- Dialog: “Send invoice to {company}”, recipient label and placeholder.
- Validation: “Enter a valid email address.”
- Success: “Invoice sent to {email}.”
- Failure: use the safe translated server error when available, otherwise
  “Could not send the invoice.”
- Memory: loading, empty suggestion state, remove action and remove failure.

## UI Wireframes

### AR detail — never sent

```text
┌──────────────────────── Invoice detail ────────────────────────┐
│ Invoice INV-001                                      [Unpaid]  │
│                                                               │
│ ┌──────────────── invoice document ──────────────┐ ┌─────────┐ │
│ │ Seller / buyer / lines / totals               │ │ SEND    │ │
│ │                                               │ │         │ │
│ │                                               │ │ Not sent│ │
│ │                                               │ │ yet     │ │
│ │                                               │ │         │ │
│ │                                               │ │[Send    │ │
│ │                                               │ │ invoice]│ │
│ └───────────────────────────────────────────────┘ ├─────────┤ │
│                                                   │ SUMMARY │ │
│                                                   └─────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### AR detail — sent/opened

```text
┌────────────────────────── SEND ──────────────────────────┐
│ Last sent 14 Sep 2026                                    │
│ [Opened 14 Sep 2026, 10:42]                              │
│                                             [Resend invoice]
└──────────────────────────────────────────────────────────┘
```

If `openedAt` is null, the status badge reads “Not opened yet”. Date formatting
must follow the app locale and timezone policy, not the legacy formatter.

### Send dialog

```text
┌──────────────────── Send invoice ─────────────────────┐
│ Send a copy of INV-001 to Acme Ltd.                   │
│                                                       │
│ Recipient email                                       │
│ ┌───────────────────────────────────────────────────┐ │
│ │ accounts@acme.example                         ▾   │ │
│ └───────────────────────────────────────────────────┘ │
│ ┌──────── Remembered for Acme Ltd. ────────────────┐ │
│ │ accounts@acme.example                    [Remove]│ │
│ │ finance@acme.example                     [Remove]│ │
│ └───────────────────────────────────────────────────┘ │
│                                                       │
│ Error text stays here without clearing the address.   │
│                                      [Cancel] [Send]  │
└───────────────────────────────────────────────────────┘
```

The dialog uses the shared `Dialog`, `Button`, and `ComboboxInput` primitives.
`Escape` cancels when no request is active. `Cmd/Ctrl+Enter` submits. Focus
starts on the recipient input and returns to the trigger on close.

### Mobile behavior

```text
┌──────── Invoice INV-001 ────────┐
│ document content                │
├─────────────────────────────────┤
│ SEND                            │
│ Not sent yet                    │
│ [       Send invoice          ] │
├─────────────────────────────────┤
│ SUMMARY                         │
└─────────────────────────────────┘

Dialog: full-width within page padding; recipient list scrolls internally;
Cancel and Send remain visible in the footer.
```

### AP detail

```text
┌──────── Invoice AP-001 ─────────┐
│ document content                │
├─────────────────────────────────┤
│ SUMMARY                         │
└─────────────────────────────────┘

No Send card, send button, dialog, or company-email request.
```

## Architecture

```text
InvoiceDetailPage
  ├─ GET /api/invoice/invoices/[id]
  │    └─ companyId, direction, updatedAt, lastSentAt, openedAt
  └─ AR only: InvoiceSendPanel
       └─ InvoiceSendDialog
            ├─ GET /api/invoice/company-emails?companyId=...
            ├─ DELETE /api/invoice/company-emails/[emailId]?companyId=...
            └─ POST /api/invoice/invoices/[id]/send { email }
                 └─ existing CAP-001 backend
                      ├─ mail abstraction
                      ├─ privacy-safe tracking token handling
                      └─ best-effort CAP-006 memory record
```

### Target files

Preferred minimal shape:

- Update `packages/core/src/modules/invoice/backend/invoice/all/[id]/page.tsx`
  to expose typed detail reload and mount the AR-only panel.
- Add
  `packages/core/src/modules/invoice/backend/invoice/components/InvoiceSendPanel.tsx`.
- Add
  `packages/core/src/modules/invoice/backend/invoice/components/InvoiceSendDialog.tsx`.
- Add an invoice-local recipient wrapper only if `ComboboxInput` cannot support
  the remove affordance cleanly.
- Update `packages/core/src/modules/invoice/i18n/*.json`.
- Add
  `packages/core/src/modules/invoice/__integration__/TC-INV-004-send-company-email-memory.spec.ts`.

The implementer may combine the two small components if that produces a simpler
file without making the detail page harder to read. Do not create global state,
new backend routes, or a new reusable UI primitive in this issue.

### UI data access

- All requests use `apiCall`; never raw `fetch`.
- All DELETE and POST requests run through `useGuardedMutation`.
- Send builds the optimistic-lock request header from the current invoice
  `updatedAt`. A 409 is handled with the shared record-conflict surface; after
  resolution/reload, the user may retry with the current record version.
- Keep the invoice detail `load()` callback as the authoritative refresh path.
- Ignore stale async results after dialog/page unmount.
- Do not poll for open tracking in this issue. `openedAt` is displayed whenever
  a normal detail load provides it. A future event/polling requirement needs a
  separate product decision.

## Data Models

No schema or persistence changes.

Existing fields consumed by UI:

| Source | Field | UI use |
| --- | --- | --- |
| Invoice detail | `id` | Send URL |
| Invoice detail | `direction` | AR-only eligibility |
| Invoice detail | `companyId` | CAP-006 list/delete scope |
| Invoice detail | `updatedAt` | Optimistic-lock header |
| Invoice detail | `lastSentAt` | Sent/resend state |
| Invoice detail | `openedAt` | Open-tracking display |
| Company email DTO | `id` | Delete URL |
| Company email DTO | `companyId` | Scope verification/context |
| Company email DTO | `email` | Suggestion value |
| Company email DTO | `updatedAt` | Backend ordering evidence only |

The frontend must never model a raw tracking token. It only consumes the two
safe timestamps returned by Invoice Core.

## API Contracts

### List remembered recipients

```http
GET /api/invoice/company-emails?companyId=<uuid>
```

```json
{
  "items": [
    {
      "id": "<uuid>",
      "companyId": "<uuid>",
      "email": "accounts@example.com",
      "updatedAt": "2026-09-14T03:42:00.000Z"
    }
  ]
}
```

Use `invoice.manage`. Empty items are a valid state. A load failure does not
block manual entry; show a non-blocking translated message and a retry action.

### Remove remembered recipient

```http
DELETE /api/invoice/company-emails/<emailId>?companyId=<uuid>
```

Expected success: `{ "ok": true }`. On success, remove the row locally or
reload the list. On failure, preserve it and show translated failure feedback.

### Send invoice

```http
POST /api/invoice/invoices/<invoiceId>/send
Content-Type: application/json
x-om-ext-optimistic-lock-expected-updated-at: <current updatedAt>

{ "email": "accounts@example.com" }
```

Expected success: `{ "ok": true, "invoice": <InvoiceDetailDto> }`.

The UI must not depend only on the returned invoice. It calls the existing
detail reload after success so send/open state stays backend-authoritative.

## Browser Test Plan

Use Playwright route interception for focused UI behavior, following the
existing `TC-INV-003-ui-parity.spec.ts` style. Provide a complete AR detail
fixture including `companyId`, `updatedAt`, line arrays, and send-state fields.
Tests must use role/label locators and must not depend on seeded data.

1. **Remembered-recipient selection**
   - Detail returns eligible AR invoice.
   - Company-email GET returns two addresses in MRU order.
   - Open dialog, select the second address, submit.
   - Assert send POST body contains only the selected trimmed email.
   - Assert detail and recipient-memory GET are requested again after success.

2. **Manual recipient**
   - Company-email GET returns no items.
   - Enter a valid custom email and submit.
   - Assert the send endpoint receives the custom email.
   - Assert no frontend POST is made to `/api/invoice/company-emails`; CAP-001
     owns recording after delivery.

3. **Successful send and authoritative refresh**
   - Initial detail has null `lastSentAt` and `openedAt`.
   - Send succeeds.
   - Refreshed detail returns `lastSentAt` and later an `openedAt` value.
   - Assert success feedback, closed dialog, **Resend invoice**, and localized
     sent/open status are visible.

4. **Invalid recipient**
   - Enter malformed input and submit by button and keyboard.
   - Assert inline validation is visible and focused/associated with input.
   - Assert no request reaches the send endpoint.

5. **Send failure**
   - Send endpoint returns a safe 4xx/5xx error.
   - Assert the dialog stays open, input value remains, error is shown, and
     controls become enabled for retry.
   - Retry with a successful response and assert the normal success refresh.

Add two low-cost assertions inside the same suite:

- AP detail never shows send/resend and never requests company emails.
- Removing a remembered email calls the exact CAP-006 DELETE URL and removes or
  refreshes the suggestion without sending the invoice.

## Stepwise Implementation

1. Refactor the current detail page type/load block into readable multiline
   code without changing existing invoice rendering behavior.
2. Add typed API response shapes for company email list, removal, and send at
   the UI boundary.
3. Build the AR-only status panel from existing `lastSentAt`/`openedAt` fields.
4. Build the accessible send dialog and recipient combobox.
5. Add guarded delete and send mutations, optimistic-lock handling, and safe
   loading/error state transitions.
6. On successful send, refresh invoice detail and recipient suggestions, then
   render backend-derived state.
7. Add complete translation keys to every invoice locale.
8. Add the focused browser suite and keep existing invoice UI scenarios intact.
9. Review the final diff for raw tokens, raw `fetch`, hard-coded strings/colors,
   AP exposure, and duplicate recipient persistence.

## Error Handling and Retry

| Failure | Behavior | Retry |
| --- | --- | --- |
| Company-email GET fails | Manual input stays usable; show non-blocking error | Retry list action or reopen dialog |
| Invalid email | Inline field error; no POST | Edit value and resubmit |
| Send 409 conflict | Use shared record-conflict UX and reload current invoice | Resubmit against fresh `updatedAt` |
| Send 400/403 | Show safe translated/server message; preserve email | Correct input/permission, retry |
| Send 5xx/network | Keep dialog open and controls recoverable | Same submit action retries |
| Delete fails | Keep suggestion; show feedback | Repeat remove action |
| Detail refresh fails after delivered send | Keep success feedback but state panel reports refresh issue | Retry detail load; never resend automatically |

No automatic retry is allowed for the send POST because delivery may already
have happened. Only an explicit user action may send again.

## Monitoring and Logging

- Frontend code must not log recipient email, request bodies, or tracking data.
- Rely on the existing server-side structured invoice logs and mail abstraction
  for delivery diagnosis.
- UI errors should expose safe messages only, with no raw backend stack/error.
- Browser tests verify request count and body shape to detect accidental double
  sends or duplicate memory writes.
- A delivered send followed by detail-refresh failure must be distinguishable
  in the UI so the user does not assume delivery failed.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| Double send from repeated submit | High | Customer email | Disable controls while pending; no automatic POST retry | Network ambiguity remains possible |
| AP send action appears | High | Business behavior | Direction guard in render and browser assertion | Backend already rejects AP |
| Stale detail overwrites send state | Medium | UI accuracy | Reload authoritative detail after send | Refresh can fail independently |
| Duplicate frontend memory persistence | Medium | CAP-006 ordering | Never POST memory from UI; send service records it | Server best-effort record may fail |
| Recipient data leaks across company/scope | High | Privacy | Use invoice `companyId`; API enforces tenant/org scope | UI must avoid caching globally |
| Combobox deletion harms keyboard UX | Medium | Accessibility | Reuse shared combobox behavior; role/label tests | Per-row action may need careful focus handling |
| Raw token reaches frontend | High | Security/privacy | DTO contains timestamps only; no token type/state | None expected with current API |

## Final Compliance Report

Implementation status: implemented, pending validation and review.

- Existing CAP-001 send and tracking contracts are reused unchanged.
- Existing CAP-006 company email memory is reused unchanged.
- No database migration or new production dependency is planned.
- Operis UI rules are included: `apiCall`, guarded writes, optimistic locking,
  shared primitives, i18n, semantic tokens, and accessible dialog keyboard UX.
- Required browser coverage is specified, including the five requested flows.
- Validation, review, deployment, and merge evidence remain pending.

## Changelog

- 2026-09-14: Created implementation-ready UX migration specification from the
  legacy PCA ERP invoice detail, send panel, recipient field, and hooks, aligned
  with the current Operis CAP-001/CAP-006 APIs and design-system rules.
- 2026-09-14: Implemented the AR-only detail send panel, remembered-recipient
  dialog and removal flow, guarded optimistic-lock send integration,
  backend-derived sent/open state, translations, and focused browser coverage.
