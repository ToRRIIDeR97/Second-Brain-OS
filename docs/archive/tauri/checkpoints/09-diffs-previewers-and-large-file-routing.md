# Checkpoint 09: Diffs, Previewers, and Large-File Routing

## Outcome

Files are routed to safe, responsive viewers; text differences are navigable; oversized or unsupported content cannot freeze the desktop.

## Source plan

- Sections 20.2-20.3
- Phase 3
- Backlog K003 dependency

## Prerequisites

- Checkpoints 06 and 08

## Scope

- Add a central file-type and size routing policy.
- Add Monaco diff view with clickable hunks.
- Add image and PDF previews.
- Add virtualized CSV preview.
- Add JSON/YAML tree and source modes.
- Add bounded plain-text and metadata views.
- Add large-file mode and external-open fallback.
- Sanitize preview content and application asset URLs.

## Expected artifacts

- File viewer registry with explicit capabilities and limits.
- Preview components and loading/error states.
- Diff component reusable by conflict and Git workflows.
- Large-file thresholds in settings.
- Fixture-based rendering and performance tests.

## Work items

1. Detect by trusted metadata and content sniffing rather than extension alone.
2. Prevent active HTML/script execution in previews.
3. Stream or page large tabular and text data.
4. Bound image dimensions, PDF work, and in-memory buffers.
5. Support open-at-line and diff-hunk navigation.
6. Offer default-application open for unsupported types under workspace policy.
7. Add accessible text alternatives and keyboard navigation.

## Acceptance evidence

- Supported images, PDFs, CSV, JSON, and YAML render from fixtures.
- Unsupported files offer a safe external-open action.
- Large fixtures remain responsive and do not load fully into renderer memory.
- Diff hunks navigate to the correct source location.
- Preview URLs cannot access files outside workspace policy.
- Malicious HTML and SVG fixtures do not execute active content.

## Validation focus

- Corrupt files and parser failures
- Very wide CSV data
- PDF cancellation and worker cleanup
- Image decompression limits
- Renderer memory after tab closure

## Out of scope

Rich Markdown rendering, Git command execution, spreadsheet editing, and arbitrary plugins.

## Handoff

Expose the diff and file-routing APIs for Markdown conflict resolution, Git review, search previews, and graph source navigation.
