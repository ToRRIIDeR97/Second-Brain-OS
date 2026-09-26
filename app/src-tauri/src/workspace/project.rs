//! Canonical Project cards stored inside the Brain workspace.
//!
//! Project metadata is product state, while a linked workspace remains only an
//! access boundary. A displayed location is never used to authorize a file,
//! terminal, or agent operation.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use ulid::Ulid;

use super::mutations::{MutationActor, MutationError, MutationService, WorkspacePath};

const PROJECTS_DIRECTORY: &str = "projects";
const PROJECT_CARD_VERSION: u8 = 2;

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ProjectId(String);

impl ProjectId {
    #[must_use]
    pub fn new() -> Self {
        Self(format!("project_{}", Ulid::new()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn is_valid(value: &str) -> bool {
        value
            .strip_prefix("project_")
            .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric()))
    }
}

impl Default for ProjectId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<&str> for ProjectId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    #[default]
    Active,
    Paused,
    Archived,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocation {
    pub workspace_id: String,
    /// A human-readable alias only. Runtime access resolves `workspace_id`.
    pub display_path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: ProjectId,
    pub name: String,
    pub outcome: String,
    pub template_id: Option<String>,
    pub instructions: String,
    pub status: ProjectStatus,
    pub progress_percent: u8,
    pub next_milestone: Option<String>,
    pub blocker: Option<String>,
    pub tags: Vec<String>,
    pub location: Option<ProjectLocation>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProject {
    pub name: String,
    pub outcome: String,
    pub template_id: Option<String>,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub location: Option<ProjectLocation>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub outcome: Option<String>,
    pub template_id: Option<Option<String>>,
    pub instructions: Option<String>,
    pub status: Option<ProjectStatus>,
    pub progress_percent: Option<u8>,
    pub next_milestone: Option<Option<String>>,
    pub blocker: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub location: Option<Option<ProjectLocation>>,
}

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("project name is required and must be 200 characters or fewer")]
    InvalidName,
    #[error("project outcome is required and must be 4,000 characters or fewer")]
    InvalidOutcome,
    #[error("project instructions must be 16,000 characters or fewer")]
    InvalidInstructions,
    #[error("project progress must be between 0 and 100")]
    InvalidProgress,
    #[error("project summary fields must be 1,000 characters or fewer")]
    InvalidSummary,
    #[error("project tags must be unique, non-empty, and 80 characters or fewer")]
    InvalidTags,
    #[error("a project named '{0}' already exists")]
    DuplicateName(String),
    #[error("project id is invalid")]
    InvalidId,
    #[error("project was not found")]
    NotFound,
    #[error("project card version {0} is newer than this application supports")]
    UnsupportedVersion(u64),
    #[error("project card is invalid: {0}")]
    InvalidCard(String),
    #[error("project storage failed: {0}")]
    Storage(String),
}

impl From<MutationError> for ProjectError {
    fn from(error: MutationError) -> Self {
        Self::Storage(error.to_string())
    }
}

#[derive(Debug)]
struct DecodedCard {
    record: ProjectRecord,
    front_matter: Mapping,
    body: String,
}

#[derive(Debug)]
pub struct ProjectCatalog {
    brain_workspace_id: String,
    brain_root: PathBuf,
    mutations: MutationService,
}

impl ProjectCatalog {
    pub fn new(
        brain_workspace_id: impl Into<String>,
        brain_root: impl Into<PathBuf>,
    ) -> Result<Self, ProjectError> {
        let brain_workspace_id = brain_workspace_id.into();
        let brain_root = brain_root.into();
        let mutations = MutationService::new(brain_workspace_id.clone(), brain_root.clone())?;
        Ok(Self {
            brain_workspace_id,
            brain_root,
            mutations,
        })
    }

    pub fn list(&self) -> Result<Vec<ProjectRecord>, ProjectError> {
        let directory = self.brain_root.join(PROJECTS_DIRECTORY);
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut projects = fs::read_dir(directory)
            .map_err(|error| ProjectError::Storage(error.to_string()))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "md")
            })
            .map(|entry| self.read_card(&entry.path()).map(|decoded| decoded.record))
            .collect::<Result<Vec<_>, _>>()?;
        projects.sort_by(|left, right| {
            left.status
                .rank()
                .cmp(&right.status.rank())
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(projects)
    }

    pub fn get(&self, id: &ProjectId) -> Result<ProjectRecord, ProjectError> {
        Ok(self.read_card(&self.card_path(id)?)?.record)
    }

    pub fn create(&self, input: CreateProject) -> Result<ProjectRecord, ProjectError> {
        validate_name(&input.name)?;
        validate_outcome(&input.outcome)?;
        validate_instructions(&input.instructions)?;
        validate_tags(&input.tags)?;
        if self
            .list()?
            .iter()
            .any(|project| project.name.trim().eq_ignore_ascii_case(input.name.trim()))
        {
            return Err(ProjectError::DuplicateName(input.name.trim().to_owned()));
        }
        let timestamp = timestamp()?;
        let record = ProjectRecord {
            id: ProjectId::new(),
            name: input.name.trim().to_owned(),
            outcome: input.outcome.trim().to_owned(),
            template_id: normalized_optional(input.template_id),
            instructions: input.instructions.trim().to_owned(),
            status: ProjectStatus::Active,
            progress_percent: 0,
            next_milestone: None,
            blocker: None,
            tags: normalized_tags(input.tags),
            location: input.location,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        let content = encode_card(&record, Mapping::new(), &default_body(&record))?;
        self.mutations.create_file(
            &self.card_reference(&record.id)?,
            content.as_bytes(),
            MutationActor::user("desktop"),
            Ulid::new().to_string(),
            None,
        )?;
        Ok(record)
    }

    pub fn update(
        &self,
        id: &ProjectId,
        patch: ProjectPatch,
    ) -> Result<ProjectRecord, ProjectError> {
        let path = self.card_path(id)?;
        let source = fs::read_to_string(&path).map_err(map_read_error)?;
        let mut decoded = decode_card(&source)?;
        if let Some(name) = patch.name {
            validate_name(&name)?;
            if self.list()?.iter().any(|project| {
                project.id != *id && project.name.trim().eq_ignore_ascii_case(name.trim())
            }) {
                return Err(ProjectError::DuplicateName(name.trim().to_owned()));
            }
            decoded.record.name = name.trim().to_owned();
        }
        if let Some(outcome) = patch.outcome {
            validate_outcome(&outcome)?;
            decoded.record.outcome = outcome.trim().to_owned();
        }
        if let Some(template_id) = patch.template_id {
            decoded.record.template_id = normalized_optional(template_id);
        }
        if let Some(instructions) = patch.instructions {
            validate_instructions(&instructions)?;
            decoded.record.instructions = instructions.trim().to_owned();
        }
        if let Some(status) = patch.status {
            decoded.record.status = status;
        }
        if let Some(progress) = patch.progress_percent {
            if progress > 100 {
                return Err(ProjectError::InvalidProgress);
            }
            decoded.record.progress_percent = progress;
        }
        if let Some(next_milestone) = patch.next_milestone {
            validate_summary(next_milestone.as_deref())?;
            decoded.record.next_milestone = normalized_optional(next_milestone);
        }
        if let Some(blocker) = patch.blocker {
            validate_summary(blocker.as_deref())?;
            decoded.record.blocker = normalized_optional(blocker);
        }
        if let Some(tags) = patch.tags {
            validate_tags(&tags)?;
            decoded.record.tags = normalized_tags(tags);
        }
        if let Some(location) = patch.location {
            decoded.record.location = location;
        }
        decoded.record.updated_at = timestamp()?;
        let content = encode_card(&decoded.record, decoded.front_matter, &decoded.body)?;
        let base_hash = blake3::hash(source.as_bytes()).to_hex().to_string();
        self.mutations.write_text(
            &self.card_reference(id)?,
            super::mutations::WriteTextRequest {
                content,
                base_hash: Some(base_hash),
                base_content: Some(source),
                actor: MutationActor::user("desktop"),
                correlation_id: Ulid::new().to_string(),
                operation_id: None,
            },
        )?;
        Ok(decoded.record)
    }

    fn card_reference(&self, id: &ProjectId) -> Result<WorkspacePath, ProjectError> {
        if !ProjectId::is_valid(id.as_str()) {
            return Err(ProjectError::InvalidId);
        }
        Ok(WorkspacePath::new(
            self.brain_workspace_id.clone(),
            format!("{PROJECTS_DIRECTORY}/{}.md", id.as_str()),
        ))
    }

    fn card_path(&self, id: &ProjectId) -> Result<PathBuf, ProjectError> {
        let reference = self.card_reference(id)?;
        Ok(self.brain_root.join(reference.relative_path))
    }

    fn read_card(&self, path: &Path) -> Result<DecodedCard, ProjectError> {
        let source = fs::read_to_string(path).map_err(map_read_error)?;
        decode_card(&source)
    }
}

impl ProjectStatus {
    fn rank(self) -> u8 {
        match self {
            Self::Active => 0,
            Self::Paused => 1,
            Self::Archived => 2,
        }
    }
}

fn validate_name(value: &str) -> Result<(), ProjectError> {
    let length = value.trim().chars().count();
    if length == 0 || length > 200 {
        Err(ProjectError::InvalidName)
    } else {
        Ok(())
    }
}

fn validate_outcome(value: &str) -> Result<(), ProjectError> {
    let length = value.trim().chars().count();
    if length == 0 || length > 4_000 {
        Err(ProjectError::InvalidOutcome)
    } else {
        Ok(())
    }
}

fn validate_instructions(value: &str) -> Result<(), ProjectError> {
    if value.chars().count() > 16_000 {
        Err(ProjectError::InvalidInstructions)
    } else {
        Ok(())
    }
}

fn validate_summary(value: Option<&str>) -> Result<(), ProjectError> {
    if value.is_some_and(|text| text.chars().count() > 1_000) {
        Err(ProjectError::InvalidSummary)
    } else {
        Ok(())
    }
}

fn validate_tags(tags: &[String]) -> Result<(), ProjectError> {
    let mut seen = BTreeSet::new();
    for tag in tags {
        let normalized = tag.trim().to_lowercase();
        if normalized.is_empty() || normalized.chars().count() > 80 || !seen.insert(normalized) {
            return Err(ProjectError::InvalidTags);
        }
    }
    Ok(())
}

fn normalized_tags(tags: Vec<String>) -> Vec<String> {
    tags.into_iter().map(|tag| tag.trim().to_owned()).collect()
}

fn normalized_optional(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

fn timestamp() -> Result<String, ProjectError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| ProjectError::Storage(error.to_string()))
}

fn default_body(record: &ProjectRecord) -> String {
    format!("# {}\n\n{}\n", record.name, record.outcome)
}

fn split_card(source: &str) -> Result<(&str, &str), ProjectError> {
    let remainder = source
        .strip_prefix("---\n")
        .ok_or_else(|| ProjectError::InvalidCard("missing front matter".into()))?;
    let (front_matter, body) = remainder
        .split_once("\n---\n")
        .ok_or_else(|| ProjectError::InvalidCard("unterminated front matter".into()))?;
    Ok((front_matter, body))
}

fn mapping_string(mapping: &Mapping, key: &str) -> Option<String> {
    mapping
        .get(Value::String(key.into()))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn mapping_u64(mapping: &Mapping, key: &str) -> Option<u64> {
    mapping
        .get(Value::String(key.into()))
        .and_then(Value::as_u64)
}

fn extract_v1_outcome(body: &str) -> String {
    body.lines()
        .skip_while(|line| line.trim().is_empty() || line.trim_start().starts_with('#'))
        .take_while(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_owned()
}

fn decode_card(source: &str) -> Result<DecodedCard, ProjectError> {
    let (front_matter_source, body) = split_card(source)?;
    let front_matter: Mapping = serde_yaml::from_str(front_matter_source)
        .map_err(|error| ProjectError::InvalidCard(error.to_string()))?;
    let version = mapping_u64(&front_matter, "version").unwrap_or(1);
    if version > u64::from(PROJECT_CARD_VERSION) {
        return Err(ProjectError::UnsupportedVersion(version));
    }
    let id = mapping_string(&front_matter, "id")
        .ok_or_else(|| ProjectError::InvalidCard("missing id".into()))?;
    if !ProjectId::is_valid(&id) {
        return Err(ProjectError::InvalidId);
    }
    let name = mapping_string(&front_matter, "title")
        .ok_or_else(|| ProjectError::InvalidCard("missing title".into()))?;
    let status: ProjectStatus = serde_yaml::from_value(
        front_matter
            .get(Value::String("status".into()))
            .cloned()
            .ok_or_else(|| ProjectError::InvalidCard("missing status".into()))?,
    )
    .map_err(|error| ProjectError::InvalidCard(error.to_string()))?;
    let location = if version == 1 {
        mapping_string(&front_matter, "workspace_id")
            .zip(mapping_string(&front_matter, "workspace_path"))
            .map(|(workspace_id, display_path)| ProjectLocation {
                workspace_id,
                display_path,
            })
    } else {
        front_matter
            .get(Value::String("location".into()))
            .cloned()
            .map(serde_yaml::from_value)
            .transpose()
            .map_err(|error| ProjectError::InvalidCard(error.to_string()))?
    };
    let tags = front_matter
        .get(Value::String("tags".into()))
        .cloned()
        .map(serde_yaml::from_value)
        .transpose()
        .map_err(|error| ProjectError::InvalidCard(error.to_string()))?
        .unwrap_or_default();
    let outcome =
        mapping_string(&front_matter, "outcome").unwrap_or_else(|| extract_v1_outcome(body));
    let created_at = mapping_string(&front_matter, "created_at")
        .or_else(|| mapping_string(&front_matter, "updated"))
        .unwrap_or_default();
    let updated_at = mapping_string(&front_matter, "updated_at")
        .or_else(|| mapping_string(&front_matter, "updated"))
        .unwrap_or_else(|| created_at.clone());
    let record = ProjectRecord {
        id: ProjectId::from(id.as_str()),
        name,
        outcome,
        template_id: mapping_string(&front_matter, "template_id"),
        instructions: mapping_string(&front_matter, "instructions").unwrap_or_default(),
        status,
        progress_percent: mapping_u64(&front_matter, "progress_percent")
            .unwrap_or(0)
            .try_into()
            .map_err(|_| ProjectError::InvalidProgress)?,
        next_milestone: mapping_string(&front_matter, "next_milestone"),
        blocker: mapping_string(&front_matter, "blocker"),
        tags,
        location,
        created_at,
        updated_at,
    };
    validate_name(&record.name)?;
    validate_outcome(&record.outcome)?;
    if record.progress_percent > 100 {
        return Err(ProjectError::InvalidProgress);
    }
    Ok(DecodedCard {
        record,
        front_matter,
        body: body.to_owned(),
    })
}

fn put<T: Serialize>(mapping: &mut Mapping, key: &str, value: T) -> Result<(), ProjectError> {
    let value = serde_yaml::to_value(value)
        .map_err(|error| ProjectError::InvalidCard(error.to_string()))?;
    mapping.insert(Value::String(key.into()), value);
    Ok(())
}

fn put_optional<T: Serialize>(
    mapping: &mut Mapping,
    key: &str,
    value: &Option<T>,
) -> Result<(), ProjectError> {
    if let Some(value) = value {
        put(mapping, key, value)
    } else {
        mapping.remove(Value::String(key.into()));
        Ok(())
    }
}

fn encode_card(
    record: &ProjectRecord,
    mut mapping: Mapping,
    body: &str,
) -> Result<String, ProjectError> {
    mapping.remove(Value::String("workspace_id".into()));
    mapping.remove(Value::String("workspace_path".into()));
    mapping.remove(Value::String("updated".into()));
    put(&mut mapping, "contract", "project_card")?;
    put(&mut mapping, "version", PROJECT_CARD_VERSION)?;
    put(&mut mapping, "id", record.id.as_str())?;
    put(&mut mapping, "type", "project")?;
    put(&mut mapping, "title", &record.name)?;
    put(&mut mapping, "outcome", &record.outcome)?;
    put_optional(&mut mapping, "template_id", &record.template_id)?;
    put(&mut mapping, "instructions", &record.instructions)?;
    put(&mut mapping, "status", record.status)?;
    put(&mut mapping, "progress_percent", record.progress_percent)?;
    put_optional(&mut mapping, "next_milestone", &record.next_milestone)?;
    put_optional(&mut mapping, "blocker", &record.blocker)?;
    put(&mut mapping, "tags", &record.tags)?;
    put_optional(&mut mapping, "location", &record.location)?;
    put(&mut mapping, "created_at", &record.created_at)?;
    put(&mut mapping, "updated_at", &record.updated_at)?;
    let front_matter = serde_yaml::to_string(&mapping)
        .map_err(|error| ProjectError::InvalidCard(error.to_string()))?;
    Ok(format!("---\n{front_matter}---\n{body}"))
}

fn map_read_error(error: std::io::Error) -> ProjectError {
    if error.kind() == std::io::ErrorKind::NotFound {
        ProjectError::NotFound
    } else {
        ProjectError::Storage(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog(root: &Path) -> ProjectCatalog {
        ProjectCatalog::new("ws_brain", root).expect("catalog")
    }

    fn input(name: &str) -> CreateProject {
        CreateProject {
            name: name.into(),
            outcome: "Ship a useful control center".into(),
            template_id: None,
            instructions: "Keep changes reviewable.".into(),
            tags: vec!["desktop".into()],
            location: None,
        }
    }

    #[test]
    fn creates_and_reads_a_project_without_a_location() {
        let temp = tempfile::tempdir().expect("tempdir");
        let project = catalog(temp.path())
            .create(input("Control center"))
            .expect("create");
        assert_eq!(project.status, ProjectStatus::Active);
        assert!(project.location.is_none());
        assert_eq!(
            catalog(temp.path()).get(&project.id).expect("read"),
            project
        );
    }

    #[test]
    fn rejects_case_insensitive_duplicate_names() {
        let temp = tempfile::tempdir().expect("tempdir");
        let catalog = catalog(temp.path());
        catalog.create(input("Control Center")).expect("first");
        let duplicate = catalog.create(input("control center"));
        assert!(matches!(duplicate, Err(ProjectError::DuplicateName(_))));
    }

    #[test]
    fn updates_status_progress_and_preserves_unknown_content() {
        let temp = tempfile::tempdir().expect("tempdir");
        let catalog = catalog(temp.path());
        let project = catalog.create(input("Control center")).expect("create");
        let path = catalog.card_path(&project.id).expect("path");
        let source = fs::read_to_string(&path).expect("card");
        let source = source
            .replacen("version: 2", "version: 2\ncustom_field: keep", 1)
            .replace("# Control center", "# Control center\n\nCustom body stays.");
        fs::write(&path, source).expect("fixture edit");
        let updated = catalog
            .update(
                &project.id,
                ProjectPatch {
                    status: Some(ProjectStatus::Paused),
                    progress_percent: Some(45),
                    next_milestone: Some(Some("Complete shell migration".into())),
                    ..ProjectPatch::default()
                },
            )
            .expect("update");
        assert_eq!(updated.status, ProjectStatus::Paused);
        assert_eq!(updated.progress_percent, 45);
        let saved = fs::read_to_string(path).expect("saved");
        assert!(saved.contains("custom_field: keep"));
        assert!(saved.contains("Custom body stays."));
    }

    #[test]
    fn adapts_v1_cards_and_upgrades_on_write() {
        let temp = tempfile::tempdir().expect("tempdir");
        let projects = temp.path().join(PROJECTS_DIRECTORY);
        fs::create_dir(&projects).expect("projects");
        fs::write(projects.join("project_01ABC.md"), "---\nid: project_01ABC\ntype: project\ntitle: Legacy\nstatus: active\nworkspace_id: ws_legacy\nworkspace_path: C:/Legacy\nupdated: 2026-01-01\n---\n# Legacy\n\nKeep the old project usable.\n").expect("legacy card");
        let catalog = catalog(temp.path());
        let id = ProjectId::from("project_01ABC");
        let legacy = catalog.get(&id).expect("adapted");
        assert_eq!(legacy.outcome, "Keep the old project usable.");
        assert_eq!(legacy.location.expect("location").workspace_id, "ws_legacy");
        catalog
            .update(
                &id,
                ProjectPatch {
                    progress_percent: Some(10),
                    ..ProjectPatch::default()
                },
            )
            .expect("update");
        let upgraded = fs::read_to_string(projects.join("project_01ABC.md")).expect("upgraded");
        assert!(upgraded.contains("version: 2"));
        assert!(!upgraded.contains("workspace_path:"));
    }

    #[test]
    fn rejects_progress_over_one_hundred() {
        let temp = tempfile::tempdir().expect("tempdir");
        let catalog = catalog(temp.path());
        let project = catalog.create(input("Control center")).expect("create");
        let result = catalog.update(
            &project.id,
            ProjectPatch {
                progress_percent: Some(101),
                ..ProjectPatch::default()
            },
        );
        assert!(matches!(result, Err(ProjectError::InvalidProgress)));
    }
}
