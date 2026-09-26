# ADR-001: Use Tauri 2 for the desktop shell

- Status: superseded by ADR-010
- Date: 2026-07-27
- Supersedes: none

## Decision

Use Tauri 2 with a React/TypeScript renderer and a Rust application backend.
Desktop-specific code stays behind backend adapters and Tauri commands remain
thin.

## Consequences

The product gets native filesystem, process, credential, window, and packaging
integration with explicit renderer capabilities. The team must pin and test
Rust, Tauri, and each supported platform's native prerequisites.

## Supersession

An accepted replacement must retain the renderer privilege boundary, record the
new decision, and include a migration and compatibility note.
