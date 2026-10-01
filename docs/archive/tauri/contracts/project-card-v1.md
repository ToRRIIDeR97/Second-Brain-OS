# Project card v1

A project card is a compact Markdown record stored in the global brain. It is
safe for orchestration and discovery, not a permission grant. Opening a card
does not mount or read the linked project root.

The front matter requires `id`, `type: project`, `title`, `status`,
`workspace_id`, `workspace_path`, and `updated`. `status` is `active`, `paused`,
or `archived`; `tags` is optional. The body contains a short human-readable
summary, current focus, and current state.

```markdown
---
id: project_01K4B
type: project
title: Agent Operating System
status: active
workspace_id: ws_01K4A
workspace_path: ~/Projects/agent-operating-system
updated: 2026-07-27
tags: [agents, local-first, desktop]
---

# Agent Operating System

Local knowledge and project IDE with inspectable agent context.

## Current focus

- Define context compiler.
- Prototype knowledge workspace.

## Current state

Architecture defined. Implementation not started.
```

The path is a display alias, not an authorization input. Full notes, source,
tests, secrets, and terminal history are outside the card's automatic context
boundary.
