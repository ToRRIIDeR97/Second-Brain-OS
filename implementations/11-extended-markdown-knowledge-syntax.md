# Checkpoint 11: Extended Markdown Knowledge Syntax

## Outcome

The editor supports the documented knowledge and visual extensions needed by the graph, planner, and agents while keeping their source representation explicit and portable.

## Source plan

- Sections 19.4-19.9
- Phase 4 implementation order 8-12
- Backlog C006-C013

## Prerequisites

- Checkpoint 10

## Scope

- Implement version 1 directives: callouts, alignment, columns, styled blocks, data tables, graph embeds, and planner embeds.
- Add Mermaid, transclusion, explicit block IDs, decisions, project references, tags, mentions, and citations.
- Add attachment insertion and workspace-relative asset handling.
- Expand slash-menu commands for all supported constructs.
- Clearly distinguish authoritative source syntax from derived or embedded views.
- Preserve unknown directive names and attributes.

## Expected artifacts

- Codec extensions and Tiptap node views.
- Directive grammar tests and examples.
- Safe Mermaid/rendering boundary.
- Attachment and relative-link workflow.
- Accessible fallbacks for embedded graph/planner content.

## Work items

1. Implement each directive against the Checkpoint 02 specification.
2. Serialize attributes in a deterministic order.
3. Keep block IDs stable through ordinary rich edits.
4. Prevent embedded views from mutating canonical content implicitly.
5. Sanitize Mermaid and any rendered technical content.
6. Validate attachment destinations through workspace path policy.
7. Provide source-mode escape hatches for unsupported combinations.

## Acceptance evidence

- Every documented extension has parse, serialize, rich-render, and source-mode fixtures.
- Unknown directives and attributes round-trip intact.
- Durable task, decision, and block IDs survive edits and reorderings.
- Mermaid or styled content cannot execute arbitrary HTML/script.
- Attachment paths remain relative and cannot escape the workspace.
- Every canvas-like embed has a keyboard/screen-reader alternative.

## Validation focus

- Nested directives and malformed closers
- Attribute escaping and Unicode
- Transclusion cycles
- Deleted or moved attachments
- Block-ID duplication

## Out of scope

Indexer extraction, planner provider behavior, graph query implementation, and autosave recovery.

## Handoff

Publish fixture examples that the deterministic parser in Checkpoint 13 must extract identically.
