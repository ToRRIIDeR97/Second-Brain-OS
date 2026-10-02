# Threat model for the active desktop app

This document covers the OpenCode Electron fork in `opencode/`. The former
React/Tauri application is retired, so its Rust policy and MCP
sidecar design are not current desktop controls.

## Assets and boundaries

| Boundary                   | Current control and location                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer to native process | The main window uses `contextIsolation`, `sandbox`, and disabled `nodeIntegration`. `opencode/packages/desktop/src/preload/index.ts` exposes specific IPC methods implemented in `opencode/packages/desktop/src/main/ipc.ts`.                                                                                                                                          |
| Renderer to managed server | Electron starts the OpenCode server on `127.0.0.1` with a generated password. Server authorization checks credentials for protected routes. See `opencode/packages/desktop/src/main/index.ts` and `opencode/packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`.                                                                         |
| Server to workspace files  | Second Brain handlers run in an instance location context. Note and project code resolves targets through `LocationMutation` before reading or writing files. See `opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/second-brain.ts`, `opencode/packages/opencode/src/knowledge/note.ts`, and `opencode/packages/opencode/src/project/brain.ts`. |
| Desktop to Google          | Calendar and Tasks integration uses OAuth in the Electron main process. The service encrypts its client secret and refresh token with Electron `safeStorage` and disables connection when secure storage is unavailable. See `opencode/packages/desktop/src/main/google-calendar.ts`.                                                                                  |

Workspace notes, projects, calendar files, session data, provider tokens, and
agent tool permissions are sensitive. Treat note contents, provider responses,
workspace files, URL input, and IPC arguments as untrusted. Keep file access
within the selected workspace and use the existing mutation services. Never
log credentials or full private content.

## Credentials, extensions, and recovery

Google token encryption is specific to the desktop integration. It does not
establish encryption for every provider credential store. The runtime also
uses profile data such as `auth.json` and SQLite databases; treat the whole
profile as sensitive and exclude it from source control and release artifacts.

Configured plugins execute code in the local runtime. Dependency installation
and plugin initialization can therefore affect both access and startup time.
Review plugin origins and package changes, retain the Bun lockfile and local
patches, and do not treat a plugin as sandboxed workspace content. Build and
packaging scripts also download upstream binaries, as described in
[release operations](../release-operations.md).

Workspace validation and agent tool permissions are different controls.
Keep the existing permission checks on tool execution; a user opening a note
does not authorize instructions embedded inside it. Destructive recovery must
preserve both canonical workspace files and session/draft profile state.

## Checks

From the repository root, `bun run typecheck` checks desktop, renderer, core,
and server types. `bun run test` checks desktop, renderer, and Second Brain
domains; `bun run test:engine` runs core and server suites. `bun run lint`
checks `opencode/`. These commands are defined
in the root `package.json`.
Relevant focused tests include
`opencode/packages/desktop/src/main/google-calendar-domain.test.ts`,
`opencode/packages/opencode/test/project/brain.test.ts`, and the note tests
under `opencode/packages/opencode/test/knowledge/`. Run server tests from
`opencode/packages/opencode` with Bun when changing those paths. CI and
release operations now target Electron; local test results do not establish
cross-platform installer or signed-update safety.

Focused commands from `opencode/packages/opencode`:

```sh
bun run test ./test/knowledge ./test/planner ./test/project/brain.test.ts
bun run test ./test/server/httpapi-instance-route-auth.test.ts ./test/server/httpapi-ui.test.ts
```

From `opencode/packages/desktop`:

```sh
bun test src/main/google-calendar-domain.test.ts src/main/attachment-picker.test.ts src/main/external-url.test.ts
```

This is a source-level map of the controls found during setup, not a security
audit. Recheck the implementation and its tests before changing a boundary.

## Session export boundary

`save-session-export` accepts a JSON string and a basename, not a renderer
filesystem path. Main validates the basename, JSON syntax, and a 32 MiB size
limit, then asks the user to choose the destination with Electron's native
save dialog. Cancellation returns false; success follows the completed write.
This operation does not grant general renderer write access. Exports contain
private session content and are written only to the destination chosen by
the user. The IPC handler delegates validation and writing to
`packages/desktop/src/main/session-export.ts`.

Native session fork and diff endpoints use the existing session-location
middleware and authenticated HTTP boundary. Forks receive new message IDs;
opaque provider continuations and assistant filesystem snapshots are excluded
from the copied history. Review snapshots remain scoped to the session's
location and canonical Git worktree.

## Known gaps

Found during the 2026-10-02 scope audit and not yet fixed. Paths are relative
to `opencode/packages/desktop/src/main/`.

- `open-path` (`ipc.ts`) opens any renderer-supplied path, optionally with a
  renderer-supplied application through `execFile`. `reveal-path` accepts any
  path. Neither uses a workspace ID or validated relative path.
- `store-*` handlers pass a renderer-chosen store name to `getStore`
  (`store.ts`), which creates an `electron-store` file under `userData`
  without validating the name.
- IPC handlers other than `set-native-translations` do not check
  `event.senderFrame`.
- Server authorization also accepts an `auth_token` query parameter, so the
  credential can appear in URLs. `windows.ts` logs full blocked URLs.
- `drafts.sqlite` stores unsent draft content unencrypted in the profile.
