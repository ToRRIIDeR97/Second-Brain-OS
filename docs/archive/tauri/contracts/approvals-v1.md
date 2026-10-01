# Approval contract v1

An approval records the action before it is performed. Required inputs are
`approval_id`, `risk_class`, `actor`, `workspace_id`, `target`,
`reversible`, `external_side_effect`, `destructive`, `participant_facing`,
`decision`, and `audit_event_id`; `expires_at` is required for approvals that
outlive the current request.

Risk classes are:

| Class | Default | Examples |
|---|---|---|
| `read` | allow under policy | search, read a permitted section |
| `local_reversible_write` | ask on first use | create or edit a note |
| `local_destructive` | always ask | delete, overwrite, or move data |
| `external_private_write` | always ask | private calendar/task mutation |
| `external_participant_write` | explicit confirmation | invite, reply, or shared change |
| `security_boundary_change` | explicit confirmation + audit | trust, roots, tools, or HTML policy |

Approvals bind to actor, workspace, target, capability, and expiry. They cannot
expand roots, tools, or lifetime after issuance. Decisions are `pending`,
`approved`, `denied`, `expired`, or `canceled`; every decision is auditable and
secrets are excluded from the record.
