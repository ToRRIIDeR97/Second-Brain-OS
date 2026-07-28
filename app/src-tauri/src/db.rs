//! SQLite lifecycle, migrations, health checks, and serialized access.

use crate::errors::{AppError, AppResult};
use crate::events::{AuditSink, EventEnvelope};
use crate::platform::clock::{Clock, SystemClock};
use rusqlite::{Connection, Transaction, params};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const BUSY_TIMEOUT_MS: u64 = 5_000;

#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const FOUNDATION_MIGRATION: Migration = Migration {
    version: 1,
    name: "foundation",
    sql: include_str!("../../migrations/0001_foundation.sql"),
};

pub const KNOWLEDGE_MIGRATION: Migration = Migration {
    version: 13,
    name: "knowledge",
    sql: include_str!("../../migrations/0013_knowledge.sql"),
};

pub const CONTEXT_AGENTS_PLANNER_MIGRATION: Migration = Migration {
    version: 30,
    name: "context_agents_planner",
    sql: include_str!("../../migrations/0030_context_agents_planner.sql"),
};

pub const DERIVED_SEMANTIC_RELEASE_MIGRATION: Migration = Migration {
    version: 37,
    name: "derived_semantic_release",
    sql: include_str!("../../migrations/0037_derived_semantic_release.sql"),
};

pub const MAX_SUPPORTED_SCHEMA_VERSION: u32 = DERIVED_SEMANTIC_RELEASE_MIGRATION.version;

#[derive(Debug, Clone)]
pub struct DatabaseHealth {
    pub path: PathBuf,
    pub schema_version: u32,
    pub journal_mode: String,
    pub foreign_keys: bool,
    pub can_query: bool,
}

#[derive(Clone)]
pub struct Database {
    path: PathBuf,
    connection: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        Self::open_with_migrations(
            path,
            &[
                FOUNDATION_MIGRATION,
                KNOWLEDGE_MIGRATION,
                CONTEXT_AGENTS_PLANNER_MIGRATION,
                DERIVED_SEMANTIC_RELEASE_MIGRATION,
            ],
        )
    }

    pub fn open_with_migrations(
        path: impl AsRef<Path>,
        migrations: &[Migration],
    ) -> AppResult<Self> {
        let path = path.as_ref().to_path_buf();
        if path.as_os_str() != ":memory:" {
            if let Some(parent) = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
            {
                std::fs::create_dir_all(parent)?;
            }
        }
        let mut connection = Connection::open(&path)?;
        refuse_newer_schema(&connection)?;
        configure_connection(&mut connection)?;
        let database = Self {
            path,
            connection: Arc::new(Mutex::new(connection)),
        };
        database.apply_migrations(migrations)?;
        Ok(database)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn health(&self) -> AppResult<DatabaseHealth> {
        self.with_connection(|connection| {
            let journal_mode = connection.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
            let foreign_keys =
                connection.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))? != 0;
            let can_query = connection.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))? == 1;
            let schema_version = schema_version(connection)?;
            Ok(DatabaseHealth {
                path: self.path.clone(),
                schema_version,
                journal_mode,
                foreign_keys,
                can_query,
            })
        })
    }

    pub fn schema_version(&self) -> AppResult<u32> {
        self.with_connection(schema_version)
    }

    pub fn with_connection<T, F>(&self, operation: F) -> AppResult<T>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::new("database.locked", "The local database is unavailable."))?;
        operation(&connection).map_err(Into::into)
    }

    pub fn transaction<T, F>(&self, operation: F) -> AppResult<T>
    where
        F: FnOnce(&Transaction<'_>) -> AppResult<T>,
    {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::new("database.locked", "The local database is unavailable."))?;
        let transaction = connection.transaction()?;
        let value = operation(&transaction)?;
        transaction.commit()?;
        Ok(value)
    }

    pub fn execute_batch(&self, sql: &str) -> AppResult<()> {
        self.with_connection(|connection| connection.execute_batch(sql))
    }

    pub fn insert_audit_event(&self, event: &EventEnvelope) -> AppResult<()> {
        let payload = serde_json::to_string(&event.audit_payload()).map_err(|error| {
            AppError::new(
                "audit.serialize",
                "The audit event could not be serialized.",
            )
            .with_details(serde_json::Value::String(error.to_string()))
        })?;
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO audit_events (
                    event_id, event_type, occurred_at, workspace_id, correlation_id,
                    actor_type, actor_id, payload_schema_version, redaction_class,
                    payload_json, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?3)",
                params![
                    event.event_id,
                    event.event_type,
                    event.timestamp,
                    event.workspace_id,
                    event.correlation_id,
                    event.actor.kind,
                    event.actor.id,
                    event.payload_schema_version,
                    event.redaction_class.as_str(),
                    payload,
                ],
            )?;
            Ok(())
        })
    }

    fn apply_migrations(&self, migrations: &[Migration]) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )",
            )
        })?;

        let mut ordered = migrations.to_vec();
        ordered.sort_by_key(|migration| migration.version);
        for pair in ordered.windows(2) {
            if pair[0].version == pair[1].version {
                return Err(AppError::new(
                    "database.migration_duplicate",
                    "Migration versions must be unique.",
                ));
            }
        }

        let applied = self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()
        })?;
        let applied_by_version = applied
            .into_iter()
            .map(|(version, name, checksum)| (version, (name, checksum)))
            .collect::<std::collections::BTreeMap<_, _>>();

        for migration in ordered {
            let checksum = blake3::hash(migration.sql.as_bytes()).to_hex().to_string();
            if let Some((name, existing_checksum)) = applied_by_version.get(&migration.version) {
                if name != migration.name || existing_checksum != &checksum {
                    return Err(AppError::new(
                        "database.migration_checksum_mismatch",
                        "An applied migration changed and cannot be replayed.",
                    ));
                }
                continue;
            }

            let applied_at = SystemClock.now_utc();
            self.transaction(|transaction| {
                transaction.execute_batch(migration.sql)?;
                transaction.execute(
                    "INSERT INTO schema_migrations (version, name, checksum, applied_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![migration.version, migration.name, checksum, applied_at],
                )?;
                transaction.pragma_update(None, "user_version", migration.version)?;
                Ok(())
            })?;
        }
        Ok(())
    }
}

impl AuditSink for Database {
    fn append(&self, event: &EventEnvelope) -> AppResult<()> {
        self.insert_audit_event(event)
    }
}

fn configure_connection(connection: &mut Connection) -> AppResult<()> {
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.pragma_update(None, "busy_timeout", BUSY_TIMEOUT_MS as i64)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

fn refuse_newer_schema(connection: &Connection) -> AppResult<()> {
    let version = connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
    if version > MAX_SUPPORTED_SCHEMA_VERSION {
        return Err(AppError::new(
            "database.schema_newer",
            "This database was created by a newer version of Second Brain OS.",
        )
        .with_details(serde_json::json!({
            "found": version,
            "supported": MAX_SUPPORTED_SCHEMA_VERSION,
        })));
    }
    Ok(())
}

fn schema_version(connection: &Connection) -> Result<u32, rusqlite::Error> {
    connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
}

#[cfg(test)]
mod tests {
    use super::{Database, Migration};
    use crate::events::{Actor, EventEnvelope, EventKind, RedactionClass};
    use serde_json::json;
    use std::sync::Arc;
    use std::thread;
    use tempfile::tempdir;

    #[test]
    fn migrates_and_reopens_without_replaying() {
        let root = tempdir().expect("tempdir");
        let path = root.path().join("db.sqlite");
        let first = Database::open(&path).expect("open");
        let health = first.health().expect("health");
        assert!(health.can_query);
        assert!(health.foreign_keys);
        assert_eq!(health.schema_version, 37);
        drop(first);

        let reopened = Database::open(&path).expect("reopen");
        assert_eq!(reopened.schema_version().expect("version"), 37);
    }

    #[test]
    fn refuses_a_newer_schema_before_running_migrations() {
        let root = tempdir().expect("tempdir");
        let path = root.path().join("future.sqlite");
        let connection = rusqlite::Connection::open(&path).expect("future database");
        connection
            .pragma_update(None, "user_version", 999)
            .expect("future version");
        drop(connection);

        let error = match Database::open(&path) {
            Ok(_) => panic!("newer schema must be refused"),
            Err(error) => error,
        };
        assert_eq!(error.code, "database.schema_newer");
        let connection = rusqlite::Connection::open(&path).expect("reopen future database");
        let version = connection
            .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
            .expect("version");
        assert_eq!(version, 999);
        let has_migration_table = connection
            .query_row(
                "SELECT EXISTS (
                    SELECT 1 FROM sqlite_master
                    WHERE type = 'table' AND name = 'schema_migrations'
                )",
                [],
                |row| row.get::<_, bool>(0),
            )
            .expect("table check");
        assert!(!has_migration_table);
    }

    #[test]
    fn failed_migration_rolls_back_and_can_be_retried() {
        let root = tempdir().expect("tempdir");
        let path = root.path().join("db.sqlite");
        let bad = [Migration {
            version: 2,
            name: "bad",
            sql: "CREATE TABLE broken (id INTEGER); SELECT no_such_function();",
        }];
        assert!(Database::open_with_migrations(&path, &bad).is_err());

        let good = [Migration {
            version: 2,
            name: "good",
            sql: "CREATE TABLE recovered (id INTEGER NOT NULL);",
        }];
        let database = Database::open_with_migrations(&path, &good).expect("retry");
        assert_eq!(database.schema_version().expect("version"), 2);
    }

    #[test]
    fn concurrent_writes_are_serialized() {
        let root = tempdir().expect("tempdir");
        let database = Arc::new(Database::open(root.path().join("db.sqlite")).expect("open"));
        database
            .execute_batch("CREATE TABLE writes (value INTEGER NOT NULL);")
            .expect("table");
        let handles = (0..8)
            .map(|value| {
                let database = Arc::clone(&database);
                thread::spawn(move || {
                    database
                        .transaction(|transaction| {
                            transaction.execute("INSERT INTO writes VALUES (?1)", [value])?;
                            Ok(())
                        })
                        .expect("write");
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().expect("join");
        }
        let count = database
            .with_connection(|connection| {
                connection.query_row("SELECT COUNT(*) FROM writes", [], |row| {
                    row.get::<_, i64>(0)
                })
            })
            .expect("count");
        assert_eq!(count, 8);
    }

    #[test]
    fn audit_insert_keeps_payload_redacted() {
        let root = tempdir().expect("tempdir");
        let database = Database::open(root.path().join("db.sqlite")).expect("open");
        let event = EventEnvelope::new(
            EventKind::AgentEventReceived,
            json!({"authorization": "Bearer secret", "message": "safe"}),
            None,
            None,
            Actor::system(),
            1,
            RedactionClass::Sensitive,
            true,
        )
        .expect("event");
        database.insert_audit_event(&event).expect("audit");
        let payload = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT payload_json FROM audit_events WHERE event_id = ?1",
                    [&event.event_id],
                    |row| row.get::<_, String>(0),
                )
            })
            .expect("payload");
        assert!(!payload.contains("secret"));
        assert!(payload.contains("[REDACTED]"));
    }
}
