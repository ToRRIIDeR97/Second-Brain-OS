# Tenon Workbench

Tenon Workbench is a personal operating system for organizing projects,
commitments, knowledge, and delegated work. This glossary defines the product
language shared by design and engineering.

## Language

**Brain**:
The user's complete personal control center. In the app it is the selected
workspace folder: its notes, Project cards, planning and Activity.
_Avoid_: account, home

**Project**:
A bounded body of work with an intended outcome, status, plan, resources,
instructions, and Activity. A Project's folder is a subfolder of its
workspace's `projects` folder (any letter case) or a folder linked from
elsewhere in `.tenon/workspace.json`; **Scan for projects** gives each such
folder a Project. Threads of a Project run in its folder, and the sidebar
lists them under the Project. A Project's own `AGENTS.md` replaces the
workspace default for its threads. Older Projects may instead link a Workspace
(`location.workspaceId`) or have no folder and run in their card folder.
_Avoid_: folder, repository

**Project card**:
The Markdown file holding a Project's metadata, with its notes and
calendar-derived timeline beside it, in `.tenon/projects/<id>/` (older cards:
`projects/<id>/`). It belongs to a Project but is not the Project's folder.
_Avoid_: Project, Workspace

**Workspace**:
A folder opened in the app and chosen in the sidebar's workspace dropdown.
Its `projects` folder and linked folders are its Projects; threads elsewhere
in the folder show under **General**. Workspaces never share threads in the
sidebar. Its root `AGENTS.md` is the default for Projects without their own.
In code it is an OpenCode project (a folder or repository) and the Brain
directory of the Second Brain routes.
_Avoid_: Project

**Resource**:
An item that can be opened or referenced, such as a note, source file, task,
event, diff, or Run.
_Avoid_: Asset, object, item

**Task**:
A completable unit of work that may belong to a Project and may have a date or
scheduled time.
_Avoid_: To-do, action item

**Calendar event**:
A time-bound commitment from the local planner or a connected calendar
provider.
_Avoid_: Meeting, appointment, time block as general terms

**Run**:
One managed execution of an agent with an objective, context, permissions,
events, approvals, and a result. A Run uses one active Harness at a time and
may switch Harnesses between turns.
_Avoid_: Agent session, chat, job

**Harness**:
The agent runtime implementation that executes a Run, such as OpenCode or
Codex.
_Avoid_: Provider, model, agent

**Harness instance**:
A configured local installation and account for a Harness. Multiple instances
of the same Harness may use different binaries, homes, or accounts.
_Avoid_: Provider account, runtime as an interchangeable name

**Delegation**:
An agent in one Harness handing a task to an agent in another Harness. The
task runs as a child Run of the delegating Run and returns its final reply.
_Avoid_: Subagent (a Harness's own nested agent)

**Activity**:
The chronological record of meaningful user, agent, file, Git, planning, and
provider events.
_Avoid_: Log, feed, history as interchangeable names

**Attention item**:
A Task, approval, conflict, failure, or recovery state that needs a user
decision or action.
_Avoid_: Notification, alert

**Project Map**:
A bounded visual view of relationships and live work inside a Project.
_Avoid_: Global graph, knowledge graph as the product name

**Connection**:
An authorized link to an external provider such as Google Calendar or Google
Tasks.
_Avoid_: Integration, account as interchangeable names
