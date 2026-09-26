# Retired Tauri application

The root React/Tauri application, Rust MCP executable, Cargo workspace, pnpm
workspace, and their release scripts were retired on 2026-09-26. They were not
used by the active Electron application.

Their last complete source is available in Git at
`92c2ac5` under `app/`, `mcp/`, and `scripts/`. Restore from that revision in a
separate checkout when investigating old installations. The four SQL files in
`migrations/` are reference copies, not migrations for the active application.

The cleanup also created a local recovery archive at
`.cache/cleanup/donor-before-cleanup.tar`. It contains only tracked source from
that revision, not application data, credentials, or uncommitted work.

## Remaining product and migration work

- The donor had trust-gated lexical search over workspace paths and file
  contents. The active Second Brain HTTP API has note, project, and calendar
  operations, but no equivalent general workspace search endpoint.
- The donor stored planner and knowledge state in SQLite. The active planner
  uses workspace `.second-brain/calendar-v1.json` files and Electron owns Google
  connections. There is no donor-database import path. Source retirement must
  not be interpreted as permission to delete old installed application data.
- Semantic retrieval, persistent indexing, derived extraction, and context
  packet modules in the donor were prototypes or test-only paths. Their tests
  did not establish that the old app delivered those features.
- The donor MCP executable used an unavailable gateway; the active runtime's
  MCP support is separate and remains in the OpenCode packages.

Keep `fixtures/`, `docs/contracts/`, product briefs, implementation records,
and handovers as requirements and historical evidence. Old Rust/Tauri commands
in those records are not current setup or verification instructions. Use the
root README and `docs/release-operations.md` for the active application.
