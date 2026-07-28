use crate::knowledge::parser::Authority;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const DEFAULT_NODE_LIMIT: usize = 100;
pub const HARD_NODE_LIMIT: usize = 750;
pub const DEFAULT_EDGE_LIMIT: usize = 300;
pub const HARD_EDGE_LIMIT: usize = 3_000;
pub const HARD_DEPTH: u8 = 3;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceReference {
    pub source_id: String,
    pub relative_path: Option<String>,
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub node_type: String,
    pub workspace_id: String,
    pub project_id: Option<String>,
    pub label: String,
    pub authority: Authority,
    pub confidence: u16,
    pub relevance: u16,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub deleted_at: Option<String>,
    pub sources: Vec<SourceReference>,
    pub layout_hint: Option<(i32, i32)>,
    pub context_candidate_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub edge_type: String,
    pub authority: Authority,
    pub confidence: u16,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub deleted_at: Option<String>,
    pub sources: Vec<SourceReference>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphQuery {
    pub start_node_ids: Vec<String>,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub node_types: Vec<String>,
    pub edge_types: Vec<String>,
    pub depth: u8,
    pub node_limit: usize,
    pub edge_limit: usize,
    pub include_inferred: bool,
    pub at: Option<String>,
    pub continuation: usize,
}

impl Default for GraphQuery {
    fn default() -> Self {
        Self {
            start_node_ids: Vec::new(),
            workspace_id: None,
            project_id: None,
            node_types: Vec::new(),
            edge_types: Vec::new(),
            depth: 1,
            node_limit: DEFAULT_NODE_LIMIT,
            edge_limit: DEFAULT_EDGE_LIMIT,
            include_inferred: false,
            at: None,
            continuation: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub truncated: bool,
    pub next_continuation: Option<usize>,
    pub warnings: Vec<String>,
}

pub fn query_graph(nodes: &[GraphNode], edges: &[GraphEdge], query: &GraphQuery) -> GraphResponse {
    let node_limit = query.node_limit.clamp(1, HARD_NODE_LIMIT);
    let edge_limit = query.edge_limit.clamp(1, HARD_EDGE_LIMIT);
    let mut warnings = Vec::new();
    if query.node_limit > HARD_NODE_LIMIT {
        warnings.push("graph.node_limit_clamped".to_owned());
    }
    if query.edge_limit > HARD_EDGE_LIMIT {
        warnings.push("graph.edge_limit_clamped".to_owned());
    }
    let depth = query.depth.min(HARD_DEPTH);
    if query.depth > HARD_DEPTH {
        warnings.push("graph.depth_clamped".to_owned());
    }

    let eligible = nodes
        .iter()
        .filter(|node| eligible_node(node, query))
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();
    let eligible_edges = edges
        .iter()
        .filter(|edge| {
            eligible.contains_key(edge.from.as_str())
                && eligible.contains_key(edge.to.as_str())
                && eligible_edge(edge, query)
        })
        .collect::<Vec<_>>();

    let requested_starts = query
        .start_node_ids
        .iter()
        .filter(|id| eligible.contains_key(id.as_str()))
        .cloned()
        .collect::<BTreeSet<_>>();
    let starts = requested_starts
        .iter()
        .take(node_limit)
        .cloned()
        .collect::<BTreeSet<_>>();
    if starts.len() < requested_starts.len() {
        warnings.push("graph.start_nodes_truncated".to_owned());
    }
    let mut reached = starts.clone();
    let mut frontier = starts.clone();
    if starts.is_empty() && query.start_node_ids.is_empty() {
        reached.extend(eligible.keys().map(|id| (*id).to_owned()));
    } else {
        for _ in 0..depth {
            let mut next = BTreeSet::new();
            for edge in &eligible_edges {
                if frontier.contains(&edge.from) {
                    next.insert(edge.to.clone());
                }
                if frontier.contains(&edge.to) {
                    next.insert(edge.from.clone());
                }
            }
            next.retain(|id| !reached.contains(id));
            if next.is_empty() {
                break;
            }
            reached.extend(next.iter().cloned());
            frontier = next;
        }
    }

    let mut neighbors = reached
        .difference(&starts)
        .filter_map(|id| eligible.get(id.as_str()).copied())
        .collect::<Vec<_>>();
    neighbors.sort_by(|left, right| {
        authority_score(right.authority)
            .cmp(&authority_score(left.authority))
            .then_with(|| right.confidence.cmp(&left.confidence))
            .then_with(|| right.relevance.cmp(&left.relevance))
            .then_with(|| left.id.cmp(&right.id))
    });

    let selected_neighbor_count = node_limit.saturating_sub(starts.len());
    let selected_neighbors = neighbors
        .iter()
        .skip(query.continuation)
        .take(selected_neighbor_count)
        .map(|node| node.id.clone())
        .collect::<BTreeSet<_>>();
    if selected_neighbor_count == 0 && !neighbors.is_empty() {
        warnings.push("graph.node_limit_has_no_expansion_capacity".to_owned());
    }
    let selected_ids = starts
        .union(&selected_neighbors)
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut selected_nodes = selected_ids
        .iter()
        .filter_map(|id| eligible.get(id.as_str()).map(|node| (*node).clone()))
        .collect::<Vec<_>>();
    selected_nodes.sort_by(|left, right| left.id.cmp(&right.id));

    let mut selected_edges = eligible_edges
        .into_iter()
        .filter(|edge| selected_ids.contains(&edge.from) && selected_ids.contains(&edge.to))
        .cloned()
        .collect::<Vec<_>>();
    selected_edges.sort_by(|left, right| {
        authority_score(right.authority)
            .cmp(&authority_score(left.authority))
            .then_with(|| right.confidence.cmp(&left.confidence))
            .then_with(|| left.id.cmp(&right.id))
    });

    let more_nodes = query.continuation + selected_neighbors.len() < neighbors.len();
    let more_edges = selected_edges.len() > edge_limit;
    if more_edges {
        warnings.push("graph.edge_limit_reached".to_owned());
    }
    selected_edges.truncate(edge_limit);
    GraphResponse {
        nodes: selected_nodes,
        edges: selected_edges,
        truncated: more_nodes || more_edges,
        next_continuation: (more_nodes && !selected_neighbors.is_empty())
            .then_some(query.continuation + selected_neighbors.len()),
        warnings,
    }
}

pub fn expand_one_hop(
    nodes: &[GraphNode],
    edges: &[GraphEdge],
    start_node_ids: Vec<String>,
    continuation: usize,
    limit: usize,
) -> GraphResponse {
    query_graph(
        nodes,
        edges,
        &GraphQuery {
            start_node_ids,
            depth: 1,
            node_limit: limit,
            continuation,
            ..GraphQuery::default()
        },
    )
}

fn eligible_node(node: &GraphNode, query: &GraphQuery) -> bool {
    node.deleted_at.is_none()
        && (query.include_inferred || !inferred(node.authority))
        && query
            .workspace_id
            .as_ref()
            .is_none_or(|workspace| workspace == &node.workspace_id)
        && query
            .project_id
            .as_ref()
            .is_none_or(|project| node.project_id.as_ref() == Some(project))
        && (query.node_types.is_empty() || query.node_types.contains(&node.node_type))
        && current_at(
            node.valid_from.as_deref(),
            node.valid_to.as_deref(),
            query.at.as_deref(),
        )
}

fn eligible_edge(edge: &GraphEdge, query: &GraphQuery) -> bool {
    edge.deleted_at.is_none()
        && !edge.sources.is_empty()
        && (query.include_inferred || !inferred(edge.authority))
        && (query.edge_types.is_empty() || query.edge_types.contains(&edge.edge_type))
        && current_at(
            edge.valid_from.as_deref(),
            edge.valid_to.as_deref(),
            query.at.as_deref(),
        )
}

fn current_at(valid_from: Option<&str>, valid_to: Option<&str>, at: Option<&str>) -> bool {
    match at {
        Some(at) => valid_from.is_none_or(|from| from <= at) && valid_to.is_none_or(|to| at < to),
        None => valid_to.is_none(),
    }
}

fn inferred(authority: Authority) -> bool {
    matches!(
        authority,
        Authority::HeuristicInferred | Authority::ModelInferred
    )
}

fn authority_score(authority: Authority) -> u8 {
    match authority {
        Authority::ExplicitUser => 6,
        Authority::ExplicitFile => 5,
        Authority::ProviderAuthoritative => 4,
        Authority::AgentConfirmed => 3,
        Authority::ModelInferred => 2,
        Authority::HeuristicInferred => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, authority: Authority) -> GraphNode {
        GraphNode {
            id: id.to_owned(),
            node_type: "Document".to_owned(),
            workspace_id: "ws".to_owned(),
            project_id: Some("project".to_owned()),
            label: id.to_owned(),
            authority,
            confidence: 900,
            relevance: 500,
            valid_from: None,
            valid_to: None,
            deleted_at: None,
            sources: Vec::new(),
            layout_hint: None,
            context_candidate_id: Some(id.to_owned()),
        }
    }

    fn edge(id: &str, from: &str, to: &str) -> GraphEdge {
        GraphEdge {
            id: id.to_owned(),
            from: from.to_owned(),
            to: to.to_owned(),
            edge_type: "LINKS_TO".to_owned(),
            authority: Authority::ExplicitFile,
            confidence: 900,
            valid_from: None,
            valid_to: None,
            deleted_at: None,
            sources: vec![SourceReference {
                source_id: "source".to_owned(),
                relative_path: Some("note.md".to_owned()),
                start_line: Some(1),
                end_line: Some(1),
            }],
        }
    }

    #[test]
    fn query_is_bounded_current_and_provenance_aware() {
        let nodes = vec![
            node("a", Authority::ExplicitFile),
            node("b", Authority::ExplicitFile),
            node("c", Authority::ModelInferred),
        ];
        let edges = vec![edge("ab", "a", "b"), edge("ac", "a", "c")];
        let response = query_graph(
            &nodes,
            &edges,
            &GraphQuery {
                start_node_ids: vec!["a".to_owned()],
                node_limit: 2,
                ..GraphQuery::default()
            },
        );
        assert_eq!(
            response
                .nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert_eq!(response.edges[0].sources[0].source_id, "source");
    }

    #[test]
    fn continuation_is_stable_for_high_degree_nodes() {
        let nodes = vec![
            node("root", Authority::ExplicitFile),
            node("a", Authority::ExplicitFile),
            node("b", Authority::ExplicitFile),
            node("c", Authority::ExplicitFile),
        ];
        let edges = vec![
            edge("ra", "root", "a"),
            edge("rb", "root", "b"),
            edge("rc", "root", "c"),
        ];
        let first = expand_one_hop(&nodes, &edges, vec!["root".to_owned()], 0, 2);
        let second = expand_one_hop(
            &nodes,
            &edges,
            vec!["root".to_owned()],
            first.next_continuation.unwrap(),
            2,
        );
        assert_eq!(first.nodes[0].id, "a");
        assert_eq!(second.nodes[0].id, "b");
    }
}
