use crate::knowledge::parser::Authority;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path};

pub const HARD_CONTEXT_LIMIT: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextRequest {
    pub workspace_id: String,
    pub objective: String,
    pub primary_project_ids: Vec<String>,
    pub secondary_project_ids: Vec<String>,
    pub selected_ids: Vec<String>,
    pub requested_action: Option<String>,
    pub expected_output: Option<String>,
    pub include_historical: bool,
    pub include_inferred: bool,
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadPolicy {
    pub readable_roots: Vec<String>,
    pub agent_ignored_roots: Vec<String>,
    pub sensitive_roots: Vec<String>,
    pub allow_provider_data: bool,
    pub allow_inferred_data: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextKind {
    ProjectCard,
    Decision,
    Task,
    SelectedItem,
    File,
    Chunk,
    Graph,
    RecentChange,
    PriorSessionSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextCandidate {
    pub id: String,
    pub source_id: String,
    pub workspace_id: String,
    pub project_id: Option<String>,
    pub relative_path: Option<String>,
    pub kind: ContextKind,
    pub authority: Authority,
    pub content: Option<String>,
    pub base_score: u32,
    pub active: bool,
    pub historical: bool,
    pub inferred: bool,
    pub provider_data: bool,
    pub unresolved_contradiction: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RankedContextCandidate {
    pub candidate: ContextCandidate,
    pub score: u32,
    pub required: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextExclusion {
    pub candidate_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextRetrieval {
    pub candidates: Vec<RankedContextCandidate>,
    pub exclusions: Vec<ContextExclusion>,
}

pub fn validate_context_request(request: &ContextRequest) -> Result<(), &'static str> {
    if request.workspace_id.trim().is_empty() {
        return Err("context.workspace_required");
    }
    if request.objective.trim().is_empty() {
        return Err("context.objective_required");
    }
    if request
        .primary_project_ids
        .iter()
        .any(|project| request.secondary_project_ids.contains(project))
    {
        return Err("context.project_scope_overlap");
    }
    Ok(())
}

pub fn retrieve_context(
    request: &ContextRequest,
    policy: &ReadPolicy,
    candidates: Vec<ContextCandidate>,
) -> ContextRetrieval {
    let selected = request.selected_ids.iter().collect::<BTreeSet<_>>();
    let primary = request.primary_project_ids.iter().collect::<BTreeSet<_>>();
    let secondary = request
        .secondary_project_ids
        .iter()
        .collect::<BTreeSet<_>>();
    let mut allowed = Vec::new();
    let mut exclusions = Vec::new();

    for candidate in candidates {
        let is_selected = selected.contains(&candidate.id);
        if let Some(reason) = exclusion_reason(
            &candidate,
            request,
            policy,
            &primary,
            &secondary,
            is_selected,
        ) {
            exclusions.push(ContextExclusion {
                candidate_id: candidate.id,
                reason: reason.to_owned(),
            });
            continue;
        }

        let required = is_selected
            || candidate.unresolved_contradiction
            || (candidate.active
                && matches!(
                    candidate.kind,
                    ContextKind::ProjectCard | ContextKind::Decision | ContextKind::Task
                ));
        let mut reasons = Vec::new();
        if is_selected {
            reasons.push("context.explicit_selection".to_owned());
        }
        if candidate.unresolved_contradiction {
            reasons.push("context.unresolved_contradiction".to_owned());
        }
        if candidate.active {
            reasons.push("context.current".to_owned());
        } else if candidate.historical {
            reasons.push("context.historical".to_owned());
        }
        reasons.push(
            match candidate.authority {
                Authority::ExplicitUser | Authority::ExplicitFile => "context.explicit_authority",
                Authority::ProviderAuthoritative => "context.provider_authority",
                Authority::AgentConfirmed => "context.agent_confirmed",
                Authority::ModelInferred | Authority::HeuristicInferred => "context.inferred",
            }
            .to_owned(),
        );
        reasons.push(
            match candidate.kind {
                ContextKind::ProjectCard => "context.project_card",
                ContextKind::Decision => "context.decision",
                ContextKind::Task => "context.task",
                ContextKind::SelectedItem => "context.selected_item",
                ContextKind::File => "context.file",
                ContextKind::Chunk => "context.chunk",
                ContextKind::Graph => "context.graph",
                ContextKind::RecentChange => "context.recent_change",
                ContextKind::PriorSessionSummary => "context.prior_session_summary",
            }
            .to_owned(),
        );

        let score = candidate
            .base_score
            .saturating_add(authority_score(candidate.authority))
            .saturating_add(u32::from(candidate.active) * 10_000)
            .saturating_add(u32::from(candidate.unresolved_contradiction) * 20_000)
            .saturating_add(u32::from(is_selected) * 1_000_000)
            .saturating_add(kind_score(candidate.kind));
        allowed.push(RankedContextCandidate {
            candidate,
            score,
            required,
            reasons,
        });
    }

    allowed.sort_by(|left, right| {
        right
            .required
            .cmp(&left.required)
            .then_with(|| right.score.cmp(&left.score))
            .then_with(|| left.candidate.id.cmp(&right.candidate.id))
    });
    exclusions.sort_by(|left, right| left.candidate_id.cmp(&right.candidate_id));

    let mut source_counts = BTreeMap::<String, usize>::new();
    let mut ranked = Vec::new();
    let limit = request.limit.min(HARD_CONTEXT_LIMIT);
    for candidate in allowed {
        if ranked.len() >= limit {
            exclusions.push(ContextExclusion {
                candidate_id: candidate.candidate.id,
                reason: "context.limit".to_owned(),
            });
            continue;
        }
        let count = source_counts
            .entry(candidate.candidate.source_id.clone())
            .or_default();
        if !candidate.required && *count >= 2 {
            exclusions.push(ContextExclusion {
                candidate_id: candidate.candidate.id,
                reason: "context.source_diversity".to_owned(),
            });
            continue;
        }
        *count += 1;
        ranked.push(candidate);
    }
    exclusions.sort_by(|left, right| left.candidate_id.cmp(&right.candidate_id));
    ContextRetrieval {
        candidates: ranked,
        exclusions,
    }
}

fn exclusion_reason(
    candidate: &ContextCandidate,
    request: &ContextRequest,
    policy: &ReadPolicy,
    primary: &BTreeSet<&String>,
    secondary: &BTreeSet<&String>,
    selected: bool,
) -> Option<&'static str> {
    if candidate.workspace_id != request.workspace_id {
        return Some("context.workspace_denied");
    }
    if let Some(path) = candidate.relative_path.as_deref() {
        if !valid_relative(path) || !within_any(path, &policy.readable_roots) {
            return Some("context.path_denied");
        }
        if within_any(path, &policy.agent_ignored_roots) {
            return Some("context.agent_ignored");
        }
        if within_any(path, &policy.sensitive_roots) {
            return Some("context.sensitive");
        }
    }
    if candidate.provider_data && !policy.allow_provider_data {
        return Some("context.provider_denied");
    }
    let inferred = candidate.inferred
        || matches!(
            candidate.authority,
            Authority::ModelInferred | Authority::HeuristicInferred
        );
    if inferred && (!policy.allow_inferred_data || !request.include_inferred) {
        return Some("context.inferred_denied");
    }
    if candidate.historical && !request.include_historical {
        return Some("context.historical_denied");
    }
    if let Some(project) = candidate.project_id.as_ref() {
        if selected {
            return None;
        }
        if primary.contains(project) {
            return None;
        }
        if secondary.contains(project) {
            return (!matches!(candidate.kind, ContextKind::ProjectCard))
                .then_some("context.cross_project_card_only");
        }
        return Some("context.unrelated_project");
    }
    if !primary.is_empty() && !selected {
        return Some("context.unrelated_project");
    }
    None
}

fn valid_relative(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn within_any(path: &str, roots: &[String]) -> bool {
    roots.iter().any(|root| {
        root == "."
            || (valid_relative(root)
                && (Path::new(path) == Path::new(root)
                    || Path::new(path).starts_with(Path::new(root))))
    })
}

fn authority_score(authority: Authority) -> u32 {
    match authority {
        Authority::ExplicitUser => 6_000,
        Authority::ExplicitFile => 5_000,
        Authority::ProviderAuthoritative => 4_000,
        Authority::AgentConfirmed => 3_000,
        Authority::ModelInferred => 2_000,
        Authority::HeuristicInferred => 1_000,
    }
}

fn kind_score(kind: ContextKind) -> u32 {
    match kind {
        ContextKind::ProjectCard => 900,
        ContextKind::Decision => 800,
        ContextKind::Task => 700,
        ContextKind::SelectedItem => 600,
        ContextKind::File => 500,
        ContextKind::Chunk => 400,
        ContextKind::Graph => 300,
        ContextKind::RecentChange => 200,
        ContextKind::PriorSessionSummary => 100,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ContextRequest {
        ContextRequest {
            workspace_id: "ws".to_owned(),
            objective: "Review indexing".to_owned(),
            primary_project_ids: vec!["primary".to_owned()],
            secondary_project_ids: vec!["secondary".to_owned()],
            selected_ids: vec!["denied".to_owned()],
            requested_action: None,
            expected_output: None,
            include_historical: false,
            include_inferred: false,
            limit: 10,
        }
    }

    fn candidate(id: &str, path: &str, kind: ContextKind) -> ContextCandidate {
        ContextCandidate {
            id: id.to_owned(),
            source_id: id.to_owned(),
            workspace_id: "ws".to_owned(),
            project_id: Some("primary".to_owned()),
            relative_path: Some(path.to_owned()),
            kind,
            authority: Authority::ExplicitFile,
            content: Some(format!("content for {id}")),
            base_score: 1,
            active: true,
            historical: false,
            inferred: false,
            provider_data: false,
            unresolved_contradiction: false,
        }
    }

    #[test]
    fn applies_policy_before_selected_priority_without_leaking_content() {
        assert_eq!(validate_context_request(&request()), Ok(()));
        let policy = ReadPolicy {
            readable_roots: vec!["notes".to_owned()],
            agent_ignored_roots: vec!["notes/private".to_owned()],
            sensitive_roots: Vec::new(),
            allow_provider_data: false,
            allow_inferred_data: false,
        };
        let denied = candidate("denied", "notes/private/secret.md", ContextKind::File);
        let allowed = candidate("allowed", "notes/current.md", ContextKind::Decision);
        let result = retrieve_context(&request(), &policy, vec![denied, allowed]);
        assert_eq!(result.candidates[0].candidate.id, "allowed");
        assert_eq!(result.exclusions[0].candidate_id, "denied");
        assert_eq!(result.exclusions[0].reason, "context.agent_ignored");
    }

    #[test]
    fn ranks_current_explicit_state_and_keeps_contradictions() {
        let policy = ReadPolicy {
            readable_roots: vec![".".to_owned()],
            agent_ignored_roots: Vec::new(),
            sensitive_roots: Vec::new(),
            allow_provider_data: true,
            allow_inferred_data: true,
        };
        let mut inferred = candidate("inferred", "a.md", ContextKind::Decision);
        inferred.authority = Authority::ModelInferred;
        inferred.inferred = true;
        let mut contradiction = candidate("contradiction", "b.md", ContextKind::Decision);
        contradiction.unresolved_contradiction = true;
        let mut request = request();
        request.include_inferred = true;
        let result = retrieve_context(&request, &policy, vec![inferred, contradiction]);
        assert_eq!(result.candidates[0].candidate.id, "contradiction");
        assert!(
            result.candidates[0]
                .reasons
                .contains(&"context.unresolved_contradiction".to_owned())
        );
    }

    #[test]
    fn secondary_projects_begin_with_cards_only() {
        let policy = ReadPolicy {
            readable_roots: vec![".".to_owned()],
            agent_ignored_roots: Vec::new(),
            sensitive_roots: Vec::new(),
            allow_provider_data: true,
            allow_inferred_data: true,
        };
        let mut card = candidate("card", "card.md", ContextKind::ProjectCard);
        card.project_id = Some("secondary".to_owned());
        let mut file = candidate("file", "file.md", ContextKind::File);
        file.project_id = Some("secondary".to_owned());
        let result = retrieve_context(&request(), &policy, vec![file, card]);
        assert_eq!(result.candidates[0].candidate.id, "card");
        assert_eq!(
            result.exclusions[0].reason,
            "context.cross_project_card_only"
        );
    }
}
