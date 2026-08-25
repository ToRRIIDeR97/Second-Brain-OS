# Second Brain OS v1 implementation plan

- Status: proposed delivery plan
- Product brief: [`PRODUCT-BRIEF-V1.md`](./PRODUCT-BRIEF-V1.md)
- Navigation map: [`NAVIGATION-MAP-V1.md`](./NAVIGATION-MAP-V1.md)
- Updated: 2026-08-22

This plan turns the v1 product direction into incremental engineering work. It
uses the accessibility and interaction priorities from UI/UX Pro Max and the
component and motion principles from Emil Kowalski's design engineering work.
The rules below are acceptance criteria, not optional polish.

## Implementation stance

- Keep the Tauri backend and one thin MCP sidecar.
- Keep local files canonical and database projections rebuildable.
- Reuse the current editors, planner, agent contracts, graph query boundary,
  workspace policy, tabs, inspector, and utility dock.
- Change one product area at a time and keep the application runnable.
- Do not add a second agent runtime, design system package, animation library,
  or state framework without a demonstrated need.
- Do not start production UI changes until a visual direction for Home and
  Project Overview has been selected.

## Design quality contract

### Hierarchy before decoration

- Each view has one primary user goal and one visually dominant action.
- Use spacing, alignment, type weight, and dividers before adding a card.
- Reserve elevated cards for selectable or actionable groups. Do not place
  every block in a rounded container.
- Keep persistent chrome quiet. Attention states, selection, and active work
  receive the strongest contrast.
- Use one accent color for actions and selection. Status colors keep their
  semantic meaning and never become decoration.
- Keep Project context visible in the breadcrumb, not in a second workspace
  bar.

### Keyboard and pointer parity

- Every primary action works by keyboard.
- Tab order follows the visible layout.
- `Ctrl+K` search and `Ctrl+Shift+P` commands open without motion or delay.
- Icon-only buttons have an accessible name and a tooltip.
- Fine-pointer controls have at least a 32 by 32 pixel hit area. Coarse-pointer
  controls expand to at least 44 by 44 pixels.
- Hover never reveals the only way to perform an action.
- Async buttons disable immediately and show the operation in their label.
- Errors appear next to the control or record that caused them and include a
  recovery action when one exists.

### Accessibility

- Normal text reaches a 4.5:1 contrast ratio in light and dark themes.
- Focus rings remain visible against every supported surface.
- Color is never the only sign of status, selection, sync, or failure.
- Headings preserve a logical outline even when visual size differs.
- Lists, tabs, dialogs, trees, and menus expose the correct semantic roles.
- Loading regions announce useful state without reading every streamed update.
- Reduced motion removes position, scale, parallax, and camera movement while
  retaining short opacity and color transitions that explain state.
- Project Map always has a searchable list or table alternative.

### Typography and density

- Keep the current platform-first sans-serif stack unless the selected visual
  direction proves a better option.
- Use the monospace stack only for code, paths, IDs, and terminal content.
- Define type roles for page title, section title, body, label, metadata, and
  code. Components consume roles rather than inventing font sizes.
- Body copy uses enough line height to scan comfortably. Dense tables and trees
  may be tighter than explanatory text.
- Long-form text stays within a readable measure. Workbench editors use the
  space needed for code and Markdown.
- Secondary text must remain readable. Muted does not mean low contrast.

### Motion budget

Motion explains state, location, or feedback. Frequency decides how much motion
an interaction receives.

| Interaction | Rule | Target behavior |
|---|---|---|
| Keyboard search, commands, and navigation | No entrance motion | Visible on the next frame |
| Frequent list and rail navigation | No spatial motion | Color or opacity only, 100 to 150 ms |
| Button press | Immediate feedback | `scale(0.97)` to `scale(0.98)`, 100 to 160 ms |
| Tooltip after initial delay | Small anchored entrance | 125 to 160 ms; adjacent tooltips become instant |
| Popover or menu | Enter from its trigger | 150 to 200 ms, strong ease-out, origin-aware |
| Modal | Centered entrance | Opacity plus scale from at least `0.95`, 180 to 240 ms |
| Utility panel or drawer | Explain spatial origin | Transform plus opacity, 200 to 260 ms |
| Toast | Confirm background result | Interruptible transition, faster exit than entrance |
| Project Map activity | Show a real event | One bounded pulse or transition, no ambient movement |

Motion implementation rules:

- Never use `transition: all`.
- Never use `ease-in` for interface entrances.
- Use the existing `--ease-out` curve and add a named strong ease-in-out curve
  for on-screen movement.
- Animate transform and opacity. Do not animate layout properties in frequent
  interactions.
- Prefer CSS transitions for interruptible UI. Use JavaScript only when motion
  depends on live input or gesture velocity.
- Popovers transform from their trigger. Modals remain centered.
- Do not animate from `scale(0)`.
- Gate hover motion behind fine-pointer media queries.
- Review motion at normal speed and in slow motion before accepting it.

### Perceived performance

- Reserve space for asynchronous content so Home and Project views do not jump.
- Show skeletons that match the final layout for loads that outlast a brief
  frame. Do not stack generic spinners across the page.
- Stream agent work into stable groups instead of inserting noisy rows at the
  top of the screen.
- Lazy-load heavy editors and Project Map, as the current shell already does
  for major workspaces.
- Keep graph label rendering independent of the 3D canvas resolution.
- Add list virtualization only after representative data shows a problem.

### Component defaults

- Use Lucide for product icons and keep stroke weight consistent.
- Buttons provide rest, hover, active, focus, disabled, busy, and destructive
  states.
- Popovers close on Escape, outside pointer press, and successful selection.
- Menus keep selection and focus separate.
- Tooltips use an initial delay, then open adjacent tooltips instantly.
- Empty states explain why the area is empty and offer one useful action.
- Success feedback stays quiet. Failures and approvals remain until resolved.
- Destructive actions state the affected Project or resource and whether the
  action is reversible.

## Phase 0: visual direction and baseline

### Outcome

A selected visual direction and a measured baseline for the current shell.

### Work

1. Produce three visual directions for Home and Project Overview from the
   agreed product brief.
2. Include normal, empty, loading, and needs-attention states.
3. Select one direction before changing production UI.
4. Inventory the existing tokens and reusable components in
   [`reference-workbench.css`](../../app/src/styles/reference-workbench.css).
5. Capture the current app at representative desktop sizes and in light and
   dark themes.
6. Record the current keyboard paths for search, commands, panel toggles, tabs,
   files, tasks, and approvals.

### Acceptance gate

- Home and Project Overview share one visual language.
- The direction demonstrates hierarchy without relying on a grid of equal
  cards.
- Light, dark, narrow, empty, loading, and attention states are covered.
- Focus, hover, pressed, disabled, and busy states are visible.
- Motion intent is annotated for each animated component.

## Phase 1: product model and shared actions

### Outcome

Projects, Activity, and application actions have stable contracts before the
new navigation depends on them.

### Work

1. Extend the existing Project card contract with the smallest fields needed
   for outcome, progress, next milestone, blocker, instructions, and location.
2. Add thin Project commands in Tauri and keep behavior in the workspace,
   knowledge, planner, and agent domains.
3. Define typed application actions for Project, resource, task, calendar, and
   agent operations.
4. Normalize meaningful file, Git, planner, provider, approval, and agent
   events into the existing event envelope.
5. Add read models for Home attention, active Projects, recent resources, and
   running work.
6. Keep Workspace as the access boundary while Project remains the product
   concept.

### Acceptance gate

- A Project can be created, read, updated, paused, and archived through typed
  commands.
- Project reads never grant access to a linked root.
- Each write produces the expected audit event without note content, secrets,
  hidden reasoning, or terminal scrollback.
- UI and future agent tools can call the same application action.
- Pure domain behavior has deterministic Rust tests.

## Phase 2: shell and navigation migration

### Outcome

The shell matches the v1 navigation map without rewriting the workbench.

### Primary code areas

- [`AppShell.tsx`](../../app/src/components/layout/AppShell.tsx)
- [`ActivityBar.tsx`](../../app/src/components/layout/ActivityBar.tsx)
- [`WorkspaceNavigator.tsx`](../../app/src/components/layout/WorkspaceNavigator.tsx)
- [`WorkspaceSwitcher.tsx`](../../app/src/components/layout/WorkspaceSwitcher.tsx)
- [`shell.ts`](../../app/src/state/shell.ts)

### Work

1. Change the primary rail to Home, Projects, Calendar, Knowledge, and
   Activity. Keep Settings at the bottom.
2. Replace the workspace switcher with a Brain and Project breadcrumb.
3. Remove the persistent search field. Keep `Ctrl+K` search and
   `Ctrl+Shift+P` commands as separate overlays.
4. Stop opening primary areas as tabs. Preserve resource tabs, dirty state,
   history, and per-Workspace restoration.
5. Make the navigator reflect the selected primary area.
6. Make the inspector contextual and closed when it has nothing useful to
   explain.
7. Keep the utility panel closed by default and restore only intentional tabs.
8. Define narrow-window collapse order for navigator, inspector, and utility
   panel.

### Design application

- Primary navigation responds instantly and uses no spatial animation.
- Tooltips on the icon rail use the shared delay behavior.
- Panel movement uses the drawer curve and respects reduced motion.
- Active, focused, and attention states remain distinct without depending on
  color alone.

### Acceptance gate

- Every primary area is keyboard reachable.
- Primary-area navigation creates no resource tab.
- Back and Forward restore area, resource, selection, and Project context.
- No content hides behind the top bar, rail, navigator, or utility panel.
- The shell works at the agreed minimum desktop size without horizontal page
  scrolling.
- Existing unsaved tabs survive Project or Workspace changes.

## Phase 3: Create Project and Project workspace

### Outcome

The user can create a Project and work from a stable Project page.

### Work

1. Build Create Project with basic and Advanced sections.
2. Support existing folder, new folder, and no folder yet.
3. Preview trust and agent access before creation.
4. Build Active, Paused, and Archived Project lists.
5. Build Project Overview, Plan, Work, Files, Activity, and Map routes.
6. Reuse the current file browser and resource tabs inside Project Files.
7. Put location, instructions, access, connections, and archive controls in
   Project settings.

### Design application

- The basic flow has one clear primary action per step.
- Advanced options remain available without dominating the first-run path.
- Validation appears beside the relevant input and preserves entered data.
- Creation progress does not shift the form or replace its primary controls.
- The Project list uses alignment and typography before card elevation.

### Acceptance gate

- A basic Project can be created in under two minutes.
- Duplicate names and invalid or missing folders have explicit recovery paths.
- The app never treats a displayed path as authorization.
- Project status, next action, blocker, and latest activity are readable without
  opening the inspector.
- All form controls have labels, keyboard behavior, error associations, and
  visible focus.

## Phase 4: Home

### Outcome

Home becomes the practical starting point defined in the product brief.

### Work

1. Add the Ask Second Brain composer.
2. Add Today from tasks, events, overdue work, and pending approvals.
3. Add Active Projects with progress, next milestone, blocker, and latest
   activity.
4. Add Resume from recent resources and interrupted work.
5. Add Running work from queued, running, blocked, and review-ready Runs.
6. Remove the embedded graph and the current equal-weight quick action row.
7. Add a first-run state for creating a Project, opening a folder, and
   connecting Google.

### Design application

- Attention ranks above recency. Recency ranks above discovery.
- Sections with no useful content collapse instead of showing empty cards.
- Async sections reserve their final size and load independently.
- Keyboard focus enters the Ask composer only when the user chooses it.
- Repeated Home visits use little or no entrance motion.

### Acceptance gate

- The next meaningful action is visible within ten seconds.
- A recent resource opens in no more than two interactions.
- Home remains useful without Google or an agent provider.
- Approval, overdue, conflict, and failure states include text and an action.
- Loading one section does not block or move the others.

## Phase 5: planning and Google connections

### Outcome

Tasks and calendar work locally and gain Google sync without changing their
basic interaction model.

### Primary code areas

- [`LocalPlanner.tsx`](../../app/src/features/planner/LocalPlanner.tsx)
- [`ReferenceCalendar.tsx`](../../app/src/features/planner/ReferenceCalendar.tsx)
- [`google-planner.md`](../security/google-planner.md)

### Work

1. Unify Today, Week, Month, Agenda, Tasks, Unscheduled, and Completed routes.
2. Keep task identity when scheduling or unscheduling it.
3. Show Project and provider source on task and event details.
4. Finish the system-browser OAuth, credential-store, and Google HTTP adapter.
5. Keep read and write consent separate.
6. Surface pending, synced, offline, stale, conflict, and failed states.
7. Route consequential Google writes through the existing approval classes and
   outbox.

### Design application

- Drag interactions remain optional. Every drag action has a keyboard and menu
  alternative.
- Calendar motion follows the selected date or range and uses ease-in-out.
- Frequent task completion uses immediate state feedback with no celebration.
- Provider status stays legible without occupying the main hierarchy.

### Acceptance gate

- Local planning works offline and without Google.
- Provider writes are idempotent and recover after restart.
- Conflicts preserve local enrichment and provider-owned fields.
- Calendar and task controls are fully operable by keyboard.
- Date, time, timezone, recurrence, and participant-facing effects are explicit
  before approval.

## Phase 6: agent panel, Runs, and Activity

### Outcome

The agent can investigate and act inside the product while the user remains in
control.

### Primary code areas

- [`AgentWorkspace.tsx`](../../app/src/features/agents/AgentWorkspace.tsx)
- [`codex.rs`](../../app/src-tauri/src/agents/codex.rs)
- [`provider.rs`](../../app/src-tauri/src/agents/provider.rs)
- [`mcp.rs`](../../app/src-tauri/src/mcp.rs)

### Work

1. Finish the Codex App Server process and lifecycle connection behind the
   current provider boundary.
2. Build the global Ask panel with editable context chips.
3. Preview objective, Project, tools, readable roots, and writable root before
   starting.
4. Group streamed events into assistant updates, tool work, changes,
   validations, approvals, and results.
5. Add Needs attention, Agent runs, Changes, and History views to Activity.
6. Link every event to its Project, Run, and affected Resource when available.
7. Refresh product views after application-owned MCP actions succeed.
8. Support cancel, interrupt, resume, retry, and visible provider failure.

### Design application

- Streaming updates append into stable groups and do not cause scroll jumps.
- Approval interrupts are persistent and visually stronger than ordinary Run
  output.
- The Ask panel uses a spatial drawer transition only for pointer-initiated
  opening. Keyboard opening is instant.
- Completed Runs become quiet. Failed and blocked Runs keep a clear next step.
- Tool names and provider payload details stay in expandable technical detail.

### Acceptance gate

- The user can inspect and remove context before a Run starts.
- The app never exposes hidden reasoning or provider secrets.
- Every write is scoped to the selected Project and approved by effect.
- Cancel and interrupt react without waiting for the next model message.
- The event stream remains usable with hundreds of events.
- Screen readers receive status summaries rather than every token or delta.

## Phase 7: Project Map

### Outcome

Map returns as an optional Project view that explains relationships and live
work.

### Primary code areas

- [`FocusedGraph.tsx`](../../app/src/features/graph/FocusedGraph.tsx)
- [`GraphViewport3D.tsx`](../../app/src/features/graph/GraphViewport3D.tsx)
- [`ADR-007`](../adr/ADR-007-focused-graph.md)

### Work

1. Move graph entry points into Project Map and contextual resource actions.
2. Default to the clearest bounded view for the selected Project or Resource.
3. Render labels in screen space or another resolution-independent layer.
4. Show live read, write, blocked, and completed state from Activity events.
5. Add filters for relationship type, authority, time, and activity.
6. Provide a searchable accessible list with the same selection and commands.
7. Keep the current node limits and truncation warnings.

### Design application

- No ambient node movement or decorative camera motion.
- One brief pulse may mark a real event. Repeated writes coalesce.
- Reduced motion replaces pulses and camera transitions with color and text.
- Selection, activity, authority, and status use separate visual channels.
- 3D remains optional. Readability decides the default.

### Acceptance gate

- Labels remain crisp at all supported zoom levels and display scaling.
- The Map stays understandable at 100 nodes and warns before larger views.
- Keyboard and screen-reader users can reach every node and action through the
  list alternative.
- Map activity never reduces editor or agent streaming responsiveness.

## Phase 8: quality pass and release gate

### Outcome

The new product model ships as one coherent desktop experience.

### Work

1. Review every changed component in a Before, After, Why table.
2. Test all states in light and dark themes.
3. Test the selected visual source beside implementation screenshots at the
   same viewport and state.
4. Run keyboard-only flows for Project creation, planning, editing, search,
   agent approval, recovery, and settings.
5. Verify contrast, focus, semantic roles, announcements, and reduced motion.
6. Inspect animations in slow motion and remove motion that adds delay without
   explaining state.
7. Test interrupted saves, offline Google writes, missing roots, provider auth
   expiry, failed Runs, and recovery after restart.
8. Run format, lint, tests, build, and targeted desktop smoke tests.

### Acceptance gate

- No `transition: all`, `ease-in` entrances, `scale(0)` entrances, or animated
  keyboard overlays remain.
- No icon-only action lacks an accessible name.
- No status relies on color alone.
- No hover state shifts layout.
- No panel combination makes the central workbench unusable.
- No current product route calls the Project a Workspace in user-facing copy.
- The full repository check passes.

## Validation by change size

For each small slice:

- run the closest Vitest file;
- run the closest Rust module tests for changed domain behavior;
- run TypeScript and ESLint for changed frontend code;
- inspect keyboard, focus, light theme, dark theme, and reduced motion states.

At the end of each phase:

```text
pnpm run format
pnpm run lint
pnpm run test
pnpm run build
cargo build --workspace
```

Use the full `pnpm run check` before a release checkpoint.

## Completion definition

V1 implementation is complete when the success criteria in the product brief
pass, the primary navigation no longer exposes the old workspace-first model,
and the design quality contract passes across Home, Projects, Calendar,
Knowledge, Activity, editors, agent work, and Project Map.
