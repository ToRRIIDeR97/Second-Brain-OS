//! Redaction-aware structured logging setup.

use crate::errors::{AppError, AppResult, redact_json, redact_text};
use serde_json::Value;
use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;

pub struct LoggingGuard {
    _worker: WorkerGuard,
}

/// Install one JSON logger writing to the platform app-data logs directory.
/// Keeping the guard alive flushes the non-blocking writer during shutdown.
pub fn init_logging(app_data_root: &Path) -> AppResult<LoggingGuard> {
    let logs = app_data_root.join("logs");
    std::fs::create_dir_all(&logs)?;
    let appender = tracing_appender::rolling::daily(logs, "agent-os.log");
    let (writer, worker) = tracing_appender::non_blocking(appender);
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("second_brain_os=info"));
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_writer(writer)
        .finish();
    tracing::subscriber::set_global_default(subscriber).map_err(|_| {
        AppError::new(
            "logging.already_initialized",
            "Structured logging has already been initialized.",
        )
    })?;
    Ok(LoggingGuard { _worker: worker })
}

pub fn redact_fields(fields: &Value) -> Value {
    redact_json(fields)
}

pub fn redact_message(message: &str) -> String {
    redact_text(message)
}

#[cfg(test)]
mod tests {
    use super::{redact_fields, redact_message};
    use serde_json::json;

    #[test]
    fn helpers_keep_logs_safe() {
        assert_eq!(
            redact_fields(&json!({"password": "secret"}))["password"],
            "[REDACTED]"
        );
        assert_eq!(redact_message("token sk-test"), "token [REDACTED]");
    }
}
