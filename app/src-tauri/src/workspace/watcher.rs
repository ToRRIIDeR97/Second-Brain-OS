//! Filesystem event normalization, debounce, and mutation-event deduplication.
//!
//! The coordinator is deliberately independent from indexing.  It emits
//! validated, typed signals; the indexer and UI subscribe through the shared
//! event bus in later checkpoints.

use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::time::{Duration, Instant};

use notify::Event;
use notify::event::{EventKind, ModifyKind, RenameMode};
use serde::{Deserialize, Serialize};

/// Coarse event kinds consumed by UI and indexer subscribers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileEventKind {
    Created,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEvent {
    pub workspace_id: String,
    pub kind: FileEventKind,
    pub path: String,
    pub old_path: Option<String>,
    pub observed_hash: Option<String>,
    pub file_id: Option<String>,
    pub operation_id: Option<String>,
    pub correlation_id: Option<String>,
}

impl FileEvent {
    #[must_use]
    pub fn new(
        workspace_id: impl Into<String>,
        kind: FileEventKind,
        path: impl Into<String>,
    ) -> Self {
        Self {
            workspace_id: workspace_id.into(),
            kind,
            path: path.into(),
            old_path: None,
            observed_hash: None,
            file_id: None,
            operation_id: None,
            correlation_id: None,
        }
    }
}

#[derive(Debug, Clone)]
struct PendingEvent {
    event: FileEvent,
    due: Instant,
}

/// Per-path debounce queue.  Delete events use a separate lane so a remove
/// followed by a create is still available to the rename correlator.
#[derive(Debug)]
pub struct DebounceQueue {
    delay: Duration,
    pending: HashMap<String, PendingEvent>,
    deletes: HashMap<String, PendingEvent>,
    renames: HashMap<String, PendingEvent>,
}

impl DebounceQueue {
    #[must_use]
    pub fn new(delay: Duration) -> Self {
        Self {
            delay,
            pending: HashMap::new(),
            deletes: HashMap::new(),
            renames: HashMap::new(),
        }
    }

    pub fn push(&mut self, event: FileEvent, now: Instant) {
        let lane = match event.kind {
            FileEventKind::Deleted => &mut self.deletes,
            FileEventKind::Renamed => &mut self.renames,
            FileEventKind::Created | FileEventKind::Modified => &mut self.pending,
        };
        lane.insert(
            event.path.clone(),
            PendingEvent {
                event,
                due: now + self.delay,
            },
        );
    }

    #[must_use]
    pub fn drain_ready(&mut self, now: Instant) -> Vec<FileEvent> {
        let mut ready = Vec::new();
        for lane in [&mut self.deletes, &mut self.renames, &mut self.pending] {
            let keys = lane
                .iter()
                .filter(|(_, pending)| pending.due <= now)
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            for key in keys {
                if let Some(pending) = lane.remove(&key) {
                    ready.push(pending.event);
                }
            }
        }
        ready.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then_with(|| left.kind.cmp(&right.kind))
        });
        ready
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty() && self.deletes.is_empty() && self.renames.is_empty()
    }
}

#[derive(Debug, Clone)]
struct ExpectedMutation {
    operation_id: String,
    hash: Option<String>,
    expires_at: Instant,
}

/// Correlates an app mutation with the watcher event that its atomic rename
/// produces.  Notify does not carry arbitrary operation IDs, so hash/path and
/// a short TTL are the fallback correlation signals.
#[derive(Debug)]
pub struct OperationDeduper {
    ttl: Duration,
    expected: HashMap<String, ExpectedMutation>,
}

impl OperationDeduper {
    #[must_use]
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            expected: HashMap::new(),
        }
    }

    pub fn register(
        &mut self,
        path: impl Into<String>,
        operation_id: impl Into<String>,
        hash: Option<String>,
        now: Instant,
    ) {
        self.prune(now);
        self.expected.insert(
            path.into(),
            ExpectedMutation {
                operation_id: operation_id.into(),
                hash,
                expires_at: now + self.ttl,
            },
        );
    }

    /// Returns true only for an event that is expected from this process.
    /// Callers should still emit metadata-only changes (permissions/mtime)
    /// when the hash differs.
    pub fn suppress(&mut self, event: &FileEvent, now: Instant) -> bool {
        self.prune(now);
        let Some(expected) = self.expected.get(&event.path) else {
            return false;
        };
        let operation_match = event.operation_id.as_deref() == Some(expected.operation_id.as_str());
        let hash_match =
            expected.hash.is_some() && expected.hash.as_ref() == event.observed_hash.as_ref();
        if operation_match || hash_match {
            self.expected.remove(&event.path);
            true
        } else {
            false
        }
    }

    fn prune(&mut self, now: Instant) {
        self.expected
            .retain(|_, expected| expected.expires_at > now);
    }
}

#[derive(Debug, Clone)]
struct RemovedCandidate {
    event: FileEvent,
    at: Instant,
}

#[derive(Debug)]
struct RenameCorrelator {
    window: Duration,
    removed: VecDeque<RemovedCandidate>,
}

impl RenameCorrelator {
    fn new(window: Duration) -> Self {
        Self {
            window,
            removed: VecDeque::new(),
        }
    }

    fn observe(&mut self, event: FileEvent, now: Instant) -> Option<FileEvent> {
        self.prune(now);
        match event.kind {
            FileEventKind::Deleted => {
                self.removed.push_back(RemovedCandidate { event, at: now });
                None
            }
            FileEventKind::Created => {
                let index = self.removed.iter().position(|candidate| {
                    let file_match = candidate.event.file_id.is_some()
                        && candidate.event.file_id == event.file_id;
                    let hash_match = candidate.event.observed_hash.is_some()
                        && candidate.event.observed_hash == event.observed_hash;
                    file_match || hash_match
                });
                index.map(|index| {
                    let removed = self.removed.remove(index).expect("rename candidate index");
                    FileEvent {
                        workspace_id: event.workspace_id,
                        kind: FileEventKind::Renamed,
                        path: event.path,
                        old_path: Some(removed.event.path),
                        observed_hash: event.observed_hash,
                        file_id: event.file_id,
                        operation_id: event.operation_id,
                        correlation_id: event.correlation_id,
                    }
                })
            }
            _ => Some(event),
        }
    }

    fn prune(&mut self, now: Instant) {
        while self
            .removed
            .front()
            .is_some_and(|candidate| now.duration_since(candidate.at) > self.window)
        {
            self.removed.pop_front();
        }
    }
}

/// A complete, testable event coordinator.  It does not own a thread or a
/// database; the app lifecycle can feed it from `notify` and drain it on a
/// timer or event-loop tick.
#[derive(Debug)]
pub struct WatchCoordinator {
    queue: DebounceQueue,
    deduper: OperationDeduper,
    rename: RenameCorrelator,
}

impl WatchCoordinator {
    #[must_use]
    pub fn new(debounce: Duration, operation_ttl: Duration, rename_window: Duration) -> Self {
        Self {
            queue: DebounceQueue::new(debounce),
            deduper: OperationDeduper::new(operation_ttl),
            rename: RenameCorrelator::new(rename_window),
        }
    }

    pub fn register_operation(
        &mut self,
        path: impl Into<String>,
        operation_id: impl Into<String>,
        hash: Option<String>,
        now: Instant,
    ) {
        self.deduper.register(path, operation_id, hash, now);
    }

    pub fn ingest(&mut self, event: FileEvent, now: Instant) {
        if self.deduper.suppress(&event, now) {
            return;
        }
        if let Some(event) = self.rename.observe(event, now) {
            self.queue.push(event, now);
        }
    }

    #[must_use]
    pub fn drain_ready(&mut self, now: Instant) -> Vec<FileEvent> {
        self.queue.drain_ready(now)
    }
}

/// Converts a `notify` event into workspace-relative events.  The caller must
/// still run the resulting paths through the authoritative CP06 path policy.
#[must_use]
pub fn translate_notify_event(workspace_id: &str, root: &Path, event: &Event) -> Vec<FileEvent> {
    let paths = event
        .paths
        .iter()
        .filter_map(|path| relative_path(root, path))
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return Vec::new();
    }
    match event.kind {
        EventKind::Create(_) => paths
            .into_iter()
            .map(|path| FileEvent::new(workspace_id, FileEventKind::Created, path))
            .collect(),
        EventKind::Remove(_) => paths
            .into_iter()
            .map(|path| FileEvent::new(workspace_id, FileEventKind::Deleted, path))
            .collect(),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if paths.len() >= 2 => {
            let mut event = FileEvent::new(workspace_id, FileEventKind::Renamed, paths[1].clone());
            event.old_path = Some(paths[0].clone());
            vec![event]
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => paths
            .into_iter()
            .map(|path| FileEvent::new(workspace_id, FileEventKind::Deleted, path))
            .collect(),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => paths
            .into_iter()
            .map(|path| FileEvent::new(workspace_id, FileEventKind::Created, path))
            .collect(),
        EventKind::Modify(_) => paths
            .into_iter()
            .map(|path| FileEvent::new(workspace_id, FileEventKind::Modified, path))
            .collect(),
        EventKind::Access(_) | EventKind::Any | EventKind::Other => Vec::new(),
    }
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let root = if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(root)
    };
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let relative = path.strip_prefix(&root).ok()?;
    let value = relative.to_str()?.replace('\\', "/");
    (!value.is_empty() && !value.split('/').any(|part| part == ".." || part.is_empty()))
        .then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debounce_replaces_modified_events_but_keeps_delete_lane() {
        let start = Instant::now();
        let mut queue = DebounceQueue::new(Duration::from_millis(500));
        queue.push(
            FileEvent::new("ws", FileEventKind::Modified, "note.md"),
            start,
        );
        queue.push(
            FileEvent::new("ws", FileEventKind::Modified, "note.md"),
            start + Duration::from_millis(100),
        );
        queue.push(
            FileEvent::new("ws", FileEventKind::Deleted, "note.md"),
            start + Duration::from_millis(100),
        );
        let ready = queue.drain_ready(start + Duration::from_millis(600));
        assert_eq!(ready.len(), 2);
        assert!(
            ready
                .iter()
                .any(|event| event.kind == FileEventKind::Deleted)
        );
        assert!(
            ready
                .iter()
                .any(|event| event.kind == FileEventKind::Modified)
        );
    }

    #[test]
    fn operation_hash_dedupes_own_watcher_event() {
        let now = Instant::now();
        let mut coordinator = WatchCoordinator::new(
            Duration::from_millis(500),
            Duration::from_secs(2),
            Duration::from_secs(1),
        );
        coordinator.register_operation("note.md", "op-1", Some("hash".into()), now);
        let mut event = FileEvent::new("ws", FileEventKind::Modified, "note.md");
        event.observed_hash = Some("hash".into());
        coordinator.ingest(event, now);
        assert!(
            coordinator
                .drain_ready(now + Duration::from_secs(1))
                .is_empty()
        );
    }

    #[test]
    fn matching_remove_and_create_become_rename() {
        let now = Instant::now();
        let mut coordinator = WatchCoordinator::new(
            Duration::from_millis(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
        );
        let mut removed = FileEvent::new("ws", FileEventKind::Deleted, "old.md");
        removed.observed_hash = Some("hash".into());
        coordinator.ingest(removed, now);
        let mut created = FileEvent::new("ws", FileEventKind::Created, "new.md");
        created.observed_hash = Some("hash".into());
        coordinator.ingest(created, now + Duration::from_millis(1));
        let ready = coordinator.drain_ready(now + Duration::from_secs(1));
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].kind, FileEventKind::Renamed);
        assert_eq!(ready[0].old_path.as_deref(), Some("old.md"));
    }
}
