# Code Navigation for Agents

Two prebuilt indexes answer most "where / who / why" questions without reading source.
Reach for them **before** a Grep/Glob sweep — that is the whole point. A sweep over this
repo (9,273 TS/JS files, ~660k LOC, 1,784 markdown files) costs thousands of tokens and
usually returns the same answer the index already holds.

Both are **local, regenerable caches**, like `node_modules`. Nothing but
`graphify-out/GRAPH_REPORT.md` is committed.

## Which one

| Question shape | Use |
|---|---|
| Where is X defined? What is this file's API? | `graft ask`, `graft skeleton` |
| Who calls X? What breaks if I change it? | `graft callers`, `graft blast` |
| Exhaustive regex, grouped by enclosing symbol | `graft grep` |
| First look at an unfamiliar area | `graft map` |
| Which spec/ADR covers this? Why is it built this way? | `graphify query` |
| How do these two concepts connect? | `graphify path`, `graphify explain` |
| What are the architectural hubs? | `graphify god-nodes` |
| Neither index knows | *then* Grep/Glob/Read |

Rule of thumb: **graft for code, graphify for prose and cross-document reasoning.**
Graft is deterministic, free and always fresh, so prefer it whenever the question is
answerable from code structure.

## graft — code structure

Runs from the repo root. Use `yarn graft <args>` (resolves a pinned version) or the
`graft` binary directly once installed globally. The graph refreshes itself against the
working tree before every query, so uncommitted edits are always included.

```bash
yarn graft ask "where is tenant scoping enforced"       # ranked nodes + file:line
yarn graft ask "how are ACL features declared" --in packages/core/
yarn graft skeleton packages/shared/src/lib/crud/optimistic-lock.ts
yarn graft callers apiCall --depth 2                    # blast radius
yarn graft callers createCrudRoute --direction out      # what it calls instead
yarn graft grep "requireFeatures\(" --                  # grouped by enclosing symbol
yarn graft map                                          # clusters, hubs, hotspots
yarn graft blast                                        # blast radius of your diff
```

`skeleton` is the cheap read: every signature in a file, no bodies. Measured on
`optimistic-lock.ts` it was ~1,121 tokens against ~4,004 to read the file whole (72% less).
`callers apiCall --depth 2` reported ~12,579 tokens against ~1,426,825 to read the 296
files it covers — the savings scale with how much you would otherwise have had to open.

Scopes for `--in` are the workspace paths: `packages/core/`, `packages/ui/`,
`packages/shared/`, `packages/ai-assistant/`, `apps/mercato/`, and so on.

**MCP tools** (same data, no shell): `graft_find_code`, `graft_file_api`,
`graft_trace_calls`, `graft_find_all`, `graft_repo_map`, `graft_check_freshness`.

## graphify — concepts, specs and decisions

Graft only sees code. Graphify additionally indexes the prose that explains *why*: 219
active specs, 164 implemented ones, 41 `AGENTS.md` files, 133 lessons, the ADRs and the
Docusaurus docs.

```bash
graphify query "how do modules declare ACL features"
graphify query "optimistic locking" --dfs --budget 3000
graphify path "CrudForm" "optimistic lock"
graphify explain "makeCrudRoute"
graphify god-nodes --top 15
graphify affected "query engine" --depth 2
```

Read `graphify-out/GRAPH_REPORT.md` for the community map — it is the fastest orientation
to how the repo clusters.

## Setup (once per checkout)

```bash
npm install -g @nanonets/graft@0.12.0   # pinned; also what the Claude Code hooks resolve
yarn graft:init                          # wires .claude/ hooks, statusline, skill, MCP
yarn graft:build                         # ~45k nodes, ~1 min, free
uv tool install graphifyy
yarn graphify:build                      # AST pass; add a key first for the doc layer
```

`.mcp.json` is gitignored — copy `.mcp.json.example` and keep the `open-mercato` entry
alongside `graft` and `graphify`.

### Cost tiers

`yarn graphify:build` picks its own tier. **Both are free** — the difference is depth,
not coverage:

- **No LLM key** (current default) → code by AST, then documents by structure (headings
  become nodes, so specs and ADRs *are* searchable). Measured on this repo: 60,452 code
  nodes + 33,112 document nodes from 1,778 markdown files, 0 tokens. Communities stay
  named `Community N`, and relationships between concepts are structural only.
- **`GEMINI_API_KEY` set** → the documents are additionally read *semantically*, so
  concepts and their relationships are extracted rather than inferred from headings, and
  communities get real names. Costs tokens once, then caches by content hash. Gemini
  flash is the cheap bulk path and is preferred automatically over other keys.

Graft's structural pass is always free. `graft build --deep` would add LLM summaries; it
is deliberately **not** adopted here yet.

## Freshness

- **graft** refreshes before every query (~3ms) and its `PostToolUse` hook rebuilds after
  edits. You should never need to rebuild by hand. `yarn graft:check` fails if stale.
- **graphify** is rebuilt manually. A full pass takes minutes (measured: ~4 min build,
  ~2 min for `--update` alone), which is why it is deliberately **not** in a git hook —
  it would stall every commit. Re-run `yarn graphify:build` when the docs or module
  layout have moved meaningfully; day-to-day code questions should go to graft anyway.

`graphify update` is idempotent — re-running it does not inflate the graph.

## What is not indexed

`.graphifyignore` excludes `**/generated/`, `**/.docusaurus/`, and the scaffolder template
tree (a byte-identical mirror of `apps/mercato/src/app` kept in sync by
`yarn template:sync:fix` — indexing both doubles every hit). That template does not
currently exist on disk: the `packages/create-app` → `packages/cli` rename is mid-flight,
so both paths are listed defensively and the entries are inert until one reappears.

Everything in `.gitignore` is excluded automatically by both tools.

`external/official-modules/` is an optional submodule and is not indexed unless present;
graft needs `--follow-submodules` to include it.

## Honesty rules

Both indexes can be stale or wrong. Cite the `file:line` the index gave you and, when the
answer matters, open that location to confirm before acting on it. If the index returns
nothing useful, say so and fall back to Grep — do not invent a path.
