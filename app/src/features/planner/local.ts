import type {
  PlannerGroups,
  PlannerItem,
  PlannerItemDraft,
  PlannerItemPatch,
  PlannerSchedule,
} from "./types";

export class PlannerValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PlannerValidationError";
  }
}

export function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

export function localDateForEpoch(
  epochSeconds: number,
  timezone: string,
): string {
  const offset = timezoneOffsetSeconds(timezone);
  if (offset !== undefined) {
    return new Date((epochSeconds + offset) * 1_000).toISOString().slice(0, 10);
  }
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(epochSeconds * 1_000));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = values.get("year") ?? "0000";
    const month = values.get("month") ?? "01";
    const day = values.get("day") ?? "01";
    return `${year}-${month}-${day}`;
  } catch {
    return new Date(epochSeconds * 1_000).toISOString().slice(0, 10);
  }
}

export function scheduleDate(schedule: PlannerSchedule): string {
  if (schedule.kind === "exact") {
    return localDateForEpoch(schedule.startEpochSeconds, schedule.timezone);
  }
  return schedule.date;
}

export function scheduleSortKey(item: PlannerItem): [number, string, number] {
  const schedule = item.schedule;
  if (!schedule) return [2, "", 0];
  if (schedule.kind === "exact") {
    return [0, "", schedule.startEpochSeconds];
  }
  return [1, schedule.date, 0];
}

export function sortPlannerItems(items: PlannerItem[]): PlannerItem[] {
  return [...items].sort((left, right) => {
    const [leftKind, leftDate, leftEpoch] = scheduleSortKey(left);
    const [rightKind, rightDate, rightEpoch] = scheduleSortKey(right);
    return (
      leftKind - rightKind ||
      leftDate.localeCompare(rightDate) ||
      leftEpoch - rightEpoch ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
    );
  });
}

export class LocalPlannerStore {
  private readonly items = new Map<string, PlannerItem>();
  private readonly explicitTaskIds = new Map<string, string>();
  private sequence = 0;

  constructor(
    items: PlannerItem[] = [],
    private nowEpochSeconds = 0,
  ) {
    for (const item of items) {
      validateItem(item);
      if (this.items.has(item.id)) {
        throw new PlannerValidationError("planner.duplicate_id");
      }
      this.indexExplicitTask(item);
      this.items.set(item.id, { ...item });
    }
  }

  setNow(epochSeconds: number) {
    this.nowEpochSeconds = epochSeconds;
  }

  list(): PlannerItem[] {
    return [...this.items.values()];
  }

  get(id: string): PlannerItem | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  create(draft: PlannerItemDraft): PlannerItem {
    validateDraft(draft);
    const id = draft.id ?? this.nextId();
    if (this.items.has(id)) {
      throw new PlannerValidationError("planner.duplicate_id");
    }
    this.ensureExplicitTaskAvailable(draft.sourceLink?.explicitTaskId);
    const item: PlannerItem = {
      id,
      kind: draft.kind ?? "task",
      title: draft.title.trim(),
      status: "open",
      source: draft.source ?? "local",
      syncStatus: "local_only",
      createdAtEpochSeconds: this.nowEpochSeconds,
      updatedAtEpochSeconds: this.nowEpochSeconds,
      ...(draft.details === undefined ? {} : { details: draft.details }),
      ...(draft.schedule === undefined ? {} : { schedule: draft.schedule }),
      ...(draft.projectId === undefined ? {} : { projectId: draft.projectId }),
      ...(draft.sourceLink === undefined
        ? {}
        : { sourceLink: draft.sourceLink }),
      ...(draft.providerLink === undefined
        ? {}
        : { providerLink: draft.providerLink }),
      ...(draft.recurrenceRule === undefined
        ? {}
        : { recurrenceRule: draft.recurrenceRule }),
    };
    this.items.set(id, item);
    this.indexExplicitTask(item);
    return { ...item };
  }

  update(id: string, patch: PlannerItemPatch): PlannerItem {
    const current = this.items.get(id);
    if (!current) throw new PlannerValidationError("planner.item_missing");
    const updated: PlannerItem = { ...current, ...patch, id };
    if (patch.title !== undefined) updated.title = patch.title.trim();
    validateItem(updated);
    this.ensureExplicitTaskAvailable(updated.sourceLink?.explicitTaskId, id);
    this.removeExplicitTask(current);
    updated.updatedAtEpochSeconds = this.nowEpochSeconds;
    this.items.set(id, updated);
    this.indexExplicitTask(updated);
    return { ...updated };
  }

  complete(id: string): PlannerItem {
    return this.update(id, { status: "completed" });
  }

  archive(id: string): PlannerItem {
    return this.update(id, { status: "archived" });
  }

  reconcileExplicitTask(
    explicitTaskId: string,
    draft: PlannerItemDraft,
  ): { kind: "created" | "updated"; item: PlannerItem } {
    const normalized = explicitTaskId.trim();
    if (!normalized)
      throw new PlannerValidationError("planner.task_id_required");
    const sourceLink = {
      ...(draft.sourceLink ?? { workspaceId: "workspace", relativePath: "" }),
      explicitTaskId: normalized,
    };
    const existingId = this.explicitTaskIds.get(normalized);
    if (!existingId) {
      return {
        kind: "created",
        item: this.create({
          ...draft,
          source: "markdown",
          sourceLink,
        }),
      };
    }
    const existing = this.items.get(existingId);
    if (!existing) throw new PlannerValidationError("planner.item_missing");
    const item = this.update(existingId, {
      ...draft,
      source: "markdown",
      sourceLink,
      status: existing.status,
    });
    return { kind: "updated", item };
  }

  groups(
    nowEpochSeconds = this.nowEpochSeconds,
    timezone = "UTC",
  ): PlannerGroups {
    const today = localDateForEpoch(nowEpochSeconds, timezone);
    const groups: PlannerGroups = {
      today: [],
      agenda: [],
      upcoming: [],
      unscheduled: [],
      completed: [],
    };
    for (const item of this.items.values()) {
      if (item.status === "archived") continue;
      if (item.status === "completed") {
        groups.completed.push({ ...item });
        continue;
      }
      if (!item.schedule) {
        groups.unscheduled.push({ ...item });
        continue;
      }
      groups.agenda.push({ ...item });
      const date = scheduleDate(item.schedule);
      if (date === today) groups.today.push({ ...item });
      else if (
        date > today ||
        (item.schedule.kind === "exact" &&
          item.schedule.startEpochSeconds > nowEpochSeconds)
      ) {
        groups.upcoming.push({ ...item });
      }
    }
    for (const group of Object.values(groups)) sortPlannerItems(group);
    return groups;
  }

  private nextId(): string {
    this.sequence += 1;
    return `local-${String(this.sequence)}`;
  }

  private ensureExplicitTaskAvailable(
    explicitTaskId?: string,
    currentId?: string,
  ) {
    if (!explicitTaskId) return;
    const existingId = this.explicitTaskIds.get(explicitTaskId);
    if (existingId && existingId !== currentId) {
      throw new PlannerValidationError("planner.duplicate_explicit_task_id");
    }
  }

  private indexExplicitTask(item: PlannerItem) {
    const explicitTaskId = item.sourceLink?.explicitTaskId;
    if (explicitTaskId) this.explicitTaskIds.set(explicitTaskId, item.id);
  }

  private removeExplicitTask(item: PlannerItem) {
    const explicitTaskId = item.sourceLink?.explicitTaskId;
    if (
      explicitTaskId &&
      this.explicitTaskIds.get(explicitTaskId) === item.id
    ) {
      this.explicitTaskIds.delete(explicitTaskId);
    }
  }
}

function validateDraft(draft: PlannerItemDraft) {
  if (!draft.title.trim()) {
    throw new PlannerValidationError("planner.title_required");
  }
  if (draft.sourceLink) validateSourceLink(draft.sourceLink);
  validateSchedule(draft.schedule);
}

function validateItem(item: PlannerItem) {
  if (!item.title.trim()) {
    throw new PlannerValidationError("planner.title_required");
  }
  if (item.sourceLink) validateSourceLink(item.sourceLink);
  validateSchedule(item.schedule);
}

function validateSourceLink(
  sourceLink: NonNullable<PlannerItem["sourceLink"]>,
) {
  if (
    !sourceLink.workspaceId.trim() ||
    !sourceLink.relativePath.trim() ||
    sourceLink.relativePath.startsWith("/") ||
    sourceLink.relativePath.split("/").includes("..")
  ) {
    throw new PlannerValidationError("planner.invalid_source_path");
  }
}

function validateSchedule(schedule?: PlannerSchedule) {
  if (!schedule) return;
  if (schedule.kind !== "exact") {
    if (!isDateOnly(schedule.date)) {
      throw new PlannerValidationError("planner.invalid_date");
    }
    return;
  }
  if (
    schedule.endEpochSeconds !== undefined &&
    schedule.endEpochSeconds < schedule.startEpochSeconds
  ) {
    throw new PlannerValidationError("planner.invalid_schedule");
  }
}

function timezoneOffsetSeconds(timezone: string): number | undefined {
  if (/^(?:z|utc|etc\/utc)$/i.test(timezone.trim())) return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezone.trim());
  if (!match) return undefined;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return undefined;
  const seconds = hours * 3_600 + minutes * 60;
  return match[1] === "-" ? -seconds : seconds;
}
