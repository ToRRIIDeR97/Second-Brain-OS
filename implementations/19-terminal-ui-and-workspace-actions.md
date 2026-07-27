# Checkpoint 19: Terminal UI and Workspace Actions

## Outcome

Users can work in up to six responsive terminal tabs per workspace, open terminals from files or folders, inherit paths, use safe file links, and switch terminal display modes.

## Source plan

- Sections 18.1 and 18.4-18.7
- Phase 7
- Milestone 6
- Backlog F004-F005, F011-F012

## Prerequisites

- Checkpoints 04 and 18

## Scope

- Integrate xterm.js with fit, search, Unicode, selection, copy/paste, links, and accessibility settings.
- Add terminal tabs, badges, rename/pin, restore metadata, and the six-tab UX.
- Support full activity, editor tab, bottom drawer, and separate window modes.
- Add file/folder “Open terminal here” commands.
- Apply the documented new-tab CWD resolution order.
- Add safe workspace file-link parsing and navigation.
- Add shell, Codex, Claude, server, test, and custom visible presets.

## Expected artifacts

- Terminal workspace and xterm wrapper.
- Tab/session state connected to PTY events.
- File-tree and command-palette terminal actions.
- Link provider with workspace validation.
- Accessibility and high-output UI tests.

## Work items

1. Preserve terminal sessions while switching view modes.
2. Resize PTYs only from stable layout dimensions.
3. Resolve clicked paths relative to reported CWD, then workspace root.
4. Never execute a clicked file path.
5. Default busy-terminal actions to opening a new terminal.
6. Show CWD reliability, running, waiting, exited, and agent-linked status.
7. Restore metadata without claiming dead processes are live.

## Acceptance evidence

- New tabs inherit active reliable CWD, then selected path, then workspace root.
- Right-clicking a file opens its containing folder; a folder opens itself.
- File links open the correct workspace file and line.
- Terminal input remains responsive during editor and graph activity.
- View-mode changes do not restart the process.
- Screen-reader mode, high contrast, and keyboard tab management work.

## Validation focus

- Rapid pane resizing
- Stale links after CWD or file rename
- Clipboard and bracketed-paste safety
- Separate-window lifecycle
- Six simultaneous high-output terminals

## Out of scope

Managed Codex/Claude event parsing, remote terminals, tmux integration, and indexing terminal output.

## Handoff

Expose terminal preset and session-link hooks for Checkpoints 25-26 and retain workspace isolation as a hard invariant.
