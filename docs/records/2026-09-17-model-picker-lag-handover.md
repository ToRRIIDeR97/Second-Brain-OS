# Second Brain OS Handover - Model Picker Lag

**Date tag:** 2026-09-17
**Last updated:** 2026-09-17
**Scope:** OpenCode renderer model selection and GitHub CI
**Status:** current

## Merged state

- PR: https://github.com/ToRRIIDeR97/Second-Brain-OS/pull/10
- Target: `main`.
- Merge commit: `fa9f7a2ccf29e41f2fd2fc1ab3ee841cd7443db0`.
- Reviewed head: `b888998bcb8346e39b51bcce6192a1db8e6d5a82` on `codex/model-picker-lag`.
- Verified GitHub reports the PR merged, the head is an ancestor of `origin/main`, and the three changed files match the reviewed head exactly.
- The user explicitly requested the merge after disabling automatic CI. No branch protections or applicable rules were configured; no administrative override was used.

## Changes

- Memoize the current prompt model and evaluate fallback sources only until a valid selection is found.
- Render visible provider groups in the model picker using the existing virtualizer dependency. Preserve sticky labels, search, selection, and keyboard navigation to offscreen models.
- Add a production browser benchmark with 180 providers and 1,440 models.

Changed files, relative to the repository root:

- `opencode/packages/app/src/pages/session/composer/prompt-model-selection.ts`
- `opencode/packages/app/src/components/dialog-select-model.tsx`
- `opencode/packages/app/e2e/performance/timeline/model-picker-benchmark.spec.ts`

## Verification

On the isolated PR branch based on `main`:

- App production build and `bun run typecheck` passed.
- 28 targeted unit tests passed with 36 assertions: model search, session model helpers, model variants, local agent, and provider catalog.
- Formatting and diff checks passed. Targeted lint reported 10 existing warnings and zero errors.
- The production browser benchmark passed mouse selection, search, reopening, offscreen keyboard navigation, empty results, and Escape dismissal.
- Opening measured about 200 ms, compared with the earlier 2,326 ms baseline; mounted rows fell from 1,440 to 16. These are single-machine observations, not timing guarantees.

Local logs: `/tmp/sbo-pr-build.log`, `/tmp/sbo-pr-typecheck.log`, `/tmp/sbo-pr-tests.log`, `/tmp/sbo-pr-lint.log`, and `/tmp/sbo-pr-benchmark.log`. The isolated worktree is `/tmp/sbo-model-picker-pr`; it reuses installed dependencies from the original checkout. The browser run used installed Chrome and `/tmp/sbo-pr-performance.config.ts` on port 3017.

The standard benchmark can be run from `opencode/packages/app` with `OPENCODE_PERFORMANCE=1 bunx playwright test --config e2e/performance/playwright.config.ts timeline/model-picker-benchmark.spec.ts` when the configured browser is installed. Do not restart the user's app or server for testing.

## CI and limitations

- GitHub workflow `CI` (ID `321530425`) is `disabled_manually`, as requested. Automatic push and pull-request CI runs are off. Workflow YAML was not changed.
- The unsigned release workflow remains available through manual dispatch. Copilot review was left unchanged.
- Historical CI failures remain visible on the PR: all jobs failed during `pnpm install` because the root package declares Bun. CI did not validate this merge. Local checks above are the verification evidence.
- Before re-enabling CI, repair the legacy workflow for the current Bun/OpenCode application.
- Virtualization works at provider-group granularity. A single provider with a very large catalog still renders its entire group.
- The existing `e2e/user-story/model-selection-flow.spec.ts` fails on an obsolete free-model dialog expectation. The unchanged composer logic opens the normal picker for connected providers with models; this separate test was not repaired.

## Local workspace

The original checkout remains on `codex/fix-audit-security-and-functional-issues`, with the lag-fix edits retained for the running app. Those edits are already represented by merged PR #10; do not submit them again without comparing against `origin/main`. Earlier security work in PR #9 was not merged by this task. The feature branch and temporary worktree were retained.

Unrelated `.commandcode/` and `docs/product/FEATURE-REQUEST-agent-work-orchestration.md` content was preserved. This handover is an uncommitted local file. The unslop executable was unavailable, so its CLI cleanup was not run.
