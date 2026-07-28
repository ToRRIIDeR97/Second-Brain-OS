use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const LEXICAL_WEIGHT: u32 = 700;
pub const SEMANTIC_WEIGHT: u32 = 300;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderIdentity {
    pub provider: String,
    pub model: String,
    pub dimension: usize,
    pub remote: bool,
    pub normalization_version: String,
    pub chunking_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddingInput {
    pub candidate_id: String,
    pub document_id: String,
    pub project_id: Option<String>,
    pub source_id: String,
    pub source_hash: String,
    pub text: String,
    pub denied: bool,
    pub sensitive: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Embedding {
    pub candidate_id: String,
    pub values: Vec<f32>,
}

pub trait EmbeddingProvider {
    fn identity(&self) -> ProviderIdentity;
    fn embed(&self, inputs: &[EmbeddingInput]) -> Result<Vec<Embedding>, SemanticError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SemanticPrivacy {
    pub enabled: bool,
    pub allow_remote: bool,
    pub offline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyExclusion {
    pub candidate_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VectorRecord {
    pub candidate_id: String,
    pub document_id: String,
    pub project_id: Option<String>,
    pub source_id: String,
    pub source_hash: String,
    pub fingerprint: String,
    pub values: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EmbeddingBatch {
    pub provider: ProviderIdentity,
    pub records: Vec<VectorRecord>,
    pub exclusions: Vec<PrivacyExclusion>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticError {
    pub code: String,
}

impl SemanticError {
    fn new(code: &str) -> Self {
        Self {
            code: code.to_owned(),
        }
    }
}

pub fn embed_with_policy(
    provider: &impl EmbeddingProvider,
    privacy: SemanticPrivacy,
    inputs: Vec<EmbeddingInput>,
) -> Result<EmbeddingBatch, SemanticError> {
    let identity = provider.identity();
    let mut exclusions = Vec::new();
    let allowed = inputs
        .into_iter()
        .filter(|input| {
            let reason = if !privacy.enabled {
                Some("semantic.disabled")
            } else if input.denied {
                Some("semantic.policy_denied")
            } else if identity.remote && privacy.offline {
                Some("semantic.offline")
            } else if identity.remote && !privacy.allow_remote {
                Some("semantic.remote_consent_required")
            } else if identity.remote && input.sensitive {
                Some("semantic.sensitive_remote_denied")
            } else {
                None
            };
            if let Some(reason) = reason {
                exclusions.push(PrivacyExclusion {
                    candidate_id: input.candidate_id.clone(),
                    reason: reason.to_owned(),
                });
                false
            } else {
                true
            }
        })
        .collect::<Vec<_>>();
    exclusions.sort_by(|left, right| left.candidate_id.cmp(&right.candidate_id));
    if allowed.is_empty() {
        return Ok(EmbeddingBatch {
            provider: identity,
            records: Vec::new(),
            exclusions,
        });
    }

    let mut vectors = BTreeMap::new();
    for embedding in provider.embed(&allowed)? {
        if embedding.values.len() != identity.dimension
            || embedding.values.iter().any(|value| !value.is_finite())
            || vectors
                .insert(embedding.candidate_id, embedding.values)
                .is_some()
        {
            return Err(SemanticError::new("semantic.provider_invalid"));
        }
    }
    if vectors.len() != allowed.len() {
        return Err(SemanticError::new("semantic.provider_incomplete"));
    }
    let records = allowed
        .into_iter()
        .map(|input| {
            let values = vectors
                .remove(&input.candidate_id)
                .ok_or_else(|| SemanticError::new("semantic.provider_incomplete"))?;
            Ok(VectorRecord {
                fingerprint: vector_fingerprint(&input.source_hash, &identity),
                candidate_id: input.candidate_id,
                document_id: input.document_id,
                project_id: input.project_id,
                source_id: input.source_id,
                source_hash: input.source_hash,
                values,
            })
        })
        .collect::<Result<Vec<_>, SemanticError>>()?;
    Ok(EmbeddingBatch {
        provider: identity,
        records,
        exclusions,
    })
}

#[must_use]
pub fn vector_fingerprint(source_hash: &str, identity: &ProviderIdentity) -> String {
    format!(
        "{source_hash}|{}|{}|{}|{}",
        identity.provider,
        identity.model,
        identity.normalization_version,
        identity.chunking_version
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexHealth {
    pub healthy: bool,
    pub vectors: usize,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticMatch {
    pub candidate_id: String,
    pub document_id: String,
    pub project_id: Option<String>,
    pub score: u32,
}

pub trait VectorIndex {
    fn replace(&mut self, records: Vec<VectorRecord>) -> Result<(), SemanticError>;
    fn invalidate_source(&mut self, source_id: &str, current_hash: &str) -> usize;
    fn search(
        &self,
        query: &[f32],
        identity: &ProviderIdentity,
        limit: usize,
    ) -> Result<Vec<SemanticMatch>, SemanticError>;
    fn clear(&mut self);
    fn health(&self, identity: &ProviderIdentity) -> IndexHealth;
}

#[derive(Debug, Default)]
pub struct InMemoryVectorIndex {
    records: BTreeMap<String, VectorRecord>,
    corrupt: bool,
}

impl InMemoryVectorIndex {
    /// Loads a persisted cache without trusting it. Invalid cache data is
    /// discarded independently of authoritative knowledge storage.
    pub fn load(&mut self, records: Vec<VectorRecord>, dimension: usize) {
        self.clear();
        if records.iter().any(|record| {
            record.values.len() != dimension || record.values.iter().any(|value| !value.is_finite())
        }) {
            self.corrupt = true;
            return;
        }
        self.records = records
            .into_iter()
            .map(|record| (record.candidate_id.clone(), record))
            .collect();
    }
}

impl VectorIndex for InMemoryVectorIndex {
    fn replace(&mut self, records: Vec<VectorRecord>) -> Result<(), SemanticError> {
        if records
            .iter()
            .any(|record| record.values.iter().any(|value| !value.is_finite()))
        {
            return Err(SemanticError::new("semantic.vector_corrupt"));
        }
        self.records = records
            .into_iter()
            .map(|record| (record.candidate_id.clone(), record))
            .collect();
        self.corrupt = false;
        Ok(())
    }

    fn invalidate_source(&mut self, source_id: &str, current_hash: &str) -> usize {
        let before = self.records.len();
        self.records.retain(|_, record| {
            record.source_id != source_id || record.source_hash == current_hash
        });
        before - self.records.len()
    }

    fn search(
        &self,
        query: &[f32],
        identity: &ProviderIdentity,
        limit: usize,
    ) -> Result<Vec<SemanticMatch>, SemanticError> {
        let health = self.health(identity);
        if !health.healthy {
            return Err(SemanticError::new(
                health
                    .reason
                    .as_deref()
                    .unwrap_or("semantic.index_unhealthy"),
            ));
        }
        if query.len() != identity.dimension || query.iter().any(|value| !value.is_finite()) {
            return Err(SemanticError::new("semantic.dimension_mismatch"));
        }
        let mut matches = self
            .records
            .values()
            .map(|record| SemanticMatch {
                candidate_id: record.candidate_id.clone(),
                document_id: record.document_id.clone(),
                project_id: record.project_id.clone(),
                score: cosine_score(query, &record.values),
            })
            .collect::<Vec<_>>();
        matches.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.candidate_id.cmp(&right.candidate_id))
        });
        matches.truncate(limit);
        Ok(matches)
    }

    fn clear(&mut self) {
        self.records.clear();
        self.corrupt = false;
    }

    fn health(&self, identity: &ProviderIdentity) -> IndexHealth {
        let reason =
            if self.corrupt {
                Some("semantic.index_corrupt")
            } else if self
                .records
                .values()
                .any(|record| record.values.len() != identity.dimension)
            {
                Some("semantic.dimension_mismatch")
            } else if self.records.values().any(|record| {
                record.fingerprint != vector_fingerprint(&record.source_hash, identity)
            }) {
                Some("semantic.provider_changed")
            } else {
                None
            };
        IndexHealth {
            healthy: reason.is_none(),
            vectors: self.records.len(),
            reason: reason.map(str::to_owned),
        }
    }
}

fn cosine_score(left: &[f32], right: &[f32]) -> u32 {
    let dot = left
        .iter()
        .zip(right)
        .map(|(left, right)| left * right)
        .sum::<f32>();
    let left_norm = left.iter().map(|value| value * value).sum::<f32>().sqrt();
    let right_norm = right.iter().map(|value| value * value).sum::<f32>().sqrt();
    if left_norm == 0.0 || right_norm == 0.0 {
        0
    } else {
        ((dot / (left_norm * right_norm)).clamp(0.0, 1.0) * 1000.0).round() as u32
    }
}

pub struct TokenHashEmbedding {
    pub dimension: usize,
}

impl EmbeddingProvider for TokenHashEmbedding {
    fn identity(&self) -> ProviderIdentity {
        ProviderIdentity {
            provider: "local_token_hash".to_owned(),
            model: "fnv1a-v1".to_owned(),
            dimension: self.dimension,
            remote: false,
            normalization_version: "lowercase-v1".to_owned(),
            chunking_version: "source-v1".to_owned(),
        }
    }

    fn embed(&self, inputs: &[EmbeddingInput]) -> Result<Vec<Embedding>, SemanticError> {
        if self.dimension == 0 {
            return Err(SemanticError::new("semantic.dimension_invalid"));
        }
        // ponytail: token hashing is the local baseline; replace the provider
        // when the versioned retrieval fixture shows it misses the target.
        Ok(inputs
            .iter()
            .map(|input| {
                let mut values = vec![0.0; self.dimension];
                for token in input.text.split_whitespace() {
                    let hash = token
                        .bytes()
                        .map(|byte| byte.to_ascii_lowercase())
                        .fold(2_166_136_261_u32, |hash, byte| {
                            (hash ^ u32::from(byte)).wrapping_mul(16_777_619)
                        });
                    values[hash as usize % self.dimension] += 1.0;
                }
                Embedding {
                    candidate_id: input.candidate_id.clone(),
                    values,
                }
            })
            .collect())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LexicalCandidate {
    pub candidate_id: String,
    pub document_id: String,
    pub project_id: Option<String>,
    pub score: u32,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticCandidates {
    pub matches: Vec<SemanticMatch>,
    pub provider: String,
    pub privacy_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HybridExplanation {
    pub lexical_contribution: u32,
    pub semantic_contribution: u32,
    pub semantic_provider: Option<String>,
    pub privacy_status: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HybridCandidate {
    pub candidate_id: String,
    pub document_id: String,
    pub project_id: Option<String>,
    pub score: u32,
    pub explanation: HybridExplanation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HybridResult {
    pub candidates: Vec<HybridCandidate>,
    pub fallback_reason: Option<String>,
}

pub fn hybrid_rank(
    lexical: Vec<LexicalCandidate>,
    semantic: Option<Result<SemanticCandidates, SemanticError>>,
    limit: usize,
) -> HybridResult {
    let (semantic, fallback_reason, privacy_status) = match semantic {
        None => (None, None, "semantic.disabled".to_owned()),
        Some(Ok(candidates)) => {
            let privacy = candidates.privacy_status.clone();
            (Some(candidates), None, privacy)
        }
        Some(Err(error)) => (None, Some(error.code), "semantic.fallback".to_owned()),
    };
    let semantic_enabled = semantic.is_some();
    let mut merged = lexical
        .into_iter()
        .map(|candidate| (candidate.candidate_id.clone(), candidate))
        .collect::<BTreeMap<_, _>>();
    let semantic_matches = semantic
        .as_ref()
        .map(|semantic| {
            semantic
                .matches
                .iter()
                .map(|candidate| (candidate.candidate_id.clone(), candidate))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    for candidate in semantic_matches.values() {
        merged
            .entry(candidate.candidate_id.clone())
            .or_insert_with(|| LexicalCandidate {
                candidate_id: candidate.candidate_id.clone(),
                document_id: candidate.document_id.clone(),
                project_id: candidate.project_id.clone(),
                score: 0,
                reasons: Vec::new(),
            });
    }

    let mut ranked = merged
        .into_values()
        .map(|candidate| {
            let semantic_score = semantic_matches
                .get(&candidate.candidate_id)
                .map_or(0, |item| item.score.min(1000));
            let lexical_score = candidate.score.min(1000);
            let lexical_contribution = if semantic_enabled {
                lexical_score * LEXICAL_WEIGHT / 1000
            } else {
                lexical_score
            };
            let semantic_contribution = semantic_score * SEMANTIC_WEIGHT / 1000;
            let mut reasons = candidate.reasons;
            if semantic_score > 0 {
                reasons.push("search.semantic".to_owned());
            }
            HybridCandidate {
                candidate_id: candidate.candidate_id,
                document_id: candidate.document_id,
                project_id: candidate.project_id,
                score: lexical_contribution + semantic_contribution,
                explanation: HybridExplanation {
                    lexical_contribution,
                    semantic_contribution,
                    semantic_provider: semantic.as_ref().map(|semantic| semantic.provider.clone()),
                    privacy_status: privacy_status.clone(),
                    reasons,
                },
            }
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.candidate_id.cmp(&right.candidate_id))
    });

    let mut documents = BTreeMap::<String, usize>::new();
    let mut projects = BTreeMap::<String, usize>::new();
    ranked.retain(|candidate| {
        let document_count = documents
            .get(&candidate.document_id)
            .copied()
            .unwrap_or_default();
        let project_count = candidate
            .project_id
            .as_ref()
            .and_then(|project| projects.get(project))
            .copied()
            .unwrap_or_default();
        if document_count >= 2 || project_count >= 4 {
            return false;
        }
        *documents.entry(candidate.document_id.clone()).or_default() += 1;
        if let Some(project) = &candidate.project_id {
            *projects.entry(project.clone()).or_default() += 1;
        }
        true
    });
    ranked.truncate(limit);
    HybridResult {
        candidates: ranked,
        fallback_reason,
    }
}
