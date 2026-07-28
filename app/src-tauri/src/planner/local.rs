//! Provider-neutral, local planner state.
//!
//! This module deliberately owns no provider or persistence concerns.  A
//! future adapter can map `ProviderLink`/`SyncStatus` records onto its own
//! payloads without leaking those payloads into the planner model.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DateOnly(String);

impl DateOnly {
    pub fn new(value: impl Into<String>) -> Result<Self, PlannerError> {
        let value = value.into();
        if valid_date(&value) {
            Ok(Self(value))
        } else {
            Err(PlannerError::InvalidDate(value))
        }
    }

    pub fn today(epoch_seconds: i64, timezone: &str) -> Self {
        Self(epoch_date(epoch_seconds, timezone_offset_seconds(timezone)))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DateOnly {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl TryFrom<&str> for DateOnly {
    type Error = PlannerError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl TryFrom<String> for DateOnly {
    type Error = PlannerError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExactTime {
    /// Seconds since Unix epoch.  Epoch values are always absolute; the
    /// timezone is only used to display/group the value locally.
    pub epoch_seconds: i64,
    /// IANA name when known, or an ISO offset such as `+08:00`/`Z`.
    pub timezone: String,
}

impl ExactTime {
    pub fn new(epoch_seconds: i64, timezone: impl Into<String>) -> Self {
        Self {
            epoch_seconds,
            timezone: timezone.into(),
        }
    }

    #[must_use]
    pub fn local_date(&self) -> DateOnly {
        DateOnly(epoch_date(
            self.epoch_seconds,
            timezone_offset_seconds(&self.timezone),
        ))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannerSchedule {
    DateOnly {
        date: DateOnly,
    },
    Exact {
        start: ExactTime,
        end: Option<ExactTime>,
    },
    AllDay {
        date: DateOnly,
    },
}

impl PlannerSchedule {
    #[must_use]
    pub fn start_epoch_seconds(&self) -> Option<i64> {
        match self {
            Self::Exact { start, .. } => Some(start.epoch_seconds),
            Self::DateOnly { .. } | Self::AllDay { .. } => None,
        }
    }

    #[must_use]
    pub fn date(&self) -> Option<&DateOnly> {
        match self {
            Self::DateOnly { date } | Self::AllDay { date } => Some(date),
            Self::Exact { .. } => None,
        }
    }

    #[must_use]
    pub fn is_all_day(&self) -> bool {
        matches!(self, Self::AllDay { .. })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RecurrencePlaceholder {
    /// Kept as an opaque placeholder until recurrence editing is introduced.
    pub rule: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SourceLink {
    pub workspace_id: String,
    pub relative_path: String,
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
    pub explicit_task_id: Option<String>,
}

impl SourceLink {
    pub fn new(workspace_id: impl Into<String>, relative_path: impl Into<String>) -> Self {
        Self {
            workspace_id: workspace_id.into(),
            relative_path: relative_path.into(),
            start_line: None,
            end_line: None,
            explicit_task_id: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProviderLink {
    /// Provider-neutral identifier (for example, a future adapter key).
    pub provider: String,
    pub object_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ConflictPlaceholder {
    pub message: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannerItemKind {
    Task,
    Milestone,
    FocusBlock,
    Calendar,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannerStatus {
    Open,
    InProgress,
    Completed,
    Archived,
}

impl PlannerStatus {
    #[must_use]
    pub fn is_visible(self) -> bool {
        !matches!(self, Self::Archived)
    }

    #[must_use]
    pub fn is_completed(self) -> bool {
        matches!(self, Self::Completed)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannerSource {
    Local,
    Markdown,
    Provider,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    LocalOnly,
    Pending,
    Synced,
    Conflict,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ActorRef {
    pub actor_type: String,
    pub actor_id: String,
}

impl Default for ActorRef {
    fn default() -> Self {
        Self {
            actor_type: "local".to_owned(),
            actor_id: "user".to_owned(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlannerItem {
    pub id: String,
    pub kind: PlannerItemKind,
    pub title: String,
    pub details: Option<String>,
    pub schedule: Option<PlannerSchedule>,
    pub status: PlannerStatus,
    pub project_id: Option<String>,
    pub source: PlannerSource,
    pub source_link: Option<SourceLink>,
    pub provider_link: Option<ProviderLink>,
    pub recurrence: Option<RecurrencePlaceholder>,
    pub sync_status: SyncStatus,
    pub conflict: Option<ConflictPlaceholder>,
    pub created_at_epoch_seconds: i64,
    pub updated_at_epoch_seconds: i64,
    pub created_by: ActorRef,
    pub updated_by: ActorRef,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlannerItemDraft {
    pub id: Option<String>,
    pub kind: PlannerItemKind,
    pub title: String,
    pub details: Option<String>,
    pub schedule: Option<PlannerSchedule>,
    pub project_id: Option<String>,
    pub source: PlannerSource,
    pub source_link: Option<SourceLink>,
    pub provider_link: Option<ProviderLink>,
    pub recurrence: Option<RecurrencePlaceholder>,
    pub actor: ActorRef,
}

impl Default for PlannerItemDraft {
    fn default() -> Self {
        Self {
            id: None,
            kind: PlannerItemKind::Task,
            title: String::new(),
            details: None,
            schedule: None,
            project_id: None,
            source: PlannerSource::Local,
            source_link: None,
            provider_link: None,
            recurrence: None,
            actor: ActorRef::default(),
        }
    }
}

pub type PlannerItemInput = PlannerItemDraft;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlannerItemPatch {
    pub title: Option<String>,
    pub details: Option<Option<String>>,
    pub schedule: Option<Option<PlannerSchedule>>,
    pub status: Option<PlannerStatus>,
    pub project_id: Option<Option<String>>,
    pub source: Option<PlannerSource>,
    pub source_link: Option<Option<SourceLink>>,
    pub provider_link: Option<Option<ProviderLink>>,
    pub recurrence: Option<Option<RecurrencePlaceholder>>,
    pub actor: Option<ActorRef>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PlannerError {
    EmptyTitle,
    InvalidDate(String),
    InvalidSourcePath,
    InvalidSchedule,
    DuplicateId(String),
    DuplicateExplicitTaskId(String),
    MissingItem(String),
}

impl fmt::Display for PlannerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyTitle => formatter.write_str("planner.title_required"),
            Self::InvalidDate(value) => write!(formatter, "planner.invalid_date:{value}"),
            Self::InvalidSourcePath => formatter.write_str("planner.invalid_source_path"),
            Self::InvalidSchedule => formatter.write_str("planner.invalid_schedule"),
            Self::DuplicateId(id) => write!(formatter, "planner.duplicate_id:{id}"),
            Self::DuplicateExplicitTaskId(id) => {
                write!(formatter, "planner.duplicate_explicit_task_id:{id}")
            }
            Self::MissingItem(id) => write!(formatter, "planner.item_missing:{id}"),
        }
    }
}

impl std::error::Error for PlannerError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReconcileOutcome {
    Created(PlannerItem),
    Updated(PlannerItem),
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PlannerGroups {
    pub today: Vec<PlannerItem>,
    pub agenda: Vec<PlannerItem>,
    pub upcoming: Vec<PlannerItem>,
    pub unscheduled: Vec<PlannerItem>,
    pub completed: Vec<PlannerItem>,
}

pub type PlannerViews = PlannerGroups;

/// A small in-memory store for local planner interactions.  Persistence and
/// provider synchronization can wrap this domain later without changing its
/// identity or date semantics.
#[derive(Clone, Debug)]
pub struct LocalPlanner {
    items: BTreeMap<String, PlannerItem>,
    explicit_task_ids: BTreeMap<String, String>,
    now_epoch_seconds: i64,
}

impl Default for LocalPlanner {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalPlanner {
    #[must_use]
    pub fn new() -> Self {
        Self::at(0)
    }

    #[must_use]
    pub fn at(now_epoch_seconds: i64) -> Self {
        Self {
            items: BTreeMap::new(),
            explicit_task_ids: BTreeMap::new(),
            now_epoch_seconds,
        }
    }

    pub fn set_now(&mut self, now_epoch_seconds: i64) {
        self.now_epoch_seconds = now_epoch_seconds;
    }

    #[must_use]
    pub fn list(&self) -> Vec<PlannerItem> {
        self.items.values().cloned().collect()
    }

    #[must_use]
    pub fn get(&self, id: &str) -> Option<&PlannerItem> {
        self.items.get(id)
    }

    pub fn create(&mut self, draft: PlannerItemDraft) -> Result<PlannerItem, PlannerError> {
        self.create_item(draft)
    }

    pub fn create_item(&mut self, draft: PlannerItemDraft) -> Result<PlannerItem, PlannerError> {
        validate_draft(&draft)?;
        let id = draft.id.unwrap_or_else(|| ulid::Ulid::new().to_string());
        if self.items.contains_key(&id) {
            return Err(PlannerError::DuplicateId(id));
        }
        self.ensure_explicit_id_available(&draft.source_link, None)?;
        let item = PlannerItem {
            id: id.clone(),
            kind: draft.kind,
            title: draft.title.trim().to_owned(),
            details: draft.details,
            schedule: draft.schedule,
            status: PlannerStatus::Open,
            project_id: draft.project_id,
            source: draft.source,
            source_link: draft.source_link,
            provider_link: draft.provider_link,
            recurrence: draft.recurrence,
            sync_status: SyncStatus::LocalOnly,
            conflict: None,
            created_at_epoch_seconds: self.now_epoch_seconds,
            updated_at_epoch_seconds: self.now_epoch_seconds,
            created_by: draft.actor.clone(),
            updated_by: draft.actor,
        };
        self.index_explicit_id(&item);
        self.items.insert(id, item.clone());
        Ok(item)
    }

    pub fn update(
        &mut self,
        id: &str,
        patch: PlannerItemPatch,
    ) -> Result<PlannerItem, PlannerError> {
        let current = self
            .items
            .get(id)
            .cloned()
            .ok_or_else(|| PlannerError::MissingItem(id.to_owned()))?;
        let mut updated = current.clone();
        if let Some(title) = patch.title {
            if title.trim().is_empty() {
                return Err(PlannerError::EmptyTitle);
            }
            updated.title = title.trim().to_owned();
        }
        if let Some(details) = patch.details {
            updated.details = details;
        }
        if let Some(schedule) = patch.schedule {
            updated.schedule = schedule;
        }
        if let Some(status) = patch.status {
            updated.status = status;
        }
        if let Some(project_id) = patch.project_id {
            updated.project_id = project_id;
        }
        if let Some(source) = patch.source {
            updated.source = source;
        }
        if let Some(source_link) = patch.source_link {
            updated.source_link = source_link;
        }
        if let Some(provider_link) = patch.provider_link {
            updated.provider_link = provider_link;
        }
        if let Some(recurrence) = patch.recurrence {
            updated.recurrence = recurrence;
        }
        if let Some(actor) = patch.actor {
            updated.updated_by = actor;
        }
        validate_item(&updated)?;
        self.ensure_explicit_id_available(&updated.source_link, Some(id))?;
        self.remove_explicit_id(&current);
        self.index_explicit_id(&updated);
        updated.updated_at_epoch_seconds = self.now_epoch_seconds;
        self.items.insert(id.to_owned(), updated.clone());
        Ok(updated)
    }

    pub fn update_item(
        &mut self,
        id: &str,
        patch: PlannerItemPatch,
    ) -> Result<PlannerItem, PlannerError> {
        self.update(id, patch)
    }

    pub fn complete(&mut self, id: &str) -> Result<PlannerItem, PlannerError> {
        self.update(
            id,
            PlannerItemPatch {
                status: Some(PlannerStatus::Completed),
                ..PlannerItemPatch::default()
            },
        )
    }

    pub fn archive(&mut self, id: &str) -> Result<PlannerItem, PlannerError> {
        self.update(
            id,
            PlannerItemPatch {
                status: Some(PlannerStatus::Archived),
                ..PlannerItemPatch::default()
            },
        )
    }

    /// Reconcile a Markdown task by its explicit `^task-id`.  A repeated ID
    /// updates the original local row instead of creating a duplicate.
    pub fn reconcile_explicit_task(
        &mut self,
        explicit_task_id: &str,
        mut draft: PlannerItemDraft,
    ) -> Result<ReconcileOutcome, PlannerError> {
        if explicit_task_id.trim().is_empty() {
            return Err(PlannerError::DuplicateExplicitTaskId(String::new()));
        }
        let explicit_task_id = explicit_task_id.trim().to_owned();
        if let Some(id) = self.explicit_task_ids.get(&explicit_task_id).cloned() {
            let existing = self
                .items
                .get(&id)
                .cloned()
                .ok_or_else(|| PlannerError::MissingItem(id.clone()))?;
            if draft.source_link.is_none() {
                draft.source_link = existing.source_link.clone();
            }
            let source_link = draft
                .source_link
                .get_or_insert_with(|| SourceLink::new("", ""));
            source_link.explicit_task_id = Some(explicit_task_id.clone());
            draft.source = PlannerSource::Markdown;
            let mut item = draft_to_item(&draft, id.clone(), existing.created_at_epoch_seconds);
            item.status = existing.status;
            item.sync_status = existing.sync_status;
            item.conflict = existing.conflict.clone();
            item.updated_at_epoch_seconds = self.now_epoch_seconds;
            validate_item(&item)?;
            self.remove_explicit_id(&existing);
            self.index_explicit_id(&item);
            self.items.insert(id, item.clone());
            Ok(ReconcileOutcome::Updated(item))
        } else {
            let source_link = draft
                .source_link
                .get_or_insert_with(|| SourceLink::new("", ""));
            source_link.explicit_task_id = Some(explicit_task_id.clone());
            draft.source = PlannerSource::Markdown;
            let item = self.create_item(draft)?;
            Ok(ReconcileOutcome::Created(item))
        }
    }

    pub fn reconcile_task(
        &mut self,
        explicit_task_id: &str,
        draft: PlannerItemDraft,
    ) -> Result<ReconcileOutcome, PlannerError> {
        self.reconcile_explicit_task(explicit_task_id, draft)
    }

    #[must_use]
    pub fn groups(&self, now_epoch_seconds: i64, timezone: &str) -> PlannerGroups {
        let today = DateOnly::today(now_epoch_seconds, timezone);
        self.grouped_for_date(&today, now_epoch_seconds)
    }

    #[must_use]
    pub fn views(&self, now_epoch_seconds: i64, timezone: &str) -> PlannerViews {
        self.groups(now_epoch_seconds, timezone)
    }

    #[must_use]
    pub fn grouped_for_date(&self, today: &DateOnly, now_epoch_seconds: i64) -> PlannerGroups {
        let mut groups = PlannerGroups::default();
        for item in self.items.values().filter(|item| item.status.is_visible()) {
            if item.status.is_completed() {
                groups.completed.push(item.clone());
                continue;
            }
            let Some(schedule) = item.schedule.as_ref() else {
                groups.unscheduled.push(item.clone());
                continue;
            };
            groups.agenda.push(item.clone());
            let item_date = match schedule {
                PlannerSchedule::DateOnly { date } | PlannerSchedule::AllDay { date } => {
                    date.clone()
                }
                PlannerSchedule::Exact { start, .. } => start.local_date(),
            };
            if &item_date == today {
                groups.today.push(item.clone());
            } else if item_date > today.clone()
                || schedule
                    .start_epoch_seconds()
                    .is_some_and(|start| start > now_epoch_seconds)
            {
                groups.upcoming.push(item.clone());
            }
        }
        sort_items(&mut groups.today);
        sort_items(&mut groups.agenda);
        sort_items(&mut groups.upcoming);
        sort_items(&mut groups.unscheduled);
        sort_items(&mut groups.completed);
        groups
    }

    fn ensure_explicit_id_available(
        &self,
        source_link: &Option<SourceLink>,
        current_id: Option<&str>,
    ) -> Result<(), PlannerError> {
        let Some(explicit_id) = source_link
            .as_ref()
            .and_then(|link| link.explicit_task_id.as_deref())
        else {
            return Ok(());
        };
        if self
            .explicit_task_ids
            .get(explicit_id)
            .is_some_and(|existing| Some(existing.as_str()) != current_id)
        {
            return Err(PlannerError::DuplicateExplicitTaskId(
                explicit_id.to_owned(),
            ));
        }
        Ok(())
    }

    fn index_explicit_id(&mut self, item: &PlannerItem) {
        if let Some(explicit_id) = item
            .source_link
            .as_ref()
            .and_then(|link| link.explicit_task_id.as_ref())
        {
            self.explicit_task_ids
                .insert(explicit_id.clone(), item.id.clone());
        }
    }

    fn remove_explicit_id(&mut self, item: &PlannerItem) {
        if let Some(explicit_id) = item
            .source_link
            .as_ref()
            .and_then(|link| link.explicit_task_id.as_ref())
        {
            if self.explicit_task_ids.get(explicit_id) == Some(&item.id) {
                self.explicit_task_ids.remove(explicit_id);
            }
        }
    }
}

fn draft_to_item(draft: &PlannerItemDraft, id: String, created_at: i64) -> PlannerItem {
    PlannerItem {
        id,
        kind: draft.kind,
        title: draft.title.trim().to_owned(),
        details: draft.details.clone(),
        schedule: draft.schedule.clone(),
        status: PlannerStatus::Open,
        project_id: draft.project_id.clone(),
        source: draft.source,
        source_link: draft.source_link.clone(),
        provider_link: draft.provider_link.clone(),
        recurrence: draft.recurrence.clone(),
        sync_status: SyncStatus::LocalOnly,
        conflict: None,
        created_at_epoch_seconds: created_at,
        updated_at_epoch_seconds: created_at,
        created_by: draft.actor.clone(),
        updated_by: draft.actor.clone(),
    }
}

fn validate_draft(draft: &PlannerItemDraft) -> Result<(), PlannerError> {
    if draft.title.trim().is_empty() {
        return Err(PlannerError::EmptyTitle);
    }
    if let Some(source_link) = draft.source_link.as_ref() {
        validate_source_link(source_link)?;
    }
    validate_schedule(draft.schedule.as_ref())
}

fn validate_item(item: &PlannerItem) -> Result<(), PlannerError> {
    if item.title.trim().is_empty() {
        return Err(PlannerError::EmptyTitle);
    }
    if let Some(source_link) = item.source_link.as_ref() {
        validate_source_link(source_link)?;
    }
    validate_schedule(item.schedule.as_ref())
}

fn validate_source_link(link: &SourceLink) -> Result<(), PlannerError> {
    if link.workspace_id.trim().is_empty()
        || link.relative_path.trim().is_empty()
        || link.relative_path.starts_with('/')
        || link.relative_path.split('/').any(|part| part == "..")
    {
        return Err(PlannerError::InvalidSourcePath);
    }
    Ok(())
}

fn validate_schedule(schedule: Option<&PlannerSchedule>) -> Result<(), PlannerError> {
    let Some(PlannerSchedule::Exact { start, end }) = schedule else {
        return Ok(());
    };
    if end
        .as_ref()
        .is_some_and(|end| end.epoch_seconds < start.epoch_seconds)
    {
        return Err(PlannerError::InvalidSchedule);
    }
    Ok(())
}

fn sort_items(items: &mut [PlannerItem]) {
    items.sort_by(|left, right| {
        schedule_sort_key(left)
            .cmp(&schedule_sort_key(right))
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn schedule_sort_key(item: &PlannerItem) -> (u8, String, i64) {
    match item.schedule.as_ref() {
        Some(PlannerSchedule::Exact { start, .. }) => (0, String::new(), start.epoch_seconds),
        Some(PlannerSchedule::DateOnly { date }) | Some(PlannerSchedule::AllDay { date }) => {
            (1, date.to_string(), 0)
        }
        None => (2, String::new(), 0),
    }
}

fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let year = value[0..4].parse::<i32>().ok();
    let month = value[5..7].parse::<u8>().ok();
    let day = value[8..10].parse::<u8>().ok();
    let (Some(year), Some(month), Some(day)) = (year, month, day) else {
        return false;
    };
    if !(1..=12).contains(&month) {
        return false;
    }
    let month_days = match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (1..=month_days).contains(&day)
}

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn timezone_offset_seconds(timezone: &str) -> i64 {
    let timezone = timezone.trim();
    if timezone.eq_ignore_ascii_case("z")
        || timezone.eq_ignore_ascii_case("utc")
        || timezone.eq_ignore_ascii_case("etc/utc")
    {
        return 0;
    }
    let Some(sign) = timezone.as_bytes().first().copied() else {
        return 0;
    };
    if sign != b'+' && sign != b'-' {
        // Named zones are retained for display.  Their concrete offset is
        // supplied by the exact epoch at the adapter boundary; UTC is the
        // deterministic fallback until a timezone database is introduced.
        return 0;
    }
    let raw = &timezone[1..];
    let mut parts = raw.split(':');
    let hours = parts.next().and_then(|value| value.parse::<i64>().ok());
    let minutes = parts.next().and_then(|value| value.parse::<i64>().ok());
    let (Some(hours), Some(minutes)) = (hours, minutes) else {
        return 0;
    };
    if hours > 23 || minutes > 59 {
        return 0;
    }
    let offset = hours * 3_600 + minutes * 60;
    if sign == b'-' { -offset } else { offset }
}

fn epoch_date(epoch_seconds: i64, offset_seconds: i64) -> String {
    // A civil date conversion over integer days avoids host-local timezone
    // state and remains stable around DST boundaries.
    let days = (epoch_seconds as i128 + offset_seconds as i128).div_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + i128::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(title: &str, schedule: Option<PlannerSchedule>) -> PlannerItemDraft {
        PlannerItemDraft {
            title: title.to_owned(),
            schedule,
            ..PlannerItemDraft::default()
        }
    }

    #[test]
    fn date_only_and_exact_time_remain_distinct_at_timezone_boundary() {
        let mut planner = LocalPlanner::at(1_751_320_800); // 2025-06-30T23:00Z
        planner
            .create(task(
                "date",
                Some(PlannerSchedule::DateOnly {
                    date: DateOnly::new("2025-07-01").expect("date"),
                }),
            ))
            .expect("date task");
        planner
            .create(task(
                "exact",
                Some(PlannerSchedule::Exact {
                    start: ExactTime::new(1_751_320_800, "+02:00"),
                    end: None,
                }),
            ))
            .expect("exact task");
        let groups = planner.groups(1_751_320_800, "+02:00");
        assert_eq!(groups.today.len(), 2);
        assert_eq!(groups.agenda.len(), 2);
    }

    #[test]
    fn explicit_task_reconciliation_updates_without_duplicates() {
        let mut planner = LocalPlanner::at(10);
        let mut first = task("old", None);
        first.source_link = Some(SourceLink {
            workspace_id: "ws".into(),
            relative_path: "notes/today.md".into(),
            start_line: Some(2),
            end_line: Some(2),
            explicit_task_id: None,
        });
        let created = planner
            .reconcile_explicit_task("ship", first)
            .expect("create");
        let id = match created {
            ReconcileOutcome::Created(item) => item.id,
            ReconcileOutcome::Updated(_) => panic!("expected create"),
        };
        let updated = planner
            .reconcile_explicit_task("ship", task("new", None))
            .expect("update");
        assert!(matches!(updated, ReconcileOutcome::Updated(_)));
        assert_eq!(planner.list().len(), 1);
        assert_eq!(planner.get(&id).expect("item").title, "new");
    }

    #[test]
    fn complete_and_archive_are_local_only_and_group_deterministically() {
        let mut planner = LocalPlanner::at(100);
        let first = planner.create(task("zeta", None)).expect("create");
        let second = planner.create(task("alpha", None)).expect("create");
        planner.complete(&first.id).expect("complete");
        planner.archive(&second.id).expect("archive");
        let groups = planner.groups(100, "UTC");
        assert_eq!(groups.completed[0].title, "zeta");
        assert!(groups.unscheduled.is_empty());
        assert_eq!(first.sync_status, SyncStatus::LocalOnly);
    }
}
