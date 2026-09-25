# Contract compatibility matrix

The current release carries these versioned contracts. Version numbers are
independent so a Markdown extension change does not silently change IPC or MCP.

| Contract | Version 1 carrier | Additive change | Breaking change |
|---|---|---|---|
| Application | package/Cargo version | compatible metadata | release migration note |
| Database (current: 37) | migration table | nullable/defaulted column + migration | migration with rollback; refuse newer schemas |
| Workspace manifest | `schema_version` (+ `version`) | optional field preserved | new schema + read-only/migration path |
| Project card (current: 2) | `version` | optional front-matter field | v1 reader adapter; v2 write preserving body and unknown fields |
| Markdown extensions | `extension_version` | syntax that round-trips as old data | codec migration/golden fixtures |
| Graph ontology | `version` | new node/edge with explicit semantics | rename/removal + extraction migration |
| Event envelope | `version` + payload schema version | additive payload field | new envelope/payload adapter |
| IPC result | `version` | optional details or event fields | generated binding and client migration |
| Approval | `version` | optional audit metadata | policy/decision semantics migration |
| Context packet | `version` | optional inspectable metadata | packet compiler/adapter migration |
| MCP tools/resources (current: 2) | sidecar handshake version | additive names with capability negotiation | fail closed with actionable mismatch |
| Agent adapter protocol | provider/profile protocol version | optional normalized event | adapter migration; preserve session mirror |

Writers emit the newest supported version. Readers may accept older versions
through explicit adapters, but must refuse a newer version without mutation.
Every migration records source version, target version, checksum where
applicable, and rollback behavior. Unknown fields are preserved when safe.
