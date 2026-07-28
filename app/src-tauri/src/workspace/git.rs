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

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_OUTPUT_LIMIT: usize = 8 * 1024 * 1024;
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

fn validate_path(path: &str) -> Result<(), GitError> {
    if path.is_empty() || path.contains('\0') || Path::new(path).is_absolute() {
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
    use super::{ChangeKind, GitAdapter, GitError, RepositoryKind, parse_status_porcelain_v2};
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
}
