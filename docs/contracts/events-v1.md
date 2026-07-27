# Event envelope v1

The typed internal bus carries one envelope shape. Required fields are
`event_id`, `event_type`, `timestamp` (UTC), `correlation_id`, `actor`,
`payload_schema_version`, `redaction_class`, `persist_to_audit`, and an object
`payload`; `workspace_id` is required for workspace-scoped events.

`event_type` is lowercase dotted notation such as `workspace.opened`,
`file.modified`, or `agent.approval.requested`. Actors are `system`, `user`,
`agent`, or `provider`. Payload versions can evolve independently from the
envelope. Redaction classes are `public`, `internal`, `sensitive`, and
`restricted`.

```json
{
  "contract": "event_envelope",
  "version": 1,
  "event_id": "evt_01K4E",
  "event_type": "workspace.opened",
  "timestamp": "2026-07-27T12:00:00Z",
  "workspace_id": "ws_01K4A",
  "correlation_id": "open_01K4E",
  "actor": "user",
  "payload_schema_version": 1,
  "redaction_class": "internal",
  "persist_to_audit": true,
  "payload": { "kind": "project" }
}
```

The bus is for decoupled notifications and jobs, not a replacement for direct
calls or database transactions. Audit persistence is explicit; secrets,
hidden reasoning, full note bodies, and terminal scrollback are not event
payload defaults.
