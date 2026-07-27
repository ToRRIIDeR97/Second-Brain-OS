# ADR-002: Use federated workspaces

- Status: accepted
- Date: 2026-07-27
- Supersedes: none

## Decision

Keep the global brain separate from substantial project repositories. Each
registered root has its own workspace identity, policy, files, and Git history.

## Consequences

Context, agent working directories, indexing, and archiving have clear project
boundaries. Cross-project work must explicitly resolve which roots are mounted;
a project card never grants access to its linked root.

## Supersession

Any change to root isolation requires a threat-model review and a versioned
workspace-policy migration.
