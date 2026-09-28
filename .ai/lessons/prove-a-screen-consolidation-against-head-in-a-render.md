---
title: "Prove a screen consolidation against HEAD in a render harness, and keep effect order"
modules: ["appointments","wms"]
areas: ["backend-ui","testing"]
topics: ["ui-components","testing","refactoring","effect-order"]
---

# Prove a screen consolidation against HEAD in a render harness, and keep effect order

**Context**: The 2026-09-28 dedup pass merged the appointments create and edit forms (two ~880-line pages) into a shared `useAppointmentFormFields` hook, under a requirement that rendered output and API behaviour stay unchanged (`.ai/specs/2026-09-28-codebase-dedup-and-canonical-adoption.md`).

**Problem**: The first cut moved the page's `locationId` state into the hook. The create page's clone effect then had to be declared after the hook's loaders, so the page issued the branch-list request before the clone request instead of after. In the clone flow both responses set `locationId`, and whichever lands last wins — so the new order changed which branch's services the form listed. Typecheck, the existing tests and a code read all passed; only a HEAD-vs-new comparison caught it.

**Rule**:
- State that a page's own effects write stays in the page and is passed to the shared hook; the page declares its effects where HEAD had them. Effects that issue no request on mount (e.g. a debounced search) may move.
- Prove the merge against HEAD, not against the previous edit:
  - write the HEAD page copies into a temporary `__tests__/` folder with `git show`, so escapes and literal characters survive;
  - mock `CrudForm` to serialize its props and to call each custom field's `component(...)`, and keep the real primitives and `I18nProvider`;
  - render HEAD copies with HEAD's dictionaries and the new pages with the tree's;
  - compare normalized HTML (React `useId` values: `_r_N_`, `:rN:`, `«rN»`), API calls with raw bodies, flashes, redirects and form writes;
  - cover every locale, the interaction states and a submit matrix.
- Delete the harness afterwards and keep focused unit tests of the extracted helpers.
- When a difference is a latent bug (the edit form's phone join), keep it behind an explicit option and report it instead of fixing it silently.
