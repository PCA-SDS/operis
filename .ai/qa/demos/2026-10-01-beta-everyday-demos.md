# Beta everyday-use demos

Scripted walkthroughs a beta client would actually perform. Each demo is run by
hand in the local dev app; findings are recorded at the bottom.

Accounts use the dev seed password (`OM_DEV_SEED_PASSWORD`, see README).

## Demo 1 — Onboarding a new client (platform super-admin)

Actor: `superadmin@operis.local`

1. Sign in, open Directory → Tenants, create tenant **Bloom Bakery**.
2. Create its root organization **Bloom Bakery HQ**.
3. Create the client's administrator `owner@bloom.test` with role `admin`, scoped to Bloom Bakery.
4. Create a staff member `baker@bloom.test` with role `employee`.
5. Sign out. Sign in as `owner@bloom.test` and confirm the workspace is empty and
   belongs to Bloom Bakery only (no Operis / Company A / Company B data).

## Demo 2 — Setting up and working the customer book (client admin)

Actor: `owner@bloom.test`

1. Create company **Corner Café Ltd** and contact **Sam Patel** linked to it.
2. Add a note, a follow-up, and a phone number; edit the contact's status.
3. Search for "Sam" from global search and from the People list.
4. Create a bookable service **Custom cake consultation** and book Sam in for it.
5. Open the calendar and confirm the appointment shows.

## Demo 3 — Task management across two people

Actors: `owner@bloom.test` then `baker@bloom.test`

1. Owner creates project **Wedding season** and adds the baker as a member.
2. Owner creates three tasks with due dates, assigns two to the baker, one high priority.
3. Owner comments on a task mentioning the baker.
4. Baker signs in, finds the tasks under My Tasks / Today, comments back, completes one.
5. Owner sees the change (task status, notification).

## Demo 4 — Team chat

Actors: `owner@bloom.test` and `baker@bloom.test`

1. Owner starts a direct chat with the baker and sends a message.
2. Owner creates a space **Kitchen** and adds the baker.
3. Baker sees the unread badge, reads, replies in both.
4. Owner sees the reply and the unread count clears after reading.

## Findings

Recorded in the run log below as they are found: severity, where, what happened,
expected.

### Run 2026-10-01 (local dev, branch `qa/all`)

| # | Sev | Demo | Where | What happened | Expected |
|---|---|---|---|---|---|
| 1 | Blocker | 1 | Directory → Tenants → Create | A tenant created in the UI gets **no roles** and no module setup; `setupInitialTenant` (`auth/lib/setup-app.ts:259`) runs only from the CLI, `seed:dev` and self-service onboarding verify | Creating a client prepares it (default roles, module defaults) |
| 2 | Blocker | 1 | Users → Create | Assigning `admin` to the new client's owner fails: `Role(s) not found: "admin"` | Owner can be made admin |
| 3 | High | 1 | Roles API/UI | Re-creating `admin` by hand fails: `Role name is reserved`. Workaround: an `owner` role with the admin feature list copied (128 features) | Super-admin can provision the standard roles |
| 4 | Low | 1 | Organizations → Create | Before a tenant is picked, Parent/Children list the *current* tenant's orgs (Operis) | Empty until a tenant is chosen |
| 5 | Medium | 1 | Users → Create | Password policy minimum is 6 characters | Stronger default for a password-only (no MFA) system |
| 6 | Low | 1 | Users → Create | Roles is a free-text tag box; nothing shows when the tenant has no roles, so the failure only appears on submit | Pick-list of the tenant's roles, empty-state hint |
| 7 | High | 2 | Every customer dictionary (status, lifecycle, source, industry, tier…) | Empty for a UI-created tenant (same root cause as #1); every dropdown on company/person forms is blank | Seeded defaults |
| 8 | Medium | 2 | Person form phone | Default country is **+1**; a UK number `07700 900456` is stored as `+1 07700 900456`, `phoneCountryCode` null | Default from org/locale; parse national format |
| 9 | Low | 2 | Appointment form phone | Default country is **+84** — differs from the person form (+1) | One consistent default |
| 10 | Medium | 2 | Company detail | "ACTIVE DEALS: PLN 0" tile shown although deals are out of v1 scope; currency defaults to PLN | Tile hidden with deals; currency from tenant |
| 11 | Low | 2 | Company form | Website `cornercafe.test` rejected "Invalid URL" | Auto-prefix `https://` |
| 12 | Low | 2 | Inline "Add status" dialog | Focus stays on the select behind the dialog; the new value is saved but not selected | Focus moves into dialog; new value selected |
| 13 | Low | 2 | Person save | No confirmation toast after Save | Brief success feedback |
| 14 | Medium | 2 | Global search | Shows "Search requires configuring an embedding provider for semantic search" to an ordinary client user | Hide operator-only config message |
| 15 | Low | 2 | Product form | Hint says "Define tax classes under Sales → Configuration" — the admin role cannot open Sales | Hint that matches the user's access |
| 16 | Low | 2 | Product type | "Bundle (Coming soon)", "Grouped (Coming soon)" visible | Hide unfinished options |
| 17 | High | 2 | Appointment create | Required **Referral** has no options for a new tenant and no inline add; "Manage dictionaries" navigates away and loses the form; the dictionary page has no way back despite `returnTo` | Inline add, or a working return |
| 18 | High | 2 | Appointment create | Referral selected on the form is **discarded**: stored `customerSource: null`, customer's `source` still null | Value persisted |
| 19 | Low | 2 | Appointment detail | Origin shows raw code `local` instead of label | Localised label |
| 20 | Medium | 2 | Customers calendar | Appointments never appear — the calendar only queries `/api/customers/interactions` | Bookings on the calendar |
| 21 | Low | 2 | Booking Overview vs Calendar | "Today" is Sep 30 on Booking Overview and Oct 1 on the calendar (browser GMT+8) | One timezone basis |
| 22 | Info | 2 | Appointment create | Booking types include Zalo; origin is Local/Tourist/Expatriate — market-specific (TPS) for every tenant | Per-tenant configuration |
| 23 | High | 3 | Task comment box (`tasks/components/RichText.tsx`) | The editor reports its value **only on blur**, so the **Comment** button stays disabled while typing; clicking it first only blurs the editor. Enter does post | Button enabled as soon as there is text |
| 24 | Medium | 3 | New project / New task dialogs | Cmd/Ctrl+Enter does not submit (AGENTS.md: every dialog must) — CrudForm pages do | Shortcut works |
| 25 | Medium | 3 | Task comments | No @mentions in comments (only in Quick add) — board issue #55 | Mention + notify |
| 26 | Medium | 3 | Task status changes | Reporter/reviewer gets no notification when the assignee starts or completes a task — board issue #56 | Status-change notifications |
| 27 | Low | 3 | Task detail | "Created Sep 30" while the browser's date is Oct 1 (UTC vs local, same as #21) | Local date |
| 28 | Low | 3 | Employee dashboard | Copy says "your admin start page" for an employee | Role-neutral copy |
| 29 | Info | 1 | User roles | Owner ended up with `owner,employee`; could **not** reproduce with a fresh user (got `owner` only) — likely a test-driving artefact | — |

### What worked end to end

- Tenant → organization → users created by a super-admin; client users see only their own tenant's data, members and chat directory.
- Login/logout, role-assigned notification, dashboard empty states.
- Company and person create/edit, call logging, Mark done, full-text search (Sam found).
- Service product → appointment for a returning customer; staff get an in-app notification.
- Project with members, Quick add parsing (`@ben p1 friday` → assignee, Urgent, due Friday), task list per assignee, comments, start/complete.
- Direct chat and a space: delivered, unread badges (2), read clears to 0.
