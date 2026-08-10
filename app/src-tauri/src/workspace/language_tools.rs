//! Fixed, workspace-bound language tooling.
//!
//! This adapter intentionally owns a very small command allowlist.  It finds
//! those tools without a shell, runs them with a scrubbed environment, and
//! never gives a tool a path outside the selected workspace.

use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::path_policy::validate_relative_path;
use crate::errors::redact_text;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_OUTPUT_LIMIT: usize = 8 * 1024 * 1024;
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const VERSION_OUTPUT_LIMIT: usize = 64 * 1024;
const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolLanguage {
    TypeScript,
    JavaScript,
    Python,
    Rust,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ToolStatus {
    pub id: String,
    pub name: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct FormatResult {
    pub content: String,
    pub tool: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Diagnostic {
    pub relative_path: String,
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LanguageToolError {
    InvalidWorkspace(String),
    InvalidPath(String),
    UnsupportedLanguage(String),
    ToolUnavailable {
        tool: String,
    },
    CommandFailed {
        tool: String,
        code: Option<i32>,
        stderr: String,
    },
    TimedOut {
        tool: String,
    },
    OutputTooLarge {
        tool: String,
    },
    InputTooLarge,
    Io(String),
    Parse {
        tool: String,
        message: String,
    },
}

impl std::fmt::Display for LanguageToolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidWorkspace(message) => {
                write!(formatter, "invalid language-tool workspace: {message}")
            }
            Self::InvalidPath(path) => write!(formatter, "invalid workspace path: {path}"),
            Self::UnsupportedLanguage(language) => {
                write!(formatter, "unsupported language: {language}")
            }
            Self::ToolUnavailable { tool } => write!(formatter, "tool unavailable: {tool}"),
            Self::CommandFailed { tool, code, stderr } => {
                write!(formatter, "{tool} failed ({code:?}): {stderr}")
            }
            Self::TimedOut { tool } => write!(formatter, "{tool} timed out"),
            Self::OutputTooLarge { tool } => write!(formatter, "{tool} output exceeded the limit"),
            Self::InputTooLarge => formatter.write_str("language-tool input exceeded the limit"),
            Self::Io(message) => write!(formatter, "language-tool I/O failed: {message}"),
            Self::Parse { tool, message } => {
                write!(
                    formatter,
                    "{tool} diagnostics could not be parsed: {message}"
                )
            }
        }
    }
}

impl std::error::Error for LanguageToolError {}

/// A safe adapter for the fixed local language-tool allowlist.
#[derive(Clone, Debug)]
pub struct LanguageToolService {
    root: PathBuf,
    timeout: Duration,
    output_limit: usize,
}

impl LanguageToolService {
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

    /// Return one status for every allowlisted tool.  Missing tools are a
    /// normal status, not an adapter error.
    pub fn statuses(&self) -> Result<Vec<ToolStatus>, LanguageToolError> {
        let root = self.workspace_root()?;
        ToolId::ALL
            .iter()
            .map(|tool| {
                let path = resolve_tool(&root, *tool);
                let version = path.as_ref().and_then(|path| {
                    let args = tool.version_args();
                    self.run(
                        *tool,
                        path,
                        &args,
                        None,
                        VERSION_TIMEOUT,
                        VERSION_OUTPUT_LIMIT,
                    )
                    .ok()
                    .and_then(|output| first_version_line(&output))
                });
                Ok(ToolStatus {
                    id: tool.id().to_owned(),
                    name: tool.display_name().to_owned(),
                    available: path.is_some(),
                    version,
                })
            })
            .collect()
    }

    /// Format source in memory and return the formatter's proposed text.
    /// No formatter is allowed to write the source file.
    pub fn format(
        &self,
        language: ToolLanguage,
        relative_path: &str,
        content: &str,
    ) -> Result<FormatResult, LanguageToolError> {
        if content.len() > MAX_INPUT_BYTES {
            return Err(LanguageToolError::InputTooLarge);
        }
        let root = self.workspace_root()?;
        let _ = validate_tool_path(&root, relative_path)?;
        let tool = ToolId::formatter(language);
        let path = resolve_tool(&root, tool).ok_or_else(|| LanguageToolError::ToolUnavailable {
            tool: tool.display_name().to_owned(),
        })?;
        let args = tool.format_args(relative_path);
        let output = self.run(
            tool,
            &path,
            &args,
            Some(content.as_bytes()),
            self.timeout,
            self.output_limit,
        )?;
        if !output.status.success() {
            return Err(command_failed(tool, &output));
        }
        Ok(FormatResult {
            content: String::from_utf8_lossy(&output.stdout).into_owned(),
            tool: tool.display_name().to_owned(),
        })
    }

    /// Run the fixed workspace analysis for one language.  `None` runs each
    /// unique analyzer that is installed and skips missing analyzers.
    pub fn analyze(
        &self,
        language: Option<ToolLanguage>,
    ) -> Result<Vec<Diagnostic>, LanguageToolError> {
        let root = self.workspace_root()?;
        let tools = analysis_tools(language);
        let mut diagnostics = Vec::new();
        for tool in tools {
            let Some(path) = resolve_tool(&root, tool) else {
                if language.is_none() {
                    continue;
                }
                return Err(LanguageToolError::ToolUnavailable {
                    tool: tool.display_name().to_owned(),
                });
            };
            let output = self.run(
                tool,
                &path,
                &tool.analysis_args(),
                None,
                self.timeout,
                self.output_limit,
            )?;
            let mut parsed = match tool {
                ToolId::Eslint => parse_eslint(&root, &output.stdout),
                ToolId::Ruff => parse_ruff(&root, &output.stdout),
                ToolId::CargoClippy => parse_clippy(&root, &output.stdout),
                _ => Err(LanguageToolError::Parse {
                    tool: tool.display_name().to_owned(),
                    message: "tool is not an analyzer".to_owned(),
                }),
            }?;
            if parsed.is_empty() && !output.status.success() {
                return Err(command_failed(tool, &output));
            }
            diagnostics.append(&mut parsed);
        }
        diagnostics.sort_by(|left, right| {
            left.relative_path
                .cmp(&right.relative_path)
                .then(left.line.cmp(&right.line))
                .then(left.column.cmp(&right.column))
                .then(left.message.cmp(&right.message))
        });
        Ok(diagnostics)
    }

    fn workspace_root(&self) -> Result<PathBuf, LanguageToolError> {
        let metadata = fs::metadata(&self.root).map_err(|error| {
            LanguageToolError::InvalidWorkspace(redact_text(&error.to_string()))
        })?;
        if !metadata.is_dir() {
            return Err(LanguageToolError::InvalidWorkspace(
                "workspace root is not a directory".to_owned(),
            ));
        }
        fs::canonicalize(&self.root)
            .map_err(|error| LanguageToolError::InvalidWorkspace(redact_text(&error.to_string())))
    }

    fn run(
        &self,
        tool: ToolId,
        path: &Path,
        args: &[OsString],
        input: Option<&[u8]>,
        timeout: Duration,
        output_limit: usize,
    ) -> Result<ProcessOutput, LanguageToolError> {
        let root = self.workspace_root()?;
        run_process(
            tool,
            path,
            &root,
            args,
            input,
            timeout,
            output_limit,
            &sanitized_path(&root),
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum ToolId {
    TypescriptLanguageServer,
    Prettier,
    Eslint,
    PyrightLanguageServer,
    Ruff,
    RustAnalyzer,
    Rustfmt,
    CargoClippy,
}

impl ToolId {
    const ALL: [Self; 8] = [
        Self::TypescriptLanguageServer,
        Self::Prettier,
        Self::Eslint,
        Self::PyrightLanguageServer,
        Self::Ruff,
        Self::RustAnalyzer,
        Self::Rustfmt,
        Self::CargoClippy,
    ];

    fn id(self) -> &'static str {
        match self {
            Self::TypescriptLanguageServer => "typescript-language-server",
            Self::Prettier => "prettier",
            Self::Eslint => "eslint",
            Self::PyrightLanguageServer => "pyright-langserver",
            Self::Ruff => "ruff",
            Self::RustAnalyzer => "rust-analyzer",
            Self::Rustfmt => "rustfmt",
            Self::CargoClippy => "cargo-clippy",
        }
    }

    fn executable(self) -> &'static str {
        match self {
            Self::CargoClippy => "cargo",
            _ => self.id(),
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::CargoClippy => "cargo clippy",
            _ => self.id(),
        }
    }

    fn version_args(self) -> Vec<OsString> {
        match self {
            Self::CargoClippy => vec![OsString::from("--version")],
            _ => vec![OsString::from("--version")],
        }
    }

    fn format_args(self, relative_path: &str) -> Vec<OsString> {
        match self {
            Self::Prettier => vec![
                OsString::from("--stdin-filepath"),
                OsString::from(relative_path),
            ],
            Self::Ruff => vec![
                OsString::from("format"),
                OsString::from("--stdin-filename"),
                OsString::from(relative_path),
                OsString::from("-"),
            ],
            Self::Rustfmt => vec![
                OsString::from("--emit"),
                OsString::from("stdout"),
                OsString::from("--edition"),
                OsString::from("2021"),
            ],
            _ => Vec::new(),
        }
    }

    fn analysis_args(self) -> Vec<OsString> {
        match self {
            Self::Eslint => vec![
                OsString::from("."),
                OsString::from("--format"),
                OsString::from("json"),
                OsString::from("--no-error-on-unmatched-pattern"),
            ],
            Self::Ruff => vec![
                OsString::from("check"),
                OsString::from("--output-format"),
                OsString::from("json"),
                OsString::from("."),
            ],
            Self::CargoClippy => vec![
                OsString::from("clippy"),
                OsString::from("--message-format=json"),
                OsString::from("--all-targets"),
                OsString::from("--workspace"),
            ],
            _ => Vec::new(),
        }
    }

    fn formatter(language: ToolLanguage) -> Self {
        match language {
            ToolLanguage::TypeScript | ToolLanguage::JavaScript => Self::Prettier,
            ToolLanguage::Python => Self::Ruff,
            ToolLanguage::Rust => Self::Rustfmt,
        }
    }
}

fn analysis_tools(language: Option<ToolLanguage>) -> Vec<ToolId> {
    match language {
        Some(ToolLanguage::TypeScript | ToolLanguage::JavaScript) => vec![ToolId::Eslint],
        Some(ToolLanguage::Python) => vec![ToolId::Ruff],
        Some(ToolLanguage::Rust) => vec![ToolId::CargoClippy],
        None => vec![ToolId::Eslint, ToolId::Ruff, ToolId::CargoClippy],
    }
}

fn resolve_tool(root: &Path, tool: ToolId) -> Option<PathBuf> {
    let executable = tool.executable();
    for directory in local_bin_directories(root) {
        if let Some(path) = executable_file(&directory, executable, root) {
            return Some(path);
        }
    }
    std::env::var_os("PATH")
        .as_deref()
        .into_iter()
        .flat_map(std::env::split_paths)
        .filter(|directory| directory.is_absolute())
        .find_map(|directory| executable_file(&directory, executable, &PathBuf::new()))
}

fn local_bin_directories(root: &Path) -> Vec<PathBuf> {
    let mut directories = vec![
        root.join("node_modules").join(".bin"),
        root.join(".venv").join("bin"),
        root.join("venv").join("bin"),
    ];
    if cfg!(windows) {
        directories.extend([
            root.join(".venv").join("Scripts"),
            root.join("venv").join("Scripts"),
        ]);
    }
    directories
}

fn executable_file(directory: &Path, executable: &str, workspace_root: &Path) -> Option<PathBuf> {
    let candidates = if cfg!(windows) {
        vec![
            directory.join(executable),
            directory.join(format!("{executable}.exe")),
            directory.join(format!("{executable}.cmd")),
            directory.join(format!("{executable}.bat")),
        ]
    } else {
        vec![directory.join(executable)]
    };
    candidates.into_iter().find_map(|candidate| {
        if !is_executable(&candidate) {
            return None;
        }
        if workspace_root.as_os_str().is_empty() {
            return Some(candidate);
        }
        let canonical = fs::canonicalize(&candidate).ok()?;
        canonical.starts_with(workspace_root).then_some(canonical)
    })
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn sanitized_path(root: &Path) -> OsString {
    let mut directories = local_bin_directories(root);
    directories.extend(
        std::env::var_os("PATH")
            .as_deref()
            .into_iter()
            .flat_map(std::env::split_paths)
            .filter(|path| path.is_absolute()),
    );
    let mut unique = Vec::new();
    for directory in directories {
        if !unique.iter().any(|item: &PathBuf| item == &directory) {
            unique.push(directory);
        }
    }
    std::env::join_paths(unique).unwrap_or_default()
}

fn validate_tool_path(root: &Path, relative_path: &str) -> Result<PathBuf, LanguageToolError> {
    validate_relative_path(relative_path)
        .map_err(|_| LanguageToolError::InvalidPath(relative_path.to_owned()))?;
    let candidate = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let mut nearest = candidate.clone();
    while !nearest.exists() {
        nearest = nearest
            .parent()
            .ok_or_else(|| LanguageToolError::InvalidPath(relative_path.to_owned()))?
            .to_path_buf();
    }
    let canonical = fs::canonicalize(&nearest)
        .map_err(|_| LanguageToolError::InvalidPath(relative_path.to_owned()))?;
    if !canonical.starts_with(root) {
        return Err(LanguageToolError::InvalidPath(relative_path.to_owned()));
    }
    Ok(candidate)
}

#[derive(Debug)]
struct ProcessOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    status: ExitStatus,
}

#[derive(Debug)]
enum StreamMessage {
    Data(bool, Vec<u8>),
    Error(bool, String),
    Limit(bool),
}

#[allow(clippy::too_many_arguments)]
fn run_process(
    tool: ToolId,
    path: &Path,
    root: &Path,
    args: &[OsString],
    input: Option<&[u8]>,
    timeout: Duration,
    output_limit: usize,
    path_env: &OsStr,
) -> Result<ProcessOutput, LanguageToolError> {
    let mut command = Command::new(path);
    command
        .args(args)
        .current_dir(root)
        .env_clear()
        .env("PATH", path_env)
        .env("NO_COLOR", "1")
        .env("CI", "1")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            LanguageToolError::ToolUnavailable {
                tool: tool.display_name().to_owned(),
            }
        } else {
            LanguageToolError::Io(redact_text(&error.to_string()))
        }
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| LanguageToolError::Io("tool stdout was unavailable".to_owned()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| LanguageToolError::Io("tool stderr was unavailable".to_owned()))?;
    let (sender, receiver) = mpsc::channel();
    let stdout_thread = spawn_reader(stdout, true, sender.clone(), output_limit);
    let stderr_thread = spawn_reader(stderr, false, sender, output_limit);
    let stdin_thread = input.map(|input| {
        let mut stdin = child.stdin.take().expect("piped stdin");
        let bytes = input.to_vec();
        thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        })
    });
    let started = Instant::now();
    let mut stdout_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();
    let mut output_too_large = false;
    let status = loop {
        drain_messages(
            &receiver,
            &mut stdout_bytes,
            &mut stderr_bytes,
            output_limit,
            &mut output_too_large,
        );
        if output_too_large {
            terminate_child(&mut child);
            join_threads(stdout_thread, stderr_thread, stdin_thread);
            return Err(LanguageToolError::OutputTooLarge {
                tool: tool.display_name().to_owned(),
            });
        }
        if started.elapsed() >= timeout {
            terminate_child(&mut child);
            join_threads(stdout_thread, stderr_thread, stdin_thread);
            return Err(LanguageToolError::TimedOut {
                tool: tool.display_name().to_owned(),
            });
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error) => {
                terminate_child(&mut child);
                join_threads(stdout_thread, stderr_thread, stdin_thread);
                return Err(LanguageToolError::Io(redact_text(&error.to_string())));
            }
        }
    };
    let _ = child.stdin.take();
    join_threads(stdout_thread, stderr_thread, stdin_thread);
    drain_messages(
        &receiver,
        &mut stdout_bytes,
        &mut stderr_bytes,
        output_limit,
        &mut output_too_large,
    );
    if output_too_large {
        return Err(LanguageToolError::OutputTooLarge {
            tool: tool.display_name().to_owned(),
        });
    }
    Ok(ProcessOutput {
        stdout: stdout_bytes,
        stderr: stderr_bytes,
        status,
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
        let mut total = 0_usize;
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
                let _ = message;
            }
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return,
        }
    }
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn join_threads(
    stdout_thread: thread::JoinHandle<()>,
    stderr_thread: thread::JoinHandle<()>,
    stdin_thread: Option<thread::JoinHandle<()>>,
) {
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    if let Some(thread) = stdin_thread {
        let _ = thread.join();
    }
}

fn command_failed(tool: ToolId, output: &ProcessOutput) -> LanguageToolError {
    LanguageToolError::CommandFailed {
        tool: tool.display_name().to_owned(),
        code: output.status.code(),
        stderr: safe_stderr(&output.stderr),
    }
}

fn safe_stderr(bytes: &[u8]) -> String {
    redact_text(
        &String::from_utf8_lossy(bytes)
            .chars()
            .filter(|character| !character.is_control() || *character == '\n' || *character == '\t')
            .take(2_048)
            .collect::<String>(),
    )
}

fn first_version_line(output: &ProcessOutput) -> Option<String> {
    let value = [output.stdout.as_slice(), output.stderr.as_slice()]
        .into_iter()
        .find_map(|bytes| {
            String::from_utf8_lossy(bytes)
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(str::to_owned)
        })?;
    Some(redact_text(
        &value
            .chars()
            .filter(|character| !character.is_control())
            .take(256)
            .collect::<String>(),
    ))
}

fn parse_eslint(root: &Path, bytes: &[u8]) -> Result<Vec<Diagnostic>, LanguageToolError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|error| LanguageToolError::Parse {
        tool: ToolId::Eslint.display_name().to_owned(),
        message: error.to_string(),
    })?;
    let reports = value.as_array().ok_or_else(|| LanguageToolError::Parse {
        tool: ToolId::Eslint.display_name().to_owned(),
        message: "expected a JSON array".to_owned(),
    })?;
    let mut diagnostics = Vec::new();
    for report in reports {
        let Some(report) = report.as_object() else {
            continue;
        };
        let Some(path) = report
            .get("filePath")
            .and_then(Value::as_str)
            .and_then(|path| diagnostic_path(root, path))
        else {
            continue;
        };
        let Some(messages) = report.get("messages").and_then(Value::as_array) else {
            continue;
        };
        for message in messages {
            let Some(message) = message.as_object() else {
                continue;
            };
            let severity = match message.get("severity").and_then(Value::as_u64) {
                Some(2) => "error",
                Some(1) => "warning",
                _ => "info",
            };
            diagnostics.push(Diagnostic {
                relative_path: path.clone(),
                line: json_u32(message.get("line")),
                column: json_u32(message.get("column")),
                severity: severity.to_owned(),
                message: safe_text(message.get("message").and_then(Value::as_str).unwrap_or("")),
                source: ToolId::Eslint.id().to_owned(),
                code: message
                    .get("ruleId")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            });
        }
    }
    Ok(diagnostics)
}

fn parse_ruff(root: &Path, bytes: &[u8]) -> Result<Vec<Diagnostic>, LanguageToolError> {
    let text = String::from_utf8_lossy(bytes);
    let mut diagnostics = Vec::new();
    let values = if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
        value.as_array().cloned().unwrap_or_default()
    } else {
        text.lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .collect()
    };
    for value in values {
        let Some(object) = value.as_object() else {
            continue;
        };
        let Some(path) = object
            .get("filename")
            .and_then(Value::as_str)
            .and_then(|path| diagnostic_path(root, path))
        else {
            continue;
        };
        let location = object.get("location").and_then(Value::as_object);
        diagnostics.push(Diagnostic {
            relative_path: path,
            line: json_u32(location.and_then(|location| location.get("row"))),
            column: json_u32(location.and_then(|location| location.get("column"))),
            severity: "error".to_owned(),
            message: safe_text(object.get("message").and_then(Value::as_str).unwrap_or("")),
            source: ToolId::Ruff.id().to_owned(),
            code: object
                .get("code")
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
    }
    Ok(diagnostics)
}

fn parse_clippy(root: &Path, bytes: &[u8]) -> Result<Vec<Diagnostic>, LanguageToolError> {
    let mut diagnostics = Vec::new();
    for line in String::from_utf8_lossy(bytes).lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("reason").and_then(Value::as_str) != Some("compiler-message") {
            continue;
        }
        let Some(message) = value.get("message").and_then(Value::as_object) else {
            continue;
        };
        let Some(span) = message
            .get("spans")
            .and_then(Value::as_array)
            .and_then(|spans| {
                spans
                    .iter()
                    .find(|span| span.get("is_primary").and_then(Value::as_bool) == Some(true))
                    .or_else(|| spans.first())
            })
            .and_then(Value::as_object)
        else {
            continue;
        };
        let Some(path) = span
            .get("file_name")
            .and_then(Value::as_str)
            .and_then(|path| diagnostic_path(root, path))
        else {
            continue;
        };
        let severity = match message.get("level").and_then(Value::as_str) {
            Some("error") => "error",
            Some("warning") => "warning",
            _ => "info",
        };
        diagnostics.push(Diagnostic {
            relative_path: path,
            line: json_u32(span.get("line_start")),
            column: json_u32(span.get("column_start")),
            severity: severity.to_owned(),
            message: safe_text(message.get("message").and_then(Value::as_str).unwrap_or("")),
            source: ToolId::CargoClippy.id().to_owned(),
            code: message
                .get("code")
                .and_then(Value::as_object)
                .and_then(|code| code.get("code"))
                .and_then(Value::as_str)
                .map(str::to_owned),
        });
    }
    Ok(diagnostics)
}

fn diagnostic_path(root: &Path, value: &str) -> Option<String> {
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let path = Path::new(value);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let candidate = if candidate.exists() {
        fs::canonicalize(candidate).ok()?
    } else {
        lexical_normalize(&candidate)?
    };
    let relative = candidate.strip_prefix(&root).ok()?;
    let text = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    (!text.is_empty()).then_some(text)
}

fn lexical_normalize(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    Some(normalized)
}

fn json_u32(value: Option<&Value>) -> u32 {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(1)
}

fn safe_text(value: &str) -> String {
    redact_text(
        &value
            .chars()
            .filter(|character| !character.is_control() || *character == '\n' || *character == '\t')
            .take(4_096)
            .collect::<String>(),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        Diagnostic, LanguageToolError, LanguageToolService, ToolLanguage, diagnostic_path,
        parse_clippy, parse_eslint, parse_ruff,
    };
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::time::Duration;
    use tempfile::tempdir;

    fn fake_tool(root: &Path, name: &str, body: &str) {
        let bin = root.join("node_modules").join(".bin");
        fs::create_dir_all(&bin).expect("bin");
        let path = bin.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("tool");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&path).expect("metadata").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("permissions");
        }
    }

    #[test]
    fn formats_from_stdin_without_writing_the_workspace_file() {
        let root = tempdir().expect("tempdir");
        fake_tool(
            root.path(),
            "prettier",
            "cat >/dev/null; printf 'formatted\\n'",
        );
        let original = root.path().join("src.ts");
        fs::write(&original, "original").expect("source");
        let service = LanguageToolService::new(root.path());
        let result = service
            .format(ToolLanguage::TypeScript, "src.ts", "input")
            .expect("format");
        assert_eq!(result.content, "formatted\n");
        assert_eq!(fs::read_to_string(original).expect("read"), "original");
    }

    #[test]
    fn rejects_paths_that_escape_through_parent_or_symlink() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), root.path().join("link")).expect("symlink");
        let service = LanguageToolService::new(root.path());
        assert!(matches!(
            service.format(ToolLanguage::TypeScript, "../outside.ts", "x"),
            Err(LanguageToolError::InvalidPath(_))
        ));
        #[cfg(unix)]
        assert!(matches!(
            service.format(ToolLanguage::TypeScript, "link/outside.ts", "x"),
            Err(LanguageToolError::InvalidPath(_))
        ));
    }

    #[test]
    fn normalizes_linter_json_without_exposing_absolute_paths() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("src.ts");
        fs::write(&file, "x").expect("source");
        let eslint = format!(
            r#"[{{"filePath":"{}","messages":[{{"line":2,"column":3,"severity":2,"message":"bad","ruleId":"no-x"}}]}}]"#,
            file.display()
        );
        let diagnostics = parse_eslint(root.path(), eslint.as_bytes()).expect("eslint");
        assert_eq!(diagnostics[0].relative_path, "src.ts");
        assert_eq!(diagnostics[0].severity, "error");
        assert!(
            !diagnostics[0]
                .message
                .contains(root.path().to_string_lossy().as_ref())
        );

        let ruff = br#"[{"filename":"src.py","location":{"row":3,"column":4},"message":"unused","code":"F401"}]"#;
        assert_eq!(
            parse_ruff(root.path(), ruff).expect("ruff")[0]
                .code
                .as_deref(),
            Some("F401")
        );
    }

    #[test]
    fn parses_clippy_compiler_messages() {
        let root = tempdir().expect("tempdir");
        let output = br#"{"reason":"compiler-message","message":{"level":"warning","message":"unused","code":{"code":"dead_code"},"spans":[{"file_name":"src/lib.rs","line_start":4,"column_start":2,"is_primary":true}]}}"#;
        let diagnostics = parse_clippy(root.path(), output).expect("clippy");
        assert_eq!(
            diagnostics,
            vec![Diagnostic {
                relative_path: "src/lib.rs".to_owned(),
                line: 4,
                column: 2,
                severity: "warning".to_owned(),
                message: "unused".to_owned(),
                source: "cargo-clippy".to_owned(),
                code: Some("dead_code".to_owned()),
            }]
        );
        assert_eq!(diagnostic_path(root.path(), "../outside.rs"), None);
    }

    #[test]
    fn reports_missing_tools_without_running_arbitrary_commands() {
        let root = tempdir().expect("tempdir");
        let service =
            LanguageToolService::with_limits(root.path(), Duration::from_millis(50), 1024);
        let statuses = service.statuses().expect("status");
        assert_eq!(statuses.len(), 8);
        assert!(statuses.iter().any(|status| status.id == "ruff"));
        let _ = service.analyze(Some(ToolLanguage::Python));
    }
}
