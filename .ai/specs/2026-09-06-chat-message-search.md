# Chat Message Search — Within a Conversation and Across All Chats

Status: in progress
Phase: 4 of the chat module (1 direct messaging, 2 spaces + replies, 3 reactions/mentions/pins)

## TLDR

Search within one conversation and across every conversation a person belongs to,
built on Postgres full-text search plus `pg_trgm`. Authorization is an inner join
on `chat_participants`, so a revoked membership takes effect on the next
keystroke with nothing to reindex. One normalisation pipeline serves indexing,
querying and highlighting, which is what lets an accentless `duyet` find and
highlight `duyệt`.

## Problem Statement

A workspace chat accumulates history faster than anyone can remember where
anything was said, and the module shipped with no way to search it. Two distinct
needs sit behind "search":

- *Where in this conversation did we agree that?* — the reader wants the message
  back in its context, with a way to step between matches.
- *Which conversation was that in?* — the reader does not know where to look, so
  the answer has to name the conversation as well as the message.

Both must respect membership exactly. Chat readability is per-record — you can
read a message because you are in its conversation — which the platform's shared
search abstraction cannot express, since its read check is memoised per entity
*type*. And the corpus is multilingual per-message, so anything that assumes one
language (a stemmer, an ASCII fold) is wrong for most of it.

## Summary

Two search experiences over one query. Finding a message in the conversation you
are reading is a find bar — a count and a way to step through matches — because
what you want is the message in its context. Finding a message across every
conversation you belong to is a results list grouped by conversation, because
there the answer is the conversation as much as the message.

They share one parser, one normalisation pipeline, one ranking and one SQL
builder. Splitting them would let the two drift until the same message ranked
differently depending on where it was searched from, which is the kind of
difference nobody can explain to a user.

Postgres full-text search plus `pg_trgm`, not a separate search service. The
reason is authorization, not cost: membership changes must take effect
immediately, and a join against `chat_participants` is always current, where an
external index would need reindexing on every membership change and would be
wrong in the window before it finished.

## Why not the `packages/search` abstraction

It cannot express this. `canReadSearchEntity(entityId, …)` is memoised per entity
*type*, so it answers "may this user read chat messages" and not "may this user
read *this* message". Chat readability is per-record membership. The `messages`
module set the precedent for a module-owned route with `enabled: false`, and this
follows it.

## Data model

One additive column, three indexes, no new tables.

### `chat_messages.search_body`

A folded copy of the message body, written on insert and backfillable. Nullable,
so a deployment that has not yet run the backfill degrades to "not yet
searchable" rather than to an error.

| Index | Shape | Why |
|---|---|---|
| `chat_messages_search_tsv_idx` | GIN on `to_tsvector('simple', search_body)`, partial `WHERE kind='user' AND deleted_at IS NULL` | The exact/prefix branch |
| `chat_messages_search_trgm_idx` | GIN `gin_trgm_ops` on `search_body`, same partial predicate | The typo branch; created only when `pg_trgm` is present |
| `chat_messages_conversation_search_idx` | `(conversation_id, created_at DESC)`, same partial predicate | In-conversation scans and the transcript itself |

The partial predicate matches the query's own `WHERE` exactly, so the planner can
use the indexes; system rows and deleted messages are never candidates and never
occupy index space.

`'simple'`, not `'english'`. A stemmer would be wrong for most of the corpus: it
would stem English and silently mangle everything else, and chat is multilingual
per-message. Folding happens in TypeScript instead, where the same function can
also drive highlighting.

## Normalisation is one function, used everywhere

`lib/searchText.ts` owns the fold. It runs in TypeScript rather than as a
generated column because `unaccent` is an extension that is not installed by
default, is `STABLE` (so it cannot appear in a generated column), and because
highlighting has to apply the identical transformation client-side.

- NFKD decomposition, strip `\p{M}` combining marks, then **NFC recomposition** —
  the recomposition matters for Hangul, which NFKD splits into jamo. The marks
  are already gone, so recomposing cannot reintroduce an accent.
- Characters with no canonical decomposition are mapped explicitly: `đ ø ł ß æ œ
  ð þ ı`. Vietnamese `đ` is the one that matters most here, and it is exactly the
  one NFKD does not handle.
- Mentions are stripped to their display text before indexing, so `<@uuid>` never
  becomes a search term.
- Identifiers get a compacted twin: `PO-4432` also indexes as `po4432`, because
  those are the same identifier to the person searching. Minimum three characters,
  so `a-b` does not collapse into a term that matches everything.

`foldWithMap` returns the folded text *and* an offset map back to the original.
That map is what lets an accentless query for `duyet` highlight `duyệt` in the
message as the reader wrote it — verified end to end.

## Ranking

Signals are combined, each separated from the next by roughly an order of
magnitude, so a pile of weak matches can never overtake one strong one:

| Signal | Weight |
|---|---|
| Exact phrase present | 1000 |
| All terms present (`to_tsquery`) | 400 |
| `ts_rank_cd` | ×200 |
| Whole word, not merely begun | 50 |
| Fuzzy (`word_similarity`) | ×40 |
| Recency | 10, decaying over ~30 days |

The whole-word signal compares against the query *without* its trailing `:*`.
Without it a search for `deploy` ranks `deployment` exactly level with `deploy`,
because the prefixed query matches both and nothing downstream tells them apart.

Exact beats fuzzy structurally, not by tuning: a fuzzy-only row scores at most 40
plus recency, while any exact match starts at 400.

Ties break on message id, so a message appears on exactly one page. Pagination is
keyset on `(score, id)` rather than `OFFSET`, so deep pages cost what shallow ones
do.

### The keyset needs a frozen clock

Recency is part of the score, and reading it from `now()` made the score of every
row drift a little lower between requests. A row that had dropped below the
score the cursor recorded satisfied `<` again and came back on the next page:
paging a twelve-result search with `limit=2` returned **twenty-two rows over
eleven pages**, measured against the live API.

The cursor therefore carries the instant the first page was scored against, and
every later page scores against that same instant. The assembled score is also
rounded to six decimal places, because the cursor carries it out through JSON and
compares it back in SQL, and a full-width float does not make that trip
identically. After both fixes, walking the same result set at page sizes 2, 3 and
5 returns exactly twelve rows in the same order as the unpaged query, with no
duplicates.

## Typo tolerance uses word similarity, not document similarity

The first implementation put the fuzzy term only in the score and left the `WHERE`
requiring a `to_tsquery` match. That is decorative: a misspelling produces no
exact match, so there is no row to re-rank, and typo tolerance never fires for the
only queries it exists to serve. Searching `duyte` for `duyệt` returned nothing.

It also used `similarity(search_body, query)` — whole-document similarity, which
*falls* as a message grows. Measured on real messages: 0.07–0.25, under any
threshold that also rejects noise. It could only ever have scored zero.

A third measure was wrong too. `<%` scores the best-matching *continuous run* of
trigrams, which lets a short query straddle the middles of two words: `cois`
scored 0.400 against "please review the attached contract before the board
meeting on thursday" — a match no reader could be shown a reason for, and one
reported from the running app. `<<%` (strict) pins the extent to word boundaries
and drops that same pair to 0.167.

The fuzzy branch is now part of the candidate predicate, OR'd with the exact one,
using `<<%` which compares the query against the best-matching run of *whole
words* inside the message. Both halves are indexable and
Postgres bitmap-ORs the two GIN indexes — confirmed on a 300k-row corpus:

```
Bitmap Heap Scan
  -> BitmapOr
       -> Bitmap Index Scan on ..._to_tsvector_idx
       -> Bitmap Index Scan on ..._search_body_idx
```

The threshold is **0.35**, calibrated by sweeping it against this corpus with 51
generated single-character typos and 61 random strings:

| Threshold | Typos found | False positives |
|---|---|---|
| 0.30 | 48 / 51 | 1 |
| 0.33 | 48 / 51 | 1 |
| **0.35** | **42 / 51** | **0** |
| 0.40 | 34 / 51 | 0 |
| 0.50 | 24 / 51 | 0 |

0.35 is the knee: the lowest value admitting no false positive at all, while
still catching 82% of typos. Below it recall barely improves and nonsense starts
matching; above it recall falls away for nothing. The trade is deliberate — a
search that answers a word nobody wrote is worse than one that misses a badly
mangled typo, because the reader can retype but cannot tell a wrong result from a
right one. It
is applied with `SET LOCAL` inside the query's transaction, so it expires with the
transaction and cannot leak into the next borrower of a pooled connection, and so
two identical databases answer a query identically rather than inheriting whatever
the server default happens to be.

## Authorization is the join

`chat_participants` is joined with `INNER JOIN`, and the participant row's own
`tenant_id` / `organization_id` are matched — not only the message's. A stale
membership row from another organization therefore cannot authorize a read.

Authorization is never a filter applied to results. A message the caller cannot
read is never a candidate, so it cannot leak through a count, a snippet, or an
off-by-one in pagination. `countMessages` uses the identical predicate for the
same reason: a count that included unreadable messages would disclose that they
exist.

The narrowing filters (sender, date range, pinned) are built once and applied by
both the search and the count. As two hand-written copies they had already
drifted: the pinned filter reached the results but not the count, so a pinned
search showed a handful of rows under a total that had counted everything.

The phrase used for the exact-phrase signal is escaped before it becomes a `LIKE`
pattern. `%` and `_` mean something to `LIKE`, so a quoted search for `"50%"`
would otherwise have matched far more than it should — quietly, since a wildcard
produces extra results rather than an error.

`__tests__/messageSearchAuthorization.test.ts` asserts this against the *compiled
SQL* rather than against returned rows, because the property is structural —
assertions on results would pass equally well if scoping were applied afterwards
in TypeScript, which is the bug being guarded against. Verified by mutation:
weakening the `INNER JOIN` to a `LEFT JOIN` fails four of the tests.

## Snippets and highlighting

Ranges are computed against the original text and rendered as segments and text
nodes — never markup. `MessageBody` renders chat text the same way and for the
same reason: a message body is user input, and the one rule that keeps it safe is
that it never becomes HTML.

Highlighting mirrors the query's own matching rule. The last loose term is a
prefix term (`buildTsQuery` appends `:*`), so it highlights a word's opening;
every other term must match whole. Getting this wrong produced a result with
nothing marked, which reads as a wrong match rather than a partial one.

A near miss is marked too. A typo returns a message with no exact run to mark,
and left unmarked it is a result with no visible reason — indistinguishable, to
the reader, from the search being wrong. So when a term matches nothing exactly,
the closest whole word is scored with the same padded-trigram measure `pg_trgm`
uses and marked if it clears the same threshold: `budgt` marks **budget**,
`thursady` marks **Thursday**. The fallback explains a match; it never invents
one, and an exact match always wins over a near miss.

## Typing counts; navigating moves

Find-as-you-type scrolls the page in a browser's find bar, and that is the wrong
model here: the transcript is the thing being read, and hauling it somewhere new
on each keystroke of a half-typed word takes the conversation away from the
reader. Every chat client avoids it — Telegram counts matches and waits for an
arrow; WhatsApp, Messenger and Google Chat show a list and wait for a tap.

So typing reports *how many* matches there are and moves nothing. Enter,
Shift+Enter and the chevrons navigate. Entering forward lands on the first match
rather than stepping past it; entering backward lands on the last, so "previous"
from a standing start does not quietly mean the same thing as "next". A capped
total is reported as a floor — `500+ matches` — rather than as an exact number
the search never counted to.

Navigation carries a tick alongside the selection, because asking to go where the
selection already is has to work: `setIndex` to the value it already holds is a
no-op, React does not re-render, and an effect watching only the index never
runs. That is exactly the single-match case, where stepping wraps to the one
match there is — a lone result was reachable once and then never again.

Landing marks the words, not the bubble. A ring around the whole message said
only "somewhere in here"; the matched runs are marked in place instead, and the
match being stood on is marked more strongly than the rest — without that, two
visible matches are indistinguishable. Terms rather than server-computed ranges,
because the transcript renders messages the search response never mentioned and
they have to mark the same words; `findMatchRanges` is the same function the
results list highlights through, so the two agree.

Ranges are memoised per message. Deriving them is not free — measured at 0.13ms
for a long message, several milliseconds a frame across a screenful — and the
transcript re-renders for reasons that have nothing to do with search. The memo
is keyed on the segments and the terms, so moving between matches re-renders
without re-deriving anything.

The flash survives where it is still the only landing signal: pin navigation and
a shared link have no marked text, so they keep it. Both are the caller's
decision, like focus below.

Landing never takes focus. The jump used to call `focus()` on the message row
unconditionally, which pulled the caret out of the search field the moment the
debounce fired — mid-word, with the rest of what was being typed going to the
transcript instead. Focus is now the caller's decision: a pin panel closing and
a shared link opening still take it, because nothing else owns the caret then,
while the find bar never does.

## The UI pages, and names resolve the way they do everywhere else

Both surfaces fetch pages rather than a single response. A single-page hook had
reported a server-side total of up to several hundred while holding only twenty
results, so the find bar counted matches the reader could never step to and the
results list silently stopped at twenty with no way to go on. The find bar now
fetches the next page when stepping past the last loaded match instead of
wrapping early, and the results list offers "Load more" until the set is
exhausted.

A direct conversation stores no title. Left raw, a result fell back to whoever
sent the matching message — so your own messages appeared under a heading with
your own name on it. Search now resolves the counterpart's name in the same
lookup the senders already use, matching the conversation list.

## API contracts

Two routes, both `GET`, both `requireAuth` + `chat.view`, both rate-limited
fail-closed. Response schemas are shared from `api/openapi.ts` so the two cannot
drift.

| Route | Scope |
|---|---|
| `/api/chat/search` | Every conversation the caller belongs to |
| `/api/chat/conversations/{id}/search` | One conversation; membership checked first, so a conversation the caller is not in answers 404 rather than an empty result |

Query parameters: `q` (required, ≤256 chars), `limit` (≤50), `cursor` (opaque),
`from` (≤20 comma-separated user ids), `after` / `before` (dates), `pinned`.
Neither route takes an organization parameter — scope comes from the session, so
no request shape can widen it.

Response: `items[]` (message and conversation ids, conversation title and kind,
sender id and resolved name, `snippet`, `highlights[]` as offsets into the
snippet, `truncatedStart` / `truncatedEnd`, `createdAt`), plus `nextCursor`,
`hasMore`, `total`, `totalIsCapped` and `fuzzyAvailable`.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Cross-tenant or non-member disclosure | Critical | Query | Authorization is an inner join, scoped on the participant row's own tenant and organization; the count uses the identical predicate. Asserted against compiled SQL and verified by mutation | Low — a future filter added to one path but not the other would reintroduce drift, which is why the filters are now built once |
| Search text drifts from the fold that wrote it | High | Indexing | One pipeline for indexing, querying and highlighting; `backfill-search --rebuild` is the documented remedy whenever the rules change | Low, but a fold change without a rebuild leaves rows in the previous format and silently unfindable |
| `pg_trgm` absent in a deployment | Medium | Ranking | Detected once and cached; the trigram index is conditional, fuzzy leaves both predicate and score, and the UI says typo tolerance is unavailable | None — degrades to exact and prefix |
| A very common term scans a large match set | Medium | Performance | Count capped, results keyset-paged; measured p50 70ms on a synthetic worst case where the term appears in a fifth of the corpus | Accepted; no real corpus has that distribution |
| Rendering message text as markup | High | UI | Highlighting emits text nodes and `<mark>`, never interpolated HTML | None |
| CJK/Thai under-retrieval | Medium | Retrieval | Trigram substring matching partially covers it; stated as a limitation rather than papered over | Present — needs a segmenter to resolve |

## Final Compliance Report

- All 13 commands in `.ai/agentic.config.json` `validation.commands` pass.
- 399 unit tests across 21 suites; no `any`, `@ts-ignore`, or lint suppressions
  added; no hardcoded colours or arbitrary values in the new components.
- No cross-module ORM relationships; the module owns its routes, service and CLI.
- Migration ships with its snapshot; `pg_trgm` bootstrap added to the local
  compose init, the integration harness and the deployment playbook.
- Five locale files in sync.

## Performance

300k messages, reader in 264 of 500 conversations, 30 runs each:

| Query | p50 | p95 | p99 |
|---|---|---|---|
| Exact, rare term | 3.0 ms | 3.7 ms | 3.7 ms |
| Typo (fuzzy branch) | 2.4 ms | 3.6 ms | 4.0 ms |
| Exact, very common term | 70.6 ms | 73.8 ms | 74.4 ms |

Fuzzy costs nothing over exact. The common-term figure is a synthetic worst case —
that term appears in a fifth of the corpus, which no real chat corpus does — and it
is the case the count cap exists for.

The participant join makes global search *faster*, not slower: it narrows to the
conversations the caller belongs to before any text matching happens.

## Deep links

A result opens `?message=<id>`, a real navigation, so back works and the link can
be shared. Two bugs were found and fixed in getting this to actually land:

1. The effect that resets per-conversation state was declared *after* the effect
   that read `?message=`, so on mount the reset ran second and wiped the jump.
   They are one decision and are now one effect.
2. The jump was applied to the rows already on screen — usually the cached tail —
   and the anchored window then replaced every row. A transcript whose rows all
   vanished counts as scrolled to the bottom, so the follow-the-bottom rule took
   the reader back down. The landing is now re-asserted once the anchored window
   arrives, keyed on that arrival so paging further back does not drag the reader
   forward again.

Verified on the oldest message of a 25-message conversation: the target lands at
the top of the viewport and takes focus.

## Operations

`yarn mercato chat backfill-search` fills `search_body` for messages that predate
it. The work queue *is* the set of rows where `search_body IS NULL`, so a run that
dies halfway has less to do next time and no state to reconcile; re-running it is
idempotent and two concurrent runs are safe. Batched on an id keyset, not `OFFSET`,
so cost per batch is constant and no batch holds a lock long enough to interrupt a
conversation. `--rebuild` recomputes every row, which is what a change to the fold
requires — the normalisation rules *are* the index format.

`yarn mercato chat search-status` reports corpus coverage and whether `pg_trgm` is
present, changing nothing.

`pg_trgm` is optional. Without it the trigram index is not created, fuzzy is
dropped from both the predicate and the score, and the UI says typo tolerance is
unavailable rather than silently returning less.

## Limitations, stated honestly

- **CJK has no word segmentation.** `'simple'` splits on whitespace, and Chinese
  and Japanese do not use it, so a whole sentence becomes one token. Substring
  matching via trigram partially covers this; proper support needs a segmenter
  (`pg_bigm`, or an external analyzer). Thai has the same problem.
- **The total is capped.** Beyond the cap it reports "N+", because the exact total
  of a broad query costs a full scan of the match set to produce a number nobody
  acts on.
- **Attachments are not searched** — the chat module has no attachments.
- **Edits and deletes do not reindex** — `deleted_at` exists but is never written,
  and messages are not editable. When either ships, `search_body` must be
  recomputed in the same command.
- **External/guest participants are not modelled**, so there is no separate
  visibility rule for them.

## Verification

- 423 unit tests across 23 suites pass: 19 assert authorization, tenancy, filter
  parity and keyset stability against the compiled SQL; 12 pin the find bar's
  navigation contract; 11 pin in-transcript marking, including
  near-miss marking and that a body reading `<b>bold</b>` still renders as text.
- Browser-verified end to end: accentless `duyet` matches and highlights `duyệt`;
  prefix `duy` matches and highlights `duy` within it; transposition `duyte` finds
  the message; `qquuxx` finds nothing; results rank exact above fuzzy; find-bar
  typing reports a count without moving the transcript or the caret, and the
  full typed value survives; the first navigation lands on match one, stepping
  scrolls to each match in turn and wraps in both directions while focus stays
  in the field; "Load more" takes a 23-result search from 20 to 23 and then
  retires; a deep link lands on a message 25 back and takes focus.
- Adversarial queries answered without error: punctuation-only (`---`), LIKE
  wildcards in a quoted phrase, sender/date/pinned filters, and an over-long
  query.
- `yarn typecheck` clean, `yarn lint` clean (8 pre-existing warnings, all in
  `@open-mercato/app`).

## Changelog

- 2026-09-06 — Initial implementation.
- 2026-09-06 — Fixed a false positive reported from the app (`cois` matching a
  message about a contract): switched the fuzzy branch to `strict_word_similarity`
  and recalibrated the threshold to 0.35 by sweep. Near-miss matches are now
  marked, so every result shows the reader why it matched.
- 2026-09-06 — Second re-verification pass: memoised the per-message range
  derivation, made backward entry land on the last match, reported a capped
  total as a floor, and fixed a lone match being reachable only once.
- 2026-09-06 — Matched words are marked inside the message, the current match
  more strongly, instead of ringing the whole bubble.
- 2026-09-06 — Aligned keystroke behaviour with chat clients: typing counts
  rather than travelling, navigation is explicit, and landing no longer steals
  the caret from the search field.
- 2026-09-06 — Re-verification pass: fixed keyset pagination against a drifting
  clock, wired paging into both surfaces, gave the count and the results the same
  filters, escaped the `LIKE` phrase, made the whole-word signal real, resolved
  direct-conversation titles, and aligned the results heading with its rows.
