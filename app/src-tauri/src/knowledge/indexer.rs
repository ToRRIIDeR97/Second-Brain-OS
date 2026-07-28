use std::collections::BTreeMap;

use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::errors::AppResult;
use crate::workspace::watcher::{FileEvent, FileEventKind};

use super::parser::ParsedDocument;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexJobKind {
    Upsert,
    Delete,
    Rename,
    FileRebuild,
    FolderRebuild,
    WorkspaceRebuild,
    DerivedRebuild,
    FullRebuild,
}

impl IndexJobKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Upsert => "upsert",
            Self::Delete => "delete",
            Self::Rename => "rename",
            Self::FileRebuild => "file_rebuild",
            Self::FolderRebuild => "folder_rebuild",
            Self::WorkspaceRebuild => "workspace_rebuild",
            Self::DerivedRebuild => "derived_rebuild",
            Self::FullRebuild => "full_rebuild",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexJobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl IndexJobStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexJob {
    pub job_id: String,
    pub workspace_id: String,
    pub relative_path: String,
    pub old_relative_path: Option<String>,
    pub kind: IndexJobKind,
    pub status: IndexJobStatus,
    pub priority: i32,
    pub attempts: u32,
    pub source_hash: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl IndexJob {
    #[must_use]
    pub fn upsert(
        workspace_id: impl Into<String>,
        relative_path: impl Into<String>,
        source_hash: Option<String>,
    ) -> Self {
        Self::new(
            workspace_id.into(),
            relative_path.into(),
            None,
            IndexJobKind::Upsert,
            source_hash,
        )
    }

    #[must_use]
    pub fn from_file_event(event: FileEvent) -> Self {
        let kind = match event.kind {
            FileEventKind::Created | FileEventKind::Modified => IndexJobKind::Upsert,
            FileEventKind::Deleted => IndexJobKind::Delete,
            FileEventKind::Renamed => IndexJobKind::Rename,
        };
        Self::new(
            event.workspace_id,
            event.path,
            event.old_path,
            kind,
            event.observed_hash,
        )
    }

    fn new(
        workspace_id: String,
        relative_path: String,
        old_relative_path: Option<String>,
        kind: IndexJobKind,
        source_hash: Option<String>,
    ) -> Self {
        let job_id = stable_job_id(&workspace_id, &relative_path);
        Self {
            job_id,
            workspace_id,
            relative_path,
            old_relative_path,
            kind,
            status: IndexJobStatus::Pending,
            priority: 0,
            attempts: 0,
            source_hash,
            error_code: None,
            error_message: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug)]
pub struct IndexCoordinator {
    pending: BTreeMap<(String, String), IndexJob>,
    finished: Vec<IndexJob>,
    max_attempts: u32,
    cancelled: bool,
}

impl IndexCoordinator {
    #[must_use]
    pub fn new(max_attempts: u32) -> Self {
        Self {
            pending: BTreeMap::new(),
            finished: Vec::new(),
            max_attempts: max_attempts.max(1),
            cancelled: false,
        }
    }

    /// Watcher debounce happens before this boundary. Repeated active paths
    /// collapse here, retaining the newest hash and highest priority.
    pub fn enqueue(&mut self, job: IndexJob) {
        let key = (job.workspace_id.clone(), job.relative_path.clone());
        if let Some(existing) = self.pending.get_mut(&key) {
            existing.kind = job.kind;
            existing.old_relative_path = job.old_relative_path;
            existing.source_hash = job.source_hash;
            existing.priority = existing.priority.max(job.priority);
            existing.error_code = None;
            existing.error_message = None;
        } else {
            self.pending.insert(key, job);
        }
    }

    pub fn next_job(&mut self) -> Option<IndexJob> {
        if self.cancelled {
            return None;
        }
        let key = self
            .pending
            .iter()
            .max_by(|left, right| {
                left.1
                    .priority
                    .cmp(&right.1.priority)
                    .then_with(|| right.0.cmp(left.0))
            })
            .map(|(key, _)| key.clone())?;
        let mut job = self.pending.remove(&key)?;
        job.status = IndexJobStatus::Running;
        job.attempts += 1;
        Some(job)
    }

    pub fn finish(&mut self, mut job: IndexJob, result: Result<(), IndexFailure>) {
        match result {
            Ok(()) => {
                job.status = IndexJobStatus::Completed;
                job.error_code = None;
                job.error_message = None;
                self.finished.push(job);
            }
            Err(error) if error.retryable && job.attempts < self.max_attempts => {
                job.status = IndexJobStatus::Pending;
                job.error_code = Some(error.code);
                job.error_message = Some(error.message);
                self.enqueue(job);
            }
            Err(error) => {
                job.status = IndexJobStatus::Failed;
                job.error_code = Some(error.code);
                job.error_message = Some(error.message);
                self.finished.push(job);
            }
        }
    }

    pub fn cancel(&mut self) {
        self.cancelled = true;
        for (_, mut job) in std::mem::take(&mut self.pending) {
            job.status = IndexJobStatus::Cancelled;
            self.finished.push(job);
        }
    }

    #[must_use]
    pub fn jobs(&self) -> Vec<&IndexJob> {
        self.pending.values().chain(self.finished.iter()).collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexUpdate {
    Unchanged { generation: u64 },
    Updated { generation: u64 },
}

/// Replaces every authoritative record for one source and increments its
/// workspace generation in the same SQLite transaction.
pub fn index_document(
    database: &Database,
    parsed: &ParsedDocument,
    old_relative_path: Option<&str>,
    indexed_at: &str,
) -> AppResult<IndexUpdate> {
    database.transaction(|transaction| {
        let existing = transaction
            .query_row(
                "SELECT source_hash, parser_version, relative_path
                 FROM knowledge_documents WHERE document_id = ?1",
                [&parsed.document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, u32>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let generation = current_generation(transaction, &parsed.workspace_id)?;
        if existing.as_ref().is_some_and(|(hash, version, path)| {
            hash == &parsed.source_hash
                && version == &parsed.parser_version
                && path == &parsed.relative_path
        }) {
            return Ok(IndexUpdate::Unchanged { generation });
        }

        if let Some(old_path) = old_relative_path.filter(|path| *path != parsed.relative_path) {
            remove_path(transaction, &parsed.workspace_id, old_path)?;
        }
        replace_document(transaction, parsed, indexed_at)?;
        let generation = increment_generation(transaction, &parsed.workspace_id, indexed_at)?;
        transaction.execute(
            "INSERT INTO knowledge_invalidations (
                workspace_id, artifact_kind, artifact_id, source_document_id,
                generation, stale_at
             ) VALUES (?1, 'derived', ?2, ?2, ?3, ?4)
             ON CONFLICT (workspace_id, artifact_kind, artifact_id) DO UPDATE SET
                generation = excluded.generation, stale_at = excluded.stale_at",
            params![
                parsed.workspace_id,
                parsed.document_id,
                generation as i64,
                indexed_at
            ],
        )?;
        Ok(IndexUpdate::Updated { generation })
    })
}

pub fn delete_document(
    database: &Database,
    workspace_id: &str,
    relative_path: &str,
    indexed_at: &str,
) -> AppResult<IndexUpdate> {
    database.transaction(|transaction| {
        let changed = remove_path(transaction, workspace_id, relative_path)?;
        let generation = current_generation(transaction, workspace_id)?;
        if !changed {
            return Ok(IndexUpdate::Unchanged { generation });
        }
        Ok(IndexUpdate::Updated {
            generation: increment_generation(transaction, workspace_id, indexed_at)?,
        })
    })
}

/// Persists the coordinator snapshot. The unique partial index in migration 13
/// keeps restart-time dedupe at one active job per workspace path.
pub fn save_job(database: &Database, job: &IndexJob, now: &str) -> AppResult<()> {
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO knowledge_index_jobs (
                job_id, workspace_id, relative_path, old_relative_path, kind,
                status, priority, attempts, source_hash, error_code,
                error_message, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
             ON CONFLICT (job_id) DO UPDATE SET
                old_relative_path = excluded.old_relative_path,
                kind = excluded.kind,
                status = excluded.status,
                priority = excluded.priority,
                attempts = excluded.attempts,
                source_hash = excluded.source_hash,
                error_code = excluded.error_code,
                error_message = excluded.error_message,
                updated_at = excluded.updated_at",
            params![
                job.job_id,
                job.workspace_id,
                job.relative_path,
                job.old_relative_path,
                job.kind.as_str(),
                job.status.as_str(),
                job.priority,
                job.attempts,
                job.source_hash,
                job.error_code,
                job.error_message,
                now,
            ],
        )?;
        Ok(())
    })
}

fn replace_document(
    transaction: &Transaction<'_>,
    parsed: &ParsedDocument,
    indexed_at: &str,
) -> AppResult<()> {
    remove_document_records(transaction, &parsed.document_id)?;
    transaction.execute(
        "INSERT INTO knowledge_documents (
            document_id, workspace_id, relative_path, portable_id, source_hash,
            parser_name, parser_version, language, deleted_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
         ON CONFLICT (document_id) DO UPDATE SET
            relative_path = excluded.relative_path,
            portable_id = excluded.portable_id,
            source_hash = excluded.source_hash,
            parser_name = excluded.parser_name,
            parser_version = excluded.parser_version,
            language = excluded.language,
            deleted_at = NULL",
        params![
            parsed.document_id,
            parsed.workspace_id,
            parsed.relative_path,
            parsed.portable_id,
            parsed.source_hash,
            parsed.parser_name,
            parsed.parser_version,
            parsed.language,
        ],
    )?;
    transaction.execute(
        "INSERT OR IGNORE INTO knowledge_revisions (
            revision_id, document_id, source_hash, parser_version, indexed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            parsed.revision_id,
            parsed.document_id,
            parsed.source_hash,
            parsed.parser_version,
            indexed_at,
        ],
    )?;
    for chunk in &parsed.chunks {
        transaction.execute(
            "INSERT INTO knowledge_chunks (
                chunk_id, document_id, revision_id, kind, ordinal, start_line,
                end_line, content, explicit_id, authority, confidence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                chunk.chunk_id,
                parsed.document_id,
                parsed.revision_id,
                chunk.kind,
                chunk.ordinal,
                chunk.range.start_line,
                chunk.range.end_line,
                chunk.content,
                chunk.explicit_id,
                chunk.authority.as_str(),
                chunk.confidence,
            ],
        )?;
        transaction.execute(
            "INSERT INTO knowledge_fts (chunk_id, document_id, content)
             VALUES (?1, ?2, ?3)",
            params![chunk.chunk_id, parsed.document_id, chunk.content],
        )?;
    }
    for node in &parsed.nodes {
        transaction.execute(
            "INSERT INTO knowledge_nodes (
                node_id, workspace_id, node_type, label, authority, confidence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (node_id) DO UPDATE SET
                label = excluded.label",
            params![
                node.node_id,
                parsed.workspace_id,
                node.node_type,
                node.label,
                node.authority.as_str(),
                node.confidence,
            ],
        )?;
        transaction.execute(
            "INSERT INTO knowledge_node_sources (
                node_id, document_id, chunk_id, start_line, end_line, source_hash
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                node.node_id,
                parsed.document_id,
                node.source_chunk_id,
                node.range.start_line,
                node.range.end_line,
                parsed.source_hash,
            ],
        )?;
    }
    for edge in &parsed.edges {
        transaction.execute(
            "INSERT INTO knowledge_edges (
                edge_id, document_id, workspace_id, source_node_id,
                target_node_id, edge_type, authority, confidence
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                edge.edge_id,
                parsed.document_id,
                parsed.workspace_id,
                edge.source_node_id,
                edge.target_node_id,
                edge.edge_type,
                edge.authority.as_str(),
                edge.confidence,
            ],
        )?;
    }
    Ok(())
}

fn remove_path(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    relative_path: &str,
) -> AppResult<bool> {
    let document_id = transaction
        .query_row(
            "SELECT document_id FROM knowledge_documents
             WHERE workspace_id = ?1 AND relative_path = ?2",
            params![workspace_id, relative_path],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(document_id) = document_id {
        remove_document_records(transaction, &document_id)?;
        transaction.execute(
            "DELETE FROM knowledge_documents WHERE document_id = ?1",
            [&document_id],
        )?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn remove_document_records(transaction: &Transaction<'_>, document_id: &str) -> AppResult<()> {
    transaction.execute(
        "DELETE FROM knowledge_edges WHERE document_id = ?1",
        [document_id],
    )?;
    transaction.execute(
        "DELETE FROM knowledge_fts WHERE document_id = ?1",
        [document_id],
    )?;
    transaction.execute(
        "DELETE FROM knowledge_node_sources WHERE document_id = ?1",
        [document_id],
    )?;
    transaction.execute(
        "DELETE FROM knowledge_nodes
         WHERE NOT EXISTS (
            SELECT 1 FROM knowledge_node_sources
            WHERE knowledge_node_sources.node_id = knowledge_nodes.node_id
         )",
        [],
    )?;
    transaction.execute(
        "DELETE FROM knowledge_chunks WHERE document_id = ?1",
        [document_id],
    )?;
    Ok(())
}

fn current_generation(transaction: &Transaction<'_>, workspace_id: &str) -> AppResult<u64> {
    let generation = transaction
        .query_row(
            "SELECT generation FROM knowledge_index_generations WHERE workspace_id = ?1",
            [workspace_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    Ok(generation.max(0) as u64)
}

fn increment_generation(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    now: &str,
) -> AppResult<u64> {
    transaction.execute(
        "INSERT INTO knowledge_index_generations (workspace_id, generation, updated_at)
         VALUES (?1, 1, ?2)
         ON CONFLICT (workspace_id) DO UPDATE SET
            generation = generation + 1, updated_at = excluded.updated_at",
        params![workspace_id, now],
    )?;
    current_generation(transaction, workspace_id)
}

fn stable_job_id(workspace_id: &str, relative_path: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(workspace_id.as_bytes());
    hasher.update(&[0]);
    hasher.update(relative_path.as_bytes());
    format!("job_{}", &hasher.finalize().to_hex()[..24])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Migration;
    use crate::knowledge::parser::{MarkdownParser, SourceParser};

    const KNOWLEDGE: Migration = Migration {
        version: 13,
        name: "knowledge",
        sql: include_str!("../../../migrations/0013_knowledge.sql"),
    };

    fn database() -> Database {
        Database::open_with_migrations(":memory:", &[crate::db::FOUNDATION_MIGRATION, KNOWLEDGE])
            .expect("database")
    }

    #[test]
    fn duplicate_jobs_collapse_and_transient_failures_retry() {
        let mut coordinator = IndexCoordinator::new(2);
        coordinator.enqueue(IndexJob::upsert("ws", "note.md", Some("old".into())));
        let mut newest = IndexJob::upsert("ws", "note.md", Some("new".into()));
        newest.priority = 4;
        coordinator.enqueue(newest);
        assert_eq!(coordinator.jobs().len(), 1);
        let job = coordinator.next_job().expect("job");
        assert_eq!(job.source_hash.as_deref(), Some("new"));
        coordinator.finish(
            job,
            Err(IndexFailure {
                code: "busy".into(),
                message: "retry".into(),
                retryable: true,
            }),
        );
        assert_eq!(coordinator.next_job().expect("retry").attempts, 2);
    }

    #[test]
    fn indexing_is_atomic_idempotent_and_rename_aware() {
        let database = database();
        let parser = MarkdownParser;
        let source = "---\nid: portable\n---\n# One\n- [ ] Task ^task\n";
        let first = parser.parse("ws", "old.md", source);
        assert_eq!(
            index_document(&database, &first, None, "2026-01-01T00:00:00Z").expect("index"),
            IndexUpdate::Updated { generation: 1 }
        );
        assert_eq!(
            index_document(&database, &first, None, "2026-01-01T00:00:01Z").expect("no-op"),
            IndexUpdate::Unchanged { generation: 1 }
        );

        let renamed = parser.parse("ws", "new.md", source);
        assert_eq!(
            index_document(&database, &renamed, Some("old.md"), "2026-01-01T00:00:02Z")
                .expect("rename"),
            IndexUpdate::Updated { generation: 2 }
        );
        database
            .with_connection(|connection| {
                let counts = (
                    connection.query_row(
                        "SELECT COUNT(*) FROM knowledge_documents",
                        [],
                        |row| row.get::<_, u32>(0),
                    )?,
                    connection.query_row("SELECT COUNT(*) FROM knowledge_chunks", [], |row| {
                        row.get::<_, u32>(0)
                    })?,
                    connection.query_row(
                        "SELECT relative_path FROM knowledge_documents",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                );
                assert_eq!(counts.0, 1);
                assert_eq!(counts.1, renamed.chunks.len() as u32);
                assert_eq!(counts.2, "new.md");
                Ok(())
            })
            .expect("query");
    }

    #[test]
    fn failed_transaction_exposes_no_partial_state() {
        let database = database();
        let parser = MarkdownParser;
        let mut parsed = parser.parse("ws", "note.md", "# One\n");
        parsed.edges.push(super::super::parser::ParsedEdge {
            edge_id: "broken".into(),
            source_node_id: "missing".into(),
            target_node_id: "also_missing".into(),
            edge_type: "LINKS_TO".into(),
            source_chunk_id: parsed.chunks[0].chunk_id.clone(),
            authority: super::super::parser::Authority::ExplicitFile,
            confidence: 1.0,
        });
        assert!(index_document(&database, &parsed, None, "now").is_err());
        database
            .with_connection(|connection| {
                assert_eq!(
                    connection.query_row(
                        "SELECT COUNT(*) FROM knowledge_documents",
                        [],
                        |row| row.get::<_, u32>(0)
                    )?,
                    0
                );
                Ok(())
            })
            .expect("query");
    }
}
