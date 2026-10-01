# Database foundation

The Tauri backend owns one SQLite connection behind `db::Database`. Every
connection enables foreign keys, WAL mode, a five-second busy timeout, and UTC
timestamps supplied by the platform clock. A mutex serializes writes; callers
use `Database::transaction` for cross-table updates instead of a generic
repository layer.

Migrations are embedded, ordered by integer version, and recorded in
`schema_migrations` with a BLAKE3 checksum. Each migration runs in its own
transaction. A changed checksum or duplicate version fails startup; a failed
migration leaves no row and can be retried after correction. New domains add a
new migration file and version; they do not edit an applied migration.

The foundation migration creates only `app_settings` and `audit_events`.
Workspace, UI-state, indexing, and planner tables belong to their later
checkpoints. Application data is placed under the platform data directory;
credentials remain in the operating-system credential store.

Events marked `persist_to_audit_log` must be published through an `EventBus`
with a database audit sink. The sink writes the sanitized envelope before
subscriber fan-out. Event subscribers are isolated from one another; a
panicking subscriber is counted in the publish report and does not stop the
other subscribers.

Tests use `FixedClock` and `FixedIdGenerator` from `platform::clock`, plus a
temporary database and the fixtures under `fixtures/foundation/`.
