//! App-owned planner mutations initiated by agents.

use super::google::{
    ApprovalContext, ApprovalRequirement, OperationKind, OutboxError, OutboxOperation,
    OutboxPayload, OutboxQueue, RiskClass, approval_for,
};
use super::local::{
    ActorRef, DateOnly, ExactTime, LocalPlanner, PlannerError, PlannerItem, PlannerItemDraft,
    PlannerItemKind, PlannerSchedule, PlannerSource, SyncStatus,
};
use std::collections::BTreeMap;

pub const PLANNER_LAUNCH_PROMPT: &str =
    "Use planner.create_task for date-only intent and planner.create_event for exact-time intent.";
pub const PLANNER_COMPLETION_PROMPT: &str =
    "Before finishing, offer to record follow-up tasks or schedule a private focus block.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentPlannerContext {
    pub workspace_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub packet_id: Option<String>,
    pub project_id: Option<String>,
    pub source_note_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateTaskRequest {
    pub title: String,
    pub details: Option<String>,
    pub due_date: Option<DateOnly>,
    pub account_id: String,
    pub task_list_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateEventRequest {
    pub title: String,
    pub details: Option<String>,
    pub start: ExactTime,
    pub end: ExactTime,
    pub account_id: String,
    pub calendar_id: String,
    pub idempotency_key: String,
    pub focus_block: bool,
    pub personal: bool,
    pub attendees: bool,
    pub shared_calendar: bool,
    pub recurring: bool,
    pub organizer_sensitive: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompleteTaskRequest {
    pub planner_item_id: String,
    pub account_id: String,
    pub task_list_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannerWriteResponse {
    pub local_id: String,
    pub provider_id: Option<String>,
    pub outbox_id: String,
    pub sync_state: SyncStatus,
    pub audit_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannerAgentLink {
    pub id: String,
    pub workspace_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub packet_id: Option<String>,
    pub planner_item_id: String,
    pub outbox_id: String,
    pub audit_id: String,
    pub tool_name: String,
    pub project_id: Option<String>,
    pub source_note_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApprovalPreview {
    pub provider_target: String,
    pub risk_class: RiskClass,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AgentPlannerError {
    InvalidContext,
    InvalidProviderTarget,
    MissingIdempotencyKey,
    IdempotencyCollision,
    ApprovalRequired(ApprovalPreview),
    Planner(PlannerError),
    Outbox(OutboxError),
}

impl From<PlannerError> for AgentPlannerError {
    fn from(error: PlannerError) -> Self {
        Self::Planner(error)
    }
}

impl From<OutboxError> for AgentPlannerError {
    fn from(error: OutboxError) -> Self {
        Self::Outbox(error)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RecordedWrite {
    signature: String,
    response: PlannerWriteResponse,
}

#[derive(Debug, Default)]
pub struct AgentPlannerWorkflow {
    planner: LocalPlanner,
    outbox: OutboxQueue,
    links: Vec<PlannerAgentLink>,
    writes: BTreeMap<String, RecordedWrite>,
}

impl AgentPlannerWorkflow {
    #[must_use]
    pub fn new(planner: LocalPlanner) -> Self {
        Self {
            planner,
            ..Self::default()
        }
    }

    #[must_use]
    pub fn planner(&self) -> &LocalPlanner {
        &self.planner
    }

    #[must_use]
    pub fn outbox(&self) -> &OutboxQueue {
        &self.outbox
    }

    #[must_use]
    pub fn links(&self) -> &[PlannerAgentLink] {
        &self.links
    }

    pub fn create_task(
        &mut self,
        context: &AgentPlannerContext,
        request: CreateTaskRequest,
        now_ms: u64,
    ) -> Result<PlannerWriteResponse, AgentPlannerError> {
        validate_context(context)?;
        validate_provider_target(
            &request.account_id,
            &request.task_list_id,
            &request.idempotency_key,
        )?;
        let signature = format!(
            "task|{}|{:?}|{:?}|{}|{}|{:?}|{:?}",
            request.title,
            request.details,
            request.due_date,
            request.account_id,
            request.task_list_id,
            context.project_id,
            context.source_note_id
        );
        if let Some(response) = self.replayed(&request.idempotency_key, &signature)? {
            return Ok(response);
        }
        let item = self.planner.create(PlannerItemDraft {
            kind: PlannerItemKind::Task,
            title: request.title.clone(),
            details: request.details.clone(),
            schedule: request
                .due_date
                .clone()
                .map(|date| PlannerSchedule::DateOnly { date }),
            project_id: context.project_id.clone(),
            source: PlannerSource::Local,
            actor: actor(context),
            ..PlannerItemDraft::default()
        })?;
        let payload = OutboxPayload {
            title: Some(item.title.clone()),
            notes: item.details.clone(),
            due_date: request.due_date.map(|date| date.to_string()),
            ..empty_payload()
        };
        self.record_write(
            context,
            item,
            request.account_id,
            request.task_list_id,
            request.idempotency_key,
            signature,
            OperationKind::TaskCreate,
            payload,
            "planner.create_task",
            now_ms,
        )
    }

    pub fn create_event(
        &mut self,
        context: &AgentPlannerContext,
        request: CreateEventRequest,
        now_ms: u64,
    ) -> Result<PlannerWriteResponse, AgentPlannerError> {
        validate_context(context)?;
        validate_provider_target(
            &request.account_id,
            &request.calendar_id,
            &request.idempotency_key,
        )?;
        if let ApprovalRequirement::Confirm(risk_class) = approval_for(
            &OperationKind::CalendarCreate,
            ApprovalContext {
                personal: request.personal,
                attendees: request.attendees,
                shared_calendar: request.shared_calendar,
                recurring: request.recurring,
                destructive: false,
                organizer_sensitive: request.organizer_sensitive,
            },
        ) {
            return Err(AgentPlannerError::ApprovalRequired(ApprovalPreview {
                provider_target: format!(
                    "google:{}/calendars/{}",
                    request.account_id, request.calendar_id
                ),
                risk_class,
            }));
        }
        let signature = format!(
            "event|{}|{:?}|{:?}|{:?}|{}|{}|{}|{:?}|{:?}",
            request.title,
            request.details,
            request.start,
            request.end,
            request.account_id,
            request.calendar_id,
            request.focus_block,
            context.project_id,
            context.source_note_id
        );
        if let Some(response) = self.replayed(&request.idempotency_key, &signature)? {
            return Ok(response);
        }
        let item = self.planner.create(PlannerItemDraft {
            kind: if request.focus_block {
                PlannerItemKind::FocusBlock
            } else {
                PlannerItemKind::Calendar
            },
            title: request.title.clone(),
            details: request.details.clone(),
            schedule: Some(PlannerSchedule::Exact {
                start: request.start.clone(),
                end: Some(request.end.clone()),
            }),
            project_id: context.project_id.clone(),
            source: PlannerSource::Local,
            actor: actor(context),
            ..PlannerItemDraft::default()
        })?;
        let payload = OutboxPayload {
            title: Some(item.title.clone()),
            notes: item.details.clone(),
            start: Some(request.start.epoch_seconds.to_string()),
            end: Some(request.end.epoch_seconds.to_string()),
            ..empty_payload()
        };
        self.record_write(
            context,
            item,
            request.account_id,
            request.calendar_id,
            request.idempotency_key,
            signature,
            OperationKind::CalendarCreate,
            payload,
            "planner.create_event",
            now_ms,
        )
    }

    pub fn complete_task(
        &mut self,
        context: &AgentPlannerContext,
        request: CompleteTaskRequest,
        now_ms: u64,
    ) -> Result<PlannerWriteResponse, AgentPlannerError> {
        validate_context(context)?;
        validate_provider_target(
            &request.account_id,
            &request.task_list_id,
            &request.idempotency_key,
        )?;
        let signature = format!(
            "complete|{}|{}|{}",
            request.planner_item_id, request.account_id, request.task_list_id
        );
        if let Some(response) = self.replayed(&request.idempotency_key, &signature)? {
            return Ok(response);
        }
        let item = self.planner.complete(&request.planner_item_id)?;
        self.record_write(
            context,
            item,
            request.account_id,
            request.task_list_id,
            request.idempotency_key,
            signature,
            OperationKind::TaskComplete,
            OutboxPayload {
                status: Some("completed".to_owned()),
                ..empty_payload()
            },
            "planner.complete_task",
            now_ms,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn record_write(
        &mut self,
        context: &AgentPlannerContext,
        item: PlannerItem,
        account_id: String,
        provider_target_id: String,
        idempotency_key: String,
        signature: String,
        kind: OperationKind,
        mut payload: OutboxPayload,
        tool_name: &str,
        now_ms: u64,
    ) -> Result<PlannerWriteResponse, AgentPlannerError> {
        payload.destination_id = Some(provider_target_id);
        let outbox_id = format!("outbox_{}", ulid::Ulid::new());
        let mut operation = OutboxOperation::new(
            &outbox_id,
            account_id,
            kind,
            &item.id,
            &idempotency_key,
            payload,
            now_ms,
        )?;
        operation.provider_object_id = item
            .provider_link
            .as_ref()
            .map(|link| link.object_id.clone());
        self.outbox.enqueue(operation)?;
        let item = self
            .planner
            .mark_sync_status(&item.id, SyncStatus::Pending)?;
        let audit_id = format!("audit_{}", ulid::Ulid::new());
        let response = PlannerWriteResponse {
            local_id: item.id.clone(),
            provider_id: item
                .provider_link
                .as_ref()
                .map(|link| link.object_id.clone()),
            outbox_id: outbox_id.clone(),
            sync_state: item.sync_status,
            audit_id: audit_id.clone(),
        };
        self.links.push(PlannerAgentLink {
            id: format!("link_{}", ulid::Ulid::new()),
            workspace_id: context.workspace_id.clone(),
            agent_id: context.agent_id.clone(),
            session_id: context.session_id.clone(),
            packet_id: context.packet_id.clone(),
            planner_item_id: item.id,
            outbox_id,
            audit_id,
            tool_name: tool_name.to_owned(),
            project_id: context.project_id.clone(),
            source_note_id: context.source_note_id.clone(),
        });
        self.writes.insert(
            idempotency_key,
            RecordedWrite {
                signature,
                response: response.clone(),
            },
        );
        Ok(response)
    }

    fn replayed(
        &self,
        idempotency_key: &str,
        signature: &str,
    ) -> Result<Option<PlannerWriteResponse>, AgentPlannerError> {
        match self.writes.get(idempotency_key) {
            Some(recorded) if recorded.signature == signature => {
                Ok(Some(recorded.response.clone()))
            }
            Some(_) => Err(AgentPlannerError::IdempotencyCollision),
            None => Ok(None),
        }
    }
}

fn actor(context: &AgentPlannerContext) -> ActorRef {
    ActorRef {
        actor_type: "agent".to_owned(),
        actor_id: context.agent_id.clone(),
    }
}

fn validate_context(context: &AgentPlannerContext) -> Result<(), AgentPlannerError> {
    if [
        context.workspace_id.as_str(),
        context.agent_id.as_str(),
        context.session_id.as_str(),
    ]
    .into_iter()
    .any(|value| value.trim().is_empty())
    {
        return Err(AgentPlannerError::InvalidContext);
    }
    Ok(())
}

fn validate_provider_target(
    account_id: &str,
    target_id: &str,
    idempotency_key: &str,
) -> Result<(), AgentPlannerError> {
    if idempotency_key.trim().is_empty() {
        return Err(AgentPlannerError::MissingIdempotencyKey);
    }
    if account_id.trim().is_empty() || target_id.trim().is_empty() {
        return Err(AgentPlannerError::InvalidProviderTarget);
    }
    Ok(())
}

fn empty_payload() -> OutboxPayload {
    OutboxPayload {
        title: None,
        notes: None,
        start: None,
        end: None,
        due_date: None,
        status: None,
        destination_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::local::PlannerStatus;
    use super::*;

    fn context() -> AgentPlannerContext {
        AgentPlannerContext {
            workspace_id: "workspace".to_owned(),
            agent_id: "agent".to_owned(),
            session_id: "session".to_owned(),
            packet_id: Some("packet".to_owned()),
            project_id: Some("project".to_owned()),
            source_note_id: Some("note".to_owned()),
        }
    }

    fn task(key: &str) -> CreateTaskRequest {
        CreateTaskRequest {
            title: "Write checkpoint notes".to_owned(),
            details: None,
            due_date: Some(DateOnly::new("2026-07-29").expect("date")),
            account_id: "account".to_owned(),
            task_list_id: "tasks".to_owned(),
            idempotency_key: key.to_owned(),
        }
    }

    #[test]
    fn agent_writes_are_explicit_idempotent_linked_and_approval_safe() {
        let mut workflow = AgentPlannerWorkflow::new(LocalPlanner::at(100));
        let created = workflow
            .create_task(&context(), task("task-key"), 100_000)
            .expect("task");
        assert_eq!(
            workflow
                .planner()
                .get(&created.local_id)
                .expect("local task")
                .schedule,
            Some(PlannerSchedule::DateOnly {
                date: DateOnly::new("2026-07-29").expect("date")
            })
        );
        assert_eq!(created.sync_state, SyncStatus::Pending);
        assert_eq!(
            workflow
                .create_task(&context(), task("task-key"), 100_001)
                .expect("idempotent retry"),
            created
        );
        assert_eq!(workflow.links().len(), 1);
        assert_eq!(workflow.links()[0].session_id, "session");
        assert_eq!(workflow.links()[0].packet_id.as_deref(), Some("packet"));
        assert!(workflow.outbox().get(&created.outbox_id).is_some());

        let event = workflow
            .create_event(
                &context(),
                CreateEventRequest {
                    title: "Focus".to_owned(),
                    details: None,
                    start: ExactTime::new(1_000, "UTC"),
                    end: ExactTime::new(1_600, "UTC"),
                    account_id: "account".to_owned(),
                    calendar_id: "calendar".to_owned(),
                    idempotency_key: "event-key".to_owned(),
                    focus_block: true,
                    personal: true,
                    attendees: false,
                    shared_calendar: false,
                    recurring: false,
                    organizer_sensitive: false,
                },
                100_000,
            )
            .expect("focus block");
        assert_eq!(
            workflow.planner().get(&event.local_id).expect("event").kind,
            PlannerItemKind::FocusBlock
        );

        let participant = workflow.create_event(
            &context(),
            CreateEventRequest {
                title: "Team meeting".to_owned(),
                details: None,
                start: ExactTime::new(2_000, "UTC"),
                end: ExactTime::new(2_600, "UTC"),
                account_id: "account".to_owned(),
                calendar_id: "shared".to_owned(),
                idempotency_key: "participant-key".to_owned(),
                focus_block: false,
                personal: false,
                attendees: true,
                shared_calendar: true,
                recurring: false,
                organizer_sensitive: false,
            },
            100_000,
        );
        assert!(matches!(
            participant,
            Err(AgentPlannerError::ApprovalRequired(ApprovalPreview {
                risk_class: RiskClass::ExternalParticipantWrite,
                ..
            }))
        ));
        assert_eq!(workflow.links().len(), 2);

        let completed = workflow
            .complete_task(
                &context(),
                CompleteTaskRequest {
                    planner_item_id: created.local_id.clone(),
                    account_id: "account".to_owned(),
                    task_list_id: "tasks".to_owned(),
                    idempotency_key: "complete-key".to_owned(),
                },
                101_000,
            )
            .expect("complete");
        assert_eq!(
            workflow
                .planner()
                .get(&completed.local_id)
                .expect("completed task")
                .status,
            PlannerStatus::Completed
        );
        assert!(workflow.outbox().get(&completed.outbox_id).is_some());
        assert_eq!(workflow.links().len(), 3);
    }
}
