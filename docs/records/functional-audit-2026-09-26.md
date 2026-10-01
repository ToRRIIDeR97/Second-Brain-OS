# Desktop functional audit, 2026-09-26

Fixes and subsequent verification are recorded in
[the follow-up](functional-audit-fixes-2026-09-26.md).

Status: in progress. This is a manual coverage record, not a claim that all
functions pass. The root agent operates the actual Windows app through
computer use. Source inspection identifies the intended controls; it does not
count as a UI pass.

Build: Second Brain OS Dev 1.18.21, `dist/startup-fix/win-unpacked`, with the
startup compatibility fix. Test data uses a dedicated QA workspace and names
beginning with `QA`. Existing user records and settings must be preserved.

## Setup review

- Refreshed the existing architecture and threat-model documents rather than
  creating duplicate system/security documents.
- Replaced obsolete Tauri development instructions with links to the active
  setup and command owners.
- Documented persistence owners, mixed API startup behavior, plugin trust,
  and sensitive profile data. Verified referenced paths and script definitions.
- Documentation formatting and `git diff --check` passed.

## Coverage checklist

Items remain unverified until an observed result is recorded below. A blocked
item is not a pass. Add controls discovered during the walkthrough.

| Area                | Individual functions to verify                                                                                                                                                            | Status  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Shell               | Every navigation destination, tabs, new tab, close tab, switching tabs, sidebar, command palette, window/menu controls                                                                    | Pending |
| Home                | Workspace choice; ask agent; harness choice; project, calendar, session, and activity links; empty and populated summaries                                                                | Pending |
| Workspaces          | Open folder; recent workspace selection; session search; session opening; filters; create session; workspace actions                                                                      | Pending |
| Notes               | Create/cancel; empty-title validation; select; edit title/body/tags/project links; save; discard; search; project filter; related links/backlinks; persistence; workspace switch          | Pending |
| Projects            | Create/cancel/validation; location; list/search/status filters; overview editing/save; pause/resume/archive; Plan/Work/Files/Activity/Map; linked notes/calendar; start work; persistence | Pending |
| Calendar            | All navigation views; date movement/today; project/workspace filters; create/edit/cancel event; date/time validation; all-day and multi-day; delete test event; persistence               | Pending |
| Tasks               | Create/edit/cancel; title/date validation; scheduling; completion/reopen; filters; project assignment; deletion; persistence                                                              | Pending |
| Google              | Connection/setup state; calendars/task lists; sync; read/write mode; event/task operations; errors/outbox/retry; disconnect                                                               | Pending |
| Activity            | All views; running/completed sessions; attention state; session links; Google failure/pending links                                                                                       | Pending |
| Agent session       | Harness/model/effort selection; prompt/response; stop/follow-up; attachments/context; commands; history/search; session actions; errors; persistence                                      | Pending |
| Files and review    | Browse/open/search; file tabs; preview; changes/diff; review actions; links into workspace                                                                                                | Pending |
| Terminal            | Open; prompt/output; tab creation/switching/closing; panel layout; failure handling                                                                                                       | Pending |
| Settings: General   | Every visible preference and expandable section; reversible changes and restoration                                                                                                       | Pending |
| Settings: Shortcuts | Search; edit/cancel/reset; exercise a changed shortcut and restore                                                                                                                        | Pending |
| Settings: Servers   | Current server/status; add/edit validation; selection; recovery; removal of test entry                                                                                                    | Pending |
| Settings: Providers | Connected/available lists; search; connect setup/validation; custom provider; configured provider request                                                                                 | Pending |
| Settings: Models    | Search; provider filters; show/hide; default selection; persistence/restoration                                                                                                           | Pending |
| Shared dialogs      | Model, harness, MCP, status, help/about/update and release-note controls exposed in this build                                                                                            | Pending |

## Observed results and defects

### Manual observations so far

- Home navigation renders the selected workspace, current projects, and empty
  calendar/session summaries. Its Open Workspace action opens Workspaces.
- Workspaces: Add project opens the native folder picker. Selecting
  `C:\Users\sense\AppData\Local\Temp\SecondBrain-QA-20260926` adds and selects it.
- Projects: empty submission displays `Enter a Project name and outcome`.
  Created `QA Launch Project` with outcome, linked QA folder, instructions,
  and tags. Advanced expands and collapses. Progress, milestone, and blocker
  can be edited and saved. Navigating away and reopening retains 50% progress,
  `Complete the QA walkthrough`, and `QA test blocker`.
- Project Plan displays the saved milestone and blocker. Work displays the
  saved instructions. Files displays the managed project folder and linked
  workspace; its Open workspace action selects the correct QA workspace.
- Project Map's Notes action opens the correct project-filtered Notes page.
  Created QA Alpha there; project association is checked automatically.
- Notes: body and tags save and survive navigating Home and back. The editor's
  H1/H2/H3, bold, italic, strikethrough, bullets, numbering, task list, quote,
  inline code, and link buttons each insert their corresponding Markdown.
  Insert menu code block, horizontal rule, 3-by-3 table, inline math, math
  block, and image URL each insert syntax. This checks insertion, not remote
  image loading. Word count updates. Write, Split, Preview, side-by-side and
  stacked layouts, fullscreen, and Escape from fullscreen work. Rendered
  preview displays emphasis, lists, quote, table, inline math, and block math.
- Home displays the created project, saved progress and blocker, and project
  count. Notes' unsaved rename was lost on Home navigation (defect below).
- Created QA Beta in All notes, assigned it to the QA project, and saved a
  return link to QA Alpha. Backlink counts and Related notes buttons appear;
  clicking QA Alpha navigates correctly. Inline wiki syntax remains plain text.
  Slash menu opens, filters `/table` to one command, and Enter inserts a table.
  Cancel creation works. Switching notes while dirty shows a save/discard
  message; Discard restores the saved title. Project filter selection and
  switching Default Project / QA workspace work and clear the open note.
- Notes search matches titles, tags, paths, and wiki-link targets. `editor`
  finds QA Alpha by tag; `Beta` finds both notes because Alpha links to Beta.
  Searching saved body marker QA-COPPER-472 finds no notes. Source confirms
  body text is excluded. This is a product gap for a second-brain search.
- Notes still need split-resize, saved rename, project removal, duplicate-title
  validation, and any remaining controls discovered during final coverage pass.
- Calendar: empty event submission shows title/date validation. A same-day
  end time before start is rejected. Created QA Calendar Review, linked to QA
  project, with details and times 15:12–16:13 on September 26. Reopened all
  values correctly. Edited its title to QA Calendar Review Updated and extended
  through September 27. Today, Week, Month, and Agenda show it; next/previous
  week navigation works and both overlapping weeks include the event. Month
  shows it on both dates. Clicking September 28's day-number button opens a
  new event with that date. Created QA All-day Check without time fields.
  QA project filtering hides that unlinked event and retains the linked event.
- Tasks: empty title rejected. Created QA Task Review with notes and project,
  no dates; Unscheduled shows it and reopening retains values. Added today's
  due date; Today shows it. Completion removes it from Today and displays it
  checked in Completed. Reopening via checkbox removes it from Completed and
  restores it to Today. Scheduled it September 27, 15:20–16:20; start-only is
  rejected with a request for both times. Saved schedule appears in Upcoming.
  A task due today but scheduled tomorrow appears in both Today and Upcoming.
- Calendar/tasks still need cancel, delete, remaining date navigation, workspace
  switching, task calendar appearance/removal, remaining edit/validation paths,
  and integration checks. No whole-page completion claimed yet.
- Remaining controls are still pending; the coverage table is not yet complete.
- Task Cancel discards a draft rename. Saved rename and notes update work.
  Remove from calendar clears scheduled date/times; the task leaves its former
  September 27 month cell. Its due date remains, so daily lists still show it.
- Calendar next/previous month and next/previous day work. The separate Today
  button returns the selected date to September 26. All Projects clears the
  project filter. Clicking a scheduled task in Month opens Tasks but leaves
  the details panel empty, requiring another selection.
- Google setup opens/closes and exposes read-only/read-write choices. No OAuth
  client or account is configured. Empty Continue produces the generic
  `Google Calendar or Tasks could not complete the request` instead of missing
  field validation. Account-dependent checks are waiting on user setup.
- Activity Needs attention, Agent runs, Changes, and History render their
  empty states. History's New session opens a QA workspace session.
- Codex harness, GPT-6-Luna, maximum effort, service-tier menu, and model
  refresh work. A request to read the QA README returns QA-COPPER-472. This
  personally verifies a real harness request and local file access. Both
  visible effort controls update together; they duplicate the same setting.
- A newly created session reproduces the literal `\200B` prompt artifact.
  Native keyboard typing enables Send. UI Automation set_value alone does
  not update the contenteditable's application state; that is a test-method
  limitation and is not classified as a typing failure.
- Codex follow-up recalls QA-COPPER-472 without another tool call. Enter sends
  the prompt. Stop interrupts an active turn and shows `Provider turn interrupted`.
  Copy response pastes the correct marker into a draft. Activity shows the active
  run in Needs attention, removes it when complete, and finds/reopens the session
  from History search. A no-match search displays an empty result.
- Context opens session metadata. Usage and context-limit values are unavailable.
  Export opens the Windows save dialog and saves a 961-byte QA JSON file. Its
  success toast appears before the user chooses a destination.
- Files: README and JSON fixtures open correctly. Search filters to fixture.json;
  clearing restores the tree. Expanding notes, pinning QA Beta by double-click,
  switching file tabs, and closing QA Beta work. Review opens/closes and correctly
  reports that the QA workspace has no Git repository.
- The slash menu lists its commands. `/terminal` opens a terminal. Two terminal
  tabs can be created, switched, and closed, but neither displays a prompt or
  output after repeated observations. The shell selector only offers Auto.
- MCP opens with Ctrl+semicolon, reports zero configured servers, and supports
  search/clear/close. Attachment selection opens the Windows picker; cancelled
  before upload while the confirmation request is pending.
- General settings: English/Spanish changes the built-in settings and session
  labels, but the Second Brain navigation remains English. Restored English.
  Reasoning summaries, expanded shell tools, and expanded edit tools toggle and
  restore. Auto-accept permissions remains off. System/Light appearance, Nord
  theme, and custom UI/code/terminal font fields change successfully; restored
  System, OC-2, and empty/default fonts. Notification switches and all three
  sound selectors change and restore. These checks verify preference controls,
  not audible playback or operating-system notification delivery. Release-note
  preference toggles and restores. Check for updates is disabled in this build.
- Shortcut search matches commands and displays an explicit no-match state;
  clearing restores the list. Capturing Ctrl+Alt+K for the command palette
  works, persists across reopening, and opens the palette. Reset restores
  Ctrl+K and shows a success toast. Escape during capture closes Settings as
  well as cancelling capture. Ctrl+comma opens Settings; Ctrl+T creates a tab.
- Command palette searches fixture.json and Enter opens it. Enabling File tree
  reveals its toggle; hide/show works. Enabling Server status reveals the title
  bar button. Enabling Show agent reveals Build/Plan in an OpenCode draft.
  These four advanced preferences are temporarily enabled for further checks;
  they must be restored to off before completion. Pinch-to-zoom preference
  toggles/restores, but the automation API cannot perform a pinch or held-Ctrl
  scroll gesture.
- Servers shows a healthy Local Server with edit/delete disabled. Submitting
  a blank address closes the form without adding a server or explaining why.
  A synthetic localhost port 1 address shows `Could not connect to server`;
  Cancel returns to the healthy local connection. WSL setup reports no installed
  distributions. Check again completes, its catalog loads, search finds Debian,
  no-match disables installation, and both Cancel steps work. No distribution
  was installed. Successful remote/WSL connections need a configured test server.
- Providers lists existing OpenRouter, Xiaomi, and OpenCode Go accounts.
  Anthropic setup rejects an empty key with `API key is required`; Back works.
  Show more providers opens a searchable catalog with a no-match state. Custom
  provider setup validates required ID/name/base URL/model fields. Adding and
  removing unsaved model/header rows works. Closing leaves connections intact.
  No credentials were read or changed. New account connection/disconnection and
  a successful custom endpoint remain unverified without test credentials.
- Model settings expand provider groups, filter across providers, and show a
  no-match state. Enabled the previously hidden OpenCode Go DeepSeek V4 Flash;
  it appears in the session picker and can be selected. Model-picker search
  and no-match state work. Default variant and Plan mode can be selected.
  Restore that model's visibility to off and original Vision Exp/Max/Build
  selection after the provider request check.

### Defects

1. **Duplicate linked-folder entries.** Creating a project in the QA workspace
   lists the identical QA path twice. Both entries are visible in the native
   accessibility tree and screenshot. Selection and project creation still
   work, but the choices are indistinguishable.
2. **Visible draft placeholder artifact.** The restored new-session prompt
   contains literal `\200B` overlapping its placeholder. This was visible before
   audit input and was reproduced in a newly created session.
3. **Unsaved note changes disappear on main navigation.** After saving QA Alpha,
   changed its name to QA Alpha edited and observed Unsaved changes. Clicking
   Home left without warning. Returning to Knowledge and reopening the note
   restored QA Alpha; the draft rename was gone. Disabling workspace selection
   and New note while dirty does not protect navigation through the main rail.
4. **New-note form overflows its sidebar.** Focusing the new-note name input
   shifts the sidebar horizontally and clips its controls. Empty submission
   creates nothing but showed no visible validation message.
5. **First Markdown heading absent in preview; wiki links plain text.** The
   saved QA Alpha body begins with `# QA editor check`, but Preview starts at
   the next paragraph. `[[QA Beta]]` is literal text. Need supporting source
   review and an existing linked note before classifying the link behavior.
   Follow-up: note-editor.tsx explicitly hides the first h1 regardless of its
   text. Wiki links resolve into Related notes buttons but are not clickable
   inside the preview even after the target exists. These are rendering/UX gaps.
6. **Note body search unavailable.** Searching QA-COPPER-472 yields No notes yet
   while that saved phrase is visible in QA Alpha. The current filter searches
   title/path/tags/link targets only. No-results wording also suggests the
   workspace is empty rather than that the search has no matches.
7. **Calendar task links lose selection.** Clicking the scheduled QA task in
   the month view navigates to Tasks/Today but does not open that task. Tasks
   outside the Today filter could be harder to find after this navigation.
8. **Calendar Today label is misleading.** After moving to October and back,
   choosing the Today view shows September 1. A second Today button correctly
   jumps to the current date. Previous/next buttons retain month accessibility
   labels in daily and weekly views.
9. **Google configuration errors lack actionable validation.** Empty OAuth
   fields trigger a generic request failure with no missing-field guidance.
10. **Duplicate Codex effort selectors.** Two adjacent controls expose the same
    choices and mirror the same selected value, adding ambiguity and crowding.
11. **Session rename fails.** Renaming the QA Codex session displays
    `Request failed`; the tab and context title remain unchanged. Escape exits
    the failed rename draft and restores the original title.
12. **Terminal tabs stay blank.** Both newly created terminal tabs show no shell
    prompt, output, or failure message. Tab operations work. Execution remains
    unverified; source/log investigation is still needed.
13. **Export reports success before saving.** `Session exported` appears while
    the Windows save dialog is still awaiting a destination. Actual save works.
14. **Incomplete language coverage and unnamed switches.** Spanish leaves the
    Second Brain rail and harness controls in English. General preference
    switches have no accessible names in the Windows accessibility tree.
15. **Empty server submission silently closes.** An empty Add server form
    closes without adding an entry or explaining the missing address. A
    nonempty unreachable address correctly retains the form with an error.
16. **OpenCode provider requests stall without feedback.** A no-tool marker
    request using OpenCode Go DeepSeek V4 Flash stayed on Thinking for several
    minutes. A second request using the original DeepSeek V4 Flash Vision Exp
    selection also returned no answer after more than four minutes. Stop
    cleared the running state in both cases. Codex requests succeeded in the
    same workspace. Provider/API cause is not yet established.
17. **Archived projects have no clear restoration action.** An archived QA
    project still offers Pause Project and Archive Project. Pause moves it
    into Paused; Resume then returns it to Active. No direct Restore is shown.
18. **Home event links lose the selected record.** Clicking QA Calendar Review
    Updated on Home opens Calendar with an empty details panel. Selecting the
    event again in Calendar opens it correctly.

### Additional verified workflows

- Project pause, Paused filter, resume, archive, Archived filter, and recovery
  through Pause then Resume work. The QA project is Active again. Saved outcome,
  agent instructions, and tags can be edited. Work displays the updated outcome
  and instructions after saving. Switching project subpages with unsaved edits
  is blocked with `Save the current Project state before leaving`.
- The populated project map displays both QA notes and their outgoing links.
  Its cards are static; clicking a card does not navigate. Project Activity's
  link opens Activity in the QA workspace. Agent runs lists both QA sessions.
  Select all checks both, and Clear resets the selection and disables Archive.
  Needs attention's running-session link opens the correct active session.
- Event Cancel discards a changed title; reopening retains the original title.
  Calendar workspace switching hides QA records in Default Project and restores
  them in the QA workspace. Selection clears across the switch.
- Home shows the open QA task, timed event, project progress, and both resumable
  sessions. Empty Start is disabled. Selecting Codex and entering a prompt opens
  a new draft in the QA workspace with both selections carried through.
- Draft prompt and model survive switching session tabs. Create Git repository
  in the QA workspace completes and changes Review from the setup prompt to
  `No file changes yet`. The new-session location changes from No Git to Local.
- All four Advanced preferences were restored to off. The original OpenCode
  model selection is Vision Exp, Max, Build. DeepSeek V4 Flash was observed off
  again in Models. Models briefly showed a Windows Not Responding state during
  the restoration pass, then recovered. No repeatable cause established.

## Verification limits

### Final coverage pass, continued

- A Codex GPT-6-Luna medium request created only `qa-agent-output.md` in about
  16 seconds. Opening it in the app showed `QA-WRITE-VERIFIED`. File Explorer
  also displayed it. Git and Last turn changes both remained empty, including
  after Reload. This blocks meaningful diff/review testing for Codex edits.
- Open file search did not find that newly created file; clearing the search
  and browsing the tree did. The `@` context picker found it, inserted a file
  mention, and allowed removal. No attachment was sent. Copy workspace path
  pasted the correct QA path. Reload preserved session and file tabs.
- Saved QA Beta's rename to QA Beta Updated and removed its project link.
  The project-filtered list then showed only QA Alpha. Alpha's existing
  `[[QA Beta]]` reference was not rewritten, so Beta lost its incoming backlink.
  Split resizing worked; Preview was restored. Duplicate note-name submission,
  like empty submission, showed no useful validation feedback.
- Home workspace switching showed the original workspace's records and then
  restored the QA records. Its harness reverted to OpenCode on navigation.
  Home's task link opens Tasks without selecting the task. Its project card
  opens the project list without selecting the project, matching the event
  navigation problem. These need a shared record-selection/navigation review.
- Cleared the QA task's due date using the date field's keyboard control and
  selected No Project. Save removed it from Today; Unscheduled displayed it
  without the former due date or project. Before unlinking, the task list
  displayed a raw project ID instead of the project name.
- New Project Cancel returns to the list without creating a project. Project
  calendar opens Calendar with the correct project filter. Start work opens
  a new draft with the QA workspace and saved outcome, milestone, blocker, and
  user-authored instructions. Closing that draft tab works.
- Session review-panel resizing works and its original width was restored.
  Share opens a Publish on web confirmation; Escape closes it without sharing.
  Fork from message opens and lists the QA message, but choosing it displays
  Request failed and leaves the dialog open. `/compact` cleared its command
  but showed no progress, summary, or completion indication in the QA Codex
  session. Successful compaction is not verified.

External accounts, paid requests, destructive operations, authentication, and
unavailable services will be recorded with the exact dependency or restriction.
The audit will distinguish UI verification from supporting source or automated
checks. Never treat an untested external integration as working.
