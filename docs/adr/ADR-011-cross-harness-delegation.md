# ADR-011: Let agents delegate to other harnesses through a loopback MCP endpoint

- Status: proposed
- Date: 2026-10-25
- Supersedes: none

## Context

A Run uses one harness: the built-in loop, Codex, or an ACP agent such as
Claude Code. Users want an agent in one harness to hand a task to an agent in
another, for example Claude Code asking Codex with a GPT model to do computer
use. This differs from a subagent, which runs inside the same harness and is
that harness's own feature (Claude Code's Task tool, OpenCode's `task`).

Today no app tool reaches an external harness. The ACP driver sends
`mcpServers: []` and Codex gets no MCP configuration. External harnesses
ignore the tool list the runner builds. The app hosts no MCP server
([ADR-006](ADR-006-single-mcp-server.md) was superseded).

## Options

### H1: Loopback MCP endpoint with per-runtime tokens (chosen)

Core serves a small MCP server over Streamable HTTP on `127.0.0.1`. Each
harness runtime gets its own bearer token, bound to the Run that owns it and
revoked when the runtime closes. ACP agents receive the server in
`session/new` (`mcpServers`, `type: "http"`). Codex receives
`-c mcp_servers.tenon.*` overrides and reads the token from an environment
variable. The built-in loop gets the same four tools natively. Every
delegated task is a real child Run (`parentID` = the caller).

- One mechanism works for every harness that speaks MCP over HTTP: Codex,
  Claude Code's ACP adapter, OpenCode.
- Child Runs reuse what already exists: they nest under the caller in the
  sidebar, their approvals surface in the caller's composer, and each keeps
  its own transcript, model and cost.
- The token identifies the caller, so the endpoint needs no other auth and
  cannot be used to act as a different Run.
- It adds a second loopback port and an MCP protocol surface to maintain.
  ACP agents that don't advertise HTTP MCP get no delegation tools.

### H2: Per-driver native tool channels

Use each protocol's own client-tool hook, for example Codex dynamic tools.

- No extra port.
- ACP has no client-tool mechanism besides MCP, so Claude Code would get
  nothing. Every new driver needs its own integration.

### H3: CLI shim on PATH

Ship a `tenon-delegate` command and an environment token, and have agents
call it from their shell tool.

- Works in any harness with a shell.
- Codex's `workspace-write` sandbox blocks loopback network from shell
  commands. Every call goes through shell approval. The agent has to be told
  the command exists, and its arguments are untyped.

## Decision

Use H1.

- The endpoint and tokens live in `core/src/harness/delegation.ts`. They are
  process-global because harness runtimes are built per Location, while the
  endpoint is one port for the server process. The listener starts on the
  first harness runtime that needs it. It refuses requests that carry an
  `Origin` header, so a browser page cannot reach it.
- The task work lives in `core/src/harness/delegation-tasks.ts`, a layer the
  server mounts next to its routes. It owns no storage: a task ID is the
  child Run's session ID, and its result is the child's last assistant reply.
- Four tools: `list_agents`, `delegate_task` (waits up to `wait_seconds`,
  default 300, max 600), `task_result` and `cancel_task`. A task that outlives
  one call is collected with `task_result`, so MCP client timeouts never cut
  off a long run. Codex's tool timeout is set to 660 seconds.
- Limits: a delegated agent may delegate once more (depth 2), and a Run may
  have at most four tasks running at once. Only the Run that started a task
  can read or stop it.

## Consequences

The calling agent decides when to delegate, based on what the user asked or
on `AGENTS.md` guidance such as "use Codex for computer use". The delegated
agent sees only the task text, not the caller's conversation. Its reply comes
back as tool output, so the caller must treat it as untrusted data, like any
other tool result.

A parent Run that is interrupted doesn't stop its children; they keep running
in their own threads until they finish or the user stops them. Results are
read from the child Run, so `task_result` still works after a restart, but a
task that was running when the app closed is not resumed.

A stdio MCP bridge for ACP agents without HTTP MCP support, and a UI to choose
delegation targets per workspace, are possible follow-ups. Neither is needed
for Codex or Claude Code.
