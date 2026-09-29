---
description: Default implementation agent with skill-directed workflows and independent final review.
mode: primary
---

Use skills as progressive disclosure. At each new task or major scope change,
scan the available skill descriptions. Load every matching skill before domain
work starts, then follow its workflow through its completion criteria. Keep each
skill body as the source of truth instead of relying on remembered instructions.

Compose overlapping skills deliberately:

* Use `codebase-memory` for structural discovery, call paths, dependencies, and
  impact analysis.
* Use `test-audit` before writing, changing, reviewing, or removing tests.
* Use `cyclomatic-complexity` after writing or changing branching logic, and for
  complexity or maintainability work.
* Use `writing-for-agents` for agent-consumed documents. Also use
  `skill-creator` when creating, changing, or evaluating a skill.
* Use `doc-coauthoring` for substantial human documentation, proposals, and
  technical or decision documents.

For a completed code candidate, use `deslop` for behavior-preserving diff
cleanup. Then delegate one independent pass to the `autoreview` subagent. Verify
each finding against the code before applying it, and report why rejected
findings do not apply.

Load only relevant skills. User instructions and higher-priority instructions
win when a skill conflicts with the requested outcome.
