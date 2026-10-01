# Checkpoint 06: Secure File Discovery and Reading

## Outcome

The app can lazily browse and safely read workspace files without accepting arbitrary host paths or following escapes outside allowed roots.

## Source plan

- Sections 8.5 and 11.1-11.2
- Phase 2 read-side deliverables
- Backlog B001-B004, B010-B011, B014-B015

## Prerequisites

- Checkpoint 05

## Scope

- Implement the `WorkspacePath` boundary.
- Canonicalize nearest existing parents and detect traversal and symlink escape.
- Apply `.gitignore`, `.brainignore`, `.agentignore`, deny rules, and trust policy for their distinct purposes.
- Add lazy directory enumeration, metadata, file-type detection, and large-directory virtualization.
- Add bounded text reads, binary reads, and large-file streaming.
- Add Finder/Explorer reveal and default-application open behind policy checks.
- Build the file navigator, recent files, open-editors list, and read-side context menus.

## Expected artifacts

- Central path-policy service used by every later filesystem consumer.
- File read/list IPC commands using workspace ID plus relative path.
- Lazy, virtualized file tree.
- Ignore-policy documentation and diagnostics.
- Path-policy unit and property tests.

## Work items

1. Reject absolute paths, parent traversal, alternate separators, and encoded escapes.
2. Resolve symlinks according to workspace policy, including broken-link cases.
3. Separate visibility, indexing, and agent-access ignore semantics.
4. Bound response sizes and stream large content.
5. Sanitize external-open and file-manager launch arguments.
6. Handle permission-denied, disappearing, and unsupported files with stable errors.
7. Test large trees without recursive eager enumeration.

## Acceptance evidence

- The file tree renders the large fixture responsively.
- A renderer request cannot read outside the registered workspace.
- Symlink and traversal fixtures cannot escape policy.
- Restricted and secret-like paths are hidden or denied according to the correct ignore layer.
- External-open operations require the effective workspace policy.
- Binary and oversized content never enters normal text IPC responses accidentally.

## Validation focus

- macOS aliases, Windows junctions, and case behavior
- TOCTOU between validation and read
- Ignore precedence and negation
- Unicode and invalid filenames
- Directory replacement during enumeration

## Out of scope

Creating, changing, moving, deleting, or watching files; editor save behavior; indexing.

## Handoff

All later filesystem consumers must call the path-policy service. Record any platform gaps that require follow-up hardening.
