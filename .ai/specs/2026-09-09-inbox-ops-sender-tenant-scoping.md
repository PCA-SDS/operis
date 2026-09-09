# inbox_ops inbound-sender resolution: tenant scoping and hash matching

**Status:** implemented, pending review sign-off on the attribution change (§4).
**Origin:** `.ai/analysis/2026-09-09-consistency-audit.md` — `sec-tenancy`, medium.
**Touches:** `packages/core/src/modules/inbox_ops/lib/messagesIntegration.ts`

## 1. What was wrong

`resolveMessageSenderUserId` looked the inbound sender up by email with no tenant
predicate:

```ts
await db.selectFrom('users').select('id')
  .where('email', '=', normalizedEmail)
  .where('deleted_at', 'is', null)
  .executeTakeFirst()
```

`users` is `UNIQUE (tenant_id, email_hash)`, not globally unique
(`docs/architecture/multi-tenancy.md` §3.5), so the same address may legitimately
exist in two tenants. The returned id was written as `messages.sender_user_id`
inside the *receiving* tenant, and the messages list resolves sender identity by
id with no tenant filter (`messages/api/route.ts:357-366`), so a foreign tenant's
user name and email could render to this tenant's staff.

The function already received `scope` and did not use it.

## 2. Reachability, precisely

The disclosure required tenant data encryption to be **off**. With it on,
`users.email` is ciphertext with a per-row IV, so the plaintext comparison matched
nothing and the function always fell through to `recipientUserIds[0]`. That is
also why the bug was invisible: on an encrypted deployment the lookup was dead
code.

## 3. The change

```ts
findOneWithDecryption(em, User, {
  $or: [{ email: normalizedEmail }, { emailHash: { $in: emailHashLookupValues(normalizedEmail) } }],
  tenantId: scope.tenantId,
  deletedAt: null,
}, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId })
```

Two things at once, deliberately:

- **`tenantId: scope.tenantId`** — the security fix. Closes the cross-tenant read
  on unencrypted deployments.
- **`emailHash` matching** — matches `auth/commands/users.ts:228`, the canonical
  duplicate-check. Without it the lookup stays dead on every encrypted
  deployment, i.e. the tenant predicate alone would guard a query that never runs.

## 4. The consequence a reviewer must sign off on

On encrypted deployments the sender lookup **starts working**. Inbound mail whose
`From` matches a user in the receiving tenant will now be attributed to that
user instead of falling through to `recipientUserIds[0]`.

- Existing rows are **not** backfilled. `messages.sender_user_id` for historical
  inbound mail keeps the old fallback value, so attribution is inconsistent
  either side of this change.
- No backfill is proposed here: the correct historical sender is not recoverable
  from the stored row (the original `From` lives on the `InboxEmail`, but
  re-deriving it per message is a migration with its own tenant-scoping risk).

### Why this does not widen access

`sender_user_id` is used as an **ownership restriction**, not a grant. The
representative check is `messages/commands/attachments.ts:39`:

```ts
if (message.senderUserId !== scope.userId) throw new Error('Access denied')
```

A different value can only ever *deny* a caller who would otherwise pass, never
admit one who would not. Combined with the new tenant predicate the value is now
always a user inside the receiving tenant, which is strictly narrower than
before. The attachment path additionally requires `isDraft`, which inbound mail
is not.

The change is therefore an attribution-accuracy change, not a privilege change.

## 5. Coverage

`packages/core/src/modules/inbox_ops/lib/__tests__/messagesIntegration.test.ts`
(7 cases, rewritten — the previous suite mocked the Kysely builder this no longer
uses):

- the lookup carries `tenantId` and `deletedAt: null`
- it matches on `emailHash` as well as plaintext
- the address is normalised before lookup
- the three fallbacks (`recipientUserIds[0]`, `SYSTEM_USER_ID`, throw) still hold

Not covered: an end-to-end two-tenant inbound-email test. That needs the
integration harness and two tenant fixtures — see `.ai/qa/AGENTS.md`.

## 6. Changelog

- 2026-09-09 — implemented. Tenant predicate + hash matching landed together;
  §4 flagged for review sign-off.
