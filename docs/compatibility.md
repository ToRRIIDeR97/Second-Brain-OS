# Compatibility

| Contract | Current version | Version carrier |
|---|---:|---|
| Application | 0.1.0 | package and Cargo manifests |
| Database | 1 | `schema_migrations` |
| Workspace manifest | 1 | `schema_version` |
| Markdown codec | 1 | codec constant |
| Event envelope | 1 | `schema_version` |
| IPC envelope | 1 | generated contract |
| MCP tools | 1 | sidecar handshake |
| Context packet | 1 | `version` |

Backward-compatible fields may be added within a version. Renames, removals, or
semantic changes require a new version plus a migration note.

