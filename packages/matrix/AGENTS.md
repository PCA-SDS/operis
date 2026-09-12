# Matrix Package — Agent Guidelines

`@open-mercato/matrix` is a **transport-level** client for the Matrix
client-server API, used as an application service. It knows nothing about chat,
conversations, tenants or Operis entities, so the chat transport and any
external-network channel provider share one hardened client instead of growing
two.

Architecture and rationale: [`ADR-0006`](../../docs/architecture/adr/ADR-0006-matrix-chat-transport.md)
and [`.ai/specs/2026-09-10-matrix-chat-foundation.md`](../../.ai/specs/2026-09-10-matrix-chat-foundation.md).

## Always

- Route **every** masquerade through `assertMasqueradable`. The appservice token
  can act as any user inside its namespace, so this one check is the entire
  blast-radius bound. `MatrixClient.requestOnce` applies it centrally, which is
  why a new method cannot forget it.
- Derive transaction ids with `deriveTransactionId(operisId)`. A repeated id
  makes the homeserver return the **original** event instead of posting a
  duplicate — that is the only reason a retry is safe. A random id gives all of
  the ceremony and none of the guarantee.
- Read a timeline as the **bot**, never as `sender_localpart`. Synapse refuses
  `/sync` for the appservice's own sender (matrix-doc#1144). `resolveMatrixConfig`
  rejects a config where the two are equal.
- Narrow `/sync` with `buildSyncFilter()`. Unfiltered, an initial sync returns
  full room state for every joined room.
- Log through `@open-mercato/shared/lib/logger`. `yarn logger:check-console`
  scans this package.

## Never

- Never vendor AGPL source here. Synapse and the mautrix bridges are separate
  processes reached over the protocol; this package's dependencies are
  permissive only.
- Never put the appservice token in a query string. It goes in the
  `Authorization` header, and nowhere else.
- Never follow a redirect. A homeserver has no business redirecting an API call,
  and following one replays the bearer token at a location we did not choose.
- Never mark a non-idempotent call `retry: true`. `createRoom` is the example: a
  retry after a timeout leaves two rooms for one conversation.
- Never throw from an event accessor. A room legitimately contains state,
  receipts and, later, whatever a bridge sends; unknown shapes return `null`.

## Ask First

- Ask before adding a runtime dependency. The package deliberately carries only
  `zod` — `matrix-js-sdk` brings a sync accumulator, a crypto stack and an
  IndexedDB store that a server-side proxy has no use for. Revisit only if E2EE
  arrives.
- Ask before changing `userPrefix` semantics or the `<prefix>u_<hex32>` localpart
  shape. It is baked into every identity already minted.

## Validation Commands

```bash
yarn workspace @open-mercato/matrix test
yarn workspace @open-mercato/matrix typecheck
yarn workspace @open-mercato/matrix build
```

Against a live homeserver (`yarn matrix:up` first):

```bash
yarn matrix:verify
```

## Structure

```
packages/matrix/src/
├── client.ts        # CS API client: auth, masquerade, retry, hardening
├── identity.ts      # Operis user id ⇄ mxid, namespace enforcement
├── config.ts        # credential schema, SSRF guard, env loading
├── events.ts        # event envelope + relation accessors
├── transactions.ts  # deterministic transaction ids
├── appservice.ts    # registration YAML, hs_token verification, sync filter
├── errors.ts        # transient / reauth / permanent taxonomy
└── __tests__/
```

## The failure taxonomy is the API

Callers decide what to do next from `MatrixError.kind`, never by parsing a
message:

- `transient` — retry with backoff. Network, timeout, 429, 5xx.
- `reauth` — the credential is finished; retrying cannot help.
- `permanent` — the request is wrong; retrying re-sends it forever.

`M_FORBIDDEN` is deliberately **permanent**, not `reauth`. The homeserver
returns it both for a bad token and for "this user may not do that", and
treating a permission refusal as a credential failure would take a whole channel
down because one user lacked power level.
