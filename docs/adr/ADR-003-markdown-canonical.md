# ADR-003: Keep Markdown as canonical note storage

- Status: accepted
- Date: 2026-07-27
- Supersedes: none

## Decision

Store canonical notes as ordinary Markdown files plus the versioned extensions
in [Markdown v1](../archive/tauri/contracts/markdown-v1.md). Rich editor state is transient
and must serialize through a single codec contract.

## Consequences

Files remain readable, diffable, portable, and recoverable without the app.
Unknown extension syntax must survive a parse/serialize round trip. The editor
must not make a private database representation authoritative.

## Supersession

A new canonical format requires an explicit codec version, migration strategy,
and proof that existing Markdown remains recoverable.
