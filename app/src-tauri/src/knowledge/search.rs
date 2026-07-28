use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const SCORE_SCALE: u32 = 1_000;
pub const HARD_SEARCH_LIMIT: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchPlan {
    pub terms: Vec<String>,
    pub filters: Vec<SearchFilter>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchFilter {
    pub field: FilterField,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterField {
    Type,
    Project,
    Workspace,
    Status,
    Date,
    Tag,
    Inferred,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueryParseError {
    pub code: String,
    pub offset: usize,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComponentScores {
    pub exact: u32,
    pub title: u32,
    pub text: u32,
    pub metadata: u32,
    pub graph: u32,
    pub recency: u32,
    pub pinned: u32,
    pub authority: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchCandidate {
    pub id: String,
    pub document_id: String,
    pub project_id: Option<String>,
    pub heading: Option<String>,
    pub source_type: String,
    pub scores: ComponentScores,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RankedSearchCandidate {
    pub candidate: SearchCandidate,
    pub score: u32,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiversityLimits {
    pub per_document: usize,
    pub per_project: usize,
    pub per_heading: usize,
    pub per_source_type: usize,
}

impl Default for DiversityLimits {
    fn default() -> Self {
        Self {
            per_document: 2,
            per_project: 4,
            per_heading: 2,
            per_source_type: 8,
        }
    }
}

pub fn parse_query(input: &str) -> Result<SearchPlan, QueryParseError> {
    let tokens = tokenize(input)?;
    let mut plan = SearchPlan {
        terms: Vec::new(),
        filters: Vec::new(),
    };
    for (token, offset, filter_colon) in tokens {
        if let Some(colon) = filter_colon {
            let field_name = &token[..colon];
            let value = &token[colon + 1..];
            let Some(field) = parse_field(field_name) else {
                return Err(QueryParseError {
                    code: "search.unknown_filter".to_owned(),
                    offset,
                    message: format!("Unknown search filter `{field_name}`."),
                });
            };
            if value.is_empty() {
                return Err(QueryParseError {
                    code: "search.empty_filter".to_owned(),
                    offset,
                    message: format!("Search filter `{field_name}` needs a value."),
                });
            }
            plan.filters.push(SearchFilter {
                field,
                value: value.to_owned(),
            });
        } else {
            plan.terms.push(token);
        }
    }
    Ok(plan)
}

pub fn rank_candidates(
    candidates: Vec<SearchCandidate>,
    limit: usize,
    diversity: DiversityLimits,
) -> Vec<RankedSearchCandidate> {
    rank_candidates_page(candidates, 0, limit, diversity)
}

pub fn rank_candidates_page(
    candidates: Vec<SearchCandidate>,
    offset: usize,
    limit: usize,
    diversity: DiversityLimits,
) -> Vec<RankedSearchCandidate> {
    let maxima = maxima(&candidates);
    let mut ranked = candidates
        .into_iter()
        .map(|candidate| {
            let scores = &candidate.scores;
            let parts = [
                ("search.exact", scores.exact, maxima.exact, 28),
                ("search.title", scores.title, maxima.title, 20),
                ("search.text", scores.text, maxima.text, 20),
                ("search.metadata", scores.metadata, maxima.metadata, 10),
                ("search.graph", scores.graph, maxima.graph, 8),
                ("search.recency", scores.recency, maxima.recency, 5),
                ("search.pinned", scores.pinned, maxima.pinned, 5),
                ("search.authority", scores.authority, maxima.authority, 4),
            ];
            let score = parts
                .iter()
                .map(|(_, value, max, weight)| normalize(*value, *max) * weight)
                .sum::<u32>()
                / 100;
            let reasons = parts
                .iter()
                .filter(|(_, value, _, _)| *value > 0)
                .map(|(reason, _, _, _)| (*reason).to_owned())
                .collect();
            RankedSearchCandidate {
                candidate,
                score,
                reasons,
            }
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.candidate.id.cmp(&right.candidate.id))
    });

    let mut documents = BTreeMap::new();
    let mut projects = BTreeMap::new();
    let mut headings = BTreeMap::new();
    let mut source_types = BTreeMap::new();
    ranked
        .into_iter()
        .filter(|item| {
            let document = item.candidate.document_id.as_str();
            let project = item.candidate.project_id.as_deref();
            let heading = item
                .candidate
                .heading
                .as_ref()
                .map(|heading| format!("{document}\0{heading}"));
            let source_type = item.candidate.source_type.as_str();
            if !below(&documents, document, diversity.per_document)
                || project.is_some_and(|key| !below(&projects, key, diversity.per_project))
                || heading
                    .as_deref()
                    .is_some_and(|key| !below(&headings, key, diversity.per_heading))
                || !below(&source_types, source_type, diversity.per_source_type)
            {
                return false;
            }
            increment(&mut documents, document);
            if let Some(project) = project {
                increment(&mut projects, project);
            }
            if let Some(heading) = heading {
                increment(&mut headings, &heading);
            }
            increment(&mut source_types, source_type);
            true
        })
        .skip(offset)
        .take(limit.min(HARD_SEARCH_LIMIT))
        .collect()
}

fn tokenize(input: &str) -> Result<Vec<(String, usize, Option<usize>)>, QueryParseError> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut start = 0;
    let mut filter_colon = None;
    let mut quoted = false;
    let mut escaped = false;
    for (offset, character) in input.char_indices() {
        if escaped {
            current.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' {
            quoted = !quoted;
        } else if character.is_whitespace() && !quoted {
            if !current.is_empty() {
                tokens.push((std::mem::take(&mut current), start, filter_colon.take()));
            }
        } else {
            if current.is_empty() {
                start = offset;
            }
            if character == ':' && !quoted && filter_colon.is_none() {
                filter_colon = Some(current.len());
            }
            current.push(character);
        }
    }
    if escaped || quoted {
        return Err(QueryParseError {
            code: if escaped {
                "search.trailing_escape"
            } else {
                "search.unclosed_quote"
            }
            .to_owned(),
            offset: input.len(),
            message: if escaped {
                "Search query ends with an escape character.".to_owned()
            } else {
                "Search query has an unclosed quote.".to_owned()
            },
        });
    }
    if !current.is_empty() {
        tokens.push((current, start, filter_colon));
    }
    Ok(tokens)
}

fn parse_field(value: &str) -> Option<FilterField> {
    match value {
        "type" => Some(FilterField::Type),
        "project" => Some(FilterField::Project),
        "workspace" => Some(FilterField::Workspace),
        "status" => Some(FilterField::Status),
        "date" => Some(FilterField::Date),
        "tag" => Some(FilterField::Tag),
        "inferred" => Some(FilterField::Inferred),
        _ => None,
    }
}

fn normalize(value: u32, max: u32) -> u32 {
    if max == 0 {
        0
    } else {
        value.saturating_mul(SCORE_SCALE) / max
    }
}

fn maxima(candidates: &[SearchCandidate]) -> ComponentScores {
    candidates
        .iter()
        .fold(ComponentScores::default(), |mut max, candidate| {
            let score = &candidate.scores;
            max.exact = max.exact.max(score.exact);
            max.title = max.title.max(score.title);
            max.text = max.text.max(score.text);
            max.metadata = max.metadata.max(score.metadata);
            max.graph = max.graph.max(score.graph);
            max.recency = max.recency.max(score.recency);
            max.pinned = max.pinned.max(score.pinned);
            max.authority = max.authority.max(score.authority);
            max
        })
}

fn below(counts: &BTreeMap<String, usize>, key: &str, limit: usize) -> bool {
    counts.get(key).copied().unwrap_or_default() < limit
}

fn increment(counts: &mut BTreeMap<String, usize>, key: &str) {
    *counts.entry(key.to_owned()).or_default() += 1;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(id: &str, document: &str, exact: u32) -> SearchCandidate {
        SearchCandidate {
            id: id.to_owned(),
            document_id: document.to_owned(),
            project_id: Some("project".to_owned()),
            heading: Some("heading".to_owned()),
            source_type: "note".to_owned(),
            scores: ComponentScores {
                exact,
                text: 1,
                ..ComponentScores::default()
            },
        }
    }

    #[test]
    fn parses_quotes_escapes_and_filters() {
        let plan =
            parse_query(r#"project:"Second Brain" status:active café\ note literal\:colon "a:b""#)
                .unwrap();
        assert_eq!(plan.terms, ["café note", "literal:colon", "a:b"]);
        assert_eq!(
            plan.filters,
            [
                SearchFilter {
                    field: FilterField::Project,
                    value: "Second Brain".to_owned(),
                },
                SearchFilter {
                    field: FilterField::Status,
                    value: "active".to_owned(),
                }
            ]
        );
        assert_eq!(
            parse_query(r#"type:"note"#).unwrap_err().code,
            "search.unclosed_quote"
        );
    }

    #[test]
    fn ranking_is_stable_and_diverse() {
        let input = vec![
            candidate("b", "long", 10),
            candidate("a", "long", 10),
            candidate("c", "long", 10),
            candidate("d", "other", 9),
        ];
        let limits = DiversityLimits {
            per_document: 2,
            per_project: 10,
            per_heading: 10,
            per_source_type: 10,
        };
        let first = rank_candidates(input.clone(), 10, limits);
        let second = rank_candidates(input, 10, limits);
        assert_eq!(first, second);
        assert_eq!(
            first
                .iter()
                .map(|item| item.candidate.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b", "d"]
        );
    }
}
