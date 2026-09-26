CREATE TABLE IF NOT EXISTS knowledge_documents (
    document_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    portable_id TEXT,
    source_hash TEXT NOT NULL,
    parser_name TEXT NOT NULL,
    parser_version INTEGER NOT NULL,
    language TEXT,
    generation INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    UNIQUE (workspace_id, relative_path)
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_portable_id
    ON knowledge_documents (workspace_id, portable_id)
    WHERE portable_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_revisions (
    revision_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(document_id) ON DELETE CASCADE,
    source_hash TEXT NOT NULL,
    parser_version INTEGER NOT NULL,
    indexed_at TEXT NOT NULL,
    UNIQUE (document_id, source_hash, parser_version)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    chunk_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(document_id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL REFERENCES knowledge_revisions(revision_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    start_line INTEGER NOT NULL CHECK (start_line > 0),
    end_line INTEGER NOT NULL CHECK (end_line >= start_line),
    content TEXT NOT NULL,
    explicit_id TEXT,
    authority TEXT NOT NULL CHECK (authority IN (
        'explicit_user', 'explicit_file', 'provider_authoritative',
        'agent_confirmed', 'model_inferred', 'heuristic_inferred'
    )),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    valid_from TEXT,
    valid_to TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_nodes (
    node_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    node_type TEXT NOT NULL,
    label TEXT NOT NULL,
    authority TEXT NOT NULL CHECK (authority IN (
        'explicit_user', 'explicit_file', 'provider_authoritative',
        'agent_confirmed', 'model_inferred', 'heuristic_inferred'
    )),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    valid_from TEXT,
    valid_to TEXT,
    observed_at TEXT,
    supersedes_id TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_edges (
    edge_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(document_id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    source_node_id TEXT NOT NULL REFERENCES knowledge_nodes(node_id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES knowledge_nodes(node_id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL,
    authority TEXT NOT NULL CHECK (authority IN (
        'explicit_user', 'explicit_file', 'provider_authoritative',
        'agent_confirmed', 'model_inferred', 'heuristic_inferred'
    )),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    valid_from TEXT,
    valid_to TEXT,
    observed_at TEXT,
    supersedes_id TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_node_sources (
    node_id TEXT NOT NULL REFERENCES knowledge_nodes(node_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(document_id) ON DELETE CASCADE,
    chunk_id TEXT REFERENCES knowledge_chunks(chunk_id) ON DELETE CASCADE,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    source_hash TEXT NOT NULL,
    PRIMARY KEY (node_id, document_id, start_line, end_line)
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    chunk_id UNINDEXED,
    document_id UNINDEXED,
    content,
    tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS knowledge_index_generations (
    workspace_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_index_jobs (
    job_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    old_relative_path TEXT,
    kind TEXT NOT NULL CHECK (kind IN (
        'upsert', 'delete', 'rename', 'file_rebuild', 'folder_rebuild',
        'workspace_rebuild', 'derived_rebuild', 'full_rebuild'
    )),
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'running', 'completed', 'failed', 'cancelled'
    )),
    priority INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    source_hash TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_index_jobs_active_path
    ON knowledge_index_jobs (workspace_id, relative_path)
    WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS knowledge_invalidations (
    workspace_id TEXT NOT NULL,
    artifact_kind TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    stale_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, artifact_kind, artifact_id)
);
