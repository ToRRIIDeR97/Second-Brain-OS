use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const MARKDOWN_PARSER_VERSION: u32 = 1;
pub const CODE_PARSER_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Authority {
    ExplicitUser,
    ExplicitFile,
    ProviderAuthoritative,
    AgentConfirmed,
    ModelInferred,
    HeuristicInferred,
}

impl Authority {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ExplicitUser => "explicit_user",
            Self::ExplicitFile => "explicit_file",
            Self::ProviderAuthoritative => "provider_authoritative",
            Self::AgentConfirmed => "agent_confirmed",
            Self::ModelInferred => "model_inferred",
            Self::HeuristicInferred => "heuristic_inferred",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedChunk {
    pub chunk_id: String,
    pub kind: String,
    pub ordinal: u32,
    pub range: SourceRange,
    pub content: String,
    pub explicit_id: Option<String>,
    pub authority: Authority,
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedNode {
    pub node_id: String,
    pub node_type: String,
    pub label: String,
    pub source_chunk_id: Option<String>,
    pub range: SourceRange,
    pub authority: Authority,
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEdge {
    pub edge_id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub edge_type: String,
    pub source_chunk_id: String,
    pub authority: Authority,
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseDiagnostic {
    pub code: String,
    pub message: String,
    pub range: SourceRange,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    pub parser_name: String,
    pub parser_version: u32,
    pub document_id: String,
    pub revision_id: String,
    pub portable_id: Option<String>,
    pub workspace_id: String,
    pub relative_path: String,
    pub source_hash: String,
    pub language: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub chunks: Vec<ParsedChunk>,
    pub nodes: Vec<ParsedNode>,
    pub edges: Vec<ParsedEdge>,
    pub diagnostics: Vec<ParseDiagnostic>,
}

pub trait SourceParser: Send + Sync {
    fn supports(&self, relative_path: &str) -> bool;
    fn parse(&self, workspace_id: &str, relative_path: &str, source: &str) -> ParsedDocument;
}

#[derive(Default)]
pub struct ParserRegistry {
    parsers: Vec<Box<dyn SourceParser>>,
}

impl ParserRegistry {
    #[must_use]
    pub fn standard() -> Self {
        Self {
            parsers: vec![Box::new(MarkdownParser), Box::new(CodeParser)],
        }
    }

    pub fn parse(
        &self,
        workspace_id: &str,
        relative_path: &str,
        source: &str,
    ) -> Option<ParsedDocument> {
        self.parsers
            .iter()
            .find(|parser| parser.supports(relative_path))
            .map(|parser| parser.parse(workspace_id, relative_path, source))
    }
}

pub struct MarkdownParser;

impl SourceParser for MarkdownParser {
    fn supports(&self, relative_path: &str) -> bool {
        Path::new(relative_path)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    }

    fn parse(&self, workspace_id: &str, relative_path: &str, source: &str) -> ParsedDocument {
        parse_markdown(workspace_id, relative_path, source)
    }
}

pub struct CodeParser;

impl SourceParser for CodeParser {
    fn supports(&self, relative_path: &str) -> bool {
        code_language(relative_path).is_some()
    }

    fn parse(&self, workspace_id: &str, relative_path: &str, source: &str) -> ParsedDocument {
        parse_code(workspace_id, relative_path, source)
    }
}

#[derive(Debug)]
struct Block {
    kind: String,
    start: usize,
    end: usize,
    content: String,
    explicit_id: Option<String>,
}

#[must_use]
pub fn document_identity(
    workspace_id: &str,
    relative_path: &str,
    portable_id: Option<&str>,
) -> String {
    stable_id(
        "doc",
        &[
            workspace_id,
            portable_id.unwrap_or(relative_path),
            portable_id.map_or("path", |_| "portable"),
        ],
    )
}

#[must_use]
pub fn durable_identity(document_id: &str, explicit_id: &str) -> String {
    stable_id("chunk", &[document_id, "explicit", explicit_id])
}

#[must_use]
pub fn ordinary_chunk_identity(
    document_id: &str,
    kind: &str,
    content: &str,
    duplicate: usize,
) -> String {
    stable_id(
        "chunk",
        &[
            document_id,
            kind,
            &normalize_content(content),
            &duplicate.to_string(),
        ],
    )
}

fn parse_markdown(workspace_id: &str, relative_path: &str, source: &str) -> ParsedDocument {
    let source_hash = source_hash(source);
    let lines = source.lines().collect::<Vec<_>>();
    let (metadata, body_start, mut diagnostics) = parse_front_matter(&lines);
    let portable_id = metadata
        .get("document_id")
        .or_else(|| metadata.get("id"))
        .cloned();
    let document_id = document_identity(workspace_id, relative_path, portable_id.as_deref());
    let blocks = markdown_blocks(&lines, body_start, &mut diagnostics);
    let mut duplicate_ids = HashSet::new();
    let mut fingerprints = HashMap::<(String, String), usize>::new();
    let mut chunks = Vec::with_capacity(blocks.len());

    for (ordinal, block) in blocks.into_iter().enumerate() {
        let explicit_id = block.explicit_id.filter(|id| {
            if duplicate_ids.insert(id.clone()) {
                true
            } else {
                diagnostics.push(ParseDiagnostic {
                    code: "markdown.duplicate_explicit_id".into(),
                    message: format!("Duplicate explicit id `{id}` was treated as ordinary text."),
                    range: line_range(block.start, block.end),
                });
                false
            }
        });
        let chunk_id = if let Some(id) = explicit_id.as_deref() {
            durable_identity(&document_id, id)
        } else {
            let key = (block.kind.clone(), normalize_content(&block.content));
            let duplicate = fingerprints.entry(key).or_default();
            let id = ordinary_chunk_identity(&document_id, &block.kind, &block.content, *duplicate);
            *duplicate += 1;
            id
        };
        chunks.push(ParsedChunk {
            chunk_id,
            kind: block.kind,
            ordinal: ordinal as u32,
            range: line_range(block.start, block.end),
            content: block.content,
            explicit_id,
            authority: Authority::ExplicitFile,
            confidence: 1.0,
        });
    }

    let (nodes, edges) = graph_records(workspace_id, &document_id, &chunks);
    ParsedDocument {
        parser_name: "markdown-v1".into(),
        parser_version: MARKDOWN_PARSER_VERSION,
        revision_id: stable_id(
            "rev",
            &[
                &document_id,
                &source_hash,
                &MARKDOWN_PARSER_VERSION.to_string(),
            ],
        ),
        document_id,
        portable_id,
        workspace_id: workspace_id.into(),
        relative_path: relative_path.into(),
        source_hash,
        language: Some("markdown".into()),
        metadata,
        chunks,
        nodes,
        edges,
        diagnostics,
    }
}

fn parse_front_matter(lines: &[&str]) -> (BTreeMap<String, String>, usize, Vec<ParseDiagnostic>) {
    if lines.first().copied() != Some("---") {
        return (BTreeMap::new(), 0, Vec::new());
    }
    let Some(end) = lines.iter().skip(1).position(|line| *line == "---") else {
        return (
            BTreeMap::new(),
            0,
            vec![ParseDiagnostic {
                code: "markdown.front_matter_unclosed".into(),
                message: "Front matter has no closing delimiter.".into(),
                range: line_range(0, lines.len().saturating_sub(1)),
            }],
        );
    };
    let end = end + 1;
    let raw = lines[1..end].join("\n");
    match serde_yaml::from_str::<BTreeMap<String, serde_yaml::Value>>(&raw) {
        Ok(values) => {
            let metadata = values
                .into_iter()
                .map(|(key, value)| {
                    let value = value
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| serde_yaml::to_string(&value).unwrap_or_default());
                    (key, value.trim().to_owned())
                })
                .collect();
            (metadata, end + 1, Vec::new())
        }
        Err(error) => (
            BTreeMap::new(),
            end + 1,
            vec![ParseDiagnostic {
                code: "markdown.front_matter_invalid".into(),
                message: error.to_string(),
                range: line_range(0, end),
            }],
        ),
    }
}

fn markdown_blocks(
    lines: &[&str],
    mut index: usize,
    diagnostics: &mut Vec<ParseDiagnostic>,
) -> Vec<Block> {
    let mut blocks = Vec::new();
    while index < lines.len() {
        let line = lines[index];
        if line.trim().is_empty() {
            index += 1;
            continue;
        }
        if let Some(marker) = fence_marker(line) {
            let start = index;
            index += 1;
            while index < lines.len() && !lines[index].trim_start().starts_with(marker) {
                index += 1;
            }
            if index == lines.len() {
                diagnostics.push(ParseDiagnostic {
                    code: "markdown.fence_unclosed".into(),
                    message: "Code fence has no closing delimiter.".into(),
                    range: line_range(start, lines.len().saturating_sub(1)),
                });
                index = lines.len().saturating_sub(1);
            }
            blocks.push(block("code", start, index, lines));
            index += 1;
            continue;
        }
        if line.trim_start().starts_with(":::") {
            let start = index;
            let name = line
                .trim_start()
                .trim_start_matches(":::")
                .split(['{', ' '])
                .next()
                .unwrap_or("unknown");
            index += 1;
            while index < lines.len() && lines[index].trim() != ":::" {
                index += 1;
            }
            if index == lines.len() {
                diagnostics.push(ParseDiagnostic {
                    code: "markdown.directive_unclosed".into(),
                    message: format!("Directive `{name}` has no closing delimiter."),
                    range: line_range(start, lines.len().saturating_sub(1)),
                });
                index = lines.len().saturating_sub(1);
            }
            let mut value = block(&format!("directive:{name}"), start, index, lines);
            value.explicit_id = directive_attribute(line, "id");
            blocks.push(value);
            index += 1;
            continue;
        }
        if line.trim() == "$$" {
            let start = index;
            index += 1;
            while index < lines.len() && lines[index].trim() != "$$" {
                index += 1;
            }
            if index == lines.len() {
                diagnostics.push(ParseDiagnostic {
                    code: "markdown.math_unclosed".into(),
                    message: "Math block has no closing delimiter.".into(),
                    range: line_range(start, lines.len().saturating_sub(1)),
                });
                index = lines.len().saturating_sub(1);
            }
            blocks.push(block("math", start, index, lines));
            index += 1;
            continue;
        }

        let kind = if heading(line).is_some() {
            "heading"
        } else if is_task(line) {
            "task"
        } else if is_list(line) {
            "list"
        } else if line.trim_start().starts_with('|')
            && lines
                .get(index + 1)
                .is_some_and(|next| next.contains("---"))
        {
            "table"
        } else {
            "paragraph"
        };
        let start = index;
        index += 1;
        if kind == "table" {
            while index < lines.len() && lines[index].trim_start().starts_with('|') {
                index += 1;
            }
        } else if kind == "paragraph" {
            while index < lines.len()
                && !lines[index].trim().is_empty()
                && heading(lines[index]).is_none()
                && !is_task(lines[index])
                && !is_list(lines[index])
                && !lines[index].trim_start().starts_with(":::")
                && fence_marker(lines[index]).is_none()
            {
                index += 1;
            }
        }
        let mut value = block(kind, start, index.saturating_sub(1), lines);
        value.explicit_id = take_block_id(&mut value.content);
        blocks.push(value);
    }
    blocks
}

fn graph_records(
    workspace_id: &str,
    document_id: &str,
    chunks: &[ParsedChunk],
) -> (Vec<ParsedNode>, Vec<ParsedEdge>) {
    let document_node_id = stable_id("node", &[document_id, "Document"]);
    let first_line = chunks.first().map_or(1, |chunk| chunk.range.start_line);
    let last_line = chunks
        .last()
        .map_or(first_line, |chunk| chunk.range.end_line);
    let mut nodes = vec![ParsedNode {
        node_id: document_node_id.clone(),
        node_type: "Document".into(),
        label: document_id.into(),
        source_chunk_id: None,
        range: SourceRange {
            start_line: first_line,
            end_line: last_line,
        },
        authority: Authority::ExplicitFile,
        confidence: 1.0,
    }];
    let mut edges = Vec::new();
    let mut known_nodes = HashSet::from([document_node_id.clone()]);

    for chunk in chunks {
        let node_type = match chunk.kind.as_str() {
            "heading" => Some("Section"),
            "task" => Some("Task"),
            "directive:decision" => Some("Decision"),
            _ => None,
        };
        if let Some(node_type) = node_type {
            let node_id = stable_id("node", &[&chunk.chunk_id, node_type]);
            push_node(
                &mut nodes,
                &mut known_nodes,
                ParsedNode {
                    node_id: node_id.clone(),
                    node_type: node_type.into(),
                    label: clean_label(&chunk.content),
                    source_chunk_id: Some(chunk.chunk_id.clone()),
                    range: chunk.range.clone(),
                    authority: Authority::ExplicitFile,
                    confidence: 1.0,
                },
            );
            push_edge(
                &mut edges,
                document_node_id.clone(),
                node_id,
                if node_type == "Task" {
                    "HAS_TASK"
                } else if node_type == "Decision" {
                    "HAS_DECISION"
                } else {
                    "CONTAINS"
                },
                chunk,
            );
        }

        for target in delimited_values(&chunk.content, "[[", "]]") {
            let target = target
                .trim_start_matches('!')
                .split('#')
                .next()
                .unwrap_or("");
            if !target.is_empty() {
                add_reference(
                    workspace_id,
                    &mut nodes,
                    &mut edges,
                    &mut known_nodes,
                    &document_node_id,
                    "Concept",
                    target,
                    "LINKS_TO",
                    chunk,
                );
            }
        }
        for citation in delimited_values(&chunk.content, "[@", "]") {
            add_reference(
                workspace_id,
                &mut nodes,
                &mut edges,
                &mut known_nodes,
                &document_node_id,
                "Citation",
                citation,
                "CITES",
                chunk,
            );
        }
        for (prefix, node_type, edge_type) in
            [('#', "Concept", "RELATED_TO"), ('@', "Person", "MENTIONS")]
        {
            for value in prefixed_words(&chunk.content, prefix) {
                add_reference(
                    workspace_id,
                    &mut nodes,
                    &mut edges,
                    &mut known_nodes,
                    &document_node_id,
                    node_type,
                    &value,
                    edge_type,
                    chunk,
                );
            }
        }
        for asset in markdown_image_destinations(&chunk.content) {
            add_reference(
                workspace_id,
                &mut nodes,
                &mut edges,
                &mut known_nodes,
                &document_node_id,
                "Asset",
                &asset,
                "REFERENCES",
                chunk,
            );
        }
    }
    (nodes, edges)
}

#[allow(clippy::too_many_arguments)]
fn add_reference(
    workspace_id: &str,
    nodes: &mut Vec<ParsedNode>,
    edges: &mut Vec<ParsedEdge>,
    known_nodes: &mut HashSet<String>,
    document_node_id: &str,
    node_type: &str,
    label: &str,
    edge_type: &str,
    chunk: &ParsedChunk,
) {
    let node_id = stable_id("node", &[workspace_id, node_type, label]);
    push_node(
        nodes,
        known_nodes,
        ParsedNode {
            node_id: node_id.clone(),
            node_type: node_type.into(),
            label: label.into(),
            source_chunk_id: Some(chunk.chunk_id.clone()),
            range: chunk.range.clone(),
            authority: Authority::ExplicitFile,
            confidence: 1.0,
        },
    );
    push_edge(edges, document_node_id.into(), node_id, edge_type, chunk);
}

fn push_node(nodes: &mut Vec<ParsedNode>, known_nodes: &mut HashSet<String>, node: ParsedNode) {
    if known_nodes.insert(node.node_id.clone()) {
        nodes.push(node);
    }
}

fn push_edge(
    edges: &mut Vec<ParsedEdge>,
    source: String,
    target: String,
    edge_type: &str,
    chunk: &ParsedChunk,
) {
    edges.push(ParsedEdge {
        edge_id: stable_id("edge", &[&source, &target, edge_type, &chunk.chunk_id]),
        source_node_id: source,
        target_node_id: target,
        edge_type: edge_type.into(),
        source_chunk_id: chunk.chunk_id.clone(),
        authority: Authority::ExplicitFile,
        confidence: 1.0,
    });
}

fn parse_code(workspace_id: &str, relative_path: &str, source: &str) -> ParsedDocument {
    let source_hash = source_hash(source);
    let language = code_language(relative_path).unwrap_or("text");
    let document_id = document_identity(workspace_id, relative_path, None);
    let mut chunks = Vec::new();
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let document_node_id = stable_id("node", &[&document_id, "Document"]);
    nodes.push(ParsedNode {
        node_id: document_node_id.clone(),
        node_type: "Document".into(),
        label: relative_path.into(),
        source_chunk_id: None,
        range: line_range(0, source.lines().count().saturating_sub(1)),
        authority: Authority::ExplicitFile,
        confidence: 1.0,
    });

    for (line_index, line) in source.lines().enumerate() {
        let Some(kind) = code_line_kind(language, line) else {
            continue;
        };
        let chunk_id = ordinary_chunk_identity(&document_id, kind, line, 0);
        let chunk = ParsedChunk {
            chunk_id: chunk_id.clone(),
            kind: kind.into(),
            ordinal: chunks.len() as u32,
            range: line_range(line_index, line_index),
            content: line.trim().into(),
            explicit_id: None,
            authority: Authority::ExplicitFile,
            confidence: 1.0,
        };
        if matches!(kind, "symbol" | "export" | "todo") {
            let node_type = if kind == "todo" { "Task" } else { "Artifact" };
            let node_id = stable_id("node", &[&chunk_id, node_type]);
            nodes.push(ParsedNode {
                node_id: node_id.clone(),
                node_type: node_type.into(),
                label: clean_label(line),
                source_chunk_id: Some(chunk_id.clone()),
                range: chunk.range.clone(),
                authority: Authority::ExplicitFile,
                confidence: 1.0,
            });
            push_edge(
                &mut edges,
                document_node_id.clone(),
                node_id,
                if kind == "todo" {
                    "HAS_TASK"
                } else {
                    "CONTAINS"
                },
                &chunk,
            );
        }
        chunks.push(chunk);
    }

    ParsedDocument {
        parser_name: "code-metadata-v1".into(),
        parser_version: CODE_PARSER_VERSION,
        revision_id: stable_id(
            "rev",
            &[&document_id, &source_hash, &CODE_PARSER_VERSION.to_string()],
        ),
        document_id,
        portable_id: None,
        workspace_id: workspace_id.into(),
        relative_path: relative_path.into(),
        source_hash,
        language: Some(language.into()),
        metadata: BTreeMap::new(),
        chunks,
        nodes,
        edges,
        diagnostics: Vec::new(),
    }
}

fn code_language(path: &str) -> Option<&'static str> {
    match Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "rs" => Some("rust"),
        "js" | "jsx" => Some("javascript"),
        "ts" | "tsx" => Some("typescript"),
        "py" => Some("python"),
        _ => None,
    }
}

fn code_line_kind(language: &str, line: &str) -> Option<&'static str> {
    let value = line.trim_start();
    if value.contains("TODO") || value.contains("FIXME") {
        return Some("todo");
    }
    match language {
        "rust" if value.starts_with("use ") => Some("import"),
        "rust"
            if [
                "fn ",
                "pub fn ",
                "struct ",
                "pub struct ",
                "enum ",
                "pub enum ",
            ]
            .iter()
            .any(|prefix| value.starts_with(prefix)) =>
        {
            Some(if value.starts_with("pub ") {
                "export"
            } else {
                "symbol"
            })
        }
        "javascript" | "typescript" if value.starts_with("import ") => Some("import"),
        "javascript" | "typescript" if value.starts_with("export ") => Some("export"),
        "javascript" | "typescript"
            if ["function ", "class ", "const ", "let "]
                .iter()
                .any(|prefix| value.starts_with(prefix)) =>
        {
            Some("symbol")
        }
        "python" if value.starts_with("import ") || value.starts_with("from ") => Some("import"),
        "python" if value.starts_with("def ") || value.starts_with("class ") => Some("symbol"),
        _ => None,
    }
}

fn block(kind: &str, start: usize, end: usize, lines: &[&str]) -> Block {
    Block {
        kind: kind.into(),
        start,
        end,
        content: lines
            .get(start..=end)
            .map(|slice| slice.join("\n"))
            .unwrap_or_default(),
        explicit_id: None,
    }
}

fn fence_marker(line: &str) -> Option<&'static str> {
    let value = line.trim_start();
    if value.starts_with("```") {
        Some("```")
    } else if value.starts_with("~~~") {
        Some("~~~")
    } else {
        None
    }
}

fn heading(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let hashes = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    (hashes > 0 && hashes <= 6 && trimmed.as_bytes().get(hashes) == Some(&b' '))
        .then(|| trimmed[hashes + 1..].trim())
}

fn is_task(line: &str) -> bool {
    let value = line.trim_start();
    value.starts_with("- [ ] ")
        || value.starts_with("- [x] ")
        || value.starts_with("- [X] ")
        || value.starts_with("* [ ] ")
        || value.starts_with("* [x] ")
        || value.starts_with("* [X] ")
}

fn is_list(line: &str) -> bool {
    let value = line.trim_start();
    value.starts_with("- ")
        || value.starts_with("* ")
        || value
            .split_once(". ")
            .is_some_and(|(number, _)| number.chars().all(|character| character.is_ascii_digit()))
}

fn directive_attribute(line: &str, name: &str) -> Option<String> {
    let attributes = line.split_once('{')?.1.rsplit_once('}')?.0;
    attributes.split_whitespace().find_map(|attribute| {
        let (key, value) = attribute.split_once('=')?;
        (key == name).then(|| value.trim_matches(['"', '\'']).to_owned())
    })
}

fn take_block_id(content: &mut String) -> Option<String> {
    let (before, candidate) = content.rsplit_once(char::is_whitespace)?;
    let id = candidate.strip_prefix('^')?;
    if id.is_empty()
        || !id
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
    {
        return None;
    }
    let id = id.to_owned();
    let content_length = before.len();
    content.truncate(content_length);
    Some(id)
}

fn clean_label(content: &str) -> String {
    content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(content)
        .trim()
        .trim_start_matches(['#', '-', '*', '[', ']', 'x', 'X', ' '])
        .to_owned()
}

fn delimited_values<'a>(text: &'a str, open: &str, close: &str) -> Vec<&'a str> {
    let mut values = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(open) {
        rest = &rest[start + open.len()..];
        let Some(end) = rest.find(close) else {
            break;
        };
        values.push(&rest[..end]);
        rest = &rest[end + close.len()..];
    }
    values
}

fn prefixed_words(text: &str, prefix: char) -> Vec<String> {
    text.split_whitespace()
        .filter_map(|word| {
            let value = word.strip_prefix(prefix)?.trim_matches(|character: char| {
                !character.is_alphanumeric() && character != '_' && character != '-'
            });
            (!value.is_empty()).then(|| value.to_owned())
        })
        .collect()
}

fn markdown_image_destinations(text: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut rest = text;
    while let Some(index) = rest.find("](") {
        let before = &rest[..index];
        let is_image = before
            .rfind('[')
            .is_some_and(|open| open > 0 && before.as_bytes()[open - 1] == b'!');
        rest = &rest[index + 2..];
        let Some(end) = rest.find(')') else {
            break;
        };
        if is_image {
            values.push(rest[..end].split_whitespace().next().unwrap_or("").into());
        }
        rest = &rest[end + 1..];
    }
    values
}

fn normalize_content(content: &str) -> String {
    content.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn source_hash(source: &str) -> String {
    format!("blake3:{}", blake3::hash(source.as_bytes()).to_hex())
}

fn line_range(start: usize, end: usize) -> SourceRange {
    SourceRange {
        start_line: start.saturating_add(1) as u32,
        end_line: end.saturating_add(1) as u32,
    }
}

fn stable_id(prefix: &str, parts: &[&str]) -> String {
    let mut hasher = blake3::Hasher::new();
    for part in parts {
        hasher.update(&(part.len() as u64).to_le_bytes());
        hasher.update(part.as_bytes());
    }
    format!("{prefix}_{}", &hasher.finalize().to_hex()[..24])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_is_deterministic_and_portable_ids_survive_rename() {
        let source = "---\nid: note_portable\n---\n# Plan\n- [ ] Ship ^task_a\n[[Roadmap]] #work @ada [@paper]\n";
        let first = parse_markdown("ws", "old.md", source);
        let repeat = parse_markdown("ws", "old.md", source);
        let renamed = parse_markdown("ws", "new.md", source);
        assert_eq!(first, repeat);
        assert_eq!(first.document_id, renamed.document_id);
        assert_eq!(
            first
                .chunks
                .iter()
                .find(|chunk| chunk.explicit_id.as_deref() == Some("task_a"))
                .map(|chunk| &chunk.chunk_id),
            renamed
                .chunks
                .iter()
                .find(|chunk| chunk.explicit_id.as_deref() == Some("task_a"))
                .map(|chunk| &chunk.chunk_id)
        );
        assert!(first.nodes.iter().any(|node| node.node_type == "Citation"));
        assert!(first.edges.iter().any(|edge| edge.edge_type == "MENTIONS"));
    }

    #[test]
    fn malformed_input_is_localized_without_panicking() {
        let parsed = parse_markdown(
            "ws",
            "broken.md",
            "---\n: bad: yaml\n---\n:::callout\n```rust\nfn nope() {\0",
        );
        assert!(!parsed.diagnostics.is_empty());
        assert!(
            parsed
                .diagnostics
                .iter()
                .all(|diagnostic| diagnostic.range.start_line > 0)
        );
    }

    #[test]
    fn duplicate_explicit_ids_are_not_aliased() {
        let parsed = parse_markdown("ws", "note.md", "- [ ] one ^same\n- [ ] two ^same\n");
        assert_eq!(
            parsed
                .chunks
                .iter()
                .filter(|chunk| chunk.explicit_id.as_deref() == Some("same"))
                .count(),
            1
        );
        assert!(
            parsed
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "markdown.duplicate_explicit_id")
        );
    }

    #[test]
    fn code_metadata_is_small_and_language_aware() {
        let parsed = parse_code(
            "ws",
            "src/lib.rs",
            "use std::path::Path;\npub fn run() {}\n// TODO: test\n",
        );
        assert_eq!(parsed.language.as_deref(), Some("rust"));
        assert_eq!(parsed.chunks.len(), 3);
        assert!(parsed.chunks.iter().any(|chunk| chunk.kind == "import"));
        assert!(parsed.nodes.iter().any(|node| node.node_type == "Task"));
        assert!(
            ParserRegistry::standard()
                .parse("ws", "image.png", "bytes")
                .is_none()
        );
    }
}
