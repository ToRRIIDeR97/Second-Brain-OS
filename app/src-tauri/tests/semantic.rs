#[path = "../src/knowledge/semantic.rs"]
mod semantic;

use semantic::*;
use serde::Deserialize;
use std::cell::Cell;

fn input(id: &str, text: &str) -> EmbeddingInput {
    EmbeddingInput {
        candidate_id: id.into(),
        document_id: id.into(),
        project_id: Some("project".into()),
        source_id: id.into(),
        source_hash: format!("hash-{id}"),
        text: text.into(),
        denied: false,
        sensitive: false,
    }
}

#[test]
fn privacy_precedes_remote_calls_and_local_index_recovers_from_corruption() {
    struct Remote {
        calls: Cell<usize>,
    }
    impl EmbeddingProvider for Remote {
        fn identity(&self) -> ProviderIdentity {
            ProviderIdentity {
                provider: "remote".into(),
                model: "model-1".into(),
                dimension: 2,
                remote: true,
                normalization_version: "1".into(),
                chunking_version: "1".into(),
            }
        }

        fn embed(&self, inputs: &[EmbeddingInput]) -> Result<Vec<Embedding>, SemanticError> {
            self.calls.set(self.calls.get() + 1);
            Ok(inputs
                .iter()
                .map(|input| Embedding {
                    candidate_id: input.candidate_id.clone(),
                    values: vec![1.0, 0.0],
                })
                .collect())
        }
    }

    let remote = Remote {
        calls: Cell::new(0),
    };
    let mut sensitive = input("secret", "private");
    sensitive.sensitive = true;
    let blocked = embed_with_policy(
        &remote,
        SemanticPrivacy {
            enabled: true,
            allow_remote: false,
            offline: false,
        },
        vec![sensitive],
    )
    .expect("privacy result");
    assert!(blocked.records.is_empty());
    assert_eq!(remote.calls.get(), 0);
    assert_eq!(
        blocked.exclusions[0].reason,
        "semantic.remote_consent_required"
    );

    let local = TokenHashEmbedding { dimension: 8 };
    let batch = embed_with_policy(
        &local,
        SemanticPrivacy {
            enabled: true,
            allow_remote: false,
            offline: true,
        },
        vec![input("car", "car vehicle garage")],
    )
    .expect("local embedding");
    let mut index = InMemoryVectorIndex::default();
    index.replace(batch.records.clone()).expect("index");
    assert!(index.health(&local.identity()).healthy);
    let mut changed_provider = local.identity();
    changed_provider.model = "fnv1a-v2".into();
    assert_eq!(
        index.health(&changed_provider).reason.as_deref(),
        Some("semantic.provider_changed")
    );
    assert_eq!(index.invalidate_source("car", "changed"), 1);

    index.load(
        vec![VectorRecord {
            values: vec![f32::NAN],
            ..batch.records[0].clone()
        }],
        8,
    );
    assert_eq!(
        index.health(&local.identity()).reason.as_deref(),
        Some("semantic.index_corrupt")
    );
    assert_eq!(
        index.search(&[0.0; 8], &local.identity(), 10),
        Err(SemanticError {
            code: "semantic.index_corrupt".into()
        })
    );
    index.clear();
    assert!(index.health(&local.identity()).healthy);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationSet {
    version: u32,
    target_hybrid_recall_at_one: f32,
    cases: Vec<EvaluationCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationCase {
    expected_id: String,
    lexical: Vec<LexicalCandidate>,
    semantic: Vec<SemanticMatchFixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticMatchFixture {
    candidate_id: String,
    document_id: String,
    project_id: Option<String>,
    score: u32,
}

#[test]
fn hybrid_ranking_is_deterministic_and_meets_the_versioned_fixture_target() {
    let evaluation: EvaluationSet =
        serde_json::from_str(include_str!("../../../fixtures/semantic/retrieval-v1.json"))
            .expect("evaluation fixture");
    assert_eq!(evaluation.version, 1);
    let total = evaluation.cases.len() as f32;
    let mut lexical_hits = 0;
    let mut hybrid_hits = 0;
    for case in evaluation.cases {
        let lexical = hybrid_rank(case.lexical.clone(), None, 10);
        lexical_hits += usize::from(
            lexical.candidates.first().map(|item| &item.candidate_id) == Some(&case.expected_id),
        );
        let semantic = SemanticCandidates {
            matches: case
                .semantic
                .into_iter()
                .map(|item| SemanticMatch {
                    candidate_id: item.candidate_id,
                    document_id: item.document_id,
                    project_id: item.project_id,
                    score: item.score,
                })
                .collect(),
            provider: "recorded-local-v1".into(),
            privacy_status: "local_only".into(),
        };
        let first = hybrid_rank(case.lexical.clone(), Some(Ok(semantic.clone())), 10);
        let second = hybrid_rank(case.lexical, Some(Ok(semantic)), 10);
        assert_eq!(first, second);
        hybrid_hits += usize::from(
            first.candidates.first().map(|item| &item.candidate_id) == Some(&case.expected_id),
        );
        assert_eq!(
            first.candidates[0].explanation.semantic_provider.as_deref(),
            Some("recorded-local-v1")
        );
    }
    let hybrid_recall = hybrid_hits as f32 / total;
    assert!(hybrid_recall >= evaluation.target_hybrid_recall_at_one);
    assert!(hybrid_hits >= lexical_hits);
}

#[test]
fn semantic_failure_preserves_deterministic_results() {
    let lexical = vec![LexicalCandidate {
        candidate_id: "exact".into(),
        document_id: "doc".into(),
        project_id: None,
        score: 900,
        reasons: vec!["search.exact".into()],
    }];
    let fallback = hybrid_rank(
        lexical.clone(),
        Some(Err(SemanticError {
            code: "semantic.offline".into(),
        })),
        10,
    );
    let deterministic = hybrid_rank(lexical, None, 10);
    assert_eq!(
        fallback
            .candidates
            .iter()
            .map(|item| (&item.candidate_id, item.score))
            .collect::<Vec<_>>(),
        deterministic
            .candidates
            .iter()
            .map(|item| (&item.candidate_id, item.score))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        fallback.fallback_reason.as_deref(),
        Some("semantic.offline")
    );
}
