# Chat Attachment Access

Status: draft — waiting on Q1 and Q2
Modules: `attachments` (the hook), `chat` (the policy)
Related: [`2026-09-10-chat-resource-sharing.md`](2026-09-10-chat-resource-sharing.md), [`2026-09-29-chat-external-participants.md`](2026-09-29-chat-external-participants.md) (Risks: "An outsider's file is as exposed as any chat file"), [`2026-06-09-attachments-scope-invariant.md`](2026-06-09-attachments-scope-invariant.md)

## TLDR

Chat files are served by the generic attachments routes, which check only tenant/organization
scope and scan status. Any signed-in user in the same organization who holds an attachment id
can download a file from a conversation they are not in. A Playwright probe on the Matrix
transport proved this.

The recommended fix adds a **restrictive-only access-policy hook** to `attachments`, keyed by
`entity_id`. Chat registers a policy from its `di.ts` that asks whether the caller is a
participant of the file's conversation. When the policy refuses, the route returns a 404 that
looks exactly like a missing row, on both the file route and the image route. Rows that no
policy claims follow the same code path they follow today.

## Open Questions

- **Q1 — Architecture.** (A) Add an injectable access hook in `attachments` and have chat
  register a policy into it. **Recommended.** (B) Add chat-owned download routes. See
  [Alternatives](#alternatives).
- **Q2 — Scope.** The download routes are not the only way to reach a chat file. By default
  the attachments library also lists every chat file in the organization to every employee,
  including the file's extracted text (see [Other read paths](#other-read-paths)). Should this
  change also close those paths, or should a follow-up spec reuse the hook? **Recommended:**
  keep this change to the file and image routes and open the follow-up now. The follow-up is
  the larger leak for text documents.

## Problem Statement

- Chat stores uploads in the shared `privateAttachments` partition (`CHAT_ATTACHMENT_PARTITION`).
  Each row carries `entity_id` `chat:chat_message` (sent) or `chat:chat_message_draft`
  (staged), and `storage_metadata.chat = { conversationId }` plus exactly one uploader:
  `uploaderUserId` (a colleague) or `uploaderExternalContactId` (an outsider, since #652).
  All three creation paths write that metadata: the multipart upload, direct-upload
  finalisation and the Matrix inbound ingest.
- The transcript and the Shared panel link to `GET /api/attachments/file/{id}` and
  `GET /api/attachments/image/{id}/{variant}`. Both routes authorize only through
  `checkAttachmentAccess` (tenant/org scope + scan status). The attachments module has no
  per-partition or per-row hook.
- Result: a colleague in the same organization who is not a participant gets **200**. A second
  participant can also read someone else's unsent draft, and anyone can read a deleted
  message's file. The resource-sharing spec states the rule this breaks: "Someone who cannot
  read the conversation cannot read its files."
- Chat's rule (`chat/AGENTS.md`) is that a `chat_participants` row is the grant, and a
  non-member gets **404, never 403**.

## Proposed Solution (Option A)

### `attachments`: the hook (no chat code)

New file `attachments/lib/accessPolicies.ts`:

```ts
type AttachmentAccessPolicy = {
  id: string
  entityIds: readonly string[]
  canRead(input: { auth: AuthContext; attachment: Attachment; em: EntityManager; container: AwilixContainer }): Promise<boolean>
}
registerAttachmentAccessPolicy(policy): void             // idempotent by id
isAttachmentHiddenByAccessPolicy(input): Promise<boolean>
```

- **Only restricts.** A policy can take access away from a caller that the base check allows.
  It can never grant access. `checkAttachmentAccess` still runs on every row a policy allows.
- **Only runs on claimed rows.** A policy runs only when the row's `entity_id` is in its
  `entityIds` list. Every other attachment runs no policy code, so their behaviour stays the
  same by construction, not by testing alone. When several policies claim a row, all of them
  must allow it.
- **Errors propagate.** A policy that throws produces a 500, and no bytes are served.
- **Registry on `globalThis`** under `Symbol.for(...)`, the same pattern as the data-sync
  adapters and optimistic-lock readers. A plain module-level `Map` would be unsafe here:
  Turbopack can duplicate a module across chunk groups. Chat would then register into one
  copy while the route reads the other, empty copy, and the check would fail **open**.
- **Placement in both routes:** right after the scoped `findOne`. The line becomes
  `if (!attachment || await isAttachmentHiddenByAccessPolicy(...))`, which returns the
  route's existing not-found response. Running the policy this early matters: a hidden row
  never reaches the image route's 400 unsupported-type check, a 401 or 403, or the 409 scan
  gate, so no later branch can tell a hidden row apart from a missing one.

### `chat`: the policy (no attachments internals beyond the hook)

New file `chat/lib/attachmentAccess.ts` exports `chatAttachmentAccessPolicy`. It claims both
chat entity ids and applies these rules:

- The caller has a subject, and the row carries chat metadata. A row with no chat metadata
  was not made by chat, so it is refused. The subject is checked **before** any lookup:
  `chat_participants.user_id` is nullable, and a missing id compiles to `IS NULL`, which would
  match every outsider's row. `loadParticipant` refuses such a lookup with an internal
  error, and the policy must answer 404 before that point is reached rather than 500.
- **Sent file:** the caller passes `loadSpaceContext` for the metadata's `conversationId`.
  This is the same membership gate chat's commands use: `loadParticipant` for a colleague,
  plus a live conversation. It covers an outsider's file in an external conversation: the
  conversation's colleagues can read it and nobody else can. The message at `record_id` must also exist, be undeleted, and belong to
  that conversation, in the attachment's own tenant and organization. Requiring the metadata
  and the message link to agree means that re-pointing `record_id` (for example with
  `POST /api/attachments/transfer`) cannot move a file into a conversation it was never
  posted to.
- **Draft:** the caller is the uploading colleague (`uploaderUserId`) and is still a
  participant. Drafts are not shared, which matches `getDraftAttachments`. An outsider's draft
  exists only for the moment between ingest and send on the projector path, so no web caller
  can read it.
- Access comes from membership, not privilege. No role, no `attachments.*` grant and no
  superadmin flag opens a file, because every chat route uses the same rule.

`chat/di.ts` calls `registerAttachmentAccessPolicy(...)` as the **first** statement of
`register()`. Module registrars fail open: if a later line throws (for example on an invalid
`OM_CHAT_TRANSPORT`), the loop logs the error and continues. Registering first means the
policy is still in place when that happens.

### Behaviour change: chat rows only

| Caller | File route before → after | Image route before → after |
|---|---|---|
| Participant (sent file) | 200 → 200 | 200 → 200 |
| Same-org non-participant | **200 → 404** | **200 → 404** (400 → 404 for a non-image) |
| Same-org admin or superadmin, not a participant | **200 → 404** | **200 → 404** |
| Participant, message deleted | 200 → 404 | 200 → 404 |
| Another participant, someone's draft | 200 or 409 → 404 | 200 or 409 → 404 |
| Uploader, own draft | unchanged (200, or 409 while scanning) | unchanged |
| Unauthenticated | 401 → 404 | 401 → 404 |

A deleted message's file becomes a 404 for everyone. Every other chat read already filters
`deleted_at is null`, and the Shared panel already hides these files.

## Alternatives

- **(B) Chat-owned routes.** These do not close the hole on their own: the generic routes
  keep serving the file unless `attachments` learns to refuse chat rows, which needs this hook
  anyway or a new partition plus a data migration. They also duplicate security-sensitive byte
  serving (CSP, `nosniff`, `Content-Disposition`, magic bytes, sharp pixel limits, the
  thumbnail cache), or force that code to be extracted. They also change client URLs.
- **API interceptors.** Custom routes support only `after` hooks (core `AGENTS.md` → API
  Interceptors). The gate would be keyed on a URL pattern, would re-read the row, and would
  run for every attachment.

## Other read paths

**Out of scope unless Q2 says otherwise.** None of these check conversation membership:

| Path | Guard | Exposes |
|---|---|---|
| `GET /api/attachments/library` | `attachments.view` (default `employee`) | Every chat file in the org: id, name, size, assignments (message ids), and `content` |
| `GET /api/attachments/library/{id}`, `PATCH`, `DELETE` | `attachments.view` / `attachments.manage` | Read, retag or delete any chat file |
| `GET /api/attachments?entityId=chat:chat_message&recordId=` | `attachments.view` | Files and `content` of a known message |
| `DELETE /api/attachments?id=`, `POST /api/attachments/transfer` | `attachments.manage` | Delete, or re-parent, any chat file |
| AI assistant `resolveAttachmentParts` | tenant/org only | File bytes passed to a model |

The external-participants spec says attachment ids "appear only in membership-gated
responses". The library listing shows that is not true. `content` is the extracted text. `privateAttachments` is seeded with `requiresOcr` from
`OM_DEFAULT_ATTACHMENT_OCR_ENABLED`, which defaults to true, so chat documents uploaded through
the multipart route have their text in the library listing. With the hook in place, each of
these paths needs only a small follow-up. Per-row paths call
`isAttachmentHiddenByAccessPolicy`. List paths exclude rows whose `entity_id` a policy claims.

## Data Models

None, and no migration. The change reads the existing `attachments.entity_id`, `record_id`
and `storage_metadata`, plus `chat_messages`, `chat_participants` and `chat_conversations`.

## API Contracts

`GET /api/attachments/file/{id}` and `GET /api/attachments/image/{id}/{...slug}`: when a
registered policy refuses a row, the route returns its existing 404 body (`Attachment not
found` / `Not found`). The OpenAPI 404 descriptions gain "or hidden from the caller by the
owning module". No URL, request, ACL feature, event, notification type or schema changes, so
nothing in `BACKWARD_COMPATIBILITY.md` is touched.

## Test Coverage

- Unit, `attachments/lib/__tests__/accessPolicies.test.ts`: the policy only restricts; it runs
  only on rows it claims; all policies must allow; re-registering the same id replaces the
  policy; errors propagate; a registration made in one module instance is visible from
  another.
- Unit, `attachments/api/__tests__/{file,image}.route.test.ts`: a hidden row returns 404 with
  the missing-row body, ahead of the 400, 401, 403 and 409 branches; an unclaimed row is
  unchanged.
- Unit, `chat/__tests__/attachmentAccess.test.ts`: every rule above, plus a check that
  `di.ts` registers the policy first.
- Integration, `chat/__integration__/TC-CHAT-013-attachment-access.spec.ts`, on the default
  `local` transport, using real routes and API fixtures:
  - A participant gets 200 with the exact bytes from the file route and a 200 image.
  - A same-org non-participant gets 404 on the file route, the image route, and the image
    route with a non-image file.
  - A same-org admin who is not a participant gets 404.
  - For a draft, the uploader gets 200 and another participant gets 404.
  - Control: a non-chat attachment in the same org still gets 200 for that non-participant.
- Integration, `TC-CHAT-012` (homeserver only): restore the check that a colleague outside
  the conversation gets 404 for an outsider's file. That check was taken out when #652 found
  this leak.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| The policy is not registered when a request arrives, so the check fails open | High | `globalThis` registry; registered first in `register()`; the integration test runs against the production build | Low |
| A policy error returns 500 to members | Medium | Nothing is served; the error surfaces in the framework log | Low |
| Extra queries per chat download | Low | Up to three indexed lookups, on chat rows only | Low |
| The read paths in the Other read paths table stay open | High | Decided by Q2; the hook makes each path a small follow-up | As decided by Q2 |
| Chat is removed from the build, so its old files fall back to organization scope | Low | Recorded here | Low |

## Final Compliance Report

- No chat code in `attachments`, and no cross-module ORM relation.
- Tenant/org scoping is unchanged, and the policy can only narrow access.
- No ACL, event, notification-type or schema change, and no new user-facing strings.
- Docs: add the hook to `attachments/AGENTS.md` (Always/Never) and the policy to
  `chat/AGENTS.md` (Where Things Live).

## Changelog

- 2026-09-29 — Draft with Q1/Q2. Rebased onto main after #652: outsider uploaders,
  `loadParticipant`, integration test renumbered `TC-CHAT-013`.
