# Second Brain OS Handover - Harness Settings and Session Fallback

**Date tag:** 2026-10-07
**Last updated:** 2026-10-07
**Scope:** Harness registration, ACP models, session-not-found fallback
**Status:** current

## Merged state

- PR: https://github.com/ToRRIIDeR97/Second-Brain-OS/pull/57
  - Merge commit: `73a29cea0300bd0d8335519c2a2d2f76e1d39bb6`.
  - Reviewed head: `cab147b` on `fix/session-not-found-fallback`.
- PR: https://github.com/ToRRIIDeR97/Second-Brain-OS/pull/58
  - Merge commit: `8356f18d0f000b13237ea3579ab55614cce99aeb`.
  - Reviewed head: `0956fe2` on `feat/harness-settings-page`.
- Both target `main`. Both heads are ancestors of `origin/main`.
- The user explicitly approved both merges. No branch protection blocked
  them, and no override was used.
- The remote branches were deleted by GitHub and the local branches with
  `git branch -d`.

## Changes

- **#57.** A tab pointing at a missing session now shows "Session not
  found" with Close tab instead of "Unknown error".
  - The cause was the shape of the error. The promise client throws raw
    error bodies, and Solid wraps them as `Error("Unknown error", { cause })`.
    `isSessionNotFoundError` only checked `cause.body`.
  - Fixed in `opencode/packages/app/src/utils/server-errors.ts`.
- **#58.** Harnesses are managed in Settings → Harnesses, and the
  `harness_register` chat tool is removed.
  - New routes: `GET /api/harness/settings`, `POST /api/harness/discover`,
    `POST /api/harness/registry`, and `PATCH`/`DELETE
    /api/harness/registry/:id`.
  - The registry gains `setEnabled`, `remove`, and `discover`. Runtime
    mutations refresh the cached instance list.
  - ACP reads models from `configOptions` and switches with
    `session/set_config_option` when the agent uses that shape.
  - Save stores the discovered model IDs.
  - Plan, contract, and tests are in
    `implementations/harness-settings-page/`.

## Verification

- #57:
  - The regression test was written first and failed.
  - `server-errors.test.ts` passes (13).
  - `bun run typecheck`, `lint`, `test`, and `build` pass.
- #58:
  - Plan tests: 20 core and 12 route tests pass. The baseline before
    implementation failed for the intended reasons.
  - `typecheck`, `lint`, `test`, and `build` pass.
  - `test:engine`: core 1115 pass. Server 3328 pass and 1 fail. The
    failure is the known flaky timeout in `httpapi-v2-pty.test.ts`; all 4
    tests in that file pass when run alone.
  - Manual check in the running dev app over CDP: Test (`opencode acp`,
    OpenCode 1.17.13, 429 models), then Save, disable, and remove.
- Combined state before merging #58: `main` with #57, merged into #58's
  head. App typecheck passed, and the `server-errors` and i18n parity
  tests pass (18).

## Known issues and next steps

- **Built-in harness credentials.** The built-in OpenCode harness can't see
  provider keys stored in `auth.json`. The V2 session runner reads only the
  `credential` table and environment variables, so OpenCode Go models fail
  with `ModelUnavailableError` and the chat looks stuck. Fixes needed:
  - Add an `auth.json` fallback or migration.
  - Show the model or provider error in the chat instead of hanging.
- **Reload abort.** A request cut off by a window reload is reported as a
  fatal renderer error (`ClientError: Transport` in `fetchMessages`).
- **`test:httpapi`** (not required) fails on `main`: 18 routes have no
  scenarios, including the 5 new harness routes.
- **Unused option.** `PermissionV2`'s `alwaysAsk` option has no caller left.
- **Arguments field.** The add dialog doesn't support quoted arguments that
  contain spaces.
- **Flaky test.** `httpapi-v2-pty.test.ts` times out under full-suite load.

## Local workspace

- `main` matches `origin/main` at `8356f18`, and the working tree is clean
  except for this handover.
- `~/.config/opencode/harnesses.json` holds the user's `opencode-cli` entry
  (`opencode acp`, with model `opencode-go/glm-5.3-flash`).
- The dev app is running in the Terminal panel tab "Second Brain OS dev".
