# Checkpoint 26: Claude and Visible CLI Agent Modes

## Outcome

Users can launch visible Codex and Claude CLI sessions in the correct workspace/path and, where a stable structured Claude interface exists, use a managed Claude adapter without weakening provider boundaries.

## Source plan

- Sections 17.4-17.5
- Phase 10
- Backlog H006-H008

## Prerequisites

- Checkpoints 19, 22, and 24

## Scope

- Finalize visible CLI launch actions and session/terminal association.
- Add Claude terminal preset and selected-path launch.
- Add optional managed Claude structured adapter behind a feature flag.
- Map provider permissions and events into the common session model.
- Attach context packet or expose it through scoped MCP.
- Support resume only where the documented provider interface permits it.
- Preserve visible PTY mode as the fallback.

## Expected artifacts

- Visible Codex/Claude launch flows.
- Claude structured adapter or documented deferred adapter if no stable supported interface exists.
- Permission mapping table.
- Provider recordings and failure tests.
- Feature-flag and capability-detection behavior.

## Work items

1. Resolve launch CWD through terminal inheritance and workspace policy.
2. Display command, roots, MCP injection, and permissions before launch.
3. Capture structured output only through documented modes.
4. Never scrape undocumented terminal escape sequences for managed behavior.
5. Link visible terminal and managed sessions to context and file changes where evidence exists.
6. Handle missing binary, authentication, version, and provider errors.
7. Keep model/options configurable.

## Acceptance evidence

- Both CLIs launch visibly in the selected allowed path.
- Scoped MCP access works where configured.
- Managed Claude streams normalized events when the supported adapter is enabled.
- Unsupported managed capability falls back honestly to visible mode.
- Provider errors do not corrupt session or terminal state.
- No raw terminal output is indexed by default.

## Validation focus

- Missing/outdated CLI
- Provider output schema change
- Resume capability mismatch
- MCP configuration collision
- Untrusted workspace launch restrictions

## Out of scope

Provider-specific hidden reasoning, undocumented automation, and remote persistent terminals.

## Handoff

Document capability detection and the precise conditions under which managed Claude is enabled.
