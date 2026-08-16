# Issue Tracker

This repo uses a local Markdown issue tracker for agent planning.

## Wayfinding operations

Wayfinder maps and tickets live in `.alves/issues/`.

Each issue is a Markdown file with YAML frontmatter:

```yaml
---
title: "Human-readable issue name"
status: open
labels:
  - wayfinder:grilling
parent: .alves/issues/example-map.md
assignee:
blocked_by:
  - .alves/issues/example-blocker.md
created: 2026-07-17
---
```

- A map is an issue with label `wayfinder:map`.
- A ticket is a child issue whose `parent` points to the map file.
- A ticket is claimed by filling `assignee`.
- A ticket is closed by changing `status` to `closed` and adding a resolution comment section.
- Blocking is represented by `blocked_by`; a frontier ticket is open, unassigned, and has no open blockers.
- Refer to issues by title in human-facing text, with the file path as the link target.

