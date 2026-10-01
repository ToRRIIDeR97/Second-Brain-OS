# Typed IPC result v1

Every Tauri command returns a result envelope with a `correlation_id`. Success
is `{ok: true, data}`; failure is `{ok: false, error}` where `error` has a
stable `code`, safe user-facing `message`, `retryable`, and optional structured
`details`. Long-running work additionally returns a `job_id`; progress and
completion use versioned events.

Renderer requests identify a registered `workspace_id` and validated relative
paths. They never accept arbitrary absolute paths, process commands, provider
URLs, credentials, or raw SQL. The frontend cannot call provider APIs or spawn
processes directly.

```json
{
  "contract": "ipc_result",
  "version": 1,
  "ok": false,
  "correlation_id": "read_01K4I",
  "error": {
    "code": "workspace.path_escape",
    "message": "The requested path is outside the workspace.",
    "retryable": false,
    "details": { "path_kind": "relative" }
  }
}
```

Bindings are generated or mechanically checked from the backend contract. A
client must preserve unknown error details and display a safe fallback for an
unknown code.
