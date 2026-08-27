import { Schema } from "effect"
import { KnowledgeNote } from "@/knowledge/note"
import { PlannerCalendar } from "@/planner/calendar"
import { BrainProject } from "@/project/brain"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

const NoteQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

const ProjectQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  id: Schema.String,
})

export class SecondBrainConflictError extends Schema.ErrorClass<SecondBrainConflictError>("SecondBrainConflictError")(
  {
    name: Schema.Literal("SecondBrainConflictError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 409 },
) {}

export const SecondBrainPaths = {
  notes: "/second-brain/notes",
  note: "/second-brain/note",
  calendar: "/second-brain/calendar",
  projects: "/second-brain/projects",
  project: "/second-brain/project",
} as const

export const SecondBrainApi = HttpApi.make("secondBrain").add(
  HttpApiGroup.make("secondBrain")
    .add(
      HttpApiEndpoint.get("listNotes", SecondBrainPaths.notes, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(Schema.Array(KnowledgeNote.Info), "Notes"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.get("readNote", SecondBrainPaths.note, {
        query: NoteQuery,
        success: described(KnowledgeNote.Document, "Note"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }),
      HttpApiEndpoint.put("writeNote", SecondBrainPaths.note, {
        query: NoteQuery,
        payload: KnowledgeNote.WriteInput,
        success: described(KnowledgeNote.Document, "Note saved"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound, SecondBrainConflictError],
      }),
      HttpApiEndpoint.get("readCalendar", SecondBrainPaths.calendar, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(PlannerCalendar.Snapshot, "Calendar"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.put("writeCalendar", SecondBrainPaths.calendar, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: PlannerCalendar.WriteInput,
        success: described(PlannerCalendar.Snapshot, "Calendar saved"),
        error: [HttpApiError.BadRequest, SecondBrainConflictError],
      }),
      HttpApiEndpoint.get("listProjects", SecondBrainPaths.projects, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        success: described(Schema.Array(BrainProject.Info), "Projects"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("createProject", SecondBrainPaths.projects, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: BrainProject.CreateInput,
        success: described(BrainProject.Info, "Project created"),
        error: [HttpApiError.BadRequest, SecondBrainConflictError],
      }),
      HttpApiEndpoint.get("readProject", SecondBrainPaths.project, {
        query: ProjectQuery,
        success: described(BrainProject.Info, "Project"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }),
      HttpApiEndpoint.patch("updateProject", SecondBrainPaths.project, {
        query: ProjectQuery,
        payload: BrainProject.UpdateInput,
        success: described(BrainProject.Info, "Project updated"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound, SecondBrainConflictError],
      }),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "second brain",
        description: "Workspace-scoped notes and local calendar data.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
