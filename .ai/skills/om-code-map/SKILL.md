---
name: om-code-map
description: Locate code and explain architecture in Operis without grepping the whole monorepo. Use when the question is "where is X", "who calls X", "what breaks if I change X", "what is this file's API", "which spec/ADR covers X", "how do X and Y connect", "give me a map of this package", or before any broad Grep/Glob sweep across packages/ or apps/. Routes between the graft (code structure) and graphify (specs, ADRs, lessons) indexes.
---

# om-code-map — find code without reading the repo

Operis is 9,273 TS/JS files (~660k LOC) across 24 packages and 44 core modules, plus
1,784 markdown files. A Grep sweep costs thousands of tokens and usually re-derives
something a prebuilt index already knows.

**Answer from an index first. Fall back to Grep only when both indexes miss.**

Full reference: [`.ai/docs/code-navigation.md`](../../docs/code-navigation.md).

## Step 1 — classify the question

| Shape | Tool |
|---|---|
| where is it / what's this file's API | `graft ask`, `graft skeleton` |
| who calls it / what breaks | `graft callers`, `graft blast` |
| exhaustive pattern match | `graft grep` |
| orient me in an unfamiliar area | `graft map` |
| why is it like this / which spec | `graphify query` |
| how do these two relate | `graphify path`, `graphify explain` |

Code question → graft. Prose, rationale, or cross-document question → graphify.

## Step 2 — run it

```bash
yarn graft ask "<question>"                      # add --in packages/core/ to scope
yarn graft skeleton <file>                       # signatures only — the cheap read
yarn graft callers <symbol> --depth 2            # blast radius
yarn graft map                                   # clusters, hubs, hotspots
graphify query "<question>"                      # concepts, specs, ADRs, lessons
graphify path "<A>" "<B>"
```

`--in` scopes are workspace paths: `packages/core/`, `packages/ui/`, `packages/shared/`,
`packages/ai-assistant/`, `apps/mercato/`.

MCP equivalents, when available, need no shell: `graft_find_code`, `graft_file_api`,
`graft_trace_calls`, `graft_find_all`, `graft_repo_map`, `graft_check_freshness`.

## Step 3 — verify before acting

Both indexes can be stale or wrong.

- Quote the `file:line` the index returned.
- Open that location before you edit or before you assert it in a review.
- If the index returns nothing useful, **say so** and fall back to Grep. Never invent a
  path that looks plausible.
- `graft` auto-refreshes against the working tree, so uncommitted edits are covered.
  `graphify` is rebuilt manually (`yarn graphify:build`, minutes) and can lag the code —
  treat its `file:line` as a hint, not a fact.

## Operis-specific notes

- **The reference module is `customers`** (`packages/core/src/modules/customers/`). For
  any CRUD question, look there first — `graft map --in packages/core/` will surface it.
- **Module layout repeats.** Once you know one module's shape (`acl.ts`, `setup.ts`,
  `data/`, `api/`, `backend/`, `widgets/`), `graft skeleton` on the equivalent file in
  another module is usually enough — do not re-read a whole module.
- **The scaffolder template is excluded** from graphify — it mirrors
  `apps/mercato/src/app` byte-for-byte. Note the `packages/create-app` → `packages/cli`
  rename is mid-flight, so that tree is currently absent and some tests still reference
  the old path; if the index disagrees with disk here, trust disk. The Template Sync
  Checklist still applies whenever it returns.
- **Neither index replaces `AGENTS.md`.** The Task Router there is the authority on
  *which guide to read*; these indexes tell you *where the code is*. Check the router for
  rules and conventions, the indexes for locations.
- If the answer is a convention rather than a location (naming, migrations, RBAC,
  optimistic locking), the Task Router row is the faster path than either index.
