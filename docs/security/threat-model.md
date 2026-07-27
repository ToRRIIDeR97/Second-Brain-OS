# Threat model v1

The security boundary is the Rust application policy layer. Renderer input,
workspace files, provider payloads, terminals, and MCP arguments are untrusted
until validated by that layer.

| Surface | Threat | Required control and evidence |
|---|---|---|
| Renderer/Tauri IPC | Absolute path, shell, SQL, or provider access | Typed commands accept workspace IDs and validated relative paths only; capability config has no unrestricted fs/shell. |
| Workspace files | `..` traversal, symlink escape, malicious instructions | Canonicalize and re-check roots; apply hard denies; classify file text as data; path/symlink fixtures fail closed. |
| Untrusted workspace | Project config auto-executes code or tools | No auto terminal presets, raw HTML, MCP writes, or external launches; explicit trust upgrade. |
| Markdown preview | Script, event-handler, or remote-resource execution | Sanitize HTML, disable scripts and handlers, restrict resources, and disable raw HTML in agent context. |
| MCP sidecar | Forged/replayed arguments or sidecar replacement | Authenticated short-lived capability token, bound to session/workspace/tools/expiry; version negotiation; no direct DB/filesystem. |
| Terminal/PTY | Escape sequences, wrong cwd, recursive deletion | Workspace-scoped PTY, filtered links/environment metadata, process protection, approval for destructive actions. |
| Agents/provider content | Prompt injection, hidden reasoning or secret leakage | Separate instructions from data, typed tool authorization, bounded packets, redacted normalized events. |
| Google/provider APIs | Token theft, duplicate/replayed writes, invite spam | OS credential store, provider adapter boundary, outbox/idempotency, participant-facing approval. |
| Database/migrations | Corruption or derived state becoming authority | Transactions, migration version checks, rollback/backup, rebuild from canonical files. |

Trust levels are `untrusted`, `trusted_read_only`, `trusted`, and `restricted`.
The default capability matrix is:

| Level | Readable roots | Writable roots | Processes | MCP | HTML |
|---|---|---|---|---|---|
| `untrusted` | registered root, deny patterns | none | blocked unless approved | read-only, no writes | disabled |
| `trusted_read_only` | policy-allowed roots | none | blocked unless approved | bounded reads | sanitized preview |
| `trusted` | policy-allowed roots | policy-allowed roots | allowed only by profile | negotiated reads/writes with approval | sanitized; expert mode separately approved |
| `restricted` | explicitly listed safe roots | explicitly listed safe roots | blocked by default | no MCP writes; reads require policy | disabled |

Hard application denies override every row; missing policy is deny-by-default.
Security-boundary changes are auditable and require explicit approval.
