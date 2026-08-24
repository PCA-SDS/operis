# Board-to-PR Workflow

How to take an unreviewed change in the working tree, turn it into tracked tasks on the
project board, commit it so every commit points at its task, and open a PR that closes
the lot on merge.

Read this end to end before starting. Steps 1 and 2 are analysis; do not create anything
on GitHub until the split is settled.

---

## 0. Context

| Thing | Value |
|---|---|
| Repo | `PCA-SDS/operis` (`R_kgDOUA44FQ`) |
| Project | **operis v1** — org project `#5` (`PVT_kwDOESQTUM4BhTkh`) |
| Default branch | `main` — never merge into it directly |
| Sprints | 1 week, Monday start |

### Field IDs

Cached for speed. If a call 422s, re-read them rather than guessing — options get renamed.

```bash
gh project field-list 5 --owner PCA-SDS --format json
```

| Field | Field ID | Options |
|---|---|---|
| Status | `PVTSSF_lADOESQTUM4BhTkhzhgPxWE` | Backlog `6ea952d7` · Todo `727e0086` · In progress `959c5e1e` · In code review `708b7d04` · Done `6d9c87dd` |
| Sprint | `PVTIF_lADOESQTUM4BhTkhzhgPxnY` | iteration IDs rotate — look them up (below) |
| Module | `PVTSSF_lADOESQTUM4BhTkhzhgP0Oo` | CRM `7f7c4908` · Authentication `cd0072ec` · Automation `9b2ebe8e` · UI `b7c5e703` · Email Template Builder `c4613aa1` · Form Builder `1d221e3c` · Invoice `e759e2fa` · Task Manager `8860f845` |
| Priority | `PVTSSF_lADOESQTUM4BhTkhzhgPxy8` | P0 `b20f74b8` · P1 `e24580be` · P2 `84776819` · P3 `fa0884d8` |
| Estimate | `PVTF_lADOESQTUM4BhTkhzhgPxzA` | number (story points) |

Issue types are org-level: Task `IT_kwDOESQTUM4CA4IJ` · Bug `IT_kwDOESQTUM4CA4IK` · Feature `IT_kwDOESQTUM4CA4IL`.

Current sprint's iteration ID:

```bash
gh api graphql -f query='{ node(id:"PVTIF_lADOESQTUM4BhTkhzhgPxnY") { ... on ProjectV2IterationField { configuration { iterations { id title startDate } } } } }'
```

### Status Ladder

| Status | Means |
|---|---|
| Backlog | Not committed to a sprint. No start date. |
| Todo | Has a start date, committed to a sprint. |
| In progress | Actively being worked this sprint. |
| In code review | A PR is open for it. |
| Done | Merged. |

---

## 1. Analyze Source Control

Establish **what actually changed** before deciding anything. Do not trust the commit
subjects; read the diff.

```bash
git status --short | wc -l
git log --oneline -20
git diff --stat | tail -3
```

Then narrow to the feature under discussion:

```bash
git diff --name-only | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20
```

Work through these questions and write the answers down:

1. **Is the work committed, uncommitted, or both?** A recent commit touching the same
   area may be a *previous* iteration that the uncommitted diff partly reverses. Say which
   one you are basing tasks on.
2. **Is there a spec?** Check `.ai/specs/` — including untracked files, which `git status
   --short | head` will hide. A spec's decision table is the authoritative "why" and should
   drive the task split. `ls -la .ai/specs/`
3. **Which files carry logic and which are mechanical?** A 189-file diff is usually ~6
   real files plus a sweep. Group them:
   ```bash
   git diff --name-only | grep -vE '<mechanical patterns>'
   ```
4. **Spot-check the sweep.** Read 2–3 diffs from the "mechanical" bucket to confirm they
   are what you think. This is where mis-grouping happens — one file in a casing sweep may
   actually be a real change wearing the same extension.
5. **Do the logic files overlap?** If six concerns all live in one rewritten file, they
   cannot become six commits. Find that out now, not at commit time.

---

## 2. Split Into Tasks

One **parent** issue (type `Feature`) describing the change as a whole, plus **sub-issues**
(type `Task`) — one per independently reviewable concern.

Rules:

- Split by **concern**, not by file. "Repaint the tokens" and "remove the collapse state"
  are separate tasks even if both touch one file.
- A sub-issue should be 1–5 points. If it is bigger, split again.
- Every sub-issue body carries: **why**, the **specific files**, and a **definition of done**.
- Fold **tests** into each task's definition of done. Do not make "write the tests" a task —
  repo policy is that tests ship with the change.
- Put the **traps** in the body: the non-obvious constraints the diff's own comments flag.
  These are the highest-value part of a task description.
- Give the **parent no Estimate**. Points live on the children, or the burn-up double-counts.

Sanity check the split against the spec's decision table before creating anything. If a
decision has no task, you missed one.

---

## 3. Create the Tasks

Write each body to its own file first — inline `--body` strings mangle markdown.

```bash
gh issue create --repo PCA-SDS/operis --title "<title>" --body-file <file>.md --label <label> --assignee <user>
```

Labels available: `feature` `enhancement` `refactor` `bug` `documentation` `accessibility`
`test` `dependencies` `P0` `P1` `P2`.

Then per issue — set its type, link it to the parent, add it to the board, set its fields:

```bash
gh api graphql -f query='mutation { updateIssue(input:{ id:"<ISSUE_NODE_ID>", issueTypeId:"IT_kwDOESQTUM4CA4IJ" }) { issue { number } } }'
```

```bash
gh api graphql -f query='mutation { addSubIssue(input:{ issueId:"<PARENT_NODE_ID>", subIssueId:"<CHILD_NODE_ID>" }) { issue { number } } }'
```

```bash
gh project item-add 5 --owner PCA-SDS --url <ISSUE_URL> --format json
```

```bash
gh project item-edit --id <ITEM_ID> --project-id PVT_kwDOESQTUM4BhTkh --field-id <FIELD_ID> --single-select-option-id <OPTION_ID>
```

Use `--iteration-id` for Sprint and `--number` for Estimate.

Get a node ID with `gh issue view <N> --repo PCA-SDS/operis --json id --jq .id`.

**Budget ~15s per issue** — creating ten takes over two minutes. Script it, run it in the
background, and verify afterwards rather than letting a foreground call time out. If it does
time out, check what landed before re-running; the script is not idempotent.

Verify:

```bash
gh api graphql -f query='{ repository(owner:"PCA-SDS",name:"operis") { issue(number:<PARENT>) { subIssues(first:20) { totalCount nodes { number title } } } } }'
```

---

## 4. Commit, Linking Each Commit to Its Task

### The Three Linking Mechanisms

| Where | Effect |
|---|---|
| `#42` in a **commit message** | Cross-reference in #42's timeline. Any branch. Does **not** close. |
| `Closes #42` in a **commit message** | Same, plus closes — but only when the commit lands on `main`. |
| `Closes #42` in the **PR body** | Populates *Linked issues*, closes on merge. |

**Use `Refs #NN` in commits and `Closes #NN` in the PR body.** That gives a per-commit audit
trail plus exactly one close event per task at merge, instead of closes scattered across
whichever commits happen to reach `main`.

### Branch

```bash
git checkout -b <type>/<slugged-summary>
```

Slugged from the PR title (see §6). One branch per parent issue.

### Commits

Group commits by what is **separably stageable**, and reference every task each commit
serves. Do not invent a commit per task if the files do not separate — a commit that
references six tasks is honest; a fake split is not.

```bash
git add <paths> && git commit -m "<type>(<scope>): <prose subject>" -m "Refs #76"
```

Commit subjects stay **conventional commits** (`feat(ui): rebuild the sidebar as a single
fixed rail`) to match existing history — note the type comes first there, unlike the PR
title, where an optional scope leads. The two conventions are deliberately separate; do not
reformat the git log to match the PR.

Order the commits so the sweep goes last, then stage it with `git add -u` to sweep up
everything remaining rather than listing 180 paths.

If one file genuinely mixes two concerns, either use `git add -p` to split the hunks, or
put it with the concern whose *code* references it and say so in the PR body. Do not
silently mix.

```bash
git push -u origin <type>/<slugged-summary>
```

---

## 5. Open the PR

```bash
gh pr create --repo PCA-SDS/operis --base main --title "<type>: <plain english summary>" --body-file PR_BODY.md
```

Then label it per repo policy: exactly one `priority-*`, exactly one `risk-*`, plus
`review`. A change touching any `.tsx` outside tests, anything under `packages/ui/src/`, or
any `**/components/**` needs `needs-qa` — it does **not** qualify for
`skip-qa`.

Set the board to **In code review**, or enable the project workflow that does it (§7).

---

## 6. Conventions

### PR Title

Two accepted forms — the second when the change belongs to one clear area:

```
<type>: <plain english summary>
<scope> (<type>): <plain english summary>
```

`<type>` is one of `feature` `fix` `refactor` `docs` `chore` `test`.
`<scope>` is the module or package the change lives in — `ui`, `crm`, `auth`, `tasks`.

The summary is **plain English with spaces**. No dashes, no kebab-case, no snake_case.
Lowercase except for proper nouns, imperative or descriptive, and no trailing period.

```
feature: rework the backend sidebar into a fixed navy rail
ui (fix): stop the scroll fade covering the last nav row
auth (refactor): gate module access per user instead of per tenant
docs: document the sidebar rail contract
```

The **branch** cannot carry spaces, so slug the summary for it — lowercase, hyphens,
scope folded in where there is one:

```
feature/rework-backend-sidebar-navy-rail
fix/ui-scroll-fade-covering-last-row
```

### PR Body

Drop any section that would be empty. Keep the closing keywords last.

````markdown
## Description

<What this changes and why, in two to four sentences. Present tense.>

Spec: `.ai/specs/<file>.md`

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Refactor
- [ ] Documentation

## How to Review

<For diffs over ~20 files: which files carry the logic, and what the rest is.>

## How Has This Been Tested?

- [ ] Unit tests
- [ ] Integration tests
- [ ] Manual QA

<Which file covers what. Then: `yarn lint && yarn typecheck && yarn test`>

## Checklist

- [ ] Branched from `main` — one task, one branch
- [ ] Follows `.ai/ds-rules.md` — no hardcoded colours, no arbitrary values, correct surface tokens
- [ ] No hardcoded user-facing strings — i18n keys used
- [ ] Tests added or updated for the changed behaviour
- [ ] `yarn lint && yarn typecheck && yarn test` pass
- [ ] Board cards moved to In code review

## Notes

<Migration concerns, lingering artefacts, drive-by fixes, traps a maintainer would trip on.>

## Related Issues

Closes #<parent>
Closes #<child>
````

---

## 7. Board Automation

These are UI-only — there is no create/update mutation for project workflows. Set them once
in **Project ⋯ → Workflows**:

| Workflow | Set to |
|---|---|
| Item added to project | Backlog |
| Pull request linked to issue | In code review |
| Pull request merged | Done |
| Item closed | Done |

With these on, opening the PR moves every linked card to *In code review* and merging moves
them to *Done*. Without them, the `Closes` keywords still close the issues but the cards sit
where you left them.

### Check They Are On

Do this **before relying on them, and again immediately after any edit to the Status field**:

```bash
gh api graphql -f query='{ node(id:"PVT_kwDOESQTUM4BhTkh"){ ... on ProjectV2 { workflows(first:20){ nodes{ number name enabled } } } } }'
```

Editing a single-select's options deletes the old option IDs, and GitHub silently disables
every workflow that pointed at one. Rewriting the Status ladder therefore switches off *Item
closed*, *Pull request merged* and *Pull request linked to issue* with no warning and no
error — they have to be re-pointed and re-enabled by hand in the UI.

What makes this easy to miss: a workflow that does **not** reference a Status option (*Auto-add
sub-issues to project*) survives the edit. Seeing one workflow still enabled reads as "the
automation is fine" when in fact every status transition is dead.

### After Merging

An issue's **state** (open/closed) and its **Status field** are independent. `Closes #NN`
sets the first and never touches the second. Confirm both actually moved — adjust the issue
range:

```bash
gh api graphql -f query='{ node(id:"PVT_kwDOESQTUM4BhTkh"){ ... on ProjectV2 { items(first:50){ nodes { content { ... on Issue { number state } } fieldValues(first:20){ nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } } } } } }'
```

If the issues closed but the cards did not move, the workflows were off. Fix them for next
time, then backfill this batch — set the range and the target option ID (Done is `6d9c87dd`):

```bash
gh api graphql -f query='{ node(id:"PVT_kwDOESQTUM4BhTkh"){ ... on ProjectV2 { items(first:50){ nodes { id content { ... on Issue { number } } } } } } }' --jq '.data.node.items.nodes[] | select(.content.number != null and .content.number >= <FIRST> and .content.number <= <LAST>) | .id' | while read -r id; do gh project item-edit --id "$id" --project-id PVT_kwDOESQTUM4BhTkh --field-id PVTSSF_lADOESQTUM4BhTkhzhgPxWE --single-select-option-id 6d9c87dd; done
```

---

## 8. Gotchas

- **`Type` is a reserved project field name.** GitHub owns it for org-level Issue Types.
  Use the native types; adding new ones is an org-wide settings change affecting every repo,
  so ask before doing it.
- **View group-by is not settable via API.** `createProjectV2View` accepts name, layout,
  filter and visible fields only. Group-by, sort-by and slice must be set in the UI.
- **Replacing a single-select's options deletes the old option IDs**, which silently
  disables any project workflow that pointed at one — no error, and one unrelated workflow
  stays enabled to make it look fine. Re-check Workflows after every Status edit (§7).
- **Closing an issue does not move its card.** Issue state and the Status field are separate;
  only a project workflow bridges them. Verify after merge (§7), do not assume.
- **Closing keywords only close issues in the same repo** unless written `owner/repo#N`.
- **Squash merge** concatenates commit messages into the squash body, so `Refs #NN` survives
  — unless someone trims that body. The PR-body `Closes` lines are the reliable link.
- **`gh project field-create` cannot make iteration fields.** Use the GraphQL
  `createProjectV2Field` mutation with `iterationConfiguration`.
- **Untracked files hide from a truncated `git status`.** Always check for an untracked spec.
