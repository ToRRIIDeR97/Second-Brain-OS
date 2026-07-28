CREATE TABLE IF NOT EXISTS context_packets (
    packet_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    contract_version INTEGER NOT NULL,
    objective TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    estimator TEXT NOT NULL,
    token_budget INTEGER NOT NULL CHECK (token_budget > 0),
    token_count INTEGER NOT NULL CHECK (token_count >= 0),
    index_generation INTEGER NOT NULL,
    policy_json TEXT NOT NULL,
    approval_state TEXT NOT NULL,
    serialized_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('proposal', 'used')),
    created_at TEXT NOT NULL,
    used_at TEXT,
    stale_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS context_packet_proposal_fingerprint
    ON context_packets (workspace_id, fingerprint)
    WHERE state = 'proposal' AND stale_at IS NULL;

CREATE TABLE IF NOT EXISTS context_packet_items (
    packet_id TEXT NOT NULL REFERENCES context_packets(packet_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    bucket TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    authority TEXT NOT NULL,
    score INTEGER NOT NULL,
    reasons_json TEXT NOT NULL,
    token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
    is_data INTEGER NOT NULL CHECK (is_data IN (0, 1)),
    content TEXT NOT NULL,
    PRIMARY KEY (packet_id, ordinal)
);

CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    session_id TEXT,
    workspace_id TEXT NOT NULL,
    risk_class TEXT NOT NULL,
    target TEXT NOT NULL,
    capability TEXT NOT NULL,
    policy_revision INTEGER NOT NULL,
    reversible INTEGER NOT NULL CHECK (reversible IN (0, 1)),
    external_side_effect INTEGER NOT NULL CHECK (external_side_effect IN (0, 1)),
    destructive INTEGER NOT NULL CHECK (destructive IN (0, 1)),
    participant_facing INTEGER NOT NULL CHECK (participant_facing IN (0, 1)),
    decision TEXT NOT NULL CHECK (decision IN (
        'pending', 'approved', 'denied', 'expired', 'canceled'
    )),
    expires_at TEXT,
    audit_event_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_profiles (
    profile_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    model TEXT,
    reasoning_mode TEXT,
    protocol_version INTEGER NOT NULL,
    options_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id TEXT PRIMARY KEY,
    provider_session_id TEXT,
    profile_id TEXT NOT NULL REFERENCES agent_profiles(profile_id),
    workspace_id TEXT NOT NULL,
    context_packet_id TEXT NOT NULL REFERENCES context_packets(packet_id),
    state TEXT NOT NULL CHECK (state IN (
        'created', 'starting', 'running', 'waiting', 'canceling',
        'completed', 'failed', 'recoverable'
    )),
    readable_roots_json TEXT NOT NULL,
    writable_roots_json TEXT NOT NULL,
    provider_mirror_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
    session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (session_id, event_id),
    UNIQUE (session_id, sequence)
);

CREATE TABLE IF NOT EXISTS agent_change_sets (
    change_set_id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES agent_sessions(session_id) ON DELETE SET NULL,
    context_packet_id TEXT REFERENCES context_packets(packet_id) ON DELETE SET NULL,
    task_id TEXT,
    validation_job_id TEXT,
    attribution TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planner_items (
    item_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_item_id TEXT,
    project_id TEXT,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    schedule_kind TEXT NOT NULL,
    scheduled_value TEXT,
    timezone TEXT,
    source_document_id TEXT,
    source_task_id TEXT,
    source_start_line INTEGER,
    source_end_line INTEGER,
    local_enrichment_json TEXT NOT NULL,
    provider_fields_json TEXT NOT NULL,
    provider_etag TEXT,
    sync_status TEXT NOT NULL,
    conflict_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS planner_provider_item
    ON planner_items (provider, provider_item_id)
    WHERE provider_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS planner_source_task
    ON planner_items (workspace_id, source_task_id)
    WHERE source_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS planner_accounts (
    account_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    consent_mode TEXT NOT NULL CHECK (consent_mode IN ('read', 'write')),
    credential_key TEXT NOT NULL,
    connection_state TEXT NOT NULL,
    connected_at TEXT NOT NULL,
    disconnected_at TEXT,
    UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS planner_sync_cursors (
    account_id TEXT NOT NULL REFERENCES planner_accounts(account_id) ON DELETE CASCADE,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    cursor TEXT,
    last_synced_at TEXT,
    state TEXT NOT NULL,
    PRIMARY KEY (account_id, scope_kind, scope_id)
);

CREATE TABLE IF NOT EXISTS planner_outbox (
    operation_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES planner_accounts(account_id) ON DELETE CASCADE,
    item_id TEXT REFERENCES planner_items(item_id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    base_etag TEXT,
    base_payload_json TEXT,
    request_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'pending', 'running', 'retry_wait', 'completed', 'conflict', 'failed', 'canceled'
    )),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planner_conflicts (
    conflict_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES planner_outbox(operation_id) ON DELETE CASCADE,
    item_id TEXT REFERENCES planner_items(item_id) ON DELETE SET NULL,
    base_json TEXT NOT NULL,
    local_json TEXT NOT NULL,
    provider_json TEXT NOT NULL,
    conflicting_fields_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'resolved', 'discarded')),
    created_at TEXT NOT NULL,
    resolved_at TEXT
);
