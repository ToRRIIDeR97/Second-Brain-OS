//! Injectable time and identifier sources used by production and tests.

use crate::errors::{AppError, AppResult};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use ulid::Ulid;

pub trait Clock: Send + Sync {
    fn now_utc(&self) -> String;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_utc(&self) -> String {
        OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
    }
}

#[derive(Debug, Clone)]
pub struct FixedClock {
    value: Arc<String>,
}

impl FixedClock {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: Arc::new(value.into()),
        }
    }
}

impl Clock for FixedClock {
    fn now_utc(&self) -> String {
        (*self.value).clone()
    }
}

pub trait IdGenerator: Send + Sync {
    fn next_id(&self) -> String;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct UlidGenerator;

impl IdGenerator for UlidGenerator {
    fn next_id(&self) -> String {
        Ulid::new().to_string()
    }
}

/// Deterministic IDs for tests. Once the supplied sequence is exhausted, IDs
/// are generated as `test-id-N`, making accidental extra calls visible.
#[derive(Debug, Clone)]
pub struct FixedIdGenerator {
    values: Arc<Mutex<VecDeque<String>>>,
    next: Arc<Mutex<u64>>,
}

impl FixedIdGenerator {
    pub fn new<I, S>(values: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            values: Arc::new(Mutex::new(values.into_iter().map(Into::into).collect())),
            next: Arc::new(Mutex::new(0)),
        }
    }

    pub fn try_next_id(&self) -> AppResult<String> {
        let mut values = self
            .values
            .lock()
            .map_err(|_| AppError::new("id.locked", "The test ID source is unavailable."))?;
        if let Some(value) = values.pop_front() {
            return Ok(value);
        }
        drop(values);

        let mut next = self
            .next
            .lock()
            .map_err(|_| AppError::new("id.locked", "The test ID source is unavailable."))?;
        let value = format!("test-id-{next}");
        *next += 1;
        Ok(value)
    }
}

impl IdGenerator for FixedIdGenerator {
    fn next_id(&self) -> String {
        self.try_next_id()
            .unwrap_or_else(|_| "test-id-lock-error".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::{Clock, FixedClock, FixedIdGenerator, IdGenerator};

    #[test]
    fn fixed_adapters_are_repeatable() {
        let clock = FixedClock::new("2026-01-01T00:00:00Z");
        assert_eq!(clock.now_utc(), "2026-01-01T00:00:00Z");

        let ids = FixedIdGenerator::new(["a", "b"]);
        assert_eq!(ids.next_id(), "a");
        assert_eq!(ids.next_id(), "b");
        assert_eq!(ids.next_id(), "test-id-0");
    }
}
