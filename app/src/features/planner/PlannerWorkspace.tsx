import {
  AlignLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pencil,
  Plus,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  ConfirmDialog,
  ModalDialog,
} from "../../components/common/ModalDialog";
import type {
  GoogleConnectionStatus,
  IpcClient,
  PlannerItemRecord,
  PlannerItemPatchRecord,
  PlannerScheduleRecord,
  WorkspacePath,
} from "../../lib/ipc";

export type PlannerWorkspaceView =
  | "today"
  | "week"
  | "month"
  | "agenda"
  | "tasks"
  | "unscheduled"
  | "completed";

type Props = {
  ipc: IpcClient;
  brainWorkspaceId?: string;
  projectId?: string;
  projectName?: string;
  initialView?: PlannerWorkspaceView;
  view?: PlannerWorkspaceView;
  onViewChange?: (view: PlannerWorkspaceView) => void;
  compact?: boolean;
  onOpenSource?: (source: WorkspacePath) => void;
  onOpenSettings?: () => void;
};

const calendarDateFormatters = new Map<string, Intl.DateTimeFormat>();
const calendarTimeFormatters = new Map<string, Intl.DateTimeFormat>();
type PlannerLoad = ReturnType<IpcClient["planner"]["list"]>;
const plannerLoads = new WeakMap<IpcClient, Map<string, PlannerLoad>>();
const monthYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const mediumDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
});
const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
});

function calendarDateFormatter(timeZone: string) {
  let formatter = calendarDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    calendarDateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function calendarTimeFormatter(timeZone: string) {
  let formatter = calendarTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
    calendarTimeFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function loadPlannerItems(
  ipc: IpcClient,
  brainWorkspaceId: string,
  range: ReturnType<typeof calendarRange>,
  projectId?: string,
) {
  let loads = plannerLoads.get(ipc);
  if (!loads) {
    loads = new Map();
    plannerLoads.set(ipc, loads);
  }
  const key = `${brainWorkspaceId}:${projectId ?? ""}:${range.startDate}`;
  let load = loads.get(key);
  if (!load) {
    load = ipc.planner.list({
      brainWorkspaceId,
      ...(projectId ? { projectId } : {}),
      range,
    });
    loads.set(key, load);
    void load.finally(() => loads.delete(key));
  }
  return load;
}

function localDate(date = new Date()) {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTime(date: Date) {
  return `${localDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dateFromLocal(value: string) {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(value: string, amount: number) {
  const date = dateFromLocal(value);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

function addMonths(value: string, amount: number) {
  const date = dateFromLocal(value);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return localDate(date);
}

function calendarDates(anchor: string) {
  const first = dateFromLocal(`${anchor.slice(0, 7)}-01`);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const start = localDate(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function calendarRange(anchor: string) {
  const dates = calendarDates(anchor);
  const startDate = dates[0] ?? anchor;
  const endDate = addDays(dates.at(-1) ?? startDate, 1);
  return {
    startDate,
    endDate,
    startEpochSeconds:
      Math.floor(dateFromLocal(startDate).getTime() / 1_000) - 86_400,
    endEpochSeconds:
      Math.floor(dateFromLocal(endDate).getTime() / 1_000) + 86_400,
  };
}

function itemDate(item: PlannerItemRecord): string | undefined {
  const schedule = item.schedule;
  if (!schedule) return undefined;
  if (schedule.kind !== "exact") return schedule.date;
  try {
    const parts = calendarDateFormatter(schedule.timezone).formatToParts(
      new Date(schedule.startEpochSeconds * 1_000),
    );
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get("year") ?? "0000"}-${values.get("month") ?? "01"}-${values.get("day") ?? "01"}`;
  } catch {
    return localDate(new Date(schedule.startEpochSeconds * 1_000));
  }
}

function itemTime(item: PlannerItemRecord) {
  if (item.schedule?.kind !== "exact") return undefined;
  return calendarTimeFormatter(item.schedule.timezone).format(
    new Date(item.schedule.startEpochSeconds * 1_000),
  );
}

function formatSchedule(item: PlannerItemRecord) {
  const date = itemDate(item);
  if (!date) return "No date";
  const formatted = mediumDateFormatter.format(dateFromLocal(date));
  const time = itemTime(item);
  return time ? `${formatted} · ${time}` : formatted;
}

function errorMessage(result: { error?: { message?: string } }) {
  return result.error?.message ?? "The planner action could not be completed.";
}

export function PlannerWorkspace({
  ipc,
  brainWorkspaceId,
  projectId,
  projectName,
  initialView = "today",
  view: controlledView,
  onViewChange,
  compact = false,
  onOpenSource,
  onOpenSettings,
}: Props) {
  const [items, setItems] = useState<PlannerItemRecord[]>([]);
  const [internalView, setInternalView] = useState(initialView);
  const view = controlledView ?? internalView;
  const taskView = ["tasks", "unscheduled", "completed"].includes(view);
  const [anchorDate, setAnchorDate] = useState(localDate);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [googleStatus, setGoogleStatus] = useState<GoogleConnectionStatus>();
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newAllDay, setNewAllDay] = useState(true);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [selectedItem, setSelectedItem] = useState<PlannerItemRecord>();
  const [editingItemId, setEditingItemId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<PlannerItemRecord>();
  const [editTitle, setEditTitle] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editAllDay, setEditAllDay] = useState(true);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const writeToGoogle =
    googleStatus?.connected === true &&
    googleStatus.consentMode === "read_write";
  const visibleRange = useMemo(() => calendarRange(anchorDate), [anchorDate]);

  const refresh = useCallback(async () => {
    if (!brainWorkspaceId) {
      setLoading(false);
      return;
    }
    const result = await loadPlannerItems(
      ipc,
      brainWorkspaceId,
      visibleRange,
      projectId,
    );
    if (result.ok) {
      setItems(result.data);
      setError("");
    } else setError(errorMessage(result));
    setLoading(false);
  }, [brainWorkspaceId, ipc, projectId, visibleRange]);

  const refreshGoogleStatus = useCallback(async () => {
    const result = await ipc.integrations.googleStatus();
    if (result.ok) setGoogleStatus(result.data);
  }, [ipc]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    void refreshGoogleStatus();
  }, [refresh, refreshGoogleStatus]);

  const changeView = (next: PlannerWorkspaceView) => {
    if (controlledView === undefined) setInternalView(next);
    onViewChange?.(next);
  };

  const syncGoogle = async () => {
    if (!brainWorkspaceId || syncing) return;
    setSyncing(true);
    setError("");
    const result = await ipc.integrations.googleSync(brainWorkspaceId);
    if (result.ok) await refresh();
    else setError(errorMessage(result));
    await refreshGoogleStatus();
    setSyncing(false);
  };

  const updateItem = async (
    item: PlannerItemRecord,
    patch: PlannerItemPatchRecord,
  ) => {
    if (!brainWorkspaceId || saving) return false;
    setSaving(true);
    setError("");
    const result = await ipc.planner.update(brainWorkspaceId, item.id, patch);
    if (result.ok) {
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? result.data : entry)),
      );
      setSaving(false);
      return true;
    }
    setError(errorMessage(result));
    setSaving(false);
    return false;
  };

  const createItem = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!brainWorkspaceId || saving || !newTitle.trim()) return;
    setSaving(true);
    setError("");
    try {
      let schedule: PlannerScheduleRecord | undefined;
      if (taskView && newDate) schedule = { kind: "date_only", date: newDate };
      if (!taskView && newAllDay)
        schedule = { kind: "all_day", date: newDate || anchorDate };
      if (!taskView && !newAllDay) {
        const startEpochSeconds = Math.floor(
          new Date(newStart).getTime() / 1_000,
        );
        const endEpochSeconds = Math.floor(new Date(newEnd).getTime() / 1_000);
        if (
          !Number.isFinite(startEpochSeconds) ||
          !Number.isFinite(endEpochSeconds)
        )
          throw new Error("Choose a valid start and end time.");
        if (endEpochSeconds <= startEpochSeconds)
          throw new Error("The end time must be after the start time.");
        schedule = {
          kind: "exact",
          startEpochSeconds,
          endEpochSeconds,
          timezone,
        };
      }
      const result = await ipc.planner.create({
        brainWorkspaceId,
        draft: {
          kind: taskView ? "task" : "calendar",
          title: newTitle,
          ...(schedule ? { schedule } : {}),
          ...(projectId ? { projectId } : {}),
        },
        syncTarget: writeToGoogle ? "google" : "local",
      });
      if (!result.ok) {
        setError(errorMessage(result));
        return;
      }
      setItems((current) => [result.data, ...current]);
      setNewTitle("");
      if (taskView) setNewDate("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the schedule.");
    } finally {
      setSaving(false);
    }
  };

  const openEditor = useCallback((item: PlannerItemRecord) => {
    setEditingItemId(undefined);
    setSelectedItem(item);
    setEditTitle(item.title);
    setEditDetails(item.details ?? "");
    setEditLocation(item.location ?? "");
    setEditDate(itemDate(item) ?? "");
    if (item.schedule?.kind === "exact") {
      setEditAllDay(false);
      setEditStart(
        localDateTime(new Date(item.schedule.startEpochSeconds * 1_000)),
      );
      setEditEnd(
        localDateTime(
          new Date(
            (item.schedule.endEpochSeconds ??
              item.schedule.startEpochSeconds + 3_600) * 1_000,
          ),
        ),
      );
    } else {
      setEditAllDay(true);
      setEditStart("");
      setEditEnd("");
    }
  }, []);

  const chooseCalendarDate = useCallback((date: string) => {
    setNewDate(date);
    setNewAllDay(true);
    titleRef.current?.focus();
  }, []);

  const saveEditor = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedItem) return;
    try {
      let schedule: PlannerItemPatchRecord;
      if (selectedItem.kind === "task") {
        schedule = editDate
          ? { schedule: { kind: "date_only", date: editDate } }
          : { clearSchedule: true };
      } else if (editAllDay) {
        schedule = { schedule: { kind: "all_day", date: editDate } };
      } else {
        const startEpochSeconds = Math.floor(
          new Date(editStart).getTime() / 1_000,
        );
        const endEpochSeconds = Math.floor(new Date(editEnd).getTime() / 1_000);
        if (
          !Number.isFinite(startEpochSeconds) ||
          !Number.isFinite(endEpochSeconds)
        )
          throw new Error("Choose a valid start and end time.");
        if (endEpochSeconds <= startEpochSeconds)
          throw new Error("The end time must be after the start time.");
        schedule = {
          schedule: {
            kind: "exact",
            startEpochSeconds,
            endEpochSeconds,
            timezone,
          },
        };
      }
      const location = editLocation.trim();
      const saved = await updateItem(selectedItem, {
        title: editTitle,
        ...(editDetails ? { details: editDetails } : { clearDetails: true }),
        ...(location ? { location } : { clearLocation: true }),
        ...schedule,
      });
      if (saved) {
        setEditingItemId(undefined);
        setSelectedItem(undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the schedule.");
    }
  };

  const deleteItem = async () => {
    if (!brainWorkspaceId || !deleteTarget || saving) return;
    setSaving(true);
    setError("");
    const result = await ipc.planner.delete(brainWorkspaceId, deleteTarget.id);
    if (result.ok) {
      setItems((current) =>
        current.filter((item) => item.id !== deleteTarget.id),
      );
      setSelectedItem(undefined);
      setEditingItemId(undefined);
      setDeleteTarget(undefined);
    } else setError(errorMessage(result));
    setSaving(false);
  };

  const { calendarItems, taskItems } = useMemo(() => {
    const visible = items.filter((item) => item.status !== "archived");
    return {
      calendarItems: visible.filter(
        (item) =>
          item.kind !== "task" && item.status !== "completed" && item.schedule,
      ),
      taskItems: visible.filter((item) => item.kind === "task"),
    };
  }, [items]);
  const visibleCalendarItems = useMemo(() => {
    if (view === "today")
      return calendarItems.filter((item) => itemDate(item) === localDate());
    if (view === "week") {
      const end = addDays(anchorDate, 7);
      return calendarItems.filter((item) => {
        const date = itemDate(item);
        return Boolean(date && date >= anchorDate && date < end);
      });
    }
    return calendarItems;
  }, [anchorDate, calendarItems, view]);
  const visibleTaskItems = useMemo(() => {
    if (view === "unscheduled")
      return taskItems.filter(
        (item) => !item.schedule && item.status !== "completed",
      );
    if (view === "completed")
      return taskItems.filter((item) => item.status === "completed");
    return taskItems;
  }, [taskItems, view]);

  if (!brainWorkspaceId)
    return (
      <section className="planner-unavailable" aria-labelledby="planner-title">
        <CalendarDays aria-hidden="true" />
        <h1 id="planner-title">Create a Brain to start planning.</h1>
        <p>Tasks and calendar items need one Brain for durable storage.</p>
      </section>
    );

  return (
    <section
      className={`planner-workspace${compact ? " planner-workspace-compact" : ""}`}
      aria-labelledby="planner-title"
    >
      <header className="planner-workspace-header">
        <div>
          <p className="eyebrow">
            {projectName ? `${projectName} · Plan` : "Planner"}
          </p>
          <h1 id="planner-title">Calendar</h1>
          <p>Your schedule, tasks, and event details in one place.</p>
        </div>
      </header>

      {compact ? (
        <nav className="planner-view-tabs" aria-label="Planner views">
          {(["today", "tasks"] as const).map((entry) => (
            <button
              type="button"
              key={entry}
              aria-current={view === entry ? "page" : undefined}
              onClick={() => {
                changeView(entry);
              }}
            >
              {entry === "today" ? "Calendar" : "Tasks"}
            </button>
          ))}
        </nav>
      ) : null}

      {googleStatus?.connected && !writeToGoogle ? (
        <div className="planner-write-notice">
          <span>
            This calendar is read-only. Update access to edit its events here.
          </span>
          {onOpenSettings ? (
            <button
              type="button"
              className="button button-small"
              onClick={onOpenSettings}
            >
              Update access
            </button>
          ) : null}
        </div>
      ) : null}

      {!taskView ? (
        <div className="planner-range-toolbar">
          <div>
            <button
              type="button"
              className="icon-button"
              aria-label="Previous month"
              onClick={() => {
                setAnchorDate((date) => addMonths(date, -1));
              }}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Next month"
              onClick={() => {
                setAnchorDate((date) => addMonths(date, 1));
              }}
            >
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setAnchorDate(localDate());
              }}
            >
              Today
            </button>
            {googleStatus?.connected ? (
              <button
                type="button"
                className="button button-small"
                disabled={syncing}
                onClick={() => void syncGoogle()}
              >
                {syncing ? "Refreshing…" : "Refresh"}
              </button>
            ) : null}
          </div>
          <strong>
            {monthYearFormatter.format(dateFromLocal(anchorDate))}
          </strong>
        </div>
      ) : null}

      <form
        className="planner-quick-create"
        onSubmit={(event) => void createItem(event)}
      >
        <label className="planner-create-title">
          <span>{taskView ? "New task" : "New event"}</span>
          <input
            ref={titleRef}
            required
            maxLength={240}
            value={newTitle}
            onChange={(event) => {
              setNewTitle(event.target.value);
            }}
            placeholder={taskView ? "Add a task" : "Add an event"}
          />
        </label>
        {taskView ? (
          <label>
            <span>Due date</span>
            <input
              type="date"
              value={newDate}
              onChange={(event) => {
                setNewDate(event.target.value);
              }}
            />
          </label>
        ) : (
          <>
            <label>
              <span>Date</span>
              <input
                required
                type="date"
                value={newDate || anchorDate}
                onChange={(event) => {
                  setNewDate(event.target.value);
                }}
              />
            </label>
            <label className="planner-check-label">
              <input
                type="checkbox"
                checked={newAllDay}
                onChange={(event) => {
                  setNewAllDay(event.target.checked);
                }}
              />
              <span>All day</span>
            </label>
            {!newAllDay ? (
              <>
                <label>
                  <span>Start</span>
                  <input
                    required
                    type="datetime-local"
                    value={newStart}
                    onChange={(event) => {
                      setNewStart(event.target.value);
                    }}
                  />
                </label>
                <label>
                  <span>End</span>
                  <input
                    required
                    type="datetime-local"
                    value={newEnd}
                    onChange={(event) => {
                      setNewEnd(event.target.value);
                    }}
                  />
                </label>
              </>
            ) : null}
          </>
        )}
        <button
          type="submit"
          className="button button-primary"
          disabled={saving}
        >
          <Plus aria-hidden="true" />
          {saving ? "Adding…" : `Add ${taskView ? "task" : "event"}`}
        </button>
      </form>

      {error ? (
        <div className="planner-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="button button-small"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {view === "month" ? (
        <CalendarGrid
          anchorDate={anchorDate}
          items={visibleCalendarItems}
          onOpen={openEditor}
          onChooseDate={chooseCalendarDate}
        />
      ) : taskView ? (
        <TaskList
          loading={loading}
          items={visibleTaskItems}
          saving={saving}
          onOpen={openEditor}
          onToggle={(item) =>
            void updateItem(item, {
              status: item.status === "completed" ? "open" : "completed",
            })
          }
        />
      ) : (
        <AgendaList
          loading={loading}
          items={visibleCalendarItems}
          onOpen={openEditor}
        />
      )}

      <ItemEditor
        item={selectedItem}
        title={editTitle}
        details={editDetails}
        location={editLocation}
        date={editDate}
        allDay={editAllDay}
        start={editStart}
        end={editEnd}
        saving={saving}
        canWrite={!selectedItem?.providerLink || writeToGoogle}
        editing={selectedItem?.id === editingItemId}
        onTitleChange={setEditTitle}
        onDetailsChange={setEditDetails}
        onLocationChange={setEditLocation}
        onDateChange={setEditDate}
        onAllDayChange={setEditAllDay}
        onStartChange={setEditStart}
        onEndChange={setEditEnd}
        onSave={(event) => void saveEditor(event)}
        onDelete={() => {
          if (selectedItem) setDeleteTarget(selectedItem);
        }}
        onEdit={() => {
          if (selectedItem) setEditingItemId(selectedItem.id);
        }}
        onOpenSource={onOpenSource}
        onOpenSettings={onOpenSettings}
        onClose={() => {
          setEditingItemId(undefined);
          setSelectedItem(undefined);
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.kind === "task" ? "task" : "event"}?`}
        message={`“${deleteTarget?.title ?? "This item"}” will be deleted${deleteTarget?.providerLink?.provider === "google" ? " from Google and this app" : " from this app"}.`}
        confirmLabel="Delete"
        dangerous
        busy={saving}
        onConfirm={() => void deleteItem()}
        onClose={() => {
          setDeleteTarget(undefined);
        }}
      />
    </section>
  );
}

const CalendarGrid = memo(function CalendarGrid({
  anchorDate,
  items,
  onChooseDate,
  onOpen,
}: {
  anchorDate: string;
  items: PlannerItemRecord[];
  onChooseDate: (date: string) => void;
  onOpen: (item: PlannerItemRecord) => void;
}) {
  const dates = useMemo(() => calendarDates(anchorDate), [anchorDate]);
  const itemsByDate = useMemo(() => {
    const grouped = new Map<
      string,
      { item: PlannerItemRecord; time: string | undefined }[]
    >();
    for (const item of items) {
      const date = itemDate(item);
      if (!date) continue;
      const entries = grouped.get(date) ?? [];
      entries.push({ item, time: itemTime(item) });
      grouped.set(date, entries);
    }
    return grouped;
  }, [items]);
  const month = anchorDate.slice(0, 7);
  return (
    <div
      className="planner-calendar planner-calendar-month"
      aria-label="Month calendar"
    >
      {dates.slice(0, 7).map((date) => (
        <div className="planner-calendar-day-name" key={`day-${date}`}>
          {weekdayFormatter.format(dateFromLocal(date))}
        </div>
      ))}
      {dates.map((date) => (
        <section
          className="planner-calendar-day"
          data-outside={!date.startsWith(month) ? "true" : undefined}
          data-today={date === localDate() ? "true" : undefined}
          aria-label={fullDateFormatter.format(dateFromLocal(date))}
          key={date}
        >
          <button
            type="button"
            className="planner-calendar-date"
            aria-label={`Add an event on ${date}`}
            onClick={() => {
              onChooseDate(date);
            }}
          >
            {dateFromLocal(date).getDate()}
          </button>
          <ul>
            {(itemsByDate.get(date) ?? []).map(({ item, time }) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="planner-calendar-event"
                  onClick={() => {
                    onOpen(item);
                  }}
                >
                  {time ? <span>{time}</span> : null}
                  <strong>{item.title}</strong>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
});

function AgendaList({
  loading,
  items,
  onOpen,
}: {
  loading: boolean;
  items: PlannerItemRecord[];
  onOpen: (item: PlannerItemRecord) => void;
}) {
  if (loading)
    return (
      <div className="planner-list-loading" role="status">
        Loading calendar…
      </div>
    );
  const sorted = [...items].sort((left, right) =>
    (itemDate(left) ?? "").localeCompare(itemDate(right) ?? ""),
  );
  return sorted.length ? (
    <ul className="planner-agenda" aria-label="Calendar agenda">
      {sorted.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => {
              onOpen(item);
            }}
          >
            <span>{formatSchedule(item)}</span>
            <strong>{item.title}</strong>
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <div className="planner-task-empty">
      <CalendarDays aria-hidden="true" />
      <p>No events in this view.</p>
    </div>
  );
}

function TaskList({
  loading,
  items,
  saving,
  onOpen,
  onToggle,
}: {
  loading: boolean;
  items: PlannerItemRecord[];
  saving: boolean;
  onOpen: (item: PlannerItemRecord) => void;
  onToggle: (item: PlannerItemRecord) => void;
}) {
  if (loading)
    return (
      <div className="planner-list-loading" role="status">
        Loading tasks…
      </div>
    );
  const open = items.filter((item) => item.status !== "completed");
  const completed = items.filter((item) => item.status === "completed");
  return (
    <div className="planner-task-board">
      <section aria-labelledby="open-tasks-title">
        <header>
          <h2 id="open-tasks-title">My tasks</h2>
          <span>{open.length}</span>
        </header>
        {open.length ? (
          <ul className="planner-task-list">
            {open.map((item) => (
              <TaskRow
                key={item.id}
                item={item}
                saving={saving}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </ul>
        ) : (
          <div className="planner-task-empty">
            <Check aria-hidden="true" />
            <p>You’re caught up.</p>
          </div>
        )}
      </section>
      <details
        className="planner-completed"
        open={completed.length > 0 && open.length === 0}
      >
        <summary>Completed ({completed.length})</summary>
        <ul className="planner-task-list">
          {completed.map((item) => (
            <TaskRow
              key={item.id}
              item={item}
              saving={saving}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </details>
    </div>
  );
}

function TaskRow({
  item,
  saving,
  onOpen,
  onToggle,
}: {
  item: PlannerItemRecord;
  saving: boolean;
  onOpen: (item: PlannerItemRecord) => void;
  onToggle: (item: PlannerItemRecord) => void;
}) {
  return (
    <li data-completed={item.status === "completed" ? "true" : undefined}>
      <button
        type="button"
        className="planner-complete"
        aria-label={`${item.status === "completed" ? "Reopen" : "Complete"} ${item.title}`}
        disabled={saving}
        onClick={() => {
          onToggle(item);
        }}
      >
        {item.status === "completed" ? <Check aria-hidden="true" /> : null}
      </button>
      <button
        type="button"
        className="planner-task-content"
        onClick={() => {
          onOpen(item);
        }}
      >
        <strong>{item.title}</strong>
        <span>{formatSchedule(item)}</span>
        {item.details ? <small>{item.details}</small> : null}
      </button>
    </li>
  );
}

function ItemEditor(props: {
  item?: PlannerItemRecord | undefined;
  title: string;
  details: string;
  location: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  saving: boolean;
  canWrite: boolean;
  editing: boolean;
  onTitleChange: (value: string) => void;
  onDetailsChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onAllDayChange: (value: boolean) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpenSource?: ((source: WorkspacePath) => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  onClose: () => void;
}) {
  const { item } = props;
  const task = item?.kind === "task";
  const savedLocation = item?.location?.trim();
  const mapUrl = savedLocation
    ? `https://www.google.com/maps?q=${encodeURIComponent(savedLocation)}&output=embed`
    : undefined;
  if (item && !task && !props.editing)
    return (
      <ModalDialog open title="Event details" onClose={props.onClose}>
        <section className="planner-event-details">
          <header className="planner-event-summary-heading">
            <span className="planner-event-color" aria-hidden="true" />
            <div>
              <h3>{item.title}</h3>
              <p>{formatSchedule(item)}</p>
            </div>
          </header>
          {savedLocation ? (
            <div className="planner-event-summary-row planner-event-map-row">
              <MapPin aria-hidden="true" />
              <div>
                <p>{savedLocation}</p>
                {mapUrl ? (
                  <iframe
                    className="planner-location-map"
                    title={`Map of ${savedLocation}`}
                    src={mapUrl}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          {item.details ? (
            <div className="planner-event-summary-row">
              <AlignLeft aria-hidden="true" />
              <p className="planner-event-notes">{item.details}</p>
            </div>
          ) : null}
          {!props.canWrite ? (
            <div className="planner-editor-notice">
              <span>Update calendar access to change this event.</span>
              {props.onOpenSettings ? (
                <button
                  type="button"
                  className="button button-small"
                  onClick={props.onOpenSettings}
                >
                  Update access
                </button>
              ) : null}
            </div>
          ) : null}
          <footer className="modal-dialog-actions planner-editor-actions">
            <button
              type="button"
              className="button button-danger-quiet"
              disabled={props.saving || !props.canWrite}
              onClick={props.onDelete}
            >
              Delete
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!props.canWrite}
              onClick={props.onEdit}
            >
              <Pencil size={15} aria-hidden="true" />
              Edit event
            </button>
          </footer>
        </section>
      </ModalDialog>
    );
  return (
    <ModalDialog
      open={Boolean(item)}
      title={task ? "Task" : "Edit event"}
      onClose={props.onClose}
    >
      {item ? (
        <form className="planner-item-editor" onSubmit={props.onSave}>
          <div className="planner-editor-title-row">
            <span className="planner-event-color" aria-hidden="true" />
            <label className="planner-editor-title">
              <span className="sr-only">Title</span>
              <input
                required
                maxLength={240}
                value={props.title}
                onChange={(event) => {
                  props.onTitleChange(event.target.value);
                }}
              />
            </label>
          </div>

          <div className="planner-editor-detail-row">
            <CalendarDays aria-hidden="true" />
            <div className="planner-editor-schedule">
              {task ? (
                <label>
                  <span>Due date</span>
                  <input
                    type="date"
                    value={props.date}
                    onChange={(event) => {
                      props.onDateChange(event.target.value);
                    }}
                  />
                </label>
              ) : (
                <>
                  {props.allDay ? (
                    <label>
                      <span>Date</span>
                      <input
                        required
                        type="date"
                        value={props.date}
                        onChange={(event) => {
                          props.onDateChange(event.target.value);
                        }}
                      />
                    </label>
                  ) : (
                    <div className="planner-editor-time-grid">
                      <label>
                        <span>Start</span>
                        <input
                          required
                          type="datetime-local"
                          value={props.start}
                          onChange={(event) => {
                            props.onStartChange(event.target.value);
                          }}
                        />
                      </label>
                      <label>
                        <span>End</span>
                        <input
                          required
                          type="datetime-local"
                          value={props.end}
                          onChange={(event) => {
                            props.onEndChange(event.target.value);
                          }}
                        />
                      </label>
                    </div>
                  )}
                  <label className="planner-check-label">
                    <input
                      type="checkbox"
                      checked={props.allDay}
                      onChange={(event) => {
                        props.onAllDayChange(event.target.checked);
                      }}
                    />
                    <span>All day</span>
                  </label>
                </>
              )}
            </div>
          </div>

          {!task ? (
            <div className="planner-editor-detail-row planner-editor-location-row">
              <MapPin aria-hidden="true" />
              <div>
                <label>
                  <span>Location</span>
                  <input
                    maxLength={500}
                    value={props.location}
                    onChange={(event) => {
                      props.onLocationChange(event.target.value);
                    }}
                    placeholder="Add a place or address"
                  />
                </label>
                {mapUrl && savedLocation ? (
                  <iframe
                    className="planner-location-map"
                    title={`Map of ${savedLocation}`}
                    src={mapUrl}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="planner-editor-detail-row">
            <AlignLeft aria-hidden="true" />
            <label>
              <span>Notes</span>
              <textarea
                rows={4}
                maxLength={20_000}
                value={props.details}
                onChange={(event) => {
                  props.onDetailsChange(event.target.value);
                }}
                placeholder="Add notes"
              />
            </label>
          </div>
          {!props.canWrite ? (
            <div className="planner-editor-notice">
              <span>Update calendar access to save changes.</span>
              {props.onOpenSettings ? (
                <button
                  type="button"
                  className="button button-small"
                  onClick={props.onOpenSettings}
                >
                  Connection settings
                </button>
              ) : null}
            </div>
          ) : null}
          <footer className="modal-dialog-actions planner-editor-actions">
            <div>
              <button
                type="button"
                className="button button-danger-quiet"
                disabled={props.saving || !props.canWrite}
                onClick={props.onDelete}
              >
                Delete
              </button>
              {item.sourceLink && props.onOpenSource ? (
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    item.sourceLink && props.onOpenSource?.(item.sourceLink)
                  }
                >
                  Open source
                </button>
              ) : null}
            </div>
            <div>
              <button
                type="button"
                className="button"
                disabled={props.saving}
                onClick={props.onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={props.saving || !props.canWrite}
              >
                {props.saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </footer>
        </form>
      ) : null}
    </ModalDialog>
  );
}
