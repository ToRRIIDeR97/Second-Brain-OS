# Project card v2

Project card v2 is the canonical Project record stored at
`projects/<project_id>.md` in the designated Brain workspace. The card records
what the Project is trying to achieve and its current state. It does not grant
access to a linked workspace.

Writers emit `contract: project_card` and `version: 2`. Required front matter
is `id`, `type: project`, `title`, `outcome`, `status`, `instructions`,
`progress_percent`, `tags`, `created_at`, and `updated_at`. Optional fields are
`template_id`, `next_milestone`, `blocker`, and `location`.

`location.workspace_id` is the only link to an access boundary.
`location.display_path` is a human-readable alias and must never be accepted by
file, terminal, Git, or agent commands as authorization. Projects may omit
`location` until a workspace is linked.

```markdown
---
contract: project_card
version: 2
id: project_01K4B
type: project
title: Agent Operating System
outcome: Ship an inspectable local agent control center.
status: active
instructions: Keep changes small and show every consequential write.
progress_percent: 35
next_milestone: Connect the first live provider.
blocker: null
tags: [agents, local-first, desktop]
location:
  workspaceId: ws_01K4A
  displayPath: ~/Projects/agent-operating-system
created_at: 2026-07-27T08:00:00Z
updated_at: 2026-08-22T08:00:00Z
---
# Agent Operating System

This body remains human-owned and is preserved when Project fields change.
```

Readers adapt v1 cards by treating the required v1 workspace fields as a
location, using the first body paragraph as `outcome`, and defaulting progress
to zero. The next successful write upgrades the front matter to v2 while
preserving unknown front matter and the Markdown body.
