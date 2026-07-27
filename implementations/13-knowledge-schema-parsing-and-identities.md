# Checkpoint 13: Knowledge Schema, Parsing, and Stable Identities

## Outcome

Markdown and initial code files deterministically produce documents, revisions, chunks, authoritative nodes, edges, and source mappings with stable identity rules.

## Source plan

- Sections 10.2-10.3, 12.5-12.7, and 13
- Phase 5 parser/schema tasks
- Backlog D001-D007

## Prerequisites

- Checkpoints 03 and 07

## Scope

- Add documents, revisions, chunks, nodes, edges, node-sources, and FTS migrations.
- Implement versioned Markdown extraction matching Checkpoints 10-11 fixtures.
- Add lightweight code metadata extraction for language, symbols, imports, exports, and TODO/FIXME.
- Implement stable document, durable block, and ordinary chunk identity rules.
- Distinguish authority, confidence, temporal validity, and provenance.
- Do not modify existing source files merely to add portable IDs.

## Expected artifacts

- Knowledge schema migrations and constraints.
- Parser trait/registry and version metadata.
- Parsed intermediate representation.
- Deterministic identity utilities.
- Golden extraction fixtures and parser property tests.

## Work items

1. Parse front matter, headings, lists, tasks, tables, code, math, links, tags, mentions, directives, decisions, citations, and attachments.
2. Map explicit syntax into the initial node and edge ontology.
3. Assign database identities to existing files without editing them.
4. Preserve explicit IDs for application-created durable items.
5. Compute deterministic ordinary chunk IDs.
6. Record source hashes and line ranges.
7. Make parser errors localized and non-panicking.

## Acceptance evidence

- Identical files and parser versions produce identical authoritative records.
- Renaming a file with a portable document ID does not create a new document identity.
- Durable task/decision IDs survive reordering.
- Derived and inferred records cannot be mistaken for authoritative records.
- Parser property tests never panic on generated or malformed input.
- Codec fixtures and parser extraction fixtures agree on syntax.

## Validation focus

- Duplicate explicit IDs
- Heading reorder and duplicate headings
- Front-matter edge cases
- Temporal closure of changed records
- Unsupported code languages

## Out of scope

Watcher-driven indexing, job queues, ranking, summaries, embeddings, and graph UI.

## Handoff

Document the parsed representation, parser versioning rule, and which record types the transactional indexer must replace atomically.
