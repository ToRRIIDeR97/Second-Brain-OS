//! Health reporting, verified local backups, recovery, and safe support exports.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::db::{Database, MAX_SUPPORTED_SCHEMA_VERSION};
use crate::errors::{AppError, AppResult};

const BACKUP_PREFIX: &str = "second-brain-";
const BACKUP_SUFFIX: &str = ".sqlite";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Healthy,
    Warning,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    pub component: String,
    pub status: HealthStatus,
    pub interrupted: u64,
    pub failed: u64,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub generated_at: String,
    pub schema_version: u32,
    pub database_status: HealthStatus,
    pub journal_mode: String,
    pub foreign_keys_enabled: bool,
    pub counts: BTreeMap<String, u64>,
    pub recovery: Vec<RecoveryStatus>,
    pub backup: Option<BackupStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub verified: bool,
    pub schema_version: u32,
    pub size_bytes: u64,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: PathBuf,
    pub status: BackupStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored_schema_version: u32,
    pub rollback_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupportBundle<'a> {
    format_version: u32,
    diagnostics: &'a DiagnosticsReport,
    audit_events: Vec<AuditMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditMetadata {
    event_type: String,
    occurred_at: String,
    redaction_class: String,
}

/// Collect only aggregate state. No note bodies, provider payloads, environment
/// variables, credentials, paths, or terminal scrollback cross this boundary.
pub fn collect(
    database: &Database,
    generated_at: impl Into<String>,
    latest_backup: Option<&Path>,
) -> AppResult<DiagnosticsReport> {
    let health = database.health()?;
    let counts = database.with_connection(|connection| {
        [
            ("documents", "SELECT COUNT(*) FROM knowledge_documents"),
            ("chunks", "SELECT COUNT(*) FROM knowledge_chunks"),
            ("nodes", "SELECT COUNT(*) FROM knowledge_nodes"),
            ("edges", "SELECT COUNT(*) FROM knowledge_edges"),
            ("fts_rows", "SELECT COUNT(*) FROM knowledge_fts"),
            ("pending_index_jobs", "SELECT COUNT(*) FROM knowledge_index_jobs WHERE status IN ('pending', 'running')"),
            ("failed_index_jobs", "SELECT COUNT(*) FROM knowledge_index_jobs WHERE status = 'failed'"),
            ("recoverable_agents", "SELECT COUNT(*) FROM agent_sessions WHERE state IN ('starting', 'running', 'waiting', 'canceling', 'recoverable')"),
            ("failed_agents", "SELECT COUNT(*) FROM agent_sessions WHERE state = 'failed'"),
            ("pending_outbox", "SELECT COUNT(*) FROM planner_outbox WHERE state IN ('pending', 'running', 'retry_wait')"),
            ("failed_outbox", "SELECT COUNT(*) FROM planner_outbox WHERE state = 'failed'"),
            ("disconnected_providers", "SELECT COUNT(*) FROM planner_accounts WHERE connection_state != 'connected'"),
        ]
        .into_iter()
        .map(|(name, sql)| {
            let count = connection.query_row(sql, [], |row| row.get::<_, i64>(0))?;
            let count = u64::try_from(count)
                .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, count))?;
            Ok((name.to_owned(), count))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()
    })?;
    let recovery = [
        recovery_item(
            "index",
            counts["pending_index_jobs"],
            counts["failed_index_jobs"],
            "Resume or rebuild the affected workspace index.",
        ),
        recovery_item(
            "agents",
            counts["recoverable_agents"],
            counts["failed_agents"],
            "Reconnect the provider and resume or close the session.",
        ),
        recovery_item(
            "outbox",
            counts["pending_outbox"],
            counts["failed_outbox"],
            "Retry idempotent writes after reconnecting the provider.",
        ),
        recovery_item(
            "providers",
            counts["disconnected_providers"],
            0,
            "Reconnect the provider credentials on this machine.",
        ),
    ]
    .into_iter()
    .collect();
    let backup = latest_backup.map(|path| match validate_backup(path) {
        Ok(status) => status,
        Err(error) => BackupStatus {
            verified: false,
            schema_version: 0,
            size_bytes: fs::metadata(path).map_or(0, |metadata| metadata.len()),
            error_code: Some(error.code),
        },
    });

    Ok(DiagnosticsReport {
        generated_at: generated_at.into(),
        schema_version: health.schema_version,
        database_status: if health.can_query && health.foreign_keys {
            HealthStatus::Healthy
        } else {
            HealthStatus::Failed
        },
        journal_mode: health.journal_mode,
        foreign_keys_enabled: health.foreign_keys,
        counts,
        recovery,
        backup,
    })
}

/// SQLite `VACUUM INTO` creates a consistent snapshot while the live database
/// remains open. The result is returned only after an integrity check passes.
pub fn create_verified_backup(database: &Database, backup_dir: &Path) -> AppResult<BackupResult> {
    if database.path().as_os_str() == ":memory:" {
        return Err(AppError::new(
            "backup.unsupported",
            "In-memory databases cannot be backed up.",
        ));
    }
    fs::create_dir_all(backup_dir)?;
    let path = next_backup_path(backup_dir)?;
    let path_text = path.to_string_lossy().into_owned();
    if let Err(error) =
        database.with_connection(|connection| connection.execute("VACUUM INTO ?1", [&path_text]))
    {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    match validate_backup(&path) {
        Ok(status) => Ok(BackupResult { path, status }),
        Err(error) => {
            let _ = fs::remove_file(path);
            Err(error)
        }
    }
}

pub fn validate_backup(path: &Path) -> AppResult<BackupStatus> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() {
        return Err(AppError::new(
            "backup.invalid_type",
            "The backup must be a regular file.",
        ));
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| AppError::new("backup.corrupt", "The backup could not be opened."))?;
    let check = connection
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .map_err(|_| AppError::new("backup.corrupt", "The backup integrity check failed."))?;
    if check != "ok" {
        return Err(AppError::new(
            "backup.corrupt",
            "The backup integrity check failed.",
        ));
    }
    let schema_version = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|_| AppError::new("backup.invalid_schema", "The backup schema is invalid."))?;
    Ok(BackupStatus {
        verified: true,
        schema_version,
        size_bytes: metadata.len(),
        error_code: None,
    })
}

/// Restore a verified database while preserving the previous file beside it.
/// The owning `Database` must be closed first so WAL state is checkpointed.
pub fn restore_closed_database(
    database_path: &Path,
    backup_path: &Path,
) -> AppResult<RestoreResult> {
    let backup = validate_backup(backup_path)?;
    if backup.schema_version > MAX_SUPPORTED_SCHEMA_VERSION {
        return Err(AppError::new(
            "database.schema_too_new",
            "The backup was created by a newer application version.",
        ));
    }
    if wal_has_data(database_path)? {
        return Err(AppError::new(
            "restore.database_active",
            "Close the database cleanly before restoring.",
        ));
    }
    let parent = database_path.parent().ok_or_else(|| {
        AppError::new(
            "restore.invalid_path",
            "The database path must have a parent directory.",
        )
    })?;
    let nonce = unix_millis()?;
    let rollback_path = parent.join(format!("database.rollback-{nonce}.sqlite"));
    let staged_path = parent.join(format!("database.restore-{nonce}.tmp"));
    copy_and_sync(backup_path, &staged_path)?;
    if let Err(error) = fs::rename(database_path, &rollback_path) {
        let _ = fs::remove_file(&staged_path);
        return Err(error.into());
    }
    if let Err(error) = fs::rename(&staged_path, database_path) {
        let _ = fs::rename(&rollback_path, database_path);
        let _ = fs::remove_file(&staged_path);
        return Err(error.into());
    }
    if let Err(error) = validate_backup(database_path) {
        let failed_path = parent.join(format!("database.failed-{nonce}.sqlite"));
        let _ = fs::rename(database_path, failed_path);
        let _ = fs::rename(&rollback_path, database_path);
        return Err(error);
    }
    Ok(RestoreResult {
        restored_schema_version: backup.schema_version,
        rollback_path,
    })
}

/// Delete only old regular files created by this service, always retaining at
/// least one recovery point.
pub fn prune_backups(backup_dir: &Path, keep: usize) -> AppResult<Vec<PathBuf>> {
    let mut backups = fs::read_dir(backup_dir)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter(|entry| is_owned_backup(&entry.file_name().to_string_lossy()))
        .collect::<Vec<_>>();
    backups.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    let mut removed = Vec::new();
    for entry in backups.into_iter().skip(keep.max(1)) {
        fs::remove_file(entry.path())?;
        removed.push(entry.path());
    }
    Ok(removed)
}

/// Export a JSON support bundle containing only aggregate diagnostics and
/// audit envelope metadata. Audit payloads are deliberately never queried.
pub fn export_support_bundle(
    database: &Database,
    report: &DiagnosticsReport,
    destination: &Path,
) -> AppResult<()> {
    let audit_events = database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "SELECT event_type, occurred_at, redaction_class
             FROM audit_events ORDER BY occurred_at DESC LIMIT 500",
        )?;
        statement
            .query_map([], |row| {
                Ok(AuditMetadata {
                    event_type: row.get(0)?,
                    occurred_at: row.get(1)?,
                    redaction_class: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
    })?;
    let bundle = serde_json::to_vec_pretty(&SupportBundle {
        format_version: 1,
        diagnostics: report,
        audit_events,
    })
    .map_err(|error| {
        AppError::new(
            "diagnostics.serialize",
            "The support bundle could not be serialized.",
        )
        .with_details(serde_json::Value::String(error.to_string()))
    })?;
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)?;
    output.write_all(&bundle)?;
    output.sync_all()?;
    Ok(())
}

fn recovery_item(component: &str, interrupted: u64, failed: u64, action: &str) -> RecoveryStatus {
    RecoveryStatus {
        component: component.to_owned(),
        status: if failed > 0 {
            HealthStatus::Failed
        } else if interrupted > 0 {
            HealthStatus::Warning
        } else {
            HealthStatus::Healthy
        },
        interrupted,
        failed,
        action: (interrupted > 0 || failed > 0).then(|| action.to_owned()),
    }
}

fn next_backup_path(backup_dir: &Path) -> AppResult<PathBuf> {
    let millis = unix_millis()?;
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("{BACKUP_PREFIX}{millis}{BACKUP_SUFFIX}")
        } else {
            format!("{BACKUP_PREFIX}{millis}-{suffix}{BACKUP_SUFFIX}")
        };
        let path = backup_dir.join(name);
        if !path.exists() {
            return Ok(path);
        }
    }
    Err(AppError::new(
        "backup.name_exhausted",
        "A unique backup name could not be created.",
    ))
}

fn unix_millis() -> AppResult<u128> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|_| AppError::new("clock.invalid", "The system clock is invalid."))
}

fn is_owned_backup(name: &str) -> bool {
    let timestamp = name
        .strip_prefix(BACKUP_PREFIX)
        .and_then(|name| name.strip_suffix(BACKUP_SUFFIX));
    timestamp.is_some_and(|timestamp| {
        !timestamp.is_empty()
            && timestamp
                .chars()
                .all(|character| character.is_ascii_digit() || character == '-')
    })
}

fn copy_and_sync(source: &Path, destination: &Path) -> AppResult<()> {
    let mut source = fs::File::open(source)?;
    let mut destination = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)?;
    io::copy(&mut source, &mut destination)?;
    destination.sync_all()?;
    Ok(())
}

fn wal_has_data(database_path: &Path) -> AppResult<bool> {
    let wal = PathBuf::from(format!("{}-wal", database_path.to_string_lossy()));
    Ok(wal.exists() && fs::metadata(wal)?.len() > 0)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::Value;
    use tempfile::tempdir;

    use super::{
        collect, create_verified_backup, export_support_bundle, prune_backups,
        restore_closed_database, validate_backup,
    };
    use crate::db::{Database, MAX_SUPPORTED_SCHEMA_VERSION};

    #[test]
    fn backup_export_restore_and_retention_are_safe() {
        let root = tempdir().expect("tempdir");
        let database_path = root.path().join("database.sqlite");
        let database = Database::open(&database_path).expect("database");
        database
            .execute_batch(
                "INSERT INTO audit_events (
                    event_id, event_type, occurred_at, correlation_id, actor_type,
                    payload_schema_version, redaction_class, payload_json, created_at
                 ) VALUES (
                    'event', 'test.event', '2026-01-01T00:00:00Z', 'correlation',
                    'system', 1, 'restricted',
                    '{\"body\":\"private note\",\"password\":\"secret\"}',
                    '2026-01-01T00:00:00Z'
                 );",
            )
            .expect("audit fixture");

        let backups = root.path().join("backups");
        let first = create_verified_backup(&database, &backups).expect("backup");
        assert!(first.status.verified);
        let report =
            collect(&database, "2026-01-01T00:00:00Z", Some(&first.path)).expect("diagnostics");
        let bundle = root.path().join("support.json");
        export_support_bundle(&database, &report, &bundle).expect("bundle");
        let exported = fs::read_to_string(bundle).expect("read bundle");
        assert!(!exported.contains("private note"));
        assert!(!exported.contains("secret"));
        let parsed: Value = serde_json::from_str(&exported).expect("json");
        assert_eq!(parsed["auditEvents"][0]["eventType"], "test.event");

        let second = create_verified_backup(&database, &backups).expect("backup");
        let unrelated = backups.join("keep-me.sqlite");
        fs::write(&unrelated, b"not ours").expect("unrelated");
        let removed = prune_backups(&backups, 1).expect("retention");
        assert_eq!(removed.len(), 1);
        assert!(second.path.exists());
        assert!(unrelated.exists());

        drop(database);
        let restored = restore_closed_database(&database_path, &second.path).expect("restore");
        assert!(restored.rollback_path.exists());
        assert_eq!(
            validate_backup(&database_path)
                .expect("restored health")
                .schema_version,
            MAX_SUPPORTED_SCHEMA_VERSION
        );
    }

    #[test]
    fn corrupt_and_newer_backups_are_refused_without_mutating_database() {
        let root = tempdir().expect("tempdir");
        let database_path = root.path().join("database.sqlite");
        let database = Database::open(&database_path).expect("database");
        let corrupt = root.path().join("corrupt.sqlite");
        fs::write(&corrupt, b"not sqlite").expect("corrupt");
        assert_eq!(
            validate_backup(&corrupt).expect_err("must fail").code,
            "backup.corrupt"
        );
        let report = collect(&database, "2026-01-01T00:00:00Z", Some(&corrupt))
            .expect("failed backup diagnostics");
        assert_eq!(
            report.backup.expect("backup status").error_code.as_deref(),
            Some("backup.corrupt")
        );

        let backup =
            create_verified_backup(&database, &root.path().join("backups")).expect("backup");
        drop(database);
        let original = fs::read(&database_path).expect("original");
        rusqlite::Connection::open(&backup.path)
            .expect("open backup")
            .execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at)
                 VALUES (?1, 'future', 'checksum', '2026-01-01T00:00:00Z')",
                [MAX_SUPPORTED_SCHEMA_VERSION + 1],
            )
            .expect("future schema");
        assert_eq!(
            restore_closed_database(&database_path, &backup.path)
                .expect_err("newer schema")
                .code,
            "database.schema_too_new"
        );
        assert_eq!(fs::read(&database_path).expect("database"), original);
    }
}
