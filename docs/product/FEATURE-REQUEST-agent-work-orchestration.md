# Feature request: agent work orchestration

- Status: proposed
- Scope: OpenCode Electron application (`opencode/`), not the legacy Tauri donor (`app/`)
- Goal: make agent work easier to delegate, resume, connect, and automate across Projects while keeping every action bounded, inspectable, and approved.

## Problem

The application already has sessions, model selection, Codex harness support,
custom-agent configuration, subagent execution, and plugin lifecycle hooks.
Those primitives are not yet exposed as one coherent workflow:

1. A user cannot attach an existing thread from another Project to the current
   conversation.
2. A user can manually create a session and choose its model, but an agent
   cannot create a standalone user-owned thread from an explicit request.
3. There is no durable scheduled-run system.
4. Custom subagents require configuration files or the CLI; there is no
   desktop management surface.

## Requested outcome

### Thread references

Users can search for a thread with `@`, select it, or drag it into a composer.
The resulting card identifies its Project, thread, and optional message/turn.
The receiving agent gets an inspectable, bounded reference summary—not an
unbounded transcript.

The implementation must carry a typed session-reference part through the
composer and server, validate its server/workspace/session identity, and obey
cross-project read policy. Workspace content and referenced transcripts remain
data, not instructions.

### Explicit thread creation

When a user explicitly asks, the active agent can create a new, user-owned
thread under the requested Project with a selected agent and model. Examples:

- “Create a new thread under this project using OpenCode DeepSeek V4.1 Flash.”
- “Make Codex 5.6 Sol at medium handle this implementation in a new thread.”

The action must resolve only configured, connected provider models or
available harness models. It must not hard-code friendly model names. It
requires an approval before creating the thread, then opens the returned
thread and records the creator, selected model, Project, and source request.

This is distinct from the existing `task` tool: `task` creates a constrained
child subagent session, whereas this feature creates a standalone thread the
user owns and can continue directly.

### Scheduled runs and hooks

Users can create a one-time or recurring run for a Project/thread with prompt,
agent/model, timezone, schedule, and notification policy. Runs survive app
restart, avoid duplicate execution, retain status/history, and use normal
session permission checks.

Lifecycle hooks should receive durable automation events such as queued,
started, completed, failed, and needs-approval. Existing plugin chat/tool/
permission hooks remain extension points; they are not the scheduler itself.

### Custom subagent management

Add an Agents settings page to create, edit, disable, and remove global or
project-scoped agents. It should manage the existing canonical Markdown/config
definitions and expose description, mode, provider/model, variant, system
prompt, permissions, step limit, and visibility. Existing subagent execution,
permission inheritance, and configured depth limits should be reused.

## Existing capabilities to reuse

- The new-session composer already creates sessions with selected worktree,
  agent, provider model/variant, and harness model.
- The session and model APIs already expose session creation, listing, model
  discovery, and model switching.
- The Codex harness already discovers its model list and reasoning efforts.
- The `task` tool already creates configured subagent child sessions with
  inherited permissions and optional background execution.
- Markdown/config custom-agent discovery already supports model, prompt, mode,
  permissions, visibility, color, and step limits.
- Plugin hooks and durable events can carry automation lifecycle notifications.

## Constraints

- Keep implementation inside `opencode/`; do not revive or duplicate the
  legacy Tauri agent runtime in `app/`.
- Preserve OpenCode's Electron host, renderer, local server, and session
  workflows.
- Use workspace IDs and validated relative paths at renderer boundaries.
- A timer must not bypass the normal session, model, permission, or approval
  path.
- Do not use process-local background jobs as the scheduler's source of truth.
- Do not expose unrestricted filesystem, shell, provider, or transcript access
  through thread references or schedules.
- Persist only metadata, bounded context artifacts, and audit data necessary
  for recovery; never log secrets, hidden reasoning, or full terminal output.

## Delivery slices

1. Add a guarded `create_thread` action/tool on top of existing session
   creation and dynamic model/harness discovery.
2. Add desktop custom-agent management using the existing Markdown/config
   store and reload path.
3. Add typed, bounded session-reference cards with `@` search and drag/drop.
4. Add a durable automation domain: schedule/run persistence, due-time and
   recurrence evaluation, claiming/leases, idempotency, retry/recovery,
   history, notifications, and hook events.

## Acceptance criteria

- A user can create and open a new Project thread with a valid selected model;
  unavailable or ambiguous model names produce a clear choice instead of a
  guessed model.
- A referenced thread card works through both `@` search and drag/drop, shows
  its origin, and cannot expose an unauthorized Project or an unbounded
  transcript.
- An agent-created thread and a configured subagent remain distinguishable in
  navigation and audit history.
- A scheduled run resumes safely after an application restart, executes at
  most once per intended occurrence, and records completion, failure, or an
  approval requirement.
- An edited custom agent persists in the existing config/Markdown format,
  reloads into the agent registry, and is available to the task/subagent
  workflow according to its mode and permissions.

## Required verification

- Unit tests for model resolution, session-reference authorization/bounding,
  schedule due-time calculation, lease recovery, duplicate suppression, and
  agent-definition validation.
- Integration tests for explicit thread creation, reference attachment,
  scheduled-run restart recovery, and custom-agent CRUD/reload.
- Targeted UI coverage for model selection, thread drag/drop, and the Agents
  settings flow.

## Audit references

- `opencode/packages/app/src/components/prompt-input-v2.tsx`
- `opencode/packages/app/src/components/prompt-input/submit.ts`
- `opencode/packages/app/src/components/prompt-input/harness-controls.tsx`
- `opencode/packages/opencode/src/tool/task.ts`
- `opencode/packages/core/src/config/agent.ts`
- `opencode/packages/plugin/src/index.ts`
- `opencode/packages/core/src/background-job.ts`
