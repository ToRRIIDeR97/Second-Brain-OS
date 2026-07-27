//! Stable application errors and redaction helpers.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fmt;

/// Error values crossing a process or UI boundary use stable string codes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
            details: None,
        }
    }

    pub fn retryable(mut self, value: bool) -> Self {
        self.retryable = value;
        self
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(redact_json(&details));
        self
    }

    pub fn redacted(mut self) -> Self {
        self.message = redact_text(&self.message);
        self.details = self.details.as_ref().map(redact_json);
        self
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("database.error", "The local database operation failed.")
            .with_details(Value::String(redact_text(&error.to_string())))
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::new("filesystem.error", "The local filesystem operation failed.")
            .with_details(Value::String(redact_text(&error.to_string())))
    }
}

/// Keys that commonly contain credentials. Matching is intentionally
/// conservative in favor of dropping a value rather than leaking it.
fn sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "authorization",
        "access_token",
        "refresh_token",
        "api_key",
        "apikey",
        "client_secret",
        "password",
        "private_key",
        "credential",
        "cookie",
    ]
    .iter()
    .any(|needle| key == *needle || key.ends_with(&format!("_{needle}")))
}

/// Redact secret-like object fields and well-known token strings.
pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let value = if sensitive_key(key) {
                        Value::String("[REDACTED]".to_owned())
                    } else {
                        redact_json(value)
                    };
                    (key.clone(), value)
                })
                .collect::<Map<_, _>>(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(redact_json).collect()),
        Value::String(text) => Value::String(redact_text(text)),
        other => other.clone(),
    }
}

/// Redact only recognizable credential-shaped strings. Ordinary paths and
/// note content remain intact so diagnostics stay useful.
pub fn redact_text(text: &str) -> String {
    let mut redact_next = false;
    text.split_whitespace()
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            let token = redact_next
                || lower == "bearer"
                || lower.starts_with("sk-")
                || lower.starts_with("ghp_")
                || lower.starts_with("xoxb-")
                || lower.contains("-----begin ")
                || (word.contains("://") && word.contains('@'));
            redact_next = lower == "bearer";
            if token { "[REDACTED]" } else { word }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{redact_json, redact_text};
    use serde_json::json;

    #[test]
    fn redacts_secret_fields_without_dropping_safe_fields() {
        let value = json!({
            "authorization": "Bearer secret",
            "nested": {"api_key": "hidden", "title": "Keep me"},
            "count": 2
        });
        assert_eq!(redact_json(&value)["authorization"], "[REDACTED]");
        assert_eq!(redact_json(&value)["nested"]["title"], "Keep me");
    }

    #[test]
    fn redacts_known_token_shapes() {
        assert_eq!(redact_text("ok sk-abc123"), "ok [REDACTED]");
        assert_eq!(
            redact_text("Authorization Bearer secret"),
            "Authorization [REDACTED] [REDACTED]"
        );
        assert_eq!(redact_text("a/path"), "a/path");
    }
}
