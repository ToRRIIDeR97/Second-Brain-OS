# Second Brain OS

Second Brain OS is a personal operating system for organizing projects,
commitments, knowledge, and delegated work. This glossary defines the product
language shared by design and engineering.

## Language

**Brain**:
The user's complete personal control center. It contains global knowledge,
Project records, planning, and Activity.
_Avoid_: Workspace, account, home

**Project**:
A bounded body of work with an intended outcome, status, plan, resources,
instructions, and Activity. A Project may have a local location, but it is not
the same thing as a folder or repository.
_Avoid_: Workspace, folder, repository

**Workspace**:
A registered local root with its own identity, trust, and access policy. It is
a security boundary and should not replace Project in ordinary product copy.
_Avoid_: Project, Brain

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
events, approvals, and a result.
_Avoid_: Agent session, chat, job

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
