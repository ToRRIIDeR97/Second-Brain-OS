//! Platform-equivalent application-data directory layout.

use crate::errors::{AppError, AppResult};
use directories::ProjectDirs;
use std::fs;
use std::path::{Path, PathBuf};

const QUALIFIER: &str = "com";
const ORGANIZATION: &str = "SecondBrain";
const APPLICATION: &str = "Second Brain OS";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppDataLayout {
    pub root: PathBuf,
    pub database: PathBuf,
    pub migrations: PathBuf,
    pub logs: PathBuf,
    pub caches: PathBuf,
    pub sessions: PathBuf,
    pub shell_integration: PathBuf,
    pub sidecar: PathBuf,
    pub backups: PathBuf,
    pub settings: PathBuf,
}

impl AppDataLayout {
    pub fn under(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        Self {
            database: root.join("agent-os.sqlite"),
            migrations: root.join("migrations"),
            logs: root.join("logs"),
            caches: root.join("caches"),
            sessions: root.join("sessions"),
            shell_integration: root.join("shell-integration"),
            sidecar: root.join("sidecar"),
            backups: root.join("backups"),
            settings: root.join("settings.json"),
            root,
        }
    }

    pub fn ensure(&self) -> AppResult<()> {
        for directory in [
            &self.root,
            &self.migrations,
            &self.logs,
            &self.caches,
            &self.sessions,
            &self.shell_integration,
            &self.sidecar,
            &self.backups,
        ] {
            fs::create_dir_all(directory)?;
        }
        for directory in [
            self.caches.join("previews"),
            self.caches.join("thumbnails"),
            self.caches.join("context"),
            self.caches.join("vectors"),
            self.sessions.join("codex"),
            self.sessions.join("claude"),
            self.sessions.join("terminals"),
        ] {
            fs::create_dir_all(directory)?;
        }
        Ok(())
    }
}

pub fn application_data_dir() -> AppResult<PathBuf> {
    ProjectDirs::from(QUALIFIER, ORGANIZATION, APPLICATION)
        .map(|directories| directories.data_dir().to_path_buf())
        .ok_or_else(|| {
            AppError::new(
                "platform.app_data_unavailable",
                "The operating system did not provide an application-data directory.",
            )
        })
}

pub fn ensure_application_data_dir() -> AppResult<AppDataLayout> {
    let layout = AppDataLayout::under(application_data_dir()?);
    layout.ensure()?;
    Ok(layout)
}

pub fn ensure_directory(path: &Path) -> AppResult<()> {
    fs::create_dir_all(path).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::AppDataLayout;
    use tempfile::tempdir;

    #[test]
    fn creates_portable_layout() {
        let root = tempdir().expect("tempdir");
        let layout = AppDataLayout::under(root.path().join("app-data"));
        layout.ensure().expect("layout");
        assert!(layout.database.ends_with("agent-os.sqlite"));
        assert!(layout.caches.join("context").is_dir());
        assert!(layout.sessions.join("terminals").is_dir());
    }
}
