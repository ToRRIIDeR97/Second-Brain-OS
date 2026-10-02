# Data-classification policy v1

> Status: Tauri-era policy. The active Electron app does not implement
> class-based redaction or context packets; treat this as target policy, not
> a current control. See the [threat model](threat-model.md).

The app applies the least-permissive classification when fields are combined.
Classification is metadata for policy and redaction, not a claim that content
is trustworthy.

| Class | Examples | Context/default logging |
|---|---|---|
| `public` | public documentation, release metadata | May be included; ordinary logs allowed. |
| `internal` | project cards, UI state, non-sensitive events | Include only for an authorized workspace; redact from external exports. |
| `sensitive` | private notes, source, task details, provider metadata | Explicit policy and bounded context; identifiers/hashes in logs only. |
| `restricted` | credentials, `.env`, customer data, hidden reasoning, terminal scrollback | Never indexed or attached by default; never logged or exported. |

Canonical files are authoritative; database rows, indexes, summaries, and
packets are derived and rebuildable. Note and provider content is data, not
instructions. Only trusted project instructions are treated as instructions,
and they remain visibly separated from retrieved data.

Secret handling:

- Keep provider refresh tokens in the OS credential store.
- Deny `.env`, credential directories, and common secret patterns by default.
- Redact secrets, full content, hidden reasoning, and terminal scrollback from
  logs, audit events, crash reports, and diagnostics exports.
- Warn before adding sensitive material to a context packet.
- Never put access tokens in packets, event payloads, or provider prompts.
