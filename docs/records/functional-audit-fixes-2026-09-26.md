# Functional audit fixes, 2026-09-26

This records changes made from the referenced desktop audit. The original
[audit](functional-audit-2026-09-26.md) remains a record of the earlier build.
Existing cleanup and other working-tree changes were preserved.

## Reported defects

| Audit item                                 | Result                                                                                                                         | Evidence                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1. Duplicate linked folders                | Project location choices deduplicate the canonical path.                                                                       | Source review; existing path-key checks.                                                   |
| 2. Literal `\200B` in the prompt           | Removed the empty-editor pseudo text.                                                                                          | Browser assertion and inspected composer screenshot.                                       |
| 3. Notes lost on navigation                | Main navigation blocks while a note is dirty and explains save/discard.                                                        | Browser edit/navigation regression.                                                        |
| 4. New-note overflow and silent validation | Input fits the sidebar; blank names and duplicate files show errors.                                                           | Browser validation and bounds check; screenshot inspection.                                |
| 5. Missing heading and plain wiki links    | First heading renders; known wiki targets navigate within Notes.                                                               | Browser click/heading checks and preview screenshot; link unit tests.                      |
| 6. Body search and misleading empty state  | Server search includes saved bodies, refreshes after saving, and distinguishes no matches from an empty workspace.             | Note domain test and browser search regression.                                            |
| 7. Task links lose selection               | Calendar task links select and open the requested task, including outside the current filter.                                  | Browser Home/task selection; selected-record logic review.                                 |
| 8. Today/date labels                       | Today resets the date; previous/next names follow day, week or month.                                                          | Browser date reset and accessible-label assertion.                                         |
| 9. Empty Google credentials                | Missing client ID/secret are rejected before OAuth with field guidance.                                                        | Source/type checks; live Google sign-in was not exercised.                                 |
| 10. Duplicate Codex effort                 | One effort selector and one separate service-tier selector.                                                                    | Browser count/selection checks and screenshot inspection.                                  |
| 11. Rename fails                           | Managed servers use the supported legacy rename endpoint while execution stays native.                                         | Transport regression and session projection tests.                                         |
| 12. Blank terminals                        | Both API variants mint scoped tickets; managed servers use their supported socket route. Connection retries end with an error. | Browser ticket/output/tab checks; Windows ConPTY marker smoke.                             |
| 13. Premature export success               | Main owns the native picker, then writes JSON before success. Cancellation has no success toast.                               | Export cancellation/write/validation tests; desktop build.                                 |
| 14. Spanish and accessibility              | Brain/harness/editor strings translated; preference switches and server fields have names.                                     | Locale/placeholder tests, browser accessible-name assertions and inspected screens.        |
| 15. Blank server closes                    | Add/edit forms retain invalid input and explain a missing address.                                                             | Browser blank-submit regression and screenshot inspection.                                 |
| 16. Provider stalls                        | OpenCode streams fail after two minutes without an event, with retry/provider guidance. Responsive streams remain alive.       | Virtual-clock idle/responsive stream test. The external provider cause remains unverified. |
| 17. Project restoration                    | Archived projects have a direct Restore action.                                                                                | Browser archive/restore regression.                                                        |
| 18. Home event selection                   | Home event, task and project links carry the selected record.                                                                  | Browser deep-link regressions.                                                             |

## Other audit findings

- Last turn review reads native assistant snapshots rather than an empty legacy
  user-message summary. The API stops at the next user turn. Git review uses the
  supported managed-server route. Errors display instead of masquerading as an
  empty diff. Snapshot capture discovers Git initialized after opening a workspace.
- Ripgrep file search scans at query time, so additions and deletions are visible
  without restarting. The existing live FFF index is retained.
- Wiki links, backlinks and project-map edges accept the stable note filename
  after a title rename. Project-map note cards now open their notes.
- Unknown task project references display the existing no-project label.
- Native forks copy history through durable events, with new message IDs and no
  shared provider continuation or copied filesystem snapshots.
- Workspace name/color changes and session archive use the managed server's
  supported persistence routes. Activity removes an archived session immediately.
- Manual compaction failures now display an error. The current runtime still
  returns `OperationUnavailableError` for manual compaction; implementing that
  backend operation remains open. Automatic compaction is unchanged.
- Escape cancels shortcut recording first; another Escape closes Settings.
- Export loads every page of native history into the existing CLI JSON format.

## Validation

- Canonical `bun run test`: 77 desktop tests, one Node draft-store test,
  758 renderer unit tests, 41 browser-runtime tests and 10 Second Brain tests passed.
- Additional core regressions: 24 session/fork/diff tests, five snapshot tests,
  one provider timeout test and three filesystem/search tests passed. Windows Git
  snapshot tests used a 30-second timeout.
- Browser regressions: seven Brain/settings cases, four session/terminal cases
  and the managed-server startup case passed. Captured screens were inspected.
- Canonical typecheck, plus server/protocol/generated-client typechecks passed.
- Canonical lint completed with zero errors and 4,342 warnings. Focused lint on
  63 changed files completed with zero errors and 214 warnings.
- Production session-switch benchmark: two cases passed. Median stable V2 hot
  switch was 30.4 ms with review closed (baseline 35.9 ms), 66.6 ms with review
  open (baseline 65.4 ms). Review-open cold switch was 79.0 ms (baseline 83.8 ms).
  These local samples are not a general performance guarantee.
- Canonical desktop build passed. Final format and whitespace checks passed.

Local logs and inspected screenshots are under `.cache/audit-fixes/`; this
folder is ignored by Git. Architecture and export security boundaries are
updated in their owning documents.

## Remaining verification

Live Google authorization/sync, an actual external OpenCode Go response,
Windows native export-dialog completion, and a full packaged desktop walkthrough
were not repeated. The running application/server was not restarted. Browser
network tests use isolated fixtures; the Windows PTY smoke verifies the native
terminal library separately. Manual backend compaction remains unsupported.
