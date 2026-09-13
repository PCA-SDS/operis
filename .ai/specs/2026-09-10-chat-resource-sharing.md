# Chat Resource Sharing — Files, Media and Links

Status: in progress
Phase: 5 of the chat module (1 direct messaging, 2 spaces + replies, 3 reactions/mentions/pins, 4 translation)

## TLDR

Attach files to chat messages, preview them in the transcript, and find them
again in a per-conversation Shared panel. Built on the existing `attachments`
module rather than beside it: the storage drivers, quota lifecycle, MIME
sniffing, filename safety and access checks already existed, and the polymorphic
`(entity_id, record_id)` link means a chat attachment needs no new table.

The one genuine gap was malware scanning, which did not exist anywhere in
Operis. It is now a shared, pluggable pipeline on the `attachments` table, so
every module that uploads benefits.

## Problem Statement

Chat had no way to share anything but text. Google Chat is the interaction
reference — attach, preview, send, find later — but the architecture, storage,
permissions and tenant isolation are Operis's own. The guiding rule throughout:
**a file uploaded into chat must never become a shortcut around Operis
authorization.** Someone who cannot read the conversation cannot read its files.

## What already existed, and was reused

The brief's instruction not to build parallel infrastructure was the right one.
`attachments` is a production file system:

| Requirement | Reused |
|---|---|
| Storage abstraction, S3 | `lib/storage.ts`, `lib/drivers/`, `@open-mercato/storage-s3` |
| Temporary upload lifecycle | `AttachmentQuotaReservation` — reserve→storing→stored→committed, lease tokens, expiry, recovery worker |
| MIME sniffing, dangerous extensions | `lib/security.ts` — `detectAttachmentMimeType`, executable blocklist |
| Filename safety, Content-Disposition | `sanitizeUploadedFileName`, `buildAttachmentContentDisposition` |
| Quotas and size limits | `lib/upload-limits.ts`, already centralised and env-driven |
| Image variants, EXIF | `thumbnailCache.ts`, `imageSafety.ts`, the image route |
| Authorization | `checkAttachmentAccess` + `AttachmentTargetAccessService` |
| Upload orchestration | `ScopedAttachmentUploadService` — already used by the warranty-claims **portal** |
| Client upload manager | `uploadAttachmentsForChat` — concurrency, per-file timeouts, abort, typed failures |

Two consequences worth stating. Chat attachments use the existing
`privateAttachments` partition rather than a chat-specific one: it is already
described as "internal attachments scoped to tenants and organizations", which
is exactly what a chat file is, and a new partition would have to be seeded in
every deployment before chat could accept a single upload. And the client uses
the existing upload adapter, so chat's endpoint returns `{ item }` — the shape
that adapter parses — rather than inventing a second response contract.

## Malware scanning

Nothing existed. `Attachment` now carries `scan_status` (`pending` → `clean` |
`infected` | `failed`), `scanned_at` and `scanner`.

- **`clean` is the only readable state.** `failed` is deliberately distinct from
  `infected`: a scanner that could not answer has told us nothing about the
  file, and treating silence as safety is the failure this exists to prevent.
- **The gate runs after authorization.** If it ran first, a caller from another
  tenant would be told "409, still scanning" and learn the file exists. Outsiders
  get 403 whatever the scan says — that is a test.
- **Existing rows were backfilled to `clean`.** They were readable before the
  column existed and are served by catalog, sales, sync_excel, warranty_claims
  and messages today; retroactively quarantining all of them would be an outage,
  not a security improvement.
- **An unconfigured scanner clears everything, and says so.** `inspects: false`
  is the honest half — callers can tell nothing looked at the bytes. This keeps
  an upgrade from breaking six modules' uploads. A scanner that is *named* but
  unreachable fails closed instead: silently reverting to permissive would undo
  what the operator asked for.
- **ClamAV over `INSTREAM`**, streamed rather than `SCAN <path>`, because clamd
  usually runs in a different container than the app and a path this process can
  see is not one clamd can.

Configured with `OM_ATTACHMENT_SCANNER=clamav` plus
`OM_ATTACHMENT_CLAMAV_HOST` / `_PORT`.

## Executable content, whatever it is called

Extension checks stop `payload.exe`; they do nothing about the same payload
renamed `invoice.pdf`. MIME sniffing recognised PNG, JPEG, GIF, WEBP, PDF, ZIP
and SVG — but no executable format — so a Windows PE under a document name
passed every check.

`hasExecutableSignature` now reads the magic numbers the operating system itself
dispatches on: PE (`MZ`), ELF, Mach-O in both endiannesses and widths, the
universal/Java header, and a shebang. It is deliberately narrow. Detecting a
malicious *document* is a scanner's job, and widening this into a pretend
antivirus would be the "a MIME check is not malware protection" mistake the
brief warns about — there is a test asserting that boundary.

## Archive inspection

An upload policy that blocks `.exe` and accepts `.zip` blocks nothing — the
executable travels one layer down. Archives are judged by what their contents
would have faced on their own.

The inspection reads the ZIP **central directory** and never decompresses: entry
names, declared sizes and the encryption flag are all recorded there in plain
form, so the checks that guard against a zip bomb cannot themselves expand one.
Refused: dangerous entries, path traversal (`../`, absolute, drive letters),
encrypted archives, implausible entry counts, extreme compression ratios, and
nested archives. Formats we cannot read (`.tar`, `.gz`, `.7z`, `.rar`) are
**refused rather than accepted unread** — accepting an opaque archive because we
lack a reader is the exact bypass this closes.

## Direct-to-storage upload

Large files do not travel through the application server. Streaming 200 MB
through a Node request means holding it, and holding it means a handful of
concurrent uploads can take the process down — so the 200 MB limit is only
honest if the bytes go straight to storage.

The app keeps the two ends and trusts nothing in between:

1. **Ticket.** Membership is settled first, the policy is applied before any
   capability exists (dangerous extensions, size), the quota is reserved, and a
   URL is minted that is bound to one key, one content type and one length,
   expiring in minutes. `If-None-Match: *` means a signature cannot be replayed
   to overwrite an existing object. The key is minted server-side — a client
   that could choose its own key could write outside its tenant's prefix, which
   is what the whole isolation rests on.
2. **Upload.** The browser PUTs directly to the store.
3. **Finalise.** The size and type are read back from storage via `HeadObject`
   and a sniff of the stored bytes, never taken from the client. The reservation
   must belong to *this* uploader and *this* conversation — bound by a hash of
   both against the storage key. Membership is re-checked, because it can end
   between the ticket and the finalisation. Then the file is scanned.

A store that cannot presign answers `{ supported: false }` and the client
uploads through the multipart endpoint instead. That is not a degraded path: it
is what development uses, since the local driver has nowhere to point a signed
URL, and both must behave identically from the composer's point of view.

Archives keep to the multipart path deliberately — inspection needs the bytes,
and accepting an uninspected archive is the bypass the inspection exists to
close.

## Attachment model

No chat-owned attachment table. `attachments` already links to any record
through `(entity_id, record_id)`, which is how the `messages` module carries its
own files.

- Staged: `entity_id = 'chat:chat_message_draft'`, with the uploader and
  conversation in `storage_metadata`.
- Sent: relinked to `entity_id = 'chat:chat_message'`, `record_id = <message id>`.

The relink happens **inside the send transaction**, so a message and its files
commit together — there is no state where a message exists with its attachments
still parked as drafts. Every check is answered from the server's own rows: the
attachment must still be a draft, belong to *this* uploader, have been staged
against *this* conversation, and have cleared its scan. A forged id and someone
else's id return the same error, so probing cannot distinguish them.

## Authorization

Membership is checked **before any bytes are stored**, not after. A caller who
cannot read the conversation cannot obtain the capability to upload into it,
which is what stops uploads being parked somewhere cheap and later associated
with a conversation the uploader was never in.

Reads go through `checkAttachmentAccess`, which the attachments module requires
of every reader. Chat authorizes the conversation and then asks whether the
attachment hangs off one of its messages — the attachments module cannot know
about conversations, which is why it asks callers for targets they have already
authorized.

Verified against the running app: uploading to, listing drafts of, or opening
the Shared panel of a conversation you are not in all answer 404; a draft staged
in conversation A cannot be sent into conversation B.

## Shared panel

One panel, three views. Files and media are the same attachment rows split by
MIME type in SQL, so a workspace with ten thousand photos and six documents does
not read the photos to show the documents. Links are their own index.

Links are written in the same transaction as the message, exactly as mentions
are — finding them by scanning message bodies would mean reading a workspace's
whole history to fill one screen. The extractor is conservative on purpose: only
absolute `http`/`https`, mention tokens stripped first (their UUID hex would
otherwise read as part of a URL), trailing sentence punctuation trimmed,
brackets balanced, deduplicated, bounded.

Paged with a keyset on `(created_at, id)`. The id matters: a message sent with
twenty images writes twenty rows at one instant, and a time-only cursor would
land inside that group and repeat or skip the rest.

Entries whose message was deleted, and files that have not cleared their scan,
are not listed — a panel is somewhere people download from.

**View in Chat** reuses the pin-navigation jump, lifted into one function both
panels call rather than two copies to keep in step.

## Database

| Change | Notes |
|---|---|
| `attachments.scan_status` / `scanned_at` / `scanner` | Defaults `pending`; migration backfills existing rows to `clean` |
| `attachments_scan_status_idx` | **Partial** (`where scan_status <> 'clean'`) — only the queue reads by status, and `clean` is nearly every row |
| `chat_message_links` | `(message_id, url)` unique; `(conversation_id, created_at)` index; composite FK to `chat_messages (id, conversation_id)` so a link cannot reference a message in another conversation |

## Limits

Centralised in `lib/attachmentPolicy.ts`, env-overridable:

- 200 MB per file (`OM_CHAT_ATTACHMENT_MAX_UPLOAD_MB`), matching Google Chat
- 20 images or videos per message
- 1 non-media file per message — a product choice, not a technical limit; the
  link is a row per attachment and the model supports more

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A file reachable without conversation access | Critical | Membership checked before upload and on every read; relink validated against server rows | Low |
| Executable smuggled in an archive | High | Central-directory inspection; unreadable formats refused | Present for formats we cannot read — they are refused, so the cost is a false negative on legitimate `.tar.gz` |
| Unscanned file served | High | `pending`/`failed`/`infected` all unreadable; gate after authorization | Low |
| Scan column breaks other modules | High | Backfill to `clean`; unconfigured scanner is permissive and says so | Low — verified by the full suite |
| Storage layout leaked to the client | Medium | DTO carries no path, driver, partition or URL; asserted by test | None |
| Transcript downloading originals | Medium | Thumbnails from the derived-variant route, lazily loaded | None |

## Limitations, stated plainly

- **External users are not supported, because chat does not support them.** Chat
  is backend-only: it resolves identity through `getAuthFromRequest`, has no
  portal route and no customer auth, and `chat_participants.user_id` is an
  internal user. §56–§60 of the brief presuppose external chat access that does
  not exist on this branch; delivering them means building external-user chat
  first, which is a separate feature.
- **No link previews.** Deliberate: server-side unfurling is an SSRF surface, and
  the brief is right that security beats a rich preview. URLs are displayed, not
  fetched.
- **Attaching existing Operis documents is not implemented** (§49–§52).
- **Shared-panel realtime is not wired** (§85); the panel fetches when opened.
- **Audit logging** beyond scan warnings is not wired (§67).

## Verification

- Full gate: build, generate, i18n sync/usage, lint graph, lint, repo guards,
  typecheck, `test:ci`, `build:app` — all PASS.
- Browser-verified: upload, staged previews with thumbnails, send with text +
  file and file-only, transcript rendering, download with a forcing
  `Content-Disposition`, Shared Files/Media/Links, View in Chat landing on the
  right message.
- Security, verified against the running app: bare `.exe`, disguised
  `invoice.pdf.exe`, zip containing `payload.exe`, zip with `../../etc/passwd`,
  and opaque `.tar` all refused; unscanned row returns 409; forged id 404;
  cross-conversation draft refused; upload/list/shared for a non-member 404.

## Changelog

- 2026-09-10 — Direct-to-storage upload with server-side finalisation, and
  executable-content detection by magic bytes.
- 2026-09-10 — Phases 1–4: scan pipeline, chat attachment model, composer,
  transcript rendering, Shared panel, archive inspection.
- 2026-09-06 — Images reserve their height before the bytes arrive, and a
  thumbnail that will not load falls back to a file card instead of a broken
  glyph. The reservation is what keeps the transcript pinned: a row that grew
  after first paint fired a scroll, and that scroll told the follow-the-bottom
  rule the reader had moved away, so the newest message was left partly off
  screen. Covered by `__tests__/MessageAttachments.test.tsx`.
- 2026-09-06 — `directUpload.test.ts` now mocks `EntityManager.persist` as the
  chainable method it is, and answers `findOne` by entity. The previous mock
  made `em.persist(x).flush()` throw inside the scan step; because finalisation
  logs and swallows scan failures, the suite passed while the scan never ran.
  The verdict is now asserted rather than assumed.
