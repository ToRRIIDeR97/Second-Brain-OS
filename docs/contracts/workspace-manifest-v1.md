# Workspace manifest v1

`brain.workspace.yaml` is an optional tracked manifest for a registered
workspace. The application record and canonical root remain authoritative for
identity; the file cannot grant access outside that root.

Required fields are `schema_version: 1`, `id`, `name`, `kind`, `index`, `agent`,
and `terminal`. `project_id`, `default_view`, and `security` are optional.
`kind` is `brain`, `project`, or `collection`.

`agent.readable_roots` and `agent.writable_roots` are validated relative paths.
They must not be absolute, contain `..` traversal, or override application
denies. `security` can narrow access with `deny_read` and `deny_write`; it can
never widen hard application denies. `.agentignore` and `.brainignore` are
additional filters, not substitutes for this policy.

Example:

```yaml
contract: workspace_manifest
version: 1
schema_version: 1
id: ws_01K4A
name: Agent Operating System
kind: project
project_id: project_01K4B
default_view: knowledge
index:
  enabled: true
  respect_gitignore: true
  include: ["**/*.md", "**/*.ts"]
  exclude: ["node_modules/**", "target/**"]
agent:
  default_profile: orchestrator
  auto_include_project_card: true
  default_context_budget: 12000
  readable_roots: ["."]
  writable_roots: ["."]
terminal:
  default_shell: zsh
  max_tabs: 6
security:
  deny_read: [".env", ".env.*", "credentials/**"]
  deny_write: [".git/**", "vendor/**"]
```

Unknown fields are retained when the manifest is rewritten. A newer schema is
read-only until a migration is available; an older supported schema is migrated
before policy evaluation.
