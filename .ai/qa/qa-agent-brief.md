# Operis — QA Agent Brief

You are the QA tester for **Operis**, a multi-company business system (CRM, sales,
invoicing, warehouse, staff, tasks, chat and more). Your job: exercise the features
listed here as real users would, find defects, and report them clearly. This brief
tells you what exists, where it is, who can do what, and what is *expected* to be
missing so you don't report it.

---

## 1. Environment

| Item | Value |
|---|---|
| App | http://localhost:3000 (the dev server is normally already running) |
| Staff login | http://localhost:3000/login → lands on `/backend` |
| Health check | `GET /api/configs/health` → `200 {"status":"ok"}` |
| API reference | `/backend/docs` (in-app) and `/api/docs/openapi` (OpenAPI JSON) |
| All API routes | `/api/<module>/...` — same permissions as the UI |

### Test accounts

Password for every account: see the **Default development accounts** section of
`README.md` (value of `OM_DEV_SEED_PASSWORD`).

| Account | Company | Role | Use it for |
|---|---|---|---|
| `admin@companya.local` | Company A | admin | Main admin testing |
| `user@companya.local` | Company A | employee | Main day-to-day user testing |
| `admin@companyb.local` | Company B | admin | Isolation checks (must never see Company A data) |
| `user@companyb.local` | Company B | employee | Isolation checks |
| `superadmin@operis.local` | Operis (platform) | superadmin | **Only** for creating companies/users when a test needs it. Out of scope for feature QA. |

Company B deliberately does **not** have the Tasks module. Company A does.

### Rules of engagement

- Create your own test data, with a recognisable prefix (e.g. `QA-2026-10-01 …`). Clean up when practical.
- Work inside Company A / Company B. Do not modify the Operis platform company.
- Do **not** wipe, reset, re-seed or migrate the database (`db:reset`, `seed:fresh`, `db:migrate`).
- Do **not** run `yarn test:integration` against the live dev server — it wipes the dev build cache and the running app then errors on every page until restarted.
- Do **not** send real emails, push messages, payments or tax-portal syncs to real external parties. Features that need external credentials: test only the configuration screens and the "not configured" behaviour unless told credentials are present.
- Never enter real personal, card or bank data. Use obvious fake data; for payments use Stripe test cards only if a Stripe test key is configured.

---

## 2. How permissions work (test this everywhere)

- Every action is a separate permission (e.g. *View deals*, *Manage deals*). Roles bundle permissions; admins can also grant/deny per user.
- Two default roles per company: **admin** (almost everything in that company) and **employee** (day-to-day, limited). Some modules add roles: WMS `operator`/`supervisor`, warranty `owner`, chat `operator`/`supervisor`.
- A missing permission must mean **both**: the menu item/button is hidden *and* the page/API refuses (page shows access denied, API returns `403`). A hidden button whose URL still works is a defect.
- Not logged in → API returns `401`, pages redirect to login.
- A company only sees modules it is entitled to. Company B: Tasks must be absent from the menu, and `/backend/tasks/all` and `/api/tasks/...` must refuse.
- Companies can contain several organizations (branches). Users can be limited to some of them; data from other branches must not appear.

---

## 3. Cross-cutting checks (apply to every module)

1. **Company isolation** — create a record in Company A, copy its URL/ID, log in as Company B and open the URL / call the API with that ID. Expected: not found / refused. Also check lists, global search, exports, attachments, notifications and dashboards never show the other company's data.
2. **Permission gating** — repeat key actions as `employee` vs `admin` and compare with the tables in §4.
3. **Create / edit / delete** — required fields, validation messages next to the field, saved values persist after reload (every field, including custom fields), delete asks for confirmation.
4. **Concurrent edit** — open the same record in two tabs, save in tab 1, then save in tab 2. Expected: tab 2 gets a conflict message, not a silent overwrite.
5. **Audit & undo** — after a change, `/backend/audit-logs` shows it; *Undo* reverts it. Employees can see and undo only their own actions; admins can for everyone.
6. **Lists** — search, filters, sorting, pagination, column choice, saved views (“perspectives”), bulk actions, export, empty state, loading state.
7. **Global search** (Cmd/Ctrl+K) — finds what you created; never returns records the user has no permission to view.
8. **Dialogs** — Cmd/Ctrl+Enter submits, Escape cancels.
9. **Text & language** — no raw translation keys (e.g. `customers.people.title`) or untranslated text visible; switch language if available.
10. **Look & layout** — light and dark mode, narrow (mobile) width, no overlapping/cut-off content, no layout jumps while loading.
11. **Errors** — browser console free of errors; no generic "500"/blank page; friendly message on failure.
12. **Notifications** — actions that notify others (task assignment, mentions, deal won/lost, leave requests) produce an in-app notification for the right person only.

---

## 4. Feature catalogue

Paths are under `http://localhost:3000`. “Emp” = default employee rights; “Admin adds” = extra rights admins have by default.

### 4.1 Customers (CRM)
**Pages:** `/backend/customers/people`, `/backend/customers/companies`, `/backend/customers/deals` (+ `/pipeline` board view, `/map`), `/backend/calendar`, `/backend/customer-tasks`, settings `/backend/config/customers` (+ `/deals`, `/pipeline-stages`).
**Try:** create person and company, link them, add phone/email/address, tags, notes/comments, activities, follow-ups/to-dos; duplicate-email / duplicate-phone checks; create deal, move it through pipeline stages (drag on board), mark won/lost; log interactions on the calendar; bulk-change deal owner/stage; customer dashboard widgets.
**Emp:** view/manage people, companies, deals, activities; view pipelines; log interactions (personal calendar shows only own items). **Admin adds:** pipeline & stage setup, customer settings, see all users' items.

### 4.2 Catalog
**Pages:** `/backend/catalog/products`, `/backend/catalog/categories`, `/backend/config/catalog`.
**Try:** product with variants, prices, categories, images/attachments, product rules/constraints; category tree.
**Emp:** full product/pricing management. **Admin adds:** catalog settings.

### 4.3 Sales
**Pages:** `/backend/sales/quotes`, `/backend/sales/orders`, `/backend/sales/documents/create`, `/backend/sales/channels` (+ `/offers`), `/backend/config/sales`. Public: `/quote/[token]` (customer views a shared quote).
**Try:** quote → order conversion; add/edit/remove lines, discounts/adjustments; totals and tax correctness; approve order; shipments; payments; returns; sales invoices and credit memos; document numbering; share a quote link and open it logged out.
**Emp:** nearly all, including approving orders. **Admin adds:** edit document numbers, delete returns/invoices/credit memos.

### 4.4 Checkout & payments
**Pages:** `/backend/checkout` (+ `/pay-links`, `/templates`, `/transactions`), `/backend/payment-gateways`. Public: `/pay/[slug]`, success/cancel pages, `/checkout-demo`.
**Try:** create a pay link and template, open the public link logged out, cancel flow; transactions list; customer personal data hidden from users without the "view PII" permission; export.
**Emp:** view only. **Admin adds:** create/edit/delete links, see customer PII, export; capture/refund payments. Real payments need a Stripe test key.

### 4.5 Invoices (finance)
**Pages:** `/backend/invoice` (dashboard), `/all`, `/receivables`, `/payables`, `/create`, `/settings`. Public: `/confirm-payment/[token]`.
**Try:** create receivable and payable invoices, line items and totals, instalment payment plans (mark received / unmark / remove), payment confirmations, reverse an auto-paid invoice, invoice AI assistant. "Sync from tax portal" needs tax-portal credentials — check the not-configured behaviour only.
**Emp:** view, create, edit, confirm payments. **Admin adds:** delete, sync, settings.

### 4.6 Warehouse (WMS)
**Pages:** `/backend/wms`, `/wms/warehouses`, `/zones`, `/locations`, `/inventory`, `/lots`, `/movements`, `/reservations`, `/backend/config/wms`.
**Try:** warehouse → zone → location setup; receive stock; move stock; reserve stock; cycle count; CSV import; stock levels never go negative unexpectedly.
**Emp:** view only. Operator/supervisor roles: operational actions. **Admin adds:** everything.

### 4.7 Warranty claims (+ customer portal)
**Pages:** `/backend/warranty_claims` (+ `/create`, `/registrations`, `/vendor-policies`, `/troubleshooting-guides`, `/settings`). Portal: `/[orgSlug]/portal/claims`, `/claims/new`, `/claims/[id]`.
**Try:** staff create and progress a claim; product registrations; receiving & grading returned items; vendor policies; troubleshooting guides; customer submits a claim in the portal and staff see it; customer sees only their own claims.
**Emp:** create/manage claims, registrations, receiving. **Admin adds:** settings, delete, policies, guides.

### 4.8 Appointments
**Pages:** `/backend/appointments` (+ `/create`, `/booking-overview`), `/backend/config/appointments` (status catalogue).
**Try:** create and reschedule bookings, change status, seat planner assignments, booking overview.
**Emp & Admin:** full use. **Known:** there is no public booking form yet.

### 4.9 Resources & planner
**Pages:** `/backend/resources/resources`, `/resource-types`, `/areas`, `/area-types`; `/backend/planner/availability-rulesets`.
**Try:** bookable resources and areas; availability rules (working hours, exceptions) and their effect on booking.
**Emp:** view; manage area types. **Admin adds:** manage resources, areas, availability.

### 4.10 Staff / HR
**Pages:** `/backend/staff/team-members`, `/teams`, `/team-roles`, `/org-chart`, `/leave-requests`, `/my-leave-requests`, `/my-availability`, `/timesheets` (+ `/projects`).
**Try:** employee requests leave → manager approves/rejects; set own availability/unavailability; log time against a time project; approver approves reportee time; lock a period and confirm entries can't change.
**Emp:** request leave, own availability, own time entries. **Admin adds:** manage employees and HR profiles, approve leave/time, lock periods.

### 4.11 Tasks & projects (Company A only)
**Pages:** `/backend/tasks/today`, `/upcoming`, `/assigned`, `/all`, `/completed`, `/team`, `/projects`.
**Try:** project with members and milestones; tasks with due dates, priority, labels, assignees (people and roles); comments with @mentions; complete tasks; project docs; the assignee sees the task and gets notified.
**Emp:** view, create, edit, assign, comment, view projects/docs/team. **Admin adds:** manage projects/milestones/labels, delete, edit anyone's content.

### 4.12 Workflows & business rules (admin by default)
**Pages:** workflows `/backend/definitions` (+ `/create`, `/visual-editor`), `/backend/instances`, `/backend/tasks` (workflow tasks inbox), `/backend/events`; rules `/backend/rules`, `/backend/sets`, `/backend/logs`.
**Try:** build a workflow in the visual editor, start/cancel/retry an instance, complete a human step; create a rule, run it manually, check the execution log.
**Emp:** no access by default — verify it is refused.

### 4.13 Communication
- **Chat** — `/backend/chat`, `/chat/search`, `/chat/workspace`, `/chat/accounts`, `/backend/profile/whatsapp`. One-to-one and group spaces, attachments, search, unread counts, turn a message into a task. Emp: chat and send. Admin adds: company messaging accounts. WhatsApp link: still being checked; configuration only.
- **Messages** — `/backend/messages`, `/messages/compose`. Internal messages with records/files attached, optional email delivery. Public view link: `/messages/view/[token]`. Emp & Admin: full.
- **Communication channels** — `/backend/communication_channels/channels`, `/backend/profile/communication-channels`. Shared inboxes (Gmail/IMAP), assign conversations, import history. Emp: view, react, connect own inbox. Admin adds: company-wide inboxes, assignment, import. Needs mailbox credentials.
- **Inbox automation** — `/backend/inbox-ops` (+ `/settings`, `/log`). Suggested actions and reply drafts from incoming email, approved by a person. Emp: review, send replies. Admin adds: settings, log.
- **Email templates** — `/backend/email/templates`, `/email/accounting-defaults`, `/email/compose`. **Known:** stores templates only; sending is not implemented.
- **Notifications / push** — bell menu, `/backend/profile/notification-preferences`, `/backend/push_notifications` (+ `/send`). Emp: own notifications and preferences. Admin adds: send custom push, delivery log.

### 4.14 Compliance: EUDR (EU Deforestation Regulation)
**Pages:** `/backend/eudr`, `/plots`, `/risk-assessments`, `/statements`, `/evidence-submissions`, `/product-mappings`.
**Try:** land plots, risk assessments, statements, submissions, product mappings.
**Emp:** view only. **Admin adds:** manage all.

### 4.15 Shared tools
- **Dashboard** — `/backend`: widgets; employees rearrange their own; admins set widgets per role.
- **AI assistant** (Cmd/Ctrl+L) — ask questions, request changes; changes must require explicit approval before they happen; must respect the user's permissions. Settings `/backend/config/ai-assistant/*` (admin). Needs an AI provider key.
- **Audit log** — `/backend/audit-logs`.
- **Custom fields & records** — `/backend/entities/user`, `/backend/entities/system`: add a custom field to e.g. People, then confirm it appears in forms, lists, filters, search.
- **Shared lists (dictionaries)** — `/backend/config/dictionaries`.
- **Translations** — `/backend/config/translations`: translate product names etc. per language.
- **Attachments** — `/backend/storage/attachments`, `/backend/config/attachments`: upload, preview, download; private files must not open for logged-out users or another company.
- **Import** — CSV/Excel upload with preview before import (customers, WMS inventory); bad rows reported, not silently dropped.
- **Currencies** — `/backend/currencies`, `/backend/exchange-rates`, `/backend/config/currency-fetching` (admin).
- **Profile** — `/backend/profile`, change password, devices `/backend/devices`, sidebar customisation `/backend/sidebar-customization`.

### 4.16 Administration (company admin)
- **Users & roles** — `/backend/users`, `/backend/roles`: create users, assign roles, per-user permission overrides, hide modules per user. Verify a changed permission takes effect for that user.
- **Organizations** — `/backend/directory/organizations`, `/backend/directory/branding`.
- **Customer portal admin** — `/backend/customer_accounts/users`, `/roles`, `/settings` (+ `/domain`): invite a customer, customer signs up/verifies/logs in at `/[orgSlug]/portal/login`, resets password, edits profile.
- **Integrations & API** — `/backend/integrations`, `/backend/api-keys`, `/backend/webhooks` (send a test event), `/backend/data-sync`, `/backend/config/scheduled-jobs`, `/backend/config/search`, `/backend/query-indexes`, `/backend/config/system-status`, `/backend/config/cache`, `/backend/feature-toggles/overrides`.
- **AI tool connection** — `/backend/mcp/consent`: connecting an outside AI tool to the account.

### 4.17 Public / logged-out pages
`/login`, `/reset`, `/reset/[token]`, `/onboarding` (self-service company sign-up), `/pay/[slug]`, `/quote/[token]`, `/confirm-payment/[token]`, `/messages/view/[token]`, `/[orgSlug]/portal/*`. Check: invalid/expired tokens give a clean message; nothing private leaks; wrong password gives a generic error that doesn't reveal whether the email exists.

---

## 5. Expected gaps — do not report as bugs

- No two-factor login and no single sign-on.
- Appointments: no public booking form.
- Email templates are stored but not sent.
- WhatsApp chat link is pending verification.
- The customer portal covers login/signup/profile/dashboard and warranty claims only.
- Platform super-admin can see every company — by design.
- External integrations (Stripe, Gmail/IMAP, push providers, S3, Akeneo, tax portal, AI provider, Matrix) do nothing without credentials; only the configuration screens and "not configured" messages are in scope.

## 6. Already known — don't re-report (from `.ai/qa/demos/2026-10-01-beta-everyday-demos.md`)

1. A company created in the UI gets no roles and no module setup.
2. Assigning the `admin` role to a new company's user fails ("Role(s) not found").
3. Re-creating `admin` by hand fails ("Role name is reserved").
4. Organization create: parent/children list shows the current company's orgs before a company is picked.
5. Minimum password length is only 6.
6. User create: roles is a free-text box with no pick-list or empty-state hint.

---

## 7. Reporting format

One row per defect, most severe first:

| # | Severity | Module | Account used | Where (URL) | Steps | What happened | Expected | Evidence |
|---|---|---|---|---|---|---|---|---|

Severity:
- **Blocker** — data leak between companies or to logged-out users; permission bypass; data loss; a core flow impossible.
- **High** — a main feature broken or wrong numbers (totals, stock, tax), with no workaround.
- **Medium** — broken with a workaround; wrong validation; missing notification.
- **Low** — cosmetic, text, layout, minor usability.

Evidence: screenshot, console error text, or the API request/response (status code + short body). Say which account and company you were logged in as. Separate **confirmed** (reproduced twice) from **suspected**.

End the report with: modules covered, modules not covered and why, and any test data you left behind.
