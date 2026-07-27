# Graph ontology v1

The initial authoritative names are frozen below. Names are case-sensitive and
must not be silently reused for a new meaning.

Node types:

`Workspace`, `Project`, `Area`, `Document`, `Section`, `Note`, `Concept`,
`Task`, `Decision`, `Claim`, `Question`, `Person`, `Organization`, `Company`,
`Asset`, `Source`, `Citation`, `CalendarEvent`, `TaskList`, `Calendar`,
`Milestone`, `Artifact`, `AgentSession`, `TerminalSession`, `GitCommit`,
`FileChange`.

Edge types:

`BELONGS_TO`, `CONTAINS`, `REFERENCES`, `LINKS_TO`, `RELATED_TO`, `DEPENDS_ON`,
`BLOCKED_BY`, `SUPPORTS`, `CONTRADICTS`, `SUPERSEDES`, `ANSWERS`, `IMPLEMENTS`,
`DERIVED_FROM`, `CREATED_BY`, `UPDATED_BY`, `HAS_TASK`, `HAS_DECISION`,
`HAS_EVENT`, `SCHEDULED_BY`, `HAS_ATTENDEE`, `WORKSPACE_AT`, `MENTIONS`,
`CITES`, `DUPLICATE_OF`, `PART_OF`, `PRECEDES`.

Authority is one of `explicit_user`, `explicit_file`, `provider_authoritative`,
`agent_confirmed`, `model_inferred`, or `heuristic_inferred`. Inferred records
remain visibly distinct and cannot overwrite explicit or provider-authoritative
records. Temporal records may carry `valid_from`, `valid_to`, `observed_at`,
`supersedes_id`, and `deleted_at`; historical records remain queryable but are
excluded from current context unless requested.
