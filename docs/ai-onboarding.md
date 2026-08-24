# Working on Operis with an AI assistant

This repo is 9,273 TypeScript files across 24 packages and 44 modules. An assistant
that navigates it by searching will burn thousands of tokens rediscovering structure
that is already indexed, and will miss the rules that keep tenant data separated.

Two prebuilt indexes answer most "where / who / why" questions without reading source:
**graft** for code, **graphify** for specs and decisions. Details in
[`.ai/docs/code-navigation.md`](../.ai/docs/code-navigation.md).

## Setup, once per clone

Neither index is committed — `graft/` is 336 MB and `graphify-out/` is 90 MB, both
gitignored. A fresh clone has neither. Build them locally, the same way you build
`node_modules`.

Assumes `yarn install` has already run.

### graft — about a minute

```bash
npm install -g @nanonets/graft@0.12.0
yarn graft:init
yarn graft:build
```

The global install is optional. `yarn graft <args>` falls back to
`npx -y @nanonets/graft@0.12.0` when the pinned version is not on PATH, so it works
either way — install it globally so editor hooks resolve without the npx delay on
every call.

`yarn graft:init` shows a picker for which assistants to wire. Two flags worth knowing:

- `--dry-run` prints every file it would touch, then exits without writing. Run this first.
- `--no-global` skips the `~/.codex/` writes, which otherwise apply to every repo on the machine.

### graphify — about four minutes

```bash
uv tool install graphifyy
yarn graphify:build
```

Needs [uv](https://docs.astral.sh/uv/). Free with no API key: code is indexed by AST and
documents structurally, so specs and ADRs are searchable. Set `GEMINI_API_KEY` before
building if you also want documents read semantically and communities given real names —
it costs tokens once, then caches by content hash.

### MCP tools, optional

```bash
cp .mcp.json.example .mcp.json
```

`.mcp.json` is gitignored, so it does not exist after a clone. The graphify entry needs
the interpreter that `uv` installed:

```bash
head -1 "$(which graphify)" | cut -c3-
```

Paste that path as the graphify `command`. Drop the `open-mercato` entry unless you are
running the app's own MCP server.

### Check it works

```bash
yarn graft ask "where is tenant scoping enforced" --source
graphify query "how do modules declare permissions"
```

### Keeping them fresh

graft refreshes itself before every query and rebuilds after edits via its hook — you
should never rebuild it by hand. `yarn graft:check` fails if it is stale.

graphify is manual and takes minutes, which is why it is deliberately not in a git hook.
Re-run `yarn graphify:build` when specs or the module layout have moved meaningfully.

## Paste this at the start of an AI session

Claude Code picks most of this up on its own from `AGENTS.md` and its hooks. Paste it
in Cursor, Copilot Chat, or any assistant that does not read `AGENTS.md` — or any time
you notice the assistant grepping instead of asking the index.

---

Read `AGENTS.md` at the repo root before anything else, then match my task to its
Task Router table and read every guide it points to. A task often matches more than
one row.

Find code with the prebuilt indexes, not by searching:

```
yarn graft ask "<question>" --source      where it lives, how it works
yarn graft callers <symbol> --depth all   what breaks if I change it —
                                          run this BEFORE any rename or refactor
yarn graft skeleton <file>                a file's whole API, no bodies
yarn graft grep "<literal>"               every occurrence, grouped by symbol
yarn graft map                            orientation in an unfamiliar area

graphify query "<topic>"                  which spec or decision covers this, and why
graphify path "<a>" "<b>"                 how two concepts connect
```

graft answers code questions. graphify answers "why is it built this way" — it indexes
the specs, decision records and `AGENTS.md` files that graft cannot see. Fall back to
grep, glob, or reading whole files only when neither index knows.

Check `.ai/specs/` for an existing spec before changing any module.

Rules that cause real damage if missed:

- Never query the database directly from a module. Go through the query engine, or you
  will leak data between customers.
- Never edit generated files, and never put feature code under `apps/mercato/src/`.
- Run `yarn generate` after adding or renaming module files.
- Never link one module's data to another's. Use an identifier and fetch separately.
- Never authorise on a role name. Use the permission id from that module's `acl.ts`.
- Never hardcode colours or user-facing text. Use the design tokens and locale files.

Plan before coding if the task has three or more steps or an architectural decision.
Ask me before reducing scope, changing a public contract, adding a dependency, or
touching several modules at once.

---

## Better than pasting

Put the block above where your tool reads it automatically:

| Tool | Where it reads from | Wired by `graft:init` |
|---|---|---|
| Claude Code | `AGENTS.md`, hooks, statusline, MCP, skill | Yes — nothing to paste |
| Codex | `AGENTS.md`, plus MCP + hooks in `~/.codex/` | Yes — nothing to paste |
| Copilot Chat | `.github/copilot-instructions.md` | Yes |
| Kiro | `.kiro/steering/graft.md`, `.kiro/settings/mcp.json` | Yes |
| Cursor | `.cursorrules` | Only with `--agents cursor` |
| Windsurf | `.windsurfrules` | Only with `--agents windsurf` |
| Anything else | — | Paste the block above |

Run `yarn graft:init --dry-run` to see exactly what it would touch before it touches it.

**The Codex wiring is global.** It writes `~/.codex/config.toml` and `~/.codex/hooks.json`,
which apply to every repo on that machine, not just this one. `yarn graft:init --no-global`
skips those — Codex still reads the `AGENTS.md` section, just without hooks or MCP.

Skills are separate: `yarn install-skills`. Codex reads `.agents/skills/` natively; Claude
Code needs the symlinks the script writes into `.claude/skills/`.

graphify is CLI-only for Codex — `graft:init` registers the graft MCP server but not
graphify's. Add it to `~/.codex/config.toml` by hand if you want the tools instead of the
shell commands.

## If the assistant ignores it

Two failure signs, both worth interrupting on:

- It greps or reads whole files for something `graft ask` would have answered.
- It writes a database query inside a module instead of using the query engine.
