# ADR-0005 — Add a prebuilt code-navigation layer for coding agents

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

Operis is 11,893 tracked files: 9,273 TypeScript/JavaScript files (~660k LOC) across 24
packages and 44 core modules, plus 1,784 markdown/MDX files of specs, ADRs, lessons and
framework documentation.

Coding agents navigate this by search. Every session re-derives the same structure with
Grep/Glob sweeps and whole-file reads, and the cost is paid again on each new context.
Asking "who calls `apiCall`" honestly means opening 296 files — roughly 1.4M tokens if
read whole. The information is entirely static between edits, so re-deriving it is pure
waste.

`AGENTS.md` and its 41 nested files already solve the *conventions* half of this: they
tell an agent which rules apply and which guide to read. They deliberately do not, and
should not, enumerate where every symbol lives — that is a 32,768-byte instruction budget
that is already 95% consumed.

## Decision

Adopt two prebuilt, locally regenerable indexes, and make consulting them the default
before a search sweep.

1. **Graft** (`@nanonets/graft`, MIT, pinned 0.12.0) — the code-structure index.
   Tree-sitter AST with cross-file call resolution, full-fidelity on TypeScript. Free,
   deterministic, no API key, and it refreshes against the working tree before every
   query. Wired into Claude Code via hooks, a statusline and six MCP tools.
2. **Graphify** (`graphifyy`, PyPI) — the conceptual index. Also AST for code, but it
   additionally indexes the prose graft cannot see: specs, ADRs, lessons, `AGENTS.md`.
   Keyless it reads documents structurally (headings become nodes); with a key it reads
   them semantically. Provides community detection, god nodes and path queries.

Routing is recorded in `AGENTS.md` (one rule, one Task Router row), with the procedure in
[`.ai/docs/code-navigation.md`](../../../.ai/docs/code-navigation.md) and the
`om-code-map` skill.

Supporting choices:

- **Graft is resolved at call time by `scripts/graft.mjs`, not added as a dependency.**
- **Neither graph is committed.**
- **Graphify is rebuilt manually — no git hook at all.**
- **No LLM enrichment.** `graft build --deep` and graphify's semantic document pass are
  both opt-in, gated on a key being present.

## Reason

**Two indexes, not one.** They answer different questions. Graft is free and always
fresh, so it should own every code-location question. But graft only reads code — it
cannot tell you which spec covers optimistic locking, or why the compatibility contract
was re-scoped. That prose is a large fraction of this repo's real knowledge, and only
graphify indexes it.

**Wrapper, not dependency.** Graft pulls a native `tree-sitter` binding. As a root
devDependency that adds a node-gyp step to every `yarn install` — including the Dockerfile
and CI — for a tool that is never part of a build. A pinned wrapper keeps the install
graph untouched while still guaranteeing one version.

**Nothing committed.** The graft graph alone is 336 MB and ~8,800 generated markdown
files; graphify's is 90 MB. Both are caches with the same lifecycle as `node_modules`, and
the repo rule "never edit generated files by hand" applies. Committing
`graphify-out/GRAPH_REPORT.md` was considered and rejected on inspection: without an LLM
key it is 377 KB listing 2,966 communities named `Community 0…2965` — pure diff noise.
Revisit once a labelled build exists.

**No git hook for graphify.** Two measurements killed the idea. A `graphify update` on
this repo takes 2m16s, which would stall every commit. And `graphify hook install` writes
`.git/hooks/post-commit`, which husky disables the moment `prepare: husky` sets
`core.hooksPath=.husky` — silently, with no error. Graft self-refreshes and covers the
questions asked most often, so graphify staleness is the cheaper problem to accept.

**No enrichment yet.** The structural layer is free and was measured working before any
spend was committed. Enrichment can be added later without rework.

## Alternatives considered

- **Graft alone.** Cheapest, and covers the majority of daily questions. Rejected because
  it leaves the entire spec/ADR/lesson corpus unindexed — the "why" half.
- **Graphify alone.** One tool, one graph. Rejected because its code extraction is
  weaker than graft's cross-file resolution, it has no auto-refresh, and it offers
  nothing equivalent to `skeleton` or `blast`.
- **Enumerate hot paths in `AGENTS.md`.** Zero new tooling. Rejected: 25 bytes of budget
  headroom, and a hand-maintained index goes stale immediately.
- **Commit the graphs so nobody rebuilds.** Rejected: 336 MB, ~8,800 generated files, and
  guaranteed staleness against every branch.

## Security impact

Both indexes are local and read-only over source already on disk; neither adds a runtime
dependency or ships in an image (`.dockerignore` excludes them).

Two boundaries to respect:

- **No secrets in the index.** Both honour `.gitignore`, so `.env` and other ignored
  files are never indexed. Do not disable this with graphify's `--no-gitignore`.
- **LLM passes send source to a third party.** The semantic document pass and
  `graft build --deep` transmit file contents to whichever provider's key is set. Both
  are opt-in and off by default; treat enabling one as a data-egress decision.

Graft's telemetry is anonymous and disabled in CI; `graft telemetry disable` or
`DO_NOT_TRACK=1` turns it off entirely.

## Migration impact

None to runtime, schema, or any contract in `BACKWARD_COMPATIBILITY.md`. No persisted
identifier changes. The change is additive: new scripts, new ignore entries, a new skill,
and one `AGENTS.md` routing rule. No git hooks are installed.

Existing checkouts pick it up by running the setup block in
[`.ai/docs/code-navigation.md`](../../../.ai/docs/code-navigation.md). An agent that never
runs it loses the savings but nothing else — every rule still resolves through
`AGENTS.md`.

## Future implications

- **The routing rule is the asset, not the tools.** Either index can be swapped without
  touching `AGENTS.md` beyond one row.
- **Enrichment is the obvious next step** once the structural layer proves out: a
  `GEMINI_API_KEY` upgrades documents from heading-level structure to extracted concepts
  and names the 2,966 communities, and `graft build --deep` adds per-symbol summaries.
  That also makes `GRAPH_REPORT.md` worth committing.
- **CI has an unused opening**: `graft blast --format markdown` emits a PR blast-radius
  comment. Deliberately out of scope here because it interacts with the PR label workflow.
- **These indexes never override `AGENTS.md`.** If guidance and index disagree, the
  instruction files win; the index only reports where code currently is.
