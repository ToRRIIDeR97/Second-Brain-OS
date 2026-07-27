# Checkpoint 10: Core Markdown Codec and Rich Editor

## Outcome

Users can create and edit portable Markdown in rich, source, and split modes without losing core syntax or unsupported source.

## Source plan

- Sections 19.1-19.5
- Phase 4 implementation order 1-7
- Milestone 3
- Backlog C002-C005 and C011

## Prerequisites

- Checkpoints 07-08

## Scope

- Define and implement the `MarkdownCodec` boundary.
- Add Tiptap rich editing for paragraphs, headings, marks, lists, tasks, links, code, tables, images, math, and wiki links.
- Add rich/source/split switching with one canonical Markdown buffer.
- Preserve front matter, whitespace-sensitive constructs, line endings, and unknown blocks.
- Display unsupported syntax as protected source blocks rather than dropping it.
- Add the first slash-menu commands and quick note creation.
- Build a golden round-trip fixture suite.

## Expected artifacts

- Codec parse/serialize interface and version.
- Tiptap extensions behind application-owned adapters.
- Mode-switching editor UI.
- Golden fixtures for supported, mixed, invalid, and unknown syntax.
- Format documentation and compatibility notes.

## Work items

1. Establish canonical-source ownership and prevent competing rich/source saves.
2. Implement features incrementally in the specified master-plan order.
3. Preserve unknown nodes and attributes as protected source.
4. Define deterministic table, math, code-fence, and wiki-link serialization.
5. Add paste/import normalization without silently rewriting entire files.
6. Make slash-menu actions keyboard accessible.
7. Add round-trip and repeat-round-trip tests.

## Acceptance evidence

- Core golden fixtures parse and serialize predictably.
- Repeated rich/source mode switches do not change untouched source.
- Unsupported blocks remain present and visibly protected.
- Tables, tasks, math, images, and wiki links survive round-trip.
- Invalid Markdown does not crash the editor or parser.
- Notes remain readable and editable in an external Markdown editor.

## Validation focus

- Unicode, CRLF, nested lists, complex tables, and mixed HTML
- Tiptap dependency version changes
- Selection preservation across mode switches
- Large note responsiveness
- Paste from web and office applications

## Out of scope

Custom directives, transclusion, citations, recovery journal, and conflict merge.

## Handoff

Freeze codec behavior through fixtures. Later syntax additions must extend those fixtures rather than changing existing serialization accidentally.
