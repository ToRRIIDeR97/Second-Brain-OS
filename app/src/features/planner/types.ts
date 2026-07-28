export type PlannerItemKind = "task" | "milestone" | "focus_block" | "calendar";
export type PlannerStatus = "open" | "in_progress" | "completed" | "archived";
export type PlannerSource = "local" | "markdown" | "provider";
export type SyncStatus =
  | "local_only"
  | "pending"
  | "synced"
  | "conflict"
  | "error";

export type DateOnlySchedule = {
  kind: "date_only";
  date: string;
};

export type AllDaySchedule = {
  kind: "all_day";
  date: string;
};

export type ExactSchedule = {
  kind: "exact";
  /** Absolute seconds since Unix epoch; timezone is display/grouping context. */
  startEpochSeconds: number;
  endEpochSeconds?: number;
  timezone: string;
};

export type PlannerSchedule = DateOnlySchedule | AllDaySchedule | ExactSchedule;

export type SourceLink = {
  workspaceId: string;
  relativePath: string;
  startLine?: number;
  endLine?: number;
  explicitTaskId?: string;
};

export type ProviderLink = {
  provider: string;
  objectId: string;
};

export type PlannerItem = {
  id: string;
  kind: PlannerItemKind;
  title: string;
  details?: string;
  schedule?: PlannerSchedule;
  status: PlannerStatus;
  projectId?: string;
  source: PlannerSource;
  sourceLink?: SourceLink;
  providerLink?: ProviderLink;
  recurrenceRule?: string;
  syncStatus: SyncStatus;
  conflictMessage?: string;
  createdAtEpochSeconds: number;
  updatedAtEpochSeconds: number;
};

export type PlannerItemDraft = {
  id?: string;
  kind?: PlannerItemKind;
  title: string;
  details?: string;
  schedule?: PlannerSchedule;
  projectId?: string;
  source?: PlannerSource;
  sourceLink?: SourceLink;
  providerLink?: ProviderLink;
  recurrenceRule?: string;
};

export type PlannerItemPatch = Partial<
  Pick<
    PlannerItem,
    | "title"
    | "details"
    | "schedule"
    | "status"
    | "projectId"
    | "source"
    | "sourceLink"
    | "providerLink"
    | "recurrenceRule"
  >
>;

export type PlannerGroups = {
  today: PlannerItem[];
  agenda: PlannerItem[];
  upcoming: PlannerItem[];
  unscheduled: PlannerItem[];
  completed: PlannerItem[];
};

export type PlannerView = keyof PlannerGroups | "tasks";
