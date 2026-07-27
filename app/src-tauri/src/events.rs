//! Typed internal events and an in-process subscription bus.

use crate::errors::{AppError, AppResult, redact_json};
use crate::platform::clock::{Clock, IdGenerator, SystemClock, UlidGenerator};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, Mutex, Weak};

pub type EventId = String;
pub type CorrelationId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RedactionClass {
    Public,
    Internal,
    Sensitive,
    Restricted,
}

impl RedactionClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Internal => "internal",
            Self::Sensitive => "sensitive",
            Self::Restricted => "restricted",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actor {
    pub kind: String,
    pub id: Option<String>,
}

impl Serialize for Actor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.kind)
    }
}

impl<'de> Deserialize<'de> for Actor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(Self {
            kind: String::deserialize(deserializer)?,
            id: None,
        })
    }
}

impl Actor {
    pub fn system() -> Self {
        Self {
            kind: "system".to_owned(),
            id: None,
        }
    }
}

/// The initial event names are stable wire/audit identifiers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EventKind {
    WorkspaceOpened,
    WorkspaceClosed,
    FileCreated,
    FileModified,
    FileDeleted,
    FileRenamed,
    IndexJobStarted,
    IndexJobCompleted,
    IndexGenerationChanged,
    GraphNodeUpdated,
    ContextPacketCreated,
    TerminalStarted,
    TerminalCwdChanged,
    TerminalExited,
    AgentSessionStarted,
    AgentEventReceived,
    AgentApprovalRequested,
    PlannerSyncStarted,
    PlannerSyncCompleted,
    GitStatusChanged,
    NotificationCreated,
    Custom(String),
}

impl EventKind {
    pub fn as_str(&self) -> &str {
        match self {
            Self::WorkspaceOpened => "workspace.opened",
            Self::WorkspaceClosed => "workspace.closed",
            Self::FileCreated => "file.created",
            Self::FileModified => "file.modified",
            Self::FileDeleted => "file.deleted",
            Self::FileRenamed => "file.renamed",
            Self::IndexJobStarted => "index.job.started",
            Self::IndexJobCompleted => "index.job.completed",
            Self::IndexGenerationChanged => "index.generation.changed",
            Self::GraphNodeUpdated => "graph.node.updated",
            Self::ContextPacketCreated => "context.packet.created",
            Self::TerminalStarted => "terminal.started",
            Self::TerminalCwdChanged => "terminal.cwd.changed",
            Self::TerminalExited => "terminal.exited",
            Self::AgentSessionStarted => "agent.session.started",
            Self::AgentEventReceived => "agent.event.received",
            Self::AgentApprovalRequested => "agent.approval.requested",
            Self::PlannerSyncStarted => "planner.sync.started",
            Self::PlannerSyncCompleted => "planner.sync.completed",
            Self::GitStatusChanged => "git.status.changed",
            Self::NotificationCreated => "notification.created",
            Self::Custom(value) => value,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub contract: String,
    pub version: u32,
    pub event_id: EventId,
    pub event_type: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    pub correlation_id: CorrelationId,
    pub actor: Actor,
    pub payload_schema_version: u32,
    pub redaction_class: RedactionClass,
    pub persist_to_audit: bool,
    pub payload: Value,
}

impl EventEnvelope {
    #[allow(clippy::too_many_arguments)]
    pub fn new<P: Serialize>(
        kind: EventKind,
        payload: P,
        workspace_id: Option<String>,
        correlation_id: Option<CorrelationId>,
        actor: Actor,
        payload_schema_version: u32,
        redaction_class: RedactionClass,
        persist_to_audit: bool,
    ) -> AppResult<Self> {
        let clock = SystemClock;
        let ids = UlidGenerator;
        Self::new_with_sources(
            kind,
            payload,
            workspace_id,
            correlation_id,
            actor,
            payload_schema_version,
            redaction_class,
            persist_to_audit,
            &clock,
            &ids,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new_with_sources<P: Serialize, C: Clock, I: IdGenerator>(
        kind: EventKind,
        payload: P,
        workspace_id: Option<String>,
        correlation_id: Option<CorrelationId>,
        actor: Actor,
        payload_schema_version: u32,
        redaction_class: RedactionClass,
        persist_to_audit: bool,
        clock: &C,
        ids: &I,
    ) -> AppResult<Self> {
        let payload = serde_json::to_value(payload).map_err(|error| {
            AppError::new("event.serialize", "The event payload is invalid.")
                .with_details(Value::String(error.to_string()))
        })?;
        let event_id = format!("evt_{}", ids.next_id());
        Ok(Self {
            contract: "event_envelope".to_owned(),
            version: 1,
            event_type: kind.as_str().to_owned(),
            timestamp: clock.now_utc(),
            workspace_id,
            correlation_id: correlation_id.unwrap_or_else(|| format!("corr_{}", ids.next_id())),
            actor,
            payload_schema_version,
            redaction_class,
            persist_to_audit,
            payload: redact_json(&payload),
            event_id,
        })
    }

    pub fn audit_payload(&self) -> Value {
        serde_json::json!({
            "contract": self.contract,
            "version": self.version,
            "eventId": self.event_id,
            "eventType": self.event_type,
            "timestamp": self.timestamp,
            "workspaceId": self.workspace_id,
            "correlationId": self.correlation_id,
            "actor": self.actor,
            "payloadSchemaVersion": self.payload_schema_version,
            "redactionClass": self.redaction_class,
            "persistToAudit": self.persist_to_audit,
            "payload": redact_json(&self.payload),
        })
    }
}

pub trait AuditSink: Send + Sync {
    fn append(&self, event: &EventEnvelope) -> AppResult<()>;
}

type Subscriber = Arc<dyn Fn(&EventEnvelope) + Send + Sync + 'static>;

struct BusState {
    next_subscription: u64,
    subscribers: BTreeMap<u64, Subscriber>,
}

struct EventBusInner {
    state: Mutex<BusState>,
    audit_sink: Option<Arc<dyn AuditSink>>,
}

#[derive(Clone)]
pub struct EventBus {
    inner: Arc<EventBusInner>,
}

pub struct Subscription {
    id: u64,
    bus: Weak<EventBusInner>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublishReport {
    pub delivered: usize,
    pub failed_subscribers: usize,
    pub audit_persisted: bool,
}

impl EventBus {
    pub fn new() -> Self {
        Self::with_audit_sink(None)
    }

    pub fn with_audit_sink(audit_sink: Option<Arc<dyn AuditSink>>) -> Self {
        Self {
            inner: Arc::new(EventBusInner {
                state: Mutex::new(BusState {
                    next_subscription: 1,
                    subscribers: BTreeMap::new(),
                }),
                audit_sink,
            }),
        }
    }

    pub fn subscribe<F>(&self, callback: F) -> AppResult<Subscription>
    where
        F: Fn(&EventEnvelope) + Send + Sync + 'static,
    {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| AppError::new("event.bus_locked", "The event bus is unavailable."))?;
        let id = state.next_subscription;
        state.next_subscription += 1;
        state.subscribers.insert(id, Arc::new(callback));
        Ok(Subscription {
            id,
            bus: Arc::downgrade(&self.inner),
        })
    }

    pub fn publish(&self, event: EventEnvelope) -> AppResult<PublishReport> {
        let audit_persisted = if event.persist_to_audit {
            let sink = self.inner.audit_sink.as_ref().ok_or_else(|| {
                AppError::new(
                    "audit.unavailable",
                    "An audit sink is required for this event.",
                )
            })?;
            sink.append(&event)?;
            true
        } else {
            false
        };

        let subscribers = self
            .inner
            .state
            .lock()
            .map_err(|_| AppError::new("event.bus_locked", "The event bus is unavailable."))?
            .subscribers
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut failed_subscribers = 0;
        for subscriber in &subscribers {
            if catch_unwind(AssertUnwindSafe(|| subscriber(&event))).is_err() {
                failed_subscribers += 1;
            }
        }
        Ok(PublishReport {
            delivered: subscribers.len(),
            failed_subscribers,
            audit_persisted,
        })
    }

    pub fn subscriber_count(&self) -> usize {
        self.inner
            .state
            .lock()
            .map(|state| state.subscribers.len())
            .unwrap_or_default()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Some(bus) = self.bus.upgrade() {
            if let Ok(mut state) = bus.state.lock() {
                state.subscribers.remove(&self.id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Actor, EventBus, EventEnvelope, EventKind, RedactionClass};
    use crate::errors::{AppError, AppResult};
    use crate::platform::clock::{FixedClock, FixedIdGenerator};
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    struct MemoryAudit(Arc<Mutex<Vec<String>>>);

    impl super::AuditSink for MemoryAudit {
        fn append(&self, event: &EventEnvelope) -> AppResult<()> {
            self.0
                .lock()
                .map_err(|_| AppError::new("test.locked", "lock"))?
                .push(event.event_id.clone());
            Ok(())
        }
    }

    #[test]
    fn envelope_has_deterministic_metadata_and_redaction() {
        let event = EventEnvelope::new_with_sources(
            EventKind::FileModified,
            json!({"api_key": "secret", "path": "note.md"}),
            Some("workspace-1".to_owned()),
            None,
            Actor::system(),
            1,
            RedactionClass::Internal,
            true,
            &FixedClock::new("2026-01-01T00:00:00Z"),
            &FixedIdGenerator::new(["event-1", "correlation-1"]),
        )
        .expect("event");
        assert_eq!(event.contract, "event_envelope");
        assert_eq!(event.version, 1);
        assert_eq!(event.event_id, "evt_event-1");
        assert_eq!(event.correlation_id, "corr_correlation-1");
        assert_eq!(event.payload["api_key"], "[REDACTED]");
    }

    #[test]
    fn subscriber_failure_does_not_stop_delivery() {
        let audit = Arc::new(Mutex::new(Vec::new()));
        let bus = EventBus::with_audit_sink(Some(Arc::new(MemoryAudit(audit.clone()))));
        let _bad = bus
            .subscribe(|_| panic!("expected test failure"))
            .expect("sub");
        let seen = Arc::new(Mutex::new(0));
        let seen_copy = Arc::clone(&seen);
        let _good = bus
            .subscribe(move |_| *seen_copy.lock().expect("lock") += 1)
            .expect("sub");
        let event = EventEnvelope::new(
            EventKind::NotificationCreated,
            json!({"message": "done"}),
            None,
            None,
            Actor::system(),
            1,
            RedactionClass::Public,
            true,
        )
        .expect("event");
        let report = bus.publish(event).expect("publish");
        assert_eq!(report.delivered, 2);
        assert_eq!(report.failed_subscribers, 1);
        assert_eq!(*seen.lock().expect("lock"), 1);
        assert_eq!(audit.lock().expect("lock").len(), 1);
    }

    #[test]
    fn subscription_drop_unsubscribes() {
        let bus = EventBus::new();
        let subscription = bus.subscribe(|_| {}).expect("sub");
        assert_eq!(bus.subscriber_count(), 1);
        drop(subscription);
        assert_eq!(bus.subscriber_count(), 0);
    }
}
