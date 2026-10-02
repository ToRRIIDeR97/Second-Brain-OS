# Approval risk classes v1

> Status: Tauri-era policy. The active app uses OpenCode's permission system;
> the approval IDs, expiry, and audit events described here are not
> implemented. See the [threat model](threat-model.md).

Every action is classified before execution by actor, workspace, target,
reversibility, external side effect, destructive flag, and participant-facing
impact. The app, not the model or sidecar, makes the final decision.

| Risk class | Default decision | Required controls |
|---|---|---|
| `read` | allow if policy permits | Workspace/root check; bounded result; audit when sensitive. |
| `local_reversible_write` | ask on first use | Show target and diff; bind approval to session and workspace. |
| `local_destructive` | always ask | Show exact target; require explicit confirmation; offer recovery/trash. |
| `external_private_write` | always ask | Show provider, payload, and idempotency key; audit result. |
| `external_participant_write` | explicit confirmation | Show participants and side effect; never infer consent. |
| `security_boundary_change` | explicit confirmation + audit | Show old/new roots, tools, trust, or HTML policy; invalidate stale approvals. |

An approval has a stable ID, expiry, actor, workspace, target, capability, and
audit event. It cannot expand its own roots, tools, or lifetime. Decisions are
`pending`, `approved`, `denied`, `expired`, or `canceled`. Sensitive details
and secrets are redacted from logs and audit exports.
