//! Argument-safe system Git operations for a registered workspace.
//!
//! This adapter intentionally shells out to the user's Git installation. It
//! never invokes a shell: every option and path is passed as an individual
//! argument, and every path-bearing operation puts `--` before user input.

use std::ffi::OsStr;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_OUTPUT_LIMIT: usize = 8 * 1024 * 1024;
/// Keep both sides of an editor diff bounded before they cross an IPC seam.
const DEFAULT_DIFF_TEXT_LIMIT: usize = 1024 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepositoryKind {
    NoRepository,
    Root,
    Nested,
    Worktree,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryInfo {
    pub kind: RepositoryKind,
    pub workspace_root: PathBuf,
    pub repository_root: Option<PathBuf>,
    pub git_dir: Option<PathBuf>,
    pub common_dir: Option<PathBuf>,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub detached: bool,
    pub nested: bool,
    pub worktree: bool,
}

impl RepositoryInfo {
    fn none(workspace_root: PathBuf) -> Self {
        Self {
            kind: RepositoryKind::NoRepository,
            workspace_root,
            repository_root: None,
            git_dir: None,
            common_dir: None,
            branch: None,
            head: None,
            detached: false,
            nested: false,
            worktree: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Ignored,
    Unmerged,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitChange {
    pub kind: ChangeKind,
    pub path: String,
    pub old_path: Option<String>,
    pub index_status: Option<char>,
    pub worktree_status: Option<char>,
    pub staged: bool,
    pub unstaged: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitStatus {
    pub repository: RepositoryInfo,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub changes: Vec<GitChange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitDiff {
    pub staged: bool,
    pub patch: String,
    pub truncated: bool,
}

/// The source-control state represented by a single-file before/after view.
///
/// `Staged` and `Unstaged` describe the two normal Git comparisons.  The
/// remaining variants make states that otherwise have no useful patch (new,
/// deleted, and renamed files) explicit to renderer callers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitDiffKind {
    Staged,
    Unstaged,
    Untracked,
    Deleted,
    Renamed,
}

/// A text diff cannot safely be sent to a text editor when either side is
/// binary or exceeds the bounded renderer budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitDiffFallback {
    Binary,
    Oversized,
}

/// Bounded, renderer-ready contents for one workspace-relative Git path.
///
/// A missing side is represented as an empty string when the file is a normal
/// add/delete.  `None` on either side means the caller should render the
/// fallback instead of passing potentially unsafe content to a text editor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub kind: GitDiffKind,
    pub staged: bool,
    pub original: Option<String>,
    pub modified: Option<String>,
    pub original_label: String,
    pub modified_label: String,
    pub fallback: Option<GitDiffFallback>,
    pub binary: bool,
    pub oversized: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCommit {
    pub id: String,
    pub short_id: String,
    pub author: String,
    pub authored_at: String,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitOperationResult {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitError {
    InvalidWorkspace(String),
    InvalidPath(String),
    InvalidCommitMessage,
    ConfirmationRequired,
    NoRepository,
    CommandUnavailable,
    CommandFailed {
        command: String,
        code: Option<i32>,
        stderr: String,
    },
    TimedOut {
        command: String,
    },
    OutputTooLarge {
        command: String,
    },
    Io(String),
    Parse(String),
}

impl std::fmt::Display for GitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidWorkspace(message) => {
                write!(formatter, "invalid Git workspace: {message}")
            }
            Self::InvalidPath(path) => {
                write!(formatter, "invalid workspace-relative Git path: {path}")
            }
            Self::InvalidCommitMessage => {
                formatter.write_str("commit message cannot be empty or contain NUL")
            }
            Self::ConfirmationRequired => {
                formatter.write_str("confirmation is required for this Git operation")
            }
            Self::NoRepository => formatter.write_str("no Git repository was found"),
            Self::CommandUnavailable => formatter.write_str("the Git executable is unavailable"),
            Self::CommandFailed {
                command,
                code,
                stderr,
            } => {
                write!(formatter, "Git {command} failed ({code:?}): {stderr}")
            }
            Self::TimedOut { command } => write!(formatter, "Git {command} timed out"),
            Self::OutputTooLarge { command } => {
                write!(formatter, "Git {command} output exceeded the limit")
            }
            Self::Io(message) => write!(formatter, "Git I/O failed: {message}"),
            Self::Parse(message) => write!(formatter, "Git output could not be parsed: {message}"),
        }
    }
}

impl std::error::Error for GitError {}

/// A workspace-bound Git adapter. `root` is the registered workspace root;
/// repository discovery may find a nested repository below it.
#[derive(Debug, Clone)]
pub struct GitAdapter {
    root: PathBuf,
    timeout: Duration,
    output_limit: usize,
}

impl GitAdapter {
    #[must_use]
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            timeout: DEFAULT_TIMEOUT,
            output_limit: DEFAULT_OUTPUT_LIMIT,
        }
    }

    #[must_use]
    pub fn with_limits(root: impl Into<PathBuf>, timeout: Duration, output_limit: usize) -> Self {
        Self {
            root: root.into(),
            timeout: timeout.max(Duration::from_millis(1)),
            output_limit: output_limit.max(1),
        }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Detect the repository nearest the workspace root. If the workspace is
    /// a container for a nested repository, its first nested Git root is
    /// reported rather than exposing a second arbitrary CWD.
    pub fn detect(&self) -> Result<RepositoryInfo, GitError> {
        self.ensure_root()?;
        if let Some(info) = self.probe_repository(&self.root)? {
            return Ok(info);
        }
        if let Some(nested_root) = self.find_nested_repository(&self.root, 0)? {
            return self
                .probe_repository(&nested_root)
                .map(|info| info.unwrap_or_else(|| RepositoryInfo::none(self.root.clone())));
        }
        Ok(RepositoryInfo::none(self.root.clone()))
    }

    pub fn status(&self) -> Result<GitStatus, GitError> {
        let mut repository = self.detect()?;
        if repository.kind == RepositoryKind::NoRepository {
            return Ok(GitStatus {
                repository,
                branch: None,
                ahead: 0,
                behind: 0,
                dirty: false,
                changes: Vec::new(),
            });
        }
        let cwd = repository
            .repository_root
            .clone()
            .ok_or(GitError::NoRepository)?;
        let output = self.run_at(&cwd, ["status", "--porcelain=v2", "-z", "--branch"])?;
        let parsed = parse_status_porcelain_v2(&output.stdout)?;
        repository.branch = parsed.branch.clone().or(repository.branch);
        repository.detached = parsed.repository.detached || repository.detached;
        Ok(GitStatus {
            branch: repository.branch.clone(),
            dirty: !parsed.changes.is_empty(),
            ahead: parsed.ahead,
            behind: parsed.behind,
            changes: parsed.changes,
            repository,
        })
    }

    pub fn diff(&self, staged: bool, paths: &[String]) -> Result<GitDiff, GitError> {
        validate_paths(paths)?;
        let cwd = self.repository_root()?;
        let mut args = vec!["diff", "--no-ext-diff", "--no-color", "--binary"];
        if staged {
            args.push("--cached");
        }
        args.push("--");
        let mut owned = args
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>();
        owned.extend(paths.iter().cloned());
        let output = self.run_at(&cwd, owned.iter().map(String::as_str))?;
        Ok(GitDiff {
            staged,
            truncated: false,
            patch: String::from_utf8_lossy(&output.stdout).into_owned(),
        })
    }

    /// Return bounded before/after text for one workspace-relative path.
    ///
    /// Staged comparisons are `HEAD → index`; unstaged comparisons are
    /// `index → working tree`.  The path separator is kept before every
    /// renderer-provided path and Git is always invoked directly, never by a
    /// shell.  Missing sides are normal for adds/deletes; binary and oversized
    /// sides return a typed fallback with no text content.
    pub fn diff_file(&self, staged: bool, path: &str) -> Result<GitFileDiff, GitError> {
        validate_path(path)?;
        let cwd = self.repository_root()?;
        let status = self.status()?;
        let change = status
            .changes
            .iter()
            .find(|change| change.path == path || change.old_path.as_deref() == Some(path));
        let effective_path = change.map_or(path, |change| change.path.as_str());
        let old_path = change.and_then(|change| change.old_path.clone());
        if let Some(path) = old_path.as_deref() {
            validate_path(path)?;
        }

        let is_untracked = change.is_some_and(|change| change.kind == ChangeKind::Untracked);
        let is_renamed = change.is_some_and(|change| {
            change.kind == ChangeKind::Renamed
                || change.index_status == Some('R')
                || change.worktree_status == Some('R')
        });
        let is_deleted = change.is_some_and(|change| {
            change.kind == ChangeKind::Deleted
                || change.index_status == Some('D')
                || change.worktree_status == Some('D')
        });

        let original = if is_untracked {
            Snapshot::Missing
        } else if staged {
            self.snapshot_from_tree(&cwd, "HEAD", old_path.as_deref().unwrap_or(effective_path))?
        } else {
            self.snapshot_from_index(&cwd, effective_path)?
        };
        let modified = if staged {
            if is_untracked {
                self.snapshot_from_worktree(&cwd, effective_path)?
            } else {
                self.snapshot_from_index(&cwd, effective_path)?
            }
        } else {
            self.snapshot_from_worktree(&cwd, effective_path)?
        };

        let kind = if is_untracked {
            GitDiffKind::Untracked
        } else if is_renamed {
            GitDiffKind::Renamed
        } else if is_deleted {
            GitDiffKind::Deleted
        } else if staged {
            GitDiffKind::Staged
        } else {
            GitDiffKind::Unstaged
        };
        let (original_label, modified_label) = diff_labels(kind, staged);
        let (original, modified, fallback, binary, oversized) =
            materialize_snapshots(original, modified);
        Ok(GitFileDiff {
            path: effective_path.to_owned(),
            old_path,
            kind,
            staged,
            original,
            modified,
            original_label: original_label.into(),
            modified_label: modified_label.into(),
            fallback,
            binary,
            oversized,
        })
    }

    fn snapshot_from_tree(
        &self,
        cwd: &Path,
        reference: &str,
        path: &str,
    ) -> Result<Snapshot, GitError> {
        let pathspec = literal_pathspec(path);
        let object = match self.run_at(
            cwd,
            [
                "ls-tree",
                "-z",
                "--full-tree",
                reference,
                "--",
                pathspec.as_str(),
            ],
        ) {
            Ok(output) => parse_tree_object(&output.stdout),
            Err(GitError::CommandFailed { .. }) => None,
            Err(error) => return Err(error),
        };
        let Some(object) = object else {
            return Ok(Snapshot::Missing);
        };
        self.snapshot_from_blob(cwd, &object)
    }

    fn snapshot_from_index(&self, cwd: &Path, path: &str) -> Result<Snapshot, GitError> {
        let pathspec = literal_pathspec(path);
        let output = match self.run_at(cwd, ["ls-files", "--stage", "-z", "--", pathspec.as_str()])
        {
            Ok(output) => output,
            Err(GitError::CommandFailed { .. }) => return Ok(Snapshot::Missing),
            Err(error) => return Err(error),
        };
        let Some(object) = parse_index_object(&output.stdout) else {
            return Ok(Snapshot::Missing);
        };
        self.snapshot_from_blob(cwd, &object)
    }

    fn snapshot_from_blob(&self, cwd: &Path, object: &str) -> Result<Snapshot, GitError> {
        let size_output = match self.run_at(cwd, ["cat-file", "-s", object]) {
            Ok(output) => output,
            Err(GitError::CommandFailed { .. }) => return Ok(Snapshot::Binary),
            Err(error) => return Err(error),
        };
        let size = trim_text(&size_output.stdout)
            .parse::<usize>()
            .map_err(|_| GitError::Parse("invalid Git blob size".into()))?;
        if size > DEFAULT_DIFF_TEXT_LIMIT {
            return Ok(Snapshot::Oversized);
        }
        let output = match self.run_at(cwd, ["cat-file", "blob", object]) {
            Ok(output) => output,
            Err(GitError::OutputTooLarge { .. }) => return Ok(Snapshot::Oversized),
            Err(GitError::CommandFailed { .. }) => return Ok(Snapshot::Binary),
            Err(error) => return Err(error),
        };
        Ok(snapshot_from_bytes(output.stdout))
    }

    fn snapshot_from_worktree(&self, cwd: &Path, path: &str) -> Result<Snapshot, GitError> {
        let root = canonical_or(cwd.to_path_buf());
        let absolute = cwd.join(path);
        let metadata = match std::fs::metadata(&absolute) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Snapshot::Missing),
            Err(error) => return Err(GitError::Io(error.to_string())),
        };
        if !metadata.is_file() {
            return Ok(Snapshot::Binary);
        }
        if metadata.len() > DEFAULT_DIFF_TEXT_LIMIT as u64 {
            return Ok(Snapshot::Oversized);
        }
        let canonical =
            std::fs::canonicalize(&absolute).map_err(|error| GitError::Io(error.to_string()))?;
        if !canonical.starts_with(&root) {
            return Err(GitError::InvalidPath(path.to_owned()));
        }
        let bytes = std::fs::read(&canonical).map_err(|error| GitError::Io(error.to_string()))?;
        Ok(snapshot_from_bytes(bytes))
    }

    pub fn history(&self, path: Option<&str>, limit: usize) -> Result<Vec<GitCommit>, GitError> {
        if let Some(path) = path {
            validate_path(path)?;
        }
        let cwd = self.repository_root()?;
        let bounded_limit = limit.clamp(1, 1_000);
        let mut args = vec![
            "log",
            "--no-decorate",
            "--date=iso-strict",
            "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00",
        ];
        let limit_arg = format!("-n{bounded_limit}");
        args.push(&limit_arg);
        args.push("--");
        if let Some(path) = path {
            args.push(path);
        }
        let output = self.run_at(&cwd, args)?;
        parse_history(&output.stdout)
    }

    pub fn stage(&self, paths: &[String]) -> Result<GitOperationResult, GitError> {
        self.run_paths(&["add"], paths)
    }

    pub fn unstage(&self, paths: &[String]) -> Result<GitOperationResult, GitError> {
        self.run_paths(&["reset"], paths)
    }

    pub fn discard(
        &self,
        paths: &[String],
        confirmed: bool,
    ) -> Result<GitOperationResult, GitError> {
        if !confirmed {
            return Err(GitError::ConfirmationRequired);
        }
        self.run_paths(&["restore", "--worktree"], paths)
    }

    pub fn restore_from_commit(
        &self,
        commit: &str,
        paths: &[String],
        confirmed: bool,
    ) -> Result<GitOperationResult, GitError> {
        if !confirmed {
            return Err(GitError::ConfirmationRequired);
        }
        validate_revision(commit)?;
        validate_paths(paths)?;
        let cwd = self.repository_root()?;
        let source = format!("--source={commit}");
        let args = ["restore", source.as_str(), "--"];
        let mut owned = args
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>();
        owned.extend(paths.iter().cloned());
        self.command_result(&cwd, owned.iter().map(String::as_str))
    }

    pub fn commit(&self, message: &str) -> Result<GitOperationResult, GitError> {
        if message.trim().is_empty() || message.contains('\0') {
            return Err(GitError::InvalidCommitMessage);
        }
        let cwd = self.repository_root()?;
        self.command_result(&cwd, ["commit", "-m", message])
    }

    fn run_paths(&self, prefix: &[&str], paths: &[String]) -> Result<GitOperationResult, GitError> {
        validate_paths(paths)?;
        let cwd = self.repository_root()?;
        let mut args = prefix
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>();
        args.push("--".to_owned());
        args.extend(paths.iter().cloned());
        self.command_result(&cwd, args.iter().map(String::as_str))
    }

    fn command_result<I, S>(&self, cwd: &Path, args: I) -> Result<GitOperationResult, GitError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output = self.run_at(cwd, args)?;
        Ok(GitOperationResult {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    fn repository_root(&self) -> Result<PathBuf, GitError> {
        self.detect()?.repository_root.ok_or(GitError::NoRepository)
    }

    fn ensure_root(&self) -> Result<(), GitError> {
        let metadata = std::fs::metadata(&self.root)
            .map_err(|error| GitError::InvalidWorkspace(error.to_string()))?;
        if !metadata.is_dir() {
            return Err(GitError::InvalidWorkspace(
                "workspace root is not a directory".into(),
            ));
        }
        Ok(())
    }

    fn probe_repository(&self, cwd: &Path) -> Result<Option<RepositoryInfo>, GitError> {
        let output = match self.run_at(cwd, ["rev-parse", "--show-toplevel"]) {
            Ok(output) => output,
            Err(GitError::CommandFailed { .. }) => return Ok(None),
            Err(error) => return Err(error),
        };
        let repository_root = PathBuf::from(trim_text(&output.stdout));
        let root = canonical_or(repository_root);
        let workspace_root = canonical_or(self.root.clone());
        let git_dir = self.rev_parse_path(cwd, "--git-dir")?;
        let common_dir = self.rev_parse_path(cwd, "--git-common-dir")?;
        let worktree = git_dir
            .as_ref()
            .zip(common_dir.as_ref())
            .is_some_and(|(git, common)| canonical_or(git.clone()) != canonical_or(common.clone()));
        let nested = root != workspace_root && root.starts_with(&workspace_root);
        let branch = self.symbolic_branch(cwd)?;
        let detached = branch.is_none();
        let head = self.optional_rev_parse(cwd, ["rev-parse", "--verify", "HEAD"])?;
        let kind = if worktree {
            RepositoryKind::Worktree
        } else if nested {
            RepositoryKind::Nested
        } else {
            RepositoryKind::Root
        };
        Ok(Some(RepositoryInfo {
            kind,
            workspace_root,
            repository_root: Some(root),
            git_dir,
            common_dir,
            branch,
            head,
            detached,
            nested,
            worktree,
        }))
    }

    fn rev_parse_path(&self, cwd: &Path, option: &str) -> Result<Option<PathBuf>, GitError> {
        let output = self.run_at(cwd, ["rev-parse", option])?;
        let value = PathBuf::from(trim_text(&output.stdout));
        Ok(Some(if value.is_absolute() {
            value
        } else {
            cwd.join(value)
        }))
    }

    fn optional_rev_parse<I, S>(&self, cwd: &Path, args: I) -> Result<Option<String>, GitError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        match self.run_at(cwd, args) {
            Ok(output) => Ok(Some(trim_text(&output.stdout))),
            Err(GitError::CommandFailed { .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn symbolic_branch(&self, cwd: &Path) -> Result<Option<String>, GitError> {
        match self.run_at(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]) {
            Ok(output) => {
                let branch = trim_text(&output.stdout);
                Ok((!branch.is_empty()).then_some(branch))
            }
            Err(GitError::CommandFailed { .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn find_nested_repository(
        &self,
        root: &Path,
        depth: usize,
    ) -> Result<Option<PathBuf>, GitError> {
        if depth >= 8 {
            return Ok(None);
        }
        let entries = std::fs::read_dir(root).map_err(|error| GitError::Io(error.to_string()))?;
        for entry in entries {
            let entry = entry.map_err(|error| GitError::Io(error.to_string()))?;
            let path = entry.path();
            if !entry
                .file_type()
                .map_err(|error| GitError::Io(error.to_string()))?
                .is_dir()
                || path
                    .file_name()
                    .is_some_and(|name| name == OsStr::new(".git"))
            {
                continue;
            }
            if path.join(".git").exists() && self.probe_repository(&path)?.is_some() {
                return Ok(Some(path));
            }
            if let Some(found) = self.find_nested_repository(&path, depth + 1)? {
                return Ok(Some(found));
            }
        }
        Ok(None)
    }

    fn run_at<I, S>(&self, cwd: &Path, args: I) -> Result<RawOutput, GitError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args = args
            .into_iter()
            .map(|value| value.as_ref().to_owned())
            .collect::<Vec<_>>();
        let command = args
            .first()
            .and_then(|value| value.to_str())
            .unwrap_or("git")
            .to_owned();
        let mut child = Command::new("git")
            .args(&args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                if error.kind() == io::ErrorKind::NotFound {
                    GitError::CommandUnavailable
                } else {
                    GitError::Io(error.to_string())
                }
            })?;
        collect_child(&mut child, self.timeout, self.output_limit, command)
    }
}

#[derive(Debug)]
enum Snapshot {
    Missing,
    Text(String),
    Binary,
    Oversized,
}

fn snapshot_from_bytes(bytes: Vec<u8>) -> Snapshot {
    if bytes.contains(&0) {
        return Snapshot::Binary;
    }
    match String::from_utf8(bytes) {
        Ok(text) => Snapshot::Text(text),
        Err(_) => Snapshot::Binary,
    }
}

fn materialize_snapshots(
    original: Snapshot,
    modified: Snapshot,
) -> (
    Option<String>,
    Option<String>,
    Option<GitDiffFallback>,
    bool,
    bool,
) {
    let oversized =
        matches!(original, Snapshot::Oversized) || matches!(modified, Snapshot::Oversized);
    if oversized {
        return (None, None, Some(GitDiffFallback::Oversized), false, true);
    }
    let binary = matches!(original, Snapshot::Binary) || matches!(modified, Snapshot::Binary);
    if binary {
        return (None, None, Some(GitDiffFallback::Binary), true, false);
    }
    let text = |snapshot: Snapshot| match snapshot {
        Snapshot::Missing => String::new(),
        Snapshot::Text(value) => value,
        Snapshot::Binary | Snapshot::Oversized => unreachable!("fallback handled above"),
    };
    (
        Some(text(original)),
        Some(text(modified)),
        None,
        false,
        false,
    )
}

fn diff_labels(kind: GitDiffKind, staged: bool) -> (&'static str, &'static str) {
    match kind {
        GitDiffKind::Untracked => ("Empty", "Untracked"),
        GitDiffKind::Deleted => {
            if staged {
                ("HEAD", "Deleted")
            } else {
                ("Index", "Deleted")
            }
        }
        GitDiffKind::Renamed => {
            if staged {
                ("HEAD", "Index")
            } else {
                ("Index", "Working tree")
            }
        }
        GitDiffKind::Staged => ("HEAD", "Index"),
        GitDiffKind::Unstaged => ("Index", "Working tree"),
    }
}

fn parse_tree_object(bytes: &[u8]) -> Option<String> {
    let record = bytes
        .split(|byte| *byte == 0)
        .find(|record| !record.is_empty())?;
    let tab = record.iter().position(|byte| *byte == b'\t')?;
    let fields = record[..tab]
        .split(|byte| *byte == b' ')
        .collect::<Vec<_>>();
    let object = fields.get(2)?;
    let object = std::str::from_utf8(object).ok()?;
    (object.len() == 40 && object.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| object.to_owned())
}

fn parse_index_object(bytes: &[u8]) -> Option<String> {
    let record = bytes
        .split(|byte| *byte == 0)
        .find(|record| !record.is_empty())?;
    let tab = record.iter().position(|byte| *byte == b'\t')?;
    let fields = record[..tab]
        .split(|byte| *byte == b' ')
        .collect::<Vec<_>>();
    let object = fields.get(1)?;
    let object = std::str::from_utf8(object).ok()?;
    (object.len() == 40 && object.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| object.to_owned())
}

#[derive(Debug)]
struct RawOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[derive(Debug)]
enum StreamMessage {
    Data(bool, Vec<u8>),
    Error(bool, String),
    Limit(bool),
}

fn collect_child(
    child: &mut Child,
    timeout: Duration,
    output_limit: usize,
    command: String,
) -> Result<RawOutput, GitError> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| GitError::Io("Git stdout was unavailable".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| GitError::Io("Git stderr was unavailable".into()))?;
    let (sender, receiver) = mpsc::channel();
    let stdout_thread = spawn_reader(stdout, true, sender.clone(), output_limit);
    let stderr_thread = spawn_reader(stderr, false, sender, output_limit);
    let started = Instant::now();
    let mut stdout_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();
    let mut status = None;
    let mut output_too_large = false;
    while status.is_none() {
        drain_messages(
            &receiver,
            &mut stdout_bytes,
            &mut stderr_bytes,
            output_limit,
            &mut output_too_large,
        );
        if output_too_large {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err(GitError::OutputTooLarge { command });
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err(GitError::TimedOut { command });
        }
        status = child
            .try_wait()
            .map_err(|error| GitError::Io(error.to_string()))?;
        if status.is_none() {
            thread::sleep(POLL_INTERVAL);
        }
    }
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    drain_messages(
        &receiver,
        &mut stdout_bytes,
        &mut stderr_bytes,
        output_limit,
        &mut output_too_large,
    );
    if output_too_large {
        return Err(GitError::OutputTooLarge { command });
    }
    let status = status.ok_or_else(|| GitError::Io("Git process status was unavailable".into()))?;
    if !status.success() {
        return Err(GitError::CommandFailed {
            command,
            code: status.code(),
            stderr: trim_error(&stderr_bytes),
        });
    }
    Ok(RawOutput {
        stdout: stdout_bytes,
        stderr: stderr_bytes,
    })
}

fn spawn_reader<R: Read + Send + 'static>(
    mut reader: R,
    stdout: bool,
    sender: mpsc::Sender<StreamMessage>,
    output_limit: usize,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut total: usize = 0;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(read) => {
                    total = total.saturating_add(read);
                    if total > output_limit {
                        let _ = sender.send(StreamMessage::Limit(stdout));
                        return;
                    }
                    if sender
                        .send(StreamMessage::Data(stdout, buffer[..read].to_vec()))
                        .is_err()
                    {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(StreamMessage::Error(stdout, error.to_string()));
                    return;
                }
            }
        }
    })
}

fn drain_messages(
    receiver: &mpsc::Receiver<StreamMessage>,
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    output_limit: usize,
    output_too_large: &mut bool,
) {
    loop {
        match receiver.try_recv() {
            Ok(StreamMessage::Data(is_stdout, bytes)) => {
                if is_stdout {
                    stdout.extend(bytes);
                } else {
                    stderr.extend(bytes);
                }
                if stdout.len().saturating_add(stderr.len()) > output_limit {
                    *output_too_large = true;
                }
            }
            Ok(StreamMessage::Limit(is_stdout)) => {
                let _ = is_stdout;
                *output_too_large = true;
            }
            Ok(StreamMessage::Error(is_stdout, message)) => {
                let _ = is_stdout;
                *output_too_large = true;
                let _ = message;
            }
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return,
        }
    }
}

pub fn parse_status_porcelain_v2(bytes: &[u8]) -> Result<GitStatus, GitError> {
    let mut branch = None;
    let mut detached = false;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changes = Vec::new();
    let mut fields = bytes.split(|byte| *byte == 0);
    while let Some(record) = fields.next() {
        if record.is_empty() {
            continue;
        }
        if record.starts_with(b"# ") {
            parse_branch_header(record, &mut branch, &mut detached, &mut ahead, &mut behind)?;
            continue;
        }
        if record.starts_with(b"2 ") {
            let old_path = fields.next().map(path_text).filter(|path| !path.is_empty());
            changes.push(parse_change(record, old_path)?);
        } else if record.starts_with(b"1 ") || record.starts_with(b"u ") {
            changes.push(parse_change(record, None)?);
        } else if let Some(path) = record.strip_prefix(b"? ") {
            changes.push(GitChange {
                kind: ChangeKind::Untracked,
                path: path_text(path),
                old_path: None,
                index_status: None,
                worktree_status: Some('?'),
                staged: false,
                unstaged: true,
            });
        } else if let Some(path) = record.strip_prefix(b"! ") {
            changes.push(GitChange {
                kind: ChangeKind::Ignored,
                path: path_text(path),
                old_path: None,
                index_status: None,
                worktree_status: Some('!'),
                staged: false,
                unstaged: false,
            });
        } else {
            return Err(GitError::Parse("unknown porcelain v2 record".into()));
        }
    }
    Ok(GitStatus {
        repository: RepositoryInfo::none(PathBuf::new()),
        branch,
        ahead,
        behind,
        dirty: !changes.is_empty(),
        changes,
    })
}

fn parse_branch_header(
    record: &[u8],
    branch: &mut Option<String>,
    detached: &mut bool,
    ahead: &mut u32,
    behind: &mut u32,
) -> Result<(), GitError> {
    let value = String::from_utf8_lossy(record);
    let mut parts = value.splitn(3, ' ');
    let _hash = parts.next();
    let Some(kind) = parts.next() else {
        return Err(GitError::Parse("malformed branch header".into()));
    };
    let value = parts.next().unwrap_or_default();
    match kind {
        "branch.head" => {
            if value == "(detached)" || value == "(unknown)" {
                *detached = true;
                *branch = None;
            } else if !value.is_empty() {
                *branch = Some(value.to_owned());
            }
        }
        "branch.ab" => {
            let values = value.split_whitespace().collect::<Vec<_>>();
            if values.len() >= 2 {
                *ahead = parse_signed_count(values[0])?;
                *behind = parse_signed_count(values[1])?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn parse_change(record: &[u8], old_path: Option<String>) -> Result<GitChange, GitError> {
    let text = String::from_utf8_lossy(record);
    let record_kind = text.split(' ').next().unwrap_or_default();
    let (fields, path_index) = match record_kind {
        "1" => (text.splitn(9, ' ').collect::<Vec<_>>(), 8),
        "2" => (text.splitn(10, ' ').collect::<Vec<_>>(), 9),
        "u" => (text.splitn(11, ' ').collect::<Vec<_>>(), 10),
        _ => return Err(GitError::Parse("unknown porcelain v2 change record".into())),
    };
    if fields.len() <= path_index {
        return Err(GitError::Parse("malformed porcelain v2 change".into()));
    }
    let xy = fields[1].chars().collect::<Vec<_>>();
    let index_status = xy.first().copied();
    let worktree_status = xy.get(1).copied();
    let kind = classify_change(fields[0], index_status, worktree_status);
    let path = fields[path_index];
    Ok(GitChange {
        kind,
        path: path.to_owned(),
        old_path,
        index_status,
        worktree_status,
        staged: index_status.is_some_and(|status| status != '.'),
        unstaged: worktree_status.is_some_and(|status| status != '.'),
    })
}

fn classify_change(record_kind: &str, index: Option<char>, worktree: Option<char>) -> ChangeKind {
    if record_kind == "u" || index == Some('U') || worktree == Some('U') {
        return ChangeKind::Unmerged;
    }
    [index, worktree]
        .into_iter()
        .flatten()
        .find_map(|status| match status {
            'A' => Some(ChangeKind::Added),
            'M' => Some(ChangeKind::Modified),
            'D' => Some(ChangeKind::Deleted),
            'R' => Some(ChangeKind::Renamed),
            'C' => Some(ChangeKind::Copied),
            'T' => Some(ChangeKind::TypeChanged),
            _ => None,
        })
        .unwrap_or(ChangeKind::Unknown)
}

fn parse_signed_count(value: &str) -> Result<u32, GitError> {
    value
        .trim_start_matches(['+', '-'])
        .parse::<u32>()
        .map_err(|_| GitError::Parse("invalid branch count".into()))
}

fn parse_history(bytes: &[u8]) -> Result<Vec<GitCommit>, GitError> {
    let fields = bytes.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut commits = Vec::new();
    for record in fields.chunks(5) {
        if record.len() < 5 || record[0].is_empty() {
            continue;
        }
        commits.push(GitCommit {
            id: path_text(record[0]),
            short_id: path_text(record[1]),
            author: path_text(record[2]),
            authored_at: path_text(record[3]),
            subject: path_text(record[4]),
        });
    }
    Ok(commits)
}

fn validate_paths(paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Err(GitError::InvalidPath(
            "at least one path is required".into(),
        ));
    }
    for path in paths {
        validate_path(path)?;
    }
    Ok(())
}

fn literal_pathspec(path: &str) -> String {
    format!(":(literal){path}")
}

fn validate_path(path: &str) -> Result<(), GitError> {
    if path.is_empty() || path.contains('\0') || Path::new(path).is_absolute() {
        return Err(GitError::InvalidPath(path.to_owned()));
    }
    if path.split('/').any(|segment| segment == ".git") {
        return Err(GitError::InvalidPath(path.to_owned()));
    }
    if Path::new(path).components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(GitError::InvalidPath(path.to_owned()));
    }
    Ok(())
}

fn validate_revision(revision: &str) -> Result<(), GitError> {
    if revision.trim().is_empty() || revision.contains('\0') {
        return Err(GitError::InvalidPath(revision.to_owned()));
    }
    Ok(())
}

fn trim_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_owned()
}

fn path_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn trim_error(bytes: &[u8]) -> String {
    let text = trim_text(bytes);
    text.chars().take(2_048).collect()
}

fn canonical_or(path: PathBuf) -> PathBuf {
    std::fs::canonicalize(&path).unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::{
        ChangeKind, GitAdapter, GitDiffFallback, GitDiffKind, GitError, RepositoryKind,
        parse_status_porcelain_v2,
    };
    use std::path::Path;
    use std::process::Command;
    use tempfile::tempdir;

    fn git_available() -> bool {
        Command::new("git").arg("--version").output().is_ok()
    }

    fn run(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .expect("git");
        assert!(status.success(), "git command failed: {args:?}");
    }

    fn configured(root: &Path, args: &[&str]) {
        let mut command = Command::new("git");
        command.args(args).current_dir(root);
        command.env("GIT_AUTHOR_NAME", "Test User");
        command.env("GIT_AUTHOR_EMAIL", "test@example.com");
        command.env("GIT_COMMITTER_NAME", "Test User");
        command.env("GIT_COMMITTER_EMAIL", "test@example.com");
        assert!(command.status().expect("git").success());
    }

    #[test]
    fn no_repository_is_reported_without_error() {
        if !git_available() {
            return;
        }
        let root = tempdir().expect("tempdir");
        let status = GitAdapter::new(root.path()).status().expect("status");
        assert_eq!(status.repository.kind, RepositoryKind::NoRepository);
        assert!(!status.dirty);
    }

    #[test]
    fn porcelain_v2_parser_handles_branch_counts_and_option_like_paths() {
        let status = parse_status_porcelain_v2(
            b"# branch.head main\0# branch.ab +2 -1\0? -strange;$(touch nope)\0",
        )
        .expect("parse");
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        assert_eq!(status.changes[0].kind, ChangeKind::Untracked);
        assert_eq!(status.changes[0].path, "-strange;$(touch nope)");
    }

    #[test]
    fn porcelain_v2_parser_handles_renames_and_unmerged_records() {
        let status = parse_status_porcelain_v2(
            b"2 R. N... 100644 100644 100644 abcdef1 abcdef2 R100 new.md\0old.md\0u UU N... 100644 100644 100644 100644 one two three conflict.md\0",
        )
        .expect("parse");
        assert_eq!(status.changes[0].kind, ChangeKind::Renamed);
        assert_eq!(status.changes[0].path, "new.md");
        assert_eq!(status.changes[0].old_path.as_deref(), Some("old.md"));
        assert_eq!(status.changes[1].kind, ChangeKind::Unmerged);
        assert_eq!(status.changes[1].path, "conflict.md");
    }

    #[test]
    fn dirty_status_stage_unstage_and_commit_are_argument_safe() {
        if !git_available() {
            return;
        }
        let root = tempdir().expect("tempdir");
        run(root.path(), &["init", "-q"]);
        std::fs::write(root.path().join("-option-like"), "one").expect("file");
        let adapter = GitAdapter::new(root.path());
        let status = adapter.status().expect("status");
        assert!(status.dirty);
        assert_eq!(status.changes[0].path, "-option-like");
        adapter.stage(&["-option-like".into()]).expect("stage");
        assert!(adapter.status().expect("staged").changes[0].staged);
        adapter.unstage(&["-option-like".into()]).expect("unstage");
        assert!(!adapter.status().expect("unstaged").changes[0].staged);
        adapter.stage(&["-option-like".into()]).expect("stage");
        adapter
            .commit("message; $(touch should-not-exist)")
            .expect("commit");
        assert!(!root.path().join("should-not-exist").exists());
        assert_eq!(adapter.history(None, 1).expect("history").len(), 1);
    }

    #[test]
    fn destructive_operations_require_confirmation_and_restore_content() {
        if !git_available() {
            return;
        }
        let root = tempdir().expect("tempdir");
        run(root.path(), &["init", "-q"]);
        std::fs::write(root.path().join("note.md"), "original").expect("file");
        configured(root.path(), &["add", "--", "note.md"]);
        configured(root.path(), &["commit", "-m", "initial"]);
        std::fs::write(root.path().join("note.md"), "changed").expect("edit");
        let adapter = GitAdapter::new(root.path());
        assert_eq!(
            adapter.discard(&["note.md".into()], false),
            Err(GitError::ConfirmationRequired)
        );
        adapter.discard(&["note.md".into()], true).expect("discard");
        assert_eq!(
            std::fs::read_to_string(root.path().join("note.md")).expect("read"),
            "original"
        );
        std::fs::write(root.path().join("note.md"), "again").expect("edit");
        assert_eq!(
            adapter.restore_from_commit("HEAD", &["note.md".into()], false),
            Err(GitError::ConfirmationRequired)
        );
        adapter
            .restore_from_commit("HEAD", &["note.md".into()], true)
            .expect("restore");
        assert_eq!(
            std::fs::read_to_string(root.path().join("note.md")).expect("read"),
            "original"
        );
    }

    #[test]
    fn nested_repository_is_detected() {
        if !git_available() {
            return;
        }
        let root = tempdir().expect("tempdir");
        let nested = root.path().join("nested");
        std::fs::create_dir(&nested).expect("nested");
        run(&nested, &["init", "-q"]);
        let info = GitAdapter::new(root.path()).detect().expect("detect");
        assert_eq!(info.kind, RepositoryKind::Nested);
        assert!(info.nested);
    }

    #[test]
    fn single_file_diff_reads_staged_unstaged_and_untracked_text() {
        if !git_available() {
            return;
        }
        let root = tempdir().expect("tempdir");
        run(root.path(), &["init", "-q"]);
        std::fs::write(root.path().join("note.md"), "one\n").expect("file");
        configured(root.path(), &["add", "--", "note.md"]);
        configured(root.path(), &["commit", "-m", "initial"]);
        std::fs::write(root.path().join("note.md"), "two\n").expect("edit");
        let adapter = GitAdapter::new(root.path());
        let unstaged = adapter.diff_file(false, "note.md").expect("unstaged");
        assert_eq!(unstaged.kind, GitDiffKind::Unstaged);
        assert_eq!(unstaged.original.as_deref(), Some("one\n"));
        assert_eq!(unstaged.modified.as_deref(), Some("two\n"));
        assert_eq!(unstaged.original_label, "Index");
        assert_eq!(unstaged.modified_label, "Working tree");

        adapter.stage(&["note.md".into()]).expect("stage");
        let staged = adapter.diff_file(true, "note.md").expect("staged");
        assert_eq!(staged.kind, GitDiffKind::Staged);
        assert_eq!(staged.original.as_deref(), Some("one\n"));
        assert_eq!(staged.modified.as_deref(), Some("two\n"));
        assert_eq!(staged.original_label, "HEAD");
        assert_eq!(staged.modified_label, "Index");

        std::fs::write(root.path().join("new.md"), "new\n").expect("new file");
        let untracked = adapter.diff_file(false, "new.md").expect("untracked");
        assert_eq!(untracked.kind, GitDiffKind::Untracked);
        assert_eq!(untracked.original.as_deref(), Some(""));
        assert_eq!(untracked.modified.as_deref(), Some("new\n"));
        assert_eq!(untracked.original_label, "Empty");
        assert_eq!(untracked.modified_label, "Untracked");

        let option_like = "-diff;$(touch should-not-exist).md";
        std::fs::write(root.path().join(option_like), "safe\n").expect("option-like file");
        let option_diff = adapter
            .diff_file(false, option_like)
            .expect("option-like diff");
        assert_eq!(option_diff.modified.as_deref(), Some("safe\n"));
        assert!(!root.path().join("should-not-exist").exists());
        assert!(matches!(
            adapter.diff_file(false, ".git/config"),
            Err(GitError::InvalidPath(_))
        ));
    }

    #[test]
    fn single_file_diff_handles_deleted_renamed_binary_and_oversized_files() {
        if !git_available() {
            return;
        }
        let root = tempdir().expect("tempdir");
        run(root.path(), &["init", "-q"]);
        std::fs::write(root.path().join("old.md"), "before\n").expect("file");
        std::fs::write(root.path().join("binary.dat"), [0, 1, 2]).expect("binary");
        configured(root.path(), &["add", "--", "old.md", "binary.dat"]);
        configured(root.path(), &["commit", "-m", "initial"]);
        let adapter = GitAdapter::new(root.path());

        std::fs::remove_file(root.path().join("old.md")).expect("delete");
        let deleted = adapter.diff_file(false, "old.md").expect("deleted");
        assert_eq!(deleted.kind, GitDiffKind::Deleted);
        assert_eq!(deleted.original.as_deref(), Some("before\n"));
        assert_eq!(deleted.modified.as_deref(), Some(""));

        adapter.stage(&["old.md".into()]).expect("stage delete");
        let staged_deleted = adapter.diff_file(true, "old.md").expect("staged delete");
        assert_eq!(staged_deleted.kind, GitDiffKind::Deleted);
        assert_eq!(staged_deleted.modified.as_deref(), Some(""));

        run(root.path(), &["mv", "--", "binary.dat", "renamed.dat"]);
        let renamed = adapter.diff_file(true, "renamed.dat").expect("renamed");
        assert_eq!(renamed.kind, GitDiffKind::Renamed);
        assert_eq!(renamed.old_path.as_deref(), Some("binary.dat"));
        assert_eq!(renamed.fallback, Some(GitDiffFallback::Binary));
        assert!(renamed.original.is_none());
        assert!(renamed.modified.is_none());

        std::fs::write(
            root.path().join("large.txt"),
            vec![b'x'; super::DEFAULT_DIFF_TEXT_LIMIT + 1],
        )
        .expect("large");
        let large = adapter.diff_file(false, "large.txt").expect("large diff");
        assert_eq!(large.fallback, Some(GitDiffFallback::Oversized));
        assert!(large.oversized);
    }
}
