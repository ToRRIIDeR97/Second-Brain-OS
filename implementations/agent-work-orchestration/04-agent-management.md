# Plan 04: safe custom-agent management

Read [README](README.md) first. [Plan 03](03-v2-subagents.md) is required for execution acceptance. The definition editor can be implemented independently, but it is not fully delivered until an edited agent actually works through V2 `task`.

## Outcome

An Agents settings page lists global/project definitions with their source and effective state. Users can create, edit, disable, re-enable, and remove supported definitions without losing unrelated configuration. A successful save reloads the affected registry and the agent is available according to its mode and permissions.

## Read and trace

- `opencode/packages/core/src/config.ts`, `config/agent.ts`, `config/markdown.ts`, `config/plugin/agent.ts`, and `v1/config/migrate.ts`.
- `opencode/packages/core/src/agent.ts`, `state.ts`, `global.ts`, `fs-util.ts`, `location-mutation.ts`, and `policy.ts`.
- `opencode/packages/protocol/src/groups/agent.ts` and `packages/server/src/handlers/agent.ts`.
- `opencode/packages/app/src/components/settings-v2/index.tsx`, `settings-v2/dialog-settings-v2.tsx`, and the older settings entry points: trace which surfaces are actually reachable.
- `opencode/packages/app/src/context/local-agent.ts` and model/agent picker patterns.
- `opencode/packages/core/test/config/agent.test.ts`, `agent.test.ts`, and existing settings tests.

## Contract

Keep effective runtime listing separate from editable definitions. Extend the agent API with focused definition list/read/create/update/remove operations; reuse an existing equivalent if current code now provides it.

A definition includes name, scope, opaque source identity, source revision/content hash, format, editable status/reason, validation errors, and supported fields: description, mode, provider/model, variant, system prompt, permissions, positive integer step limit, visibility, and disabled state. Preserve existing color/options if present even if they are not part of the first form.

The server maps source IDs to registered config roots and validated relative files. Neither the renderer nor an agent submits an arbitrary absolute config path. Global writes use a narrowly scoped global-agent definition operation, not a general home-directory file API.

Defaults for new definitions: project scope, mode `subagent`, visible, enabled, inherited model when unset. Use a simple validated name for newly created files; keep existing supported nested names readable/editable through their discovered source IDs. Reject traversal, reserved/path-like names, collisions, and symlink escapes.

## Implementation steps

1. **Expose source provenance without duplicating precedence.** The config agent plugin already walks ordered documents/directories. Factor only the discovery/decoding needed by both registry and settings. Return disabled and invalid definitions too; a list of active registry agents cannot support re-enable or repair. Preserve the actual ordering and legacy migration semantics.
2. **Choose one canonical creation format.** Create new custom agents as Markdown in the existing scope-specific canonical agents directory, resolved by the server. Do not invent an `agents.db` or a new JSON settings store. Show inherited/built-in/plugin definitions as such; offer an explicit scoped override where supported instead of editing plugin files.
3. **Validate before writing.** Use `ConfigAgent.Info` and existing legacy conversion where appropriate. Validate mode, positive step limit, permission schema, model/variant compatibility, name, prompt limits, and scope. Model inheritance is allowed; a removed configured model is displayed as unavailable and cannot silently switch.
4. **Preserve source data.** For JSONC definitions, use installed `jsonc-parser` targeted edits. For Markdown, preserve the body and unedited/unknown frontmatter data. Reuse installed parsing/serialization capabilities. If a complex document cannot be safely edited structurally without dropping comments or unknown fields, provide a validated raw-text editor for that definition rather than silently rewriting it. Do not write a custom YAML parser.
5. **Use conflict-aware safe saves.** Require the last-read source hash, re-read before commit, validate the destination again, and use the existing safe mutation/atomic replacement primitive. Serialize this app's writes per source file. If an external edit is detected, return conflict and preserve the user's draft. Do not claim filesystem-wide compare-and-swap against unrelated editors if the underlying API cannot guarantee it; reuse the established conflict/backup behavior and report its limits.
6. **Implement disable/remove precisely.** Disabling writes the canonical disabled setting. Removing deletes only the selected definition/file entry; it must not delete a containing config file or lower-priority definition. Preview when removal reveals an inherited agent of the same name. Reject removal of built-in/plugin sources; allow deletion of a user-owned override.
7. **Reload once after a successful mutation.** Reuse the actual V2 registry reload/lifecycle, not only the legacy config HTTP handler. Reload one Location for project changes and affected already-loaded Locations for global changes. Do not eagerly initialize every Project. Subsequent tool calls must see tightened permissions/disabled state; do not restart active sessions or the user's server. Surface a reload failure honestly even if file persistence succeeded.
8. **Build a compact settings page.** Use the current settings navigation, a scope selector, definition list, and an editor panel with Save/Cancel/Disable/Remove. Show origin, overridden/effective status, validation errors, and unavailable models. Advanced permissions/system prompt can use existing text controls. Avoid a visual permissions graph or agent marketplace.
9. **Refresh consumers through existing invalidation.** Agent pickers and `task` target discovery should reflect changes without opening a new application window. Handle a selected agent being disabled/removed with an explicit error or choice; never silently run with a different agent.
10. **Generate the API client and check package resolution.** Follow the shared README. Keep the server handler thin; validation/persistence/reload belongs in the agent domain.

## Performance constraints

Discover sources when opening the page, switching scope, or invalidating a changed definition. Do not read every Markdown file on each form edit. Keep unsaved edits local; Save performs one validated mutation and one reload. Do not call model discovery repeatedly when editing unrelated fields. Reuse the existing model selector/cache.

## Tests and acceptance

- Create/read/update/disable/re-enable/remove for both scopes using real temporary files and the registry.
- Global/project same-name precedence; removing an override reveals the expected inherited definition; disabled definitions remain manageable.
- Markdown and JSONC round trips preserve unrelated fields, body content, and comments as promised by the selected editing path; complex content uses the safe fallback.
- Legacy field names (`prompt`/permission variants) migrate correctly without mixing incompatible V1/V2 schemas.
- Invalid mode/steps/permissions/model; name collision; traversal; forged source ID; symlink escape; unwritable root; concurrent external edit; failed reload.
- Project save updates only the relevant registry; global save invalidates loaded consumers without starting unloaded Projects.
- UI keyboard flow: create → save → edit → disable → re-enable → remove; dirty edits survive a conflict; destructive removal uses an existing confirmation pattern.
- Execute the edited subagent through the real Plan 03 path and prove its selected model, system prompt, step limit, and a restrictive permission take effect.

Run targeted config/agent/permission tests, affected API checks, app unit/UI checks and build. Do not add a new test framework or a separate config daemon. Existing user files are the source of truth.
