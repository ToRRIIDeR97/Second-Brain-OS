# Context packet v1

A context packet is immutable, bounded, inspectable input for one agent request.
It contains `packet_id`, `workspace_id`, `created_at`, `objective`, explicit
`instructions`, a `policy`, source metadata, ordered sections, `token_budget`,
and canonical serialization.

The policy lists readable/writable relative roots, process permission, MCP tools,
and HTML mode. Sources carry kind, stable ID, classification, and content hash.
Every retrieved section has `is_data: true`; retrieved notes, project files,
provider content, and unknown Markdown syntax are data, never system
instructions. Operating instructions are a separate explicit array and are
not promoted from source text.

```json
{
  "contract": "context_packet",
  "version": 1,
  "packet_id": "packet_01K4P",
  "workspace_id": "ws_01K4A",
  "created_at": "2026-07-27T12:00:00Z",
  "objective": "Review the current indexing plan.",
  "instructions": ["Use only the permitted workspace roots."],
  "policy": {
    "readable_roots": ["."],
    "writable_roots": [],
    "allow_processes": false,
    "mcp_tools": ["brain.search"],
    "html_mode": "disabled"
  },
  "sources": [{"kind": "project_card", "id": "project_01K4B", "classification": "internal", "content_hash": "blake3:0123456789abcdef"}],
  "sections": [{"kind": "retrieved_note", "label": "Current focus", "content": "Define the context compiler.", "is_data": true}],
  "token_budget": 12000,
  "serialization": "canonical_json"
}
```

Packets are immutable after attachment. A new objective, policy, source set, or
budget creates a new packet and audit identity.
