use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    DocumentSummary,
    ProjectSummary,
    AreaSummary,
    Claim,
    Contradiction,
    Duplicate,
    Concept,
    RelationshipSuggestion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatus {
    PendingReview,
    Accepted,
    Rejected,
    Dismissed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDependency {
    pub source_id: String,
    pub source_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceInput {
    pub source_id: String,
    pub source_hash: String,
    pub text: String,
    pub priority: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PacketSource {
    pub dependency: SourceDependency,
    pub text: String,
    /// Source text is always generator data, never an application instruction.
    pub is_data: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourcePacket {
    pub sources: Vec<PacketSource>,
}

/// Selects a deterministic, bounded packet. Text is kept structurally separate
/// from trusted generator instructions even when it contains prompt-like text.
#[must_use]
pub fn select_source_packet(
    mut sources: Vec<SourceInput>,
    max_sources: usize,
    max_bytes: usize,
) -> SourcePacket {
    sources.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| left.source_id.cmp(&right.source_id))
    });
    let mut used = 0;
    let sources = sources
        .into_iter()
        .take(max_sources)
        .filter_map(|source| {
            let remaining = max_bytes.saturating_sub(used);
            if remaining == 0 {
                return None;
            }
            let mut end = source.text.len().min(remaining);
            while !source.text.is_char_boundary(end) {
                end -= 1;
            }
            used += end;
            Some(PacketSource {
                dependency: SourceDependency {
                    source_id: source.source_id,
                    source_hash: source.source_hash,
                },
                text: source.text[..end].to_owned(),
                is_data: true,
            })
        })
        .collect();
    SourcePacket { sources }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorIdentity {
    pub generator: String,
    pub model_or_tool_version: String,
    pub prompt_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipCandidate {
    pub source_node_id: String,
    pub target_node_id: String,
    pub edge_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedArtifact {
    pub artifact_id: String,
    pub kind: ArtifactKind,
    pub text: String,
    pub output_hash: String,
    pub confidence: u16,
    pub relationship: Option<RelationshipCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerationFailure {
    pub source_id: String,
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GenerationBatch {
    pub artifacts: Vec<GeneratedArtifact>,
    pub failures: Vec<GenerationFailure>,
}

pub trait DerivedGenerator {
    fn identity(&self) -> GeneratorIdentity;
    fn generate(&self, packet: &SourcePacket) -> Result<GenerationBatch, String>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedArtifact {
    pub artifact_id: String,
    pub workspace_id: String,
    pub kind: ArtifactKind,
    pub text: String,
    pub output_hash: String,
    pub dependencies: Vec<SourceDependency>,
    pub generator: GeneratorIdentity,
    pub confidence: u16,
    pub status: ReviewStatus,
    pub stale: bool,
    pub generated_at: String,
    pub relationship: Option<RelationshipCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedJob {
    pub job_id: String,
    pub workspace_id: String,
    pub priority: i32,
    pub packet: SourcePacket,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationshipPromotion {
    pub artifact_id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub edge_type: String,
    pub source_hashes: Vec<SourceDependency>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewError {
    NotFound,
    Stale,
    SourcesChanged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunResult {
    pub job_id: String,
    pub generated: usize,
    pub failures: Vec<GenerationFailure>,
}

#[derive(Debug)]
pub struct DerivedService {
    enabled: bool,
    artifacts: BTreeMap<String, DerivedArtifact>,
    jobs: BTreeMap<String, DerivedJob>,
}

impl DerivedService {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    #[must_use]
    pub fn enqueue(&mut self, job: DerivedJob) -> bool {
        self.enabled && self.jobs.insert(job.job_id.clone(), job).is_none()
    }

    pub fn run_next(
        &mut self,
        generator: &impl DerivedGenerator,
        generated_at: &str,
    ) -> Result<Option<RunResult>, String> {
        if !self.enabled {
            return Ok(None);
        }
        let Some(job_id) = self
            .jobs
            .values()
            .max_by(|left, right| {
                left.priority
                    .cmp(&right.priority)
                    .then_with(|| right.job_id.cmp(&left.job_id))
            })
            .map(|job| job.job_id.clone())
        else {
            return Ok(None);
        };
        let job = self.jobs.remove(&job_id).expect("selected job exists");
        let identity = generator.identity();
        self.invalidate_generator(&identity);
        let batch = match generator.generate(&job.packet) {
            Ok(batch) => batch,
            Err(error) => {
                self.jobs.insert(job_id, job);
                return Err(error);
            }
        };
        let dependencies = job
            .packet
            .sources
            .iter()
            .map(|source| source.dependency.clone())
            .collect::<Vec<_>>();
        let generated = batch.artifacts.len();
        for output in batch.artifacts {
            self.artifacts.insert(
                output.artifact_id.clone(),
                DerivedArtifact {
                    artifact_id: output.artifact_id,
                    workspace_id: job.workspace_id.clone(),
                    kind: output.kind,
                    text: output.text,
                    output_hash: output.output_hash,
                    dependencies: dependencies.clone(),
                    generator: identity.clone(),
                    confidence: output.confidence.min(1000),
                    status: ReviewStatus::PendingReview,
                    stale: false,
                    generated_at: generated_at.to_owned(),
                    relationship: output.relationship,
                },
            );
        }
        Ok(Some(RunResult {
            job_id,
            generated,
            failures: batch.failures,
        }))
    }

    #[must_use]
    pub fn artifacts(&self) -> Vec<&DerivedArtifact> {
        self.artifacts.values().collect()
    }

    pub fn invalidate_source(&mut self, source_id: &str, current_hash: &str) {
        self.stale_from(VecDeque::from([(
            source_id.to_owned(),
            Some(current_hash.to_owned()),
        )]));
    }

    pub fn invalidate_generator(&mut self, current: &GeneratorIdentity) {
        let artifact_ids = self
            .artifacts
            .values()
            .filter(|artifact| {
                artifact.generator.generator == current.generator && artifact.generator != *current
            })
            .map(|artifact| artifact.artifact_id.clone())
            .collect();
        self.mark_artifacts_stale(artifact_ids);
    }

    pub fn mark_all_stale(&mut self) {
        self.mark_artifacts_stale(self.artifacts.keys().cloned().collect());
    }

    pub fn review(
        &mut self,
        artifact_id: &str,
        expected_sources: &[SourceDependency],
        status: ReviewStatus,
    ) -> Result<Option<RelationshipPromotion>, ReviewError> {
        let artifact = self
            .artifacts
            .get_mut(artifact_id)
            .ok_or(ReviewError::NotFound)?;
        if artifact.stale {
            return Err(ReviewError::Stale);
        }
        if artifact.dependencies != expected_sources {
            return Err(ReviewError::SourcesChanged);
        }
        artifact.status = status;
        Ok((status == ReviewStatus::Accepted)
            .then_some(artifact.relationship.as_ref())
            .flatten()
            .map(|relationship| RelationshipPromotion {
                artifact_id: artifact.artifact_id.clone(),
                source_node_id: relationship.source_node_id.clone(),
                target_node_id: relationship.target_node_id.clone(),
                edge_type: relationship.edge_type.clone(),
                source_hashes: artifact.dependencies.clone(),
            }))
    }

    fn stale_from(&mut self, mut queue: VecDeque<(String, Option<String>)>) {
        let mut visited = BTreeSet::new();
        while let Some((source_id, current_hash)) = queue.pop_front() {
            for artifact in self.artifacts.values_mut().filter(|artifact| {
                !artifact.stale
                    && artifact.dependencies.iter().any(|dependency| {
                        dependency.source_id == source_id
                            && current_hash
                                .as_ref()
                                .is_none_or(|hash| dependency.source_hash != *hash)
                    })
            }) {
                artifact.stale = true;
                artifact.status = ReviewStatus::PendingReview;
                if visited.insert(artifact.artifact_id.clone()) {
                    queue.push_back((artifact.artifact_id.clone(), None));
                }
            }
        }
    }

    fn mark_artifacts_stale(&mut self, artifact_ids: Vec<String>) {
        let mut downstream = VecDeque::new();
        for artifact_id in artifact_ids {
            if let Some(artifact) = self.artifacts.get_mut(&artifact_id) {
                artifact.stale = true;
                artifact.status = ReviewStatus::PendingReview;
                downstream.push_back((artifact_id, None));
            }
        }
        self.stale_from(downstream);
    }
}

impl Default for DerivedService {
    fn default() -> Self {
        Self {
            enabled: true,
            artifacts: BTreeMap::new(),
            jobs: BTreeMap::new(),
        }
    }
}
