---
title: "Exact legacy templates need a locked execution path, not editable reconstruction"
modules: ["appointments"]
areas: ["architecture","backend-ui","testing"]
topics: ["backward-compatibility","ui-components","testing"]
---

# Exact legacy templates need a locked execution path, not editable reconstruction

**Context**: A visual editor attempted to recreate two branded appointment emails from editable fields, but details such as images, underlines, spacing, links, and audience-specific footer copy drifted from the established React Email output.

**Problem**: A configurable representation cannot promise exact compatibility when it translates a hand-authored template into a different structure. More controls also make ordinary users responsible for dynamic placeholders and fragile layout details.

**Rule**: When exact legacy output is a requirement, preserve the original renderer as a locked default path and regression-test that the selector returns its element tree directly. Lock visual dependencies such as the font stack inside that template too; importing a mutable shared typography constant can change weight, wrapping, and spacing without touching the template. Put customization behind an explicit alternate mode, keep structural and dynamic business data code-owned, and preview unsaved output with realistic samples rather than asking users to author template syntax.

**Applies to**: Branded transactional emails, printable documents, and any editable template feature that must preserve an existing exact-output compatibility mode.
