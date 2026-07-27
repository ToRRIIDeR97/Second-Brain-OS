# Stable error-code registry v1

Codes are lowercase dotted identifiers: `domain.reason`, with an optional
stable subreason (`domain.reason.detail`). The owning module defines the code,
safe message, retryability, and structured detail keys. Codes are immutable;
fixing wording must not change a code, and removing a code requires a deprecation
period and migration note. Values that identify paths, users, tokens, or note
content belong in typed details only when policy permits, never in the code.

The IPC envelope always returns `code`, `message`, and `retryable`. Clients must
render an actionable fallback for an unknown code and must not infer permission
from `retryable`.

| Owner | Code | Retryable | Meaning |
|---|---|---:|---|
| `workspace` | `workspace.not_registered` | no | Workspace ID is not registered. |
| `workspace` | `workspace.root_unavailable` | sometimes | Root is missing or unavailable. |
| `workspace` | `workspace.path_escape` | no | Relative path escapes the registered root or policy. |
| `workspace` | `workspace.denied` | no | Effective workspace policy denies the action. |
| `contract` | `contract.invalid` | no | Payload fails the versioned contract. |
| `contract` | `contract.unsupported_version` | no | Payload version is not supported. |
| `ipc` | `ipc.invalid_request` | no | Request is malformed or missing required identity. |
| `ipc` | `ipc.job_not_found` | no | Job ID is unknown or expired. |
| `events` | `event.serialize` | no | Event payload cannot be serialized. |
| `events` | `event.bus_locked` | yes | Event subscribers or audit sink are temporarily unavailable. |
| `database` | `database.error` | yes | Local database operation failed. |
| `database` | `database.locked` | yes | Database is busy and the operation may be retried. |
| `database` | `database.migration_duplicate` | no | Two migrations declare the same version. |
| `database` | `database.migration_checksum_mismatch` | no | An applied migration was changed. |
| `audit` | `audit.serialize` | no | Sanitized audit payload could not be serialized. |
| `audit` | `audit.unavailable` | yes | A required audit sink is unavailable. |
| `filesystem` | `filesystem.error` | yes | Local filesystem operation failed. |
| `platform` | `platform.app_data_unavailable` | no | The OS did not provide an application-data directory. |
| `logging` | `logging.already_initialized` | no | Structured logging was already initialized. |
| `settings` | `settings.invalid` | no | Persisted settings fail their versioned schema. |
| `settings` | `settings.serialize` | no | Settings could not be serialized. |
| `system` | `system.sample_error` | no | Typed sample error used by the IPC smoke path. |
| `knowledge` | `knowledge.source_unavailable` | yes | Canonical source is temporarily unavailable. |
| `knowledge` | `knowledge.generation_stale` | yes | Derived state must be rebuilt or refreshed. |
| `policy` | `policy.approval_required` | no | An approval is required before the action. |
| `policy` | `policy.approval_expired` | no | A previously granted approval has expired. |
| `mcp` | `mcp.protocol_mismatch` | no | Sidecar and app protocol versions are incompatible. |
| `provider` | `provider.unavailable` | yes | External provider cannot currently be reached. |
| `provider` | `provider.auth_required` | no | Provider credentials are absent or expired. |

Module owners add new codes through review. Provider-specific errors are
translated at the adapter boundary; provider names and raw response bodies do
not leak into general UI contracts.
