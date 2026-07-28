# Version-one contracts

These documents freeze the boundaries that later checkpoints implement. The
machine-readable definitions are in [`schema-v1.json`](schema-v1.json); the
Markdown files explain ownership, security, compatibility, and examples.

Every payload carries `contract` and `version: 1`. The workspace manifest also
carries its canonical `schema_version: 1`. Additive fields are allowed only
when they preserve the stated invariants. Renames, removals, changed meanings,
or changed security defaults require a new version and a migration note in
[`../compatibility/version-matrix.md`](../compatibility/version-matrix.md).

The app owns validation and policy. The renderer and MCP sidecar may validate
early, but they must not broaden roots, capabilities, or approval decisions.
Provider payloads stop at adapter boundaries and are converted to these local
types.

| Contract | Owner | Version carrier |
|---|---|---|
| Workspace manifest | `workspace` | `schema_version` + `version` |
| Project card | `workspace` | `version` |
| Markdown document | `knowledge` | `extension_version` + `version` |
| Graph ontology | `knowledge` | `version` |
| Event envelope | `events`/calling domain | `version` + `payload_schema_version` |
| IPC result | Tauri command boundary | `version` |
| Approval | `agents`/policy boundary | `version` |
| Context packet | `knowledge`/context compiler | `version` |
| MCP bridge | app gateway + thin sidecar | handshake `protocolVersion`; current contract [v2](mcp-v2.md) |
