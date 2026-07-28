CREATE TABLE IF NOT EXISTS planner_agent_links (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    packet_id TEXT,
    planner_item_id TEXT NOT NULL,
    outbox_id TEXT,
    audit_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    project_id TEXT,
    source_note_id TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS planner_agent_links_session
    ON planner_agent_links (session_id, created_at);

CREATE INDEX IF NOT EXISTS planner_agent_links_item
    ON planner_agent_links (planner_item_id);

CREATE TABLE IF NOT EXISTS derived_artifacts (
    artifact_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 1000),
    status TEXT NOT NULL CHECK (status IN (
        'pending_review', 'accepted', 'rejected', 'dismissed'
    )),
    stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
    generator TEXT NOT NULL,
    model_tool_version TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    relationship_source_node_id TEXT,
    relationship_target_node_id TEXT,
    relationship_type TEXT
);

CREATE TABLE IF NOT EXISTS derived_dependencies (
    artifact_id TEXT NOT NULL REFERENCES derived_artifacts(artifact_id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    PRIMARY KEY (artifact_id, source_id)
);

CREATE INDEX IF NOT EXISTS derived_dependencies_source
    ON derived_dependencies (source_id, source_hash);

CREATE TABLE IF NOT EXISTS derived_jobs (
    job_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    target_id TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'running', 'completed', 'failed'
    )),
    priority INTEGER NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS derived_jobs_next
    ON derived_jobs (status, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS semantic_vectors (
    fingerprint TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_version TEXT NOT NULL,
    normalization_version TEXT NOT NULL,
    chunking_version TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    vector_json TEXT NOT NULL,
    stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS semantic_vectors_source
    ON semantic_vectors (workspace_id, chunk_id, source_hash);
