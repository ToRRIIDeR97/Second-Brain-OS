//! Trash integration is deliberately an injected boundary.
//!
//! The workspace module must never turn a failed native-trash call into an
//! irreversible delete.  A platform adapter can implement [`TrashAdapter`]
//! later; the default adapter fails closed.

use std::io;
use std::path::Path;

/// Moves a path to a recoverable operating-system trash location.
pub trait TrashAdapter: Send + Sync {
    fn move_to_trash(&self, path: &Path) -> io::Result<()>;
}

/// Safe default for platforms that have not supplied a native adapter yet.
#[derive(Debug, Default, Clone, Copy)]
pub struct FailClosedTrash;

impl TrashAdapter for FailClosedTrash {
    fn move_to_trash(&self, _path: &Path) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "operating-system trash is unavailable",
        ))
    }
}

/// A deterministic adapter useful for integration tests and platform wiring.
#[derive(Debug, Default, Clone)]
pub struct RecordingTrash {
    paths: std::sync::Arc<std::sync::Mutex<Vec<std::path::PathBuf>>>,
}

impl RecordingTrash {
    #[must_use]
    pub fn paths(&self) -> Vec<std::path::PathBuf> {
        self.paths
            .lock()
            .expect("recording trash mutex poisoned")
            .clone()
    }
}

impl TrashAdapter for RecordingTrash {
    fn move_to_trash(&self, path: &Path) -> io::Result<()> {
        self.paths
            .lock()
            .map_err(|_| io::Error::other("recording trash mutex poisoned"))?
            .push(path.to_path_buf());
        Ok(())
    }
}
