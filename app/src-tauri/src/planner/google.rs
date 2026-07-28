//! Provider-neutral Google OAuth, synchronization, and write coordination.
//!
//! This module intentionally stops at injected seams.  The application owns
//! the credential store, browser/loopback listener, HTTP client, and SQLite
//! transaction; this file only models the state transitions those adapters
//! must preserve.

use std::collections::BTreeMap;

pub const MAX_BACKOFF_MS: u64 = 60 * 60 * 1_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConsentMode {
    ReadOnly,
    ReadWrite,
}

impl ConsentMode {
    pub const fn allows_writes(self) -> bool {
        matches!(self, Self::ReadWrite)
    }

    pub const fn scopes(self) -> &'static [&'static str] {
        match self {
            Self::ReadOnly => &[
                "https://www.googleapis.com/auth/calendar.readonly",
                "https://www.googleapis.com/auth/tasks.readonly",
            ],
            Self::ReadWrite => &[
                "https://www.googleapis.com/auth/calendar.events",
                "https://www.googleapis.com/auth/calendar.readonly",
                "https://www.googleapis.com/auth/tasks",
            ],
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PkceMaterial {
    pub verifier: String,
    pub challenge: String,
}

impl PkceMaterial {
    pub fn validate(&self) -> Result<(), OAuthError> {
        if !(43..=128).contains(&self.verifier.len())
            || !self
                .verifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte))
            || self.challenge.is_empty()
        {
            return Err(OAuthError::InvalidPkce);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OAuthStart {
    pub account_id: String,
    pub window_id: String,
    pub mode: ConsentMode,
    pub state: String,
    pub pkce: PkceMaterial,
    pub requested_port: Option<u16>,
    pub now_ms: u64,
    pub expires_after_ms: u64,
}

pub trait LoopbackBinder {
    fn bind(&mut self, requested_port: Option<u16>) -> Result<u16, OAuthError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OAuthStatus {
    Waiting,
    Cancelled,
    Completed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OAuthSession {
    pub account_id: String,
    pub window_id: String,
    pub mode: ConsentMode,
    pub state: String,
    pkce: PkceMaterial,
    pub redirect_port: u16,
    pub expires_at_ms: u64,
    pub status: OAuthStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OAuthCallback {
    pub account_id: String,
    pub window_id: String,
    pub state: String,
    pub code: String,
    pub redirect_port: u16,
    pub now_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizationCode {
    pub account_id: String,
    pub mode: ConsentMode,
    pub code: String,
    pub code_verifier: String,
}

/// The only OAuth state allowed to cross a persistence boundary.  Refresh
/// tokens are deliberately absent; the credential adapter receives them
/// directly and stores them in the platform credential store.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OAuthPersistence {
    pub account_id: String,
    pub window_id: String,
    pub mode: ConsentMode,
    pub state: String,
    pub redirect_port: u16,
    pub expires_at_ms: u64,
}

pub trait RefreshTokenStore {
    type Error;

    fn store_refresh_token(
        &mut self,
        account_id: &str,
        refresh_token: &str,
    ) -> Result<(), Self::Error>;
    fn remove_refresh_token(&mut self, account_id: &str) -> Result<(), Self::Error>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OAuthError {
    InvalidAccount,
    InvalidWindow,
    InvalidState,
    InvalidPkce,
    PortConflict,
    CallbackStateMismatch,
    CallbackBindingMismatch,
    CallbackPortMismatch,
    CallbackExpired,
    CallbackEmptyCode,
    AlreadyFinished,
    Cancelled,
}

impl OAuthSession {
    pub fn begin(binder: &mut impl LoopbackBinder, start: OAuthStart) -> Result<Self, OAuthError> {
        if start.account_id.trim().is_empty() {
            return Err(OAuthError::InvalidAccount);
        }
        if start.window_id.trim().is_empty() {
            return Err(OAuthError::InvalidWindow);
        }
        if start.state.trim().is_empty() {
            return Err(OAuthError::InvalidState);
        }
        start.pkce.validate()?;
        let redirect_port = binder.bind(start.requested_port)?;
        if redirect_port == 0 {
            return Err(OAuthError::PortConflict);
        }
        Ok(Self {
            account_id: start.account_id,
            window_id: start.window_id,
            mode: start.mode,
            state: start.state,
            pkce: start.pkce,
            redirect_port,
            expires_at_ms: start.now_ms.saturating_add(start.expires_after_ms),
            status: OAuthStatus::Waiting,
        })
    }

    pub fn cancel(&mut self) -> Result<(), OAuthError> {
        if self.status != OAuthStatus::Waiting {
            return Err(OAuthError::AlreadyFinished);
        }
        self.status = OAuthStatus::Cancelled;
        Ok(())
    }

    pub fn accept_callback(
        &mut self,
        callback: OAuthCallback,
    ) -> Result<AuthorizationCode, OAuthError> {
        if self.status == OAuthStatus::Cancelled {
            return Err(OAuthError::Cancelled);
        }
        if self.status != OAuthStatus::Waiting {
            return Err(OAuthError::AlreadyFinished);
        }
        if callback.now_ms >= self.expires_at_ms {
            return Err(OAuthError::CallbackExpired);
        }
        if callback.state != self.state {
            return Err(OAuthError::CallbackStateMismatch);
        }
        if callback.account_id != self.account_id || callback.window_id != self.window_id {
            return Err(OAuthError::CallbackBindingMismatch);
        }
        if callback.redirect_port != self.redirect_port {
            return Err(OAuthError::CallbackPortMismatch);
        }
        if callback.code.trim().is_empty() {
            return Err(OAuthError::CallbackEmptyCode);
        }
        self.status = OAuthStatus::Completed;
        Ok(AuthorizationCode {
            account_id: self.account_id.clone(),
            mode: self.mode,
            code: callback.code,
            code_verifier: self.pkce.verifier.clone(),
        })
    }

    pub fn persistence_view(&self) -> OAuthPersistence {
        OAuthPersistence {
            account_id: self.account_id.clone(),
            window_id: self.window_id.clone(),
            mode: self.mode,
            state: self.state.clone(),
            redirect_port: self.redirect_port,
            expires_at_ms: self.expires_at_ms,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalendarListEntry {
    pub provider_id: String,
    pub title: String,
    pub access_role: String,
    pub timezone: Option<String>,
    pub etag: Option<String>,
    pub payload_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalendarEvent {
    pub provider_id: String,
    pub calendar_id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub timezone: Option<String>,
    pub all_day: bool,
    pub recurring_series_id: Option<String>,
    pub deleted: bool,
    pub etag: Option<String>,
    pub updated_at: String,
    pub payload_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskListEntry {
    pub provider_id: String,
    pub title: String,
    pub etag: Option<String>,
    pub payload_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GoogleTask {
    pub provider_id: String,
    pub task_list_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub deleted: bool,
    pub etag: Option<String>,
    pub updated_at: String,
    pub payload_hash: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SyncCursor {
    pub sync_token: Option<String>,
    pub page_token: Option<String>,
    pub generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SyncPage<T> {
    Data {
        items: Vec<T>,
        next_page_token: Option<String>,
        next_sync_token: Option<String>,
    },
    Gone410,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SyncOutcome<T> {
    pub items: Vec<T>,
    pub cursor: SyncCursor,
    pub reset: bool,
    pub pages: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProviderError {
    Unavailable(String),
    AuthRequired,
    RepeatedGone410,
    Terminal(String),
}

/// Provider adapters stop at normalized rows; raw response payloads remain
/// adapter-owned diagnostic shadows and are represented here only by hashes.
pub trait GoogleProvider {
    fn calendar_page(
        &mut self,
        calendar_id: &str,
        sync_token: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<SyncPage<CalendarEvent>, ProviderError>;

    fn task_page(
        &mut self,
        task_list_id: &str,
        updated_min: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<SyncPage<GoogleTask>, ProviderError>;

    fn mutate(&mut self, operation: &OutboxOperation) -> MutationResponse;
}

fn run_sync<T, F>(cursor: SyncCursor, mut fetch: F) -> Result<SyncOutcome<T>, ProviderError>
where
    F: FnMut(Option<&str>, Option<&str>) -> Result<SyncPage<T>, ProviderError>,
{
    let mut current = cursor;
    let mut items = Vec::new();
    let mut page_token = current.page_token.clone();
    let mut reset = false;
    let mut pages = 0;

    loop {
        match fetch(current.sync_token.as_deref(), page_token.as_deref())? {
            SyncPage::Gone410 if reset => return Err(ProviderError::RepeatedGone410),
            SyncPage::Gone410 => {
                reset = true;
                current.sync_token = None;
                current.page_token = None;
                page_token = None;
                current.generation = current.generation.saturating_add(1);
                items.clear();
            }
            SyncPage::Data {
                items: page_items,
                next_page_token,
                next_sync_token,
            } => {
                pages += 1;
                items.extend(page_items);
                if let Some(next) = next_page_token {
                    page_token = Some(next);
                    continue;
                }
                current.page_token = None;
                if next_sync_token.is_some() {
                    current.sync_token = next_sync_token;
                }
                return Ok(SyncOutcome {
                    items,
                    cursor: current,
                    reset,
                    pages,
                });
            }
        }
    }
}

pub fn sync_calendar<P: GoogleProvider>(
    provider: &mut P,
    calendar_id: &str,
    cursor: SyncCursor,
) -> Result<SyncOutcome<CalendarEvent>, ProviderError> {
    run_sync(cursor, |sync_token, page_token| {
        provider.calendar_page(calendar_id, sync_token, page_token)
    })
}

pub fn sync_tasks<P: GoogleProvider>(
    provider: &mut P,
    task_list_id: &str,
    cursor: SyncCursor,
) -> Result<SyncOutcome<GoogleTask>, ProviderError> {
    run_sync(cursor, |updated_min, page_token| {
        provider.task_page(task_list_id, updated_min, page_token)
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationKind {
    CalendarCreate,
    CalendarUpdate,
    CalendarComplete,
    CalendarMove,
    CalendarDelete,
    TaskCreate,
    TaskUpdate,
    TaskComplete,
    TaskMove,
    TaskDelete,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxPayload {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub due_date: Option<String>,
    pub status: Option<String>,
    pub destination_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OutboxState {
    Pending,
    Running,
    Offline,
    Retryable,
    Succeeded,
    Terminal,
    Conflict,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxOperation {
    pub id: String,
    pub account_id: String,
    pub kind: OperationKind,
    pub local_object_id: String,
    pub provider_object_id: Option<String>,
    pub idempotency_key: String,
    pub payload: OutboxPayload,
    pub base_etag: Option<String>,
    pub state: OutboxState,
    pub attempts: u32,
    pub available_at_ms: u64,
    pub last_error: Option<String>,
    pub conflict: Option<ConflictRecord>,
}

impl OutboxOperation {
    pub fn new(
        id: impl Into<String>,
        account_id: impl Into<String>,
        kind: OperationKind,
        local_object_id: impl Into<String>,
        idempotency_key: impl Into<String>,
        payload: OutboxPayload,
        now_ms: u64,
    ) -> Result<Self, OutboxError> {
        let idempotency_key = idempotency_key.into();
        if idempotency_key.trim().is_empty() {
            return Err(OutboxError::MissingIdempotencyKey);
        }
        Ok(Self {
            id: id.into(),
            account_id: account_id.into(),
            kind,
            local_object_id: local_object_id.into(),
            provider_object_id: None,
            idempotency_key,
            payload,
            base_etag: None,
            state: OutboxState::Pending,
            attempts: 0,
            available_at_ms: now_ms,
            last_error: None,
            conflict: None,
        })
    }

    pub fn ready(&self, now_ms: u64) -> bool {
        matches!(
            self.state,
            OutboxState::Pending | OutboxState::Offline | OutboxState::Retryable
        ) && self.available_at_ms <= now_ms
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OutboxError {
    MissingIdempotencyKey,
    DuplicateId(String),
    IdempotencyCollision(String),
    NotFound(String),
    NotReady,
    InvalidTransition,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MutationResponse {
    Applied {
        provider_object_id: Option<String>,
        etag: Option<String>,
    },
    Retryable(String),
    Offline(String),
    Terminal(String),
    Conflict(ConflictRecord),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DispatchResult {
    Applied,
    Retrying { available_at_ms: u64 },
    Offline,
    Terminal,
    Conflict,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct OutboxQueue {
    operations: BTreeMap<String, OutboxOperation>,
}

impl OutboxQueue {
    pub fn enqueue(&mut self, operation: OutboxOperation) -> Result<String, OutboxError> {
        if let Some(existing) = self
            .operations
            .values()
            .find(|candidate| candidate.idempotency_key == operation.idempotency_key)
        {
            if existing.local_object_id == operation.local_object_id
                && existing.kind == operation.kind
            {
                return Ok(existing.id.clone());
            }
            return Err(OutboxError::IdempotencyCollision(operation.idempotency_key));
        }
        if self.operations.contains_key(&operation.id) {
            return Err(OutboxError::DuplicateId(operation.id));
        }
        let id = operation.id.clone();
        self.operations.insert(id.clone(), operation);
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Option<&OutboxOperation> {
        self.operations.get(id)
    }

    pub fn wake_offline(&mut self, now_ms: u64) {
        for operation in self.operations.values_mut() {
            if operation.state == OutboxState::Offline && operation.available_at_ms <= now_ms {
                operation.state = OutboxState::Pending;
            }
        }
    }

    pub fn dispatch<P: GoogleProvider>(
        &mut self,
        id: &str,
        provider: &mut P,
        now_ms: u64,
    ) -> Result<DispatchResult, OutboxError> {
        let operation = self
            .operations
            .get(id)
            .ok_or_else(|| OutboxError::NotFound(id.to_owned()))?;
        if !operation.ready(now_ms) {
            return Err(OutboxError::NotReady);
        }
        let mut attempt = operation.clone();
        attempt.state = OutboxState::Running;
        attempt.attempts = attempt.attempts.saturating_add(1);
        self.operations.insert(id.to_owned(), attempt.clone());

        let result = provider.mutate(&attempt);
        let operation = self
            .operations
            .get_mut(id)
            .ok_or_else(|| OutboxError::NotFound(id.to_owned()))?;
        match result {
            MutationResponse::Applied {
                provider_object_id,
                etag,
            } => {
                operation.provider_object_id = provider_object_id;
                operation.base_etag = etag;
                operation.state = OutboxState::Succeeded;
                operation.last_error = None;
                Ok(DispatchResult::Applied)
            }
            MutationResponse::Retryable(error) => {
                operation.state = OutboxState::Retryable;
                operation.available_at_ms = now_ms.saturating_add(backoff_ms(operation.attempts));
                operation.last_error = Some(error);
                Ok(DispatchResult::Retrying {
                    available_at_ms: operation.available_at_ms,
                })
            }
            MutationResponse::Offline(error) => {
                operation.state = OutboxState::Offline;
                operation.available_at_ms = now_ms.saturating_add(backoff_ms(operation.attempts));
                operation.last_error = Some(error);
                Ok(DispatchResult::Offline)
            }
            MutationResponse::Terminal(error) => {
                operation.state = OutboxState::Terminal;
                operation.last_error = Some(error);
                Ok(DispatchResult::Terminal)
            }
            MutationResponse::Conflict(conflict) => {
                operation.state = OutboxState::Conflict;
                operation.last_error = Some("provider conflict".to_owned());
                operation.conflict = Some(conflict);
                Ok(DispatchResult::Conflict)
            }
        }
    }
}

pub fn backoff_ms(attempts: u32) -> u64 {
    let shift = attempts.saturating_sub(1).min(16);
    (1_000_u64 << shift).min(MAX_BACKOFF_MS)
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProviderFields {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub due_date: Option<String>,
    pub status: Option<String>,
}

impl ProviderFields {
    fn values(&self) -> BTreeMap<&'static str, Option<&str>> {
        BTreeMap::from([
            ("title", self.title.as_deref()),
            ("notes", self.notes.as_deref()),
            ("start", self.start.as_deref()),
            ("end", self.end.as_deref()),
            ("due_date", self.due_date.as_deref()),
            ("status", self.status.as_deref()),
        ])
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LocalEnrichment {
    pub project_id: Option<String>,
    pub source_note_id: Option<String>,
    pub importance: Option<String>,
    pub private_note: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannerSnapshot {
    pub provider: ProviderFields,
    pub enrichment: LocalEnrichment,
    pub etag: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FieldConflict {
    pub field: String,
    pub base: Option<String>,
    pub local: Option<String>,
    pub remote: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConflictRecord {
    pub operation_id: String,
    pub provider_object_id: String,
    pub base_etag: Option<String>,
    pub remote_etag: Option<String>,
    pub fields: Vec<FieldConflict>,
}

pub struct ReconcileRequest<'a> {
    pub operation_id: &'a str,
    pub provider_object_id: &'a str,
    pub base_etag: Option<&'a str>,
    pub current_etag: Option<&'a str>,
    pub base: &'a ProviderFields,
    pub local: &'a PlannerSnapshot,
    pub remote: &'a ProviderFields,
    pub remote_etag: Option<&'a str>,
}

pub fn reconcile_provider(
    request: ReconcileRequest<'_>,
) -> Result<PlannerSnapshot, ConflictRecord> {
    let ReconcileRequest {
        operation_id,
        provider_object_id,
        base_etag,
        current_etag,
        base,
        local,
        remote,
        remote_etag,
    } = request;
    let mut fields = Vec::new();
    if base_etag != current_etag {
        let base_values = base.values();
        let local_values = local.provider.values();
        let remote_values = remote.values();
        for (field, base_value) in &base_values {
            let local_value = local_values[field];
            let remote_value = remote_values[field];
            if local_value != *base_value
                && remote_value != *base_value
                && local_value != remote_value
            {
                fields.push(FieldConflict {
                    field: (*field).to_owned(),
                    base: base_value.map(ToOwned::to_owned),
                    local: local_value.map(ToOwned::to_owned),
                    remote: remote_value.map(ToOwned::to_owned),
                });
            }
        }
    }
    if !fields.is_empty() {
        return Err(ConflictRecord {
            operation_id: operation_id.to_owned(),
            provider_object_id: provider_object_id.to_owned(),
            base_etag: base_etag.map(ToOwned::to_owned),
            remote_etag: remote_etag.map(ToOwned::to_owned),
            fields,
        });
    }

    let mut merged = remote.clone();
    let base_values = base.values();
    let local_values = local.provider.values();
    let remote_values = remote.values();
    for field in base_values.keys() {
        if local_values[field] != base_values[field] && remote_values[field] == base_values[field] {
            set_provider_field(&mut merged, field, local_values[field]);
        }
    }
    Ok(PlannerSnapshot {
        provider: merged,
        enrichment: local.enrichment.clone(),
        etag: remote_etag.map(ToOwned::to_owned),
    })
}

fn set_provider_field(target: &mut ProviderFields, field: &str, value: Option<&str>) {
    let value = value.map(ToOwned::to_owned);
    match field {
        "title" => target.title = value,
        "notes" => target.notes = value,
        "start" => target.start = value,
        "end" => target.end = value,
        "due_date" => target.due_date = value,
        "status" => target.status = value,
        _ => {}
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DueRequest {
    pub date: Option<String>,
    pub exact_time: Option<String>,
    pub linked_task: bool,
    pub focus_block: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DueTarget {
    LocalTask,
    GoogleTask,
    CalendarEvent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DueRoute {
    pub primary: DueTarget,
    pub linked_task: bool,
    pub focus_block: bool,
}

pub fn route_due_time(request: &DueRequest) -> DueRoute {
    if request.exact_time.is_some() {
        DueRoute {
            primary: DueTarget::CalendarEvent,
            linked_task: request.linked_task,
            focus_block: request.focus_block,
        }
    } else if request.date.is_some() {
        DueRoute {
            primary: DueTarget::GoogleTask,
            linked_task: false,
            focus_block: false,
        }
    } else {
        DueRoute {
            primary: DueTarget::LocalTask,
            linked_task: false,
            focus_block: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RiskClass {
    ExternalPrivateWrite,
    ExternalParticipantWrite,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalRequirement {
    Allow,
    Confirm(RiskClass),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ApprovalContext {
    pub personal: bool,
    pub attendees: bool,
    pub shared_calendar: bool,
    pub recurring: bool,
    pub destructive: bool,
    pub organizer_sensitive: bool,
}

pub fn approval_for(kind: &OperationKind, context: ApprovalContext) -> ApprovalRequirement {
    if context.attendees
        || context.shared_calendar
        || context.recurring
        || context.organizer_sensitive
    {
        return ApprovalRequirement::Confirm(RiskClass::ExternalParticipantWrite);
    }
    if context.personal
        && matches!(
            kind,
            OperationKind::TaskCreate | OperationKind::TaskComplete | OperationKind::CalendarCreate
        )
        && !context.destructive
    {
        return ApprovalRequirement::Allow;
    }
    ApprovalRequirement::Confirm(RiskClass::ExternalPrivateWrite)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct FakeBinder {
        result: Result<u16, OAuthError>,
    }

    impl LoopbackBinder for FakeBinder {
        fn bind(&mut self, _requested_port: Option<u16>) -> Result<u16, OAuthError> {
            self.result.clone()
        }
    }

    fn pkce() -> PkceMaterial {
        PkceMaterial {
            verifier: "v".repeat(43),
            challenge: "challenge".to_owned(),
        }
    }

    fn oauth() -> OAuthSession {
        OAuthSession::begin(
            &mut FakeBinder { result: Ok(43123) },
            OAuthStart {
                account_id: "account".to_owned(),
                window_id: "window".to_owned(),
                mode: ConsentMode::ReadOnly,
                state: "state".to_owned(),
                pkce: pkce(),
                requested_port: Some(43123),
                now_ms: 10,
                expires_after_ms: 100,
            },
        )
        .expect("oauth")
    }

    #[test]
    fn oauth_binds_callback_and_persistence_has_no_refresh_token() {
        let mut session = oauth();
        let persisted = session.persistence_view();
        let debug = format!("{persisted:?}");
        assert!(!debug.contains("refresh"));
        assert_eq!(session.mode.scopes().len(), 2);
        let code = session
            .accept_callback(OAuthCallback {
                account_id: "account".to_owned(),
                window_id: "window".to_owned(),
                state: "state".to_owned(),
                code: "code".to_owned(),
                redirect_port: 43123,
                now_ms: 50,
            })
            .expect("callback");
        assert_eq!(code.code_verifier.len(), 43);
        assert_eq!(session.status, OAuthStatus::Completed);
    }

    #[test]
    fn oauth_rejects_port_conflict_state_mismatch_and_cancellation() {
        let conflict = OAuthSession::begin(
            &mut FakeBinder {
                result: Err(OAuthError::PortConflict),
            },
            OAuthStart {
                account_id: "account".to_owned(),
                window_id: "window".to_owned(),
                mode: ConsentMode::ReadOnly,
                state: "state".to_owned(),
                pkce: pkce(),
                requested_port: None,
                now_ms: 0,
                expires_after_ms: 10,
            },
        );
        assert_eq!(conflict, Err(OAuthError::PortConflict));

        let mut session = oauth();
        let mismatch = session.accept_callback(OAuthCallback {
            account_id: "account".to_owned(),
            window_id: "window".to_owned(),
            state: "wrong".to_owned(),
            code: "code".to_owned(),
            redirect_port: 43123,
            now_ms: 50,
        });
        assert_eq!(mismatch, Err(OAuthError::CallbackStateMismatch));
        session.cancel().expect("cancel");
        assert_eq!(
            session.accept_callback(OAuthCallback {
                account_id: "account".to_owned(),
                window_id: "window".to_owned(),
                state: "state".to_owned(),
                code: "code".to_owned(),
                redirect_port: 43123,
                now_ms: 50,
            }),
            Err(OAuthError::Cancelled)
        );
    }

    #[derive(Default)]
    struct FakeProvider {
        calendar: VecDeque<Result<SyncPage<CalendarEvent>, ProviderError>>,
        tasks: VecDeque<Result<SyncPage<GoogleTask>, ProviderError>>,
        mutations: VecDeque<MutationResponse>,
        calls: Vec<(String, Option<String>, Option<String>)>,
    }

    impl GoogleProvider for FakeProvider {
        fn calendar_page(
            &mut self,
            calendar_id: &str,
            sync_token: Option<&str>,
            page_token: Option<&str>,
        ) -> Result<SyncPage<CalendarEvent>, ProviderError> {
            self.calls.push((
                calendar_id.to_owned(),
                sync_token.map(ToOwned::to_owned),
                page_token.map(ToOwned::to_owned),
            ));
            self.calendar
                .pop_front()
                .unwrap_or_else(|| Err(ProviderError::Unavailable("empty".to_owned())))
        }

        fn task_page(
            &mut self,
            _task_list_id: &str,
            _updated_min: Option<&str>,
            _page_token: Option<&str>,
        ) -> Result<SyncPage<GoogleTask>, ProviderError> {
            self.tasks
                .pop_front()
                .unwrap_or_else(|| Err(ProviderError::Unavailable("empty".to_owned())))
        }

        fn mutate(&mut self, _operation: &OutboxOperation) -> MutationResponse {
            self.mutations
                .pop_front()
                .unwrap_or_else(|| MutationResponse::Terminal("missing response".to_owned()))
        }
    }

    fn event(id: &str) -> CalendarEvent {
        CalendarEvent {
            provider_id: id.to_owned(),
            calendar_id: "calendar".to_owned(),
            title: id.to_owned(),
            start: "2026-07-28T09:00:00Z".to_owned(),
            end: "2026-07-28T10:00:00Z".to_owned(),
            timezone: Some("UTC".to_owned()),
            all_day: false,
            recurring_series_id: None,
            deleted: false,
            etag: Some(format!("etag-{id}")),
            updated_at: "2026-07-28T00:00:00Z".to_owned(),
            payload_hash: format!("hash-{id}"),
        }
    }

    #[test]
    fn calendar_sync_paginates_and_replaces_cursor_only_on_final_page() {
        let mut provider = FakeProvider {
            calendar: VecDeque::from([
                Ok(SyncPage::Data {
                    items: vec![event("one")],
                    next_page_token: Some("page-2".to_owned()),
                    next_sync_token: Some("ignored-until-final".to_owned()),
                }),
                Ok(SyncPage::Data {
                    items: vec![event("two")],
                    next_page_token: None,
                    next_sync_token: Some("sync-2".to_owned()),
                }),
            ]),
            ..FakeProvider::default()
        };
        let outcome = sync_calendar(
            &mut provider,
            "calendar",
            SyncCursor {
                sync_token: Some("sync-1".to_owned()),
                ..SyncCursor::default()
            },
        )
        .expect("sync");
        assert_eq!(outcome.items.len(), 2);
        assert_eq!(outcome.cursor.sync_token.as_deref(), Some("sync-2"));
        assert_eq!(outcome.pages, 2);
        assert_eq!(provider.calls[1].2.as_deref(), Some("page-2"));
    }

    #[test]
    fn calendar_410_resets_only_the_affected_cursor_then_full_resyncs() {
        let mut provider = FakeProvider {
            calendar: VecDeque::from([
                Ok(SyncPage::Gone410),
                Ok(SyncPage::Data {
                    items: vec![event("fresh")],
                    next_page_token: None,
                    next_sync_token: Some("fresh-token".to_owned()),
                }),
            ]),
            ..FakeProvider::default()
        };
        let outcome = sync_calendar(
            &mut provider,
            "calendar-a",
            SyncCursor {
                sync_token: Some("expired".to_owned()),
                generation: 4,
                ..SyncCursor::default()
            },
        )
        .expect("resync");
        assert!(outcome.reset);
        assert_eq!(outcome.cursor.generation, 5);
        assert_eq!(outcome.cursor.sync_token.as_deref(), Some("fresh-token"));
        assert_eq!(provider.calls[1].1, None);
    }

    fn payload() -> OutboxPayload {
        OutboxPayload {
            title: Some("Task".to_owned()),
            notes: None,
            start: None,
            end: None,
            due_date: Some("2026-07-28".to_owned()),
            status: Some("needsAction".to_owned()),
            destination_id: None,
        }
    }

    #[test]
    fn outbox_is_idempotent_and_retries_with_backoff_without_duplicate_calls() {
        let operation = OutboxOperation::new(
            "op-1",
            "account",
            OperationKind::TaskCreate,
            "local-1",
            "idem-1",
            payload(),
            0,
        )
        .expect("operation");
        let mut queue = OutboxQueue::default();
        assert_eq!(queue.enqueue(operation.clone()).expect("enqueue"), "op-1");
        assert_eq!(queue.enqueue(operation).expect("idempotent"), "op-1");
        let mut provider = FakeProvider {
            mutations: VecDeque::from([
                MutationResponse::Retryable("busy".to_owned()),
                MutationResponse::Applied {
                    provider_object_id: Some("provider-1".to_owned()),
                    etag: Some("etag-1".to_owned()),
                },
            ]),
            ..FakeProvider::default()
        };
        assert_eq!(
            queue.dispatch("op-1", &mut provider, 0),
            Ok(DispatchResult::Retrying {
                available_at_ms: 1_000
            })
        );
        assert_eq!(
            queue.dispatch("op-1", &mut provider, 500),
            Err(OutboxError::NotReady)
        );
        assert_eq!(
            queue.dispatch("op-1", &mut provider, 1_000),
            Ok(DispatchResult::Applied)
        );
        assert_eq!(queue.get("op-1").expect("op").attempts, 2);
        assert_eq!(queue.get("op-1").expect("op").state, OutboxState::Succeeded);
    }

    #[test]
    fn outbox_tracks_offline_and_terminal_states() {
        let mut queue = OutboxQueue::default();
        queue
            .enqueue(
                OutboxOperation::new(
                    "offline",
                    "account",
                    OperationKind::TaskUpdate,
                    "local",
                    "offline-key",
                    payload(),
                    0,
                )
                .expect("operation"),
            )
            .expect("enqueue");
        queue
            .enqueue(
                OutboxOperation::new(
                    "terminal",
                    "account",
                    OperationKind::TaskDelete,
                    "local-2",
                    "terminal-key",
                    payload(),
                    0,
                )
                .expect("operation"),
            )
            .expect("enqueue");
        let mut provider = FakeProvider {
            mutations: VecDeque::from([
                MutationResponse::Offline("offline".to_owned()),
                MutationResponse::Terminal("invalid".to_owned()),
            ]),
            ..FakeProvider::default()
        };
        assert_eq!(
            queue.dispatch("offline", &mut provider, 0),
            Ok(DispatchResult::Offline)
        );
        assert_eq!(
            queue.dispatch("terminal", &mut provider, 0),
            Ok(DispatchResult::Terminal)
        );
        assert_eq!(
            queue.get("offline").expect("op").state,
            OutboxState::Offline
        );
        assert_eq!(
            queue.get("terminal").expect("op").state,
            OutboxState::Terminal
        );
    }

    #[test]
    fn etag_conflict_is_field_level_and_enrichment_survives_refresh() {
        let base = ProviderFields {
            title: Some("base".to_owned()),
            ..ProviderFields::default()
        };
        let local = PlannerSnapshot {
            provider: ProviderFields {
                title: Some("local".to_owned()),
                ..base.clone()
            },
            enrichment: LocalEnrichment {
                project_id: Some("project".to_owned()),
                ..LocalEnrichment::default()
            },
            etag: Some("etag-1".to_owned()),
        };
        let remote = ProviderFields {
            title: Some("remote".to_owned()),
            ..base.clone()
        };
        let conflict = reconcile_provider(ReconcileRequest {
            operation_id: "op",
            provider_object_id: "provider",
            base_etag: Some("etag-0"),
            current_etag: local.etag.as_deref(),
            base: &base,
            local: &local,
            remote: &remote,
            remote_etag: Some("etag-2"),
        })
        .expect_err("conflict");
        assert_eq!(conflict.fields[0].field, "title");

        let remote_only = PlannerSnapshot {
            provider: base.clone(),
            enrichment: local.enrichment.clone(),
            etag: Some("etag-1".to_owned()),
        };
        let merged = reconcile_provider(ReconcileRequest {
            operation_id: "op",
            provider_object_id: "provider",
            base_etag: Some("etag-1"),
            current_etag: remote_only.etag.as_deref(),
            base: &base,
            local: &remote_only,
            remote: &ProviderFields {
                title: Some("remote".to_owned()),
                ..base.clone()
            },
            remote_etag: Some("etag-2"),
        })
        .expect("merge");
        assert_eq!(merged.enrichment.project_id.as_deref(), Some("project"));
        assert_eq!(merged.provider.title.as_deref(), Some("remote"));
    }

    #[test]
    fn due_time_and_approval_rules_are_explicit() {
        assert_eq!(
            route_due_time(&DueRequest {
                date: Some("2026-07-28".to_owned()),
                exact_time: None,
                linked_task: true,
                focus_block: true,
            }),
            DueRoute {
                primary: DueTarget::GoogleTask,
                linked_task: false,
                focus_block: false,
            }
        );
        assert_eq!(
            route_due_time(&DueRequest {
                date: None,
                exact_time: Some("2026-07-28T09:00:00Z".to_owned()),
                linked_task: true,
                focus_block: true,
            }),
            DueRoute {
                primary: DueTarget::CalendarEvent,
                linked_task: true,
                focus_block: true,
            }
        );
        assert_eq!(
            approval_for(
                &OperationKind::TaskCreate,
                ApprovalContext {
                    personal: true,
                    attendees: false,
                    shared_calendar: false,
                    recurring: false,
                    destructive: false,
                    organizer_sensitive: false,
                }
            ),
            ApprovalRequirement::Allow
        );
        assert_eq!(
            approval_for(
                &OperationKind::CalendarUpdate,
                ApprovalContext {
                    personal: false,
                    attendees: true,
                    shared_calendar: false,
                    recurring: false,
                    destructive: false,
                    organizer_sensitive: false,
                }
            ),
            ApprovalRequirement::Confirm(RiskClass::ExternalParticipantWrite)
        );
    }
}
