# Checkpoint 35: Performance, Accessibility, and Security Hardening

## Outcome

The integrated application meets its critical responsiveness and accessibility targets and has no known high-severity security issue within the Version 1 threat model.

## Source plan

- Sections 26, 28-30, and 36
- Phase 15 hardening portion
- Backlog L008-L010

## Prerequisites

- Checkpoints 17, 19, 25-30, and 34

## Scope

- Run and tune desktop, file, editor, index, graph, context, terminal, database, and planner performance fixtures.
- Complete keyboard, focus, screen reader, high contrast, reduced motion, zoom, target-size, and remappable-shortcut review.
- Revisit every threat-model item with adversarial tests.
- Perform dependency, license, secret, and unsafe-capability review.
- Validate prompt-injection boundaries, path/symlink policy, terminal escapes, MCP tokens, provider replay, and approval rules.
- Fix critical/high findings and document accepted lower-risk limitations.

## Expected artifacts

- Performance benchmark report and budgets.
- Accessibility audit and manual test notes.
- Security review, adversarial test suite, and risk dispositions.
- Updated threat model and data-flow diagrams.
- Regression tests for every fixed finding.

## Work items

1. Measure before tuning and retain repeatable fixture commands.
2. Test warm/cold startup, switch, tree, editor, save, index, query, graph, packet, and terminal targets.
3. Test 10k/100k files, 1m chunks, 300-node graph, 10k planner items, and six high-output terminals.
4. Audit all privileged IPC commands and capability files.
5. Fuzz or property-test parsers, paths, MCP arguments, and packet budgets.
6. Test accessibility with keyboard and at least one supported screen reader.
7. Review third-party advisories and pin remediated versions.

## Acceptance evidence

- Critical user actions meet targets or have documented, approved exceptions.
- Indexing and terminal output do not block editor typing.
- Critical workflows are keyboard and screen-reader usable.
- Graph and planner have non-canvas/list alternatives.
- No known critical or high-severity security issue remains.
- All threat-model risks have test evidence or an explicit disposition.

## Validation focus

- Measurement variance across target platforms
- Memory growth over long sessions
- Accessibility regressions in third-party widgets
- HTML/Mermaid/PDF/terminal untrusted content
- Secrets in telemetry and crash paths

## Out of scope

New product features, unsupported platform optimization, formal certification, and real-time collaboration.

## Handoff

Give release operations exact benchmark commands, accessibility test matrix, security findings, and any ship-blocking exceptions.
