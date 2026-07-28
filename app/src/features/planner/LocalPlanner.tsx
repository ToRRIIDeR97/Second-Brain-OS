import { useState, type SyntheticEvent } from "react";
import {
  isDateOnly,
  localDateForEpoch,
  LocalPlannerStore,
  sortPlannerItems,
  scheduleDate,
  PlannerValidationError,
} from "./local";
import type {
  PlannerItem,
  PlannerItemDraft,
  PlannerSchedule,
  PlannerView,
} from "./types";

type Props = {
  initialItems?: PlannerItem[];
  nowEpochSeconds?: number;
  timezone?: string;
  onItemsChange?: (items: PlannerItem[]) => void;
  onOpenSource?: (source: NonNullable<PlannerItem["sourceLink"]>) => void;
};

const views: Array<{ id: PlannerView; label: string }> = [
  { id: "today", label: "Today" },
  { id: "agenda", label: "Agenda" },
  { id: "upcoming", label: "Upcoming" },
  { id: "unscheduled", label: "Unscheduled" },
  { id: "completed", label: "Completed" },
  { id: "tasks", label: "Tasks" },
];

export function LocalPlanner({
  initialItems = [],
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  onItemsChange,
  onOpenSource,
}: Props) {
  const [store] = useState(
    () => new LocalPlannerStore(initialItems, nowEpochSeconds),
  );
  const [, setRevision] = useState(0);
  const [view, setView] = useState<PlannerView>("today");
  const [title, setTitle] = useState("");
  const [scheduleMode, setScheduleMode] = useState<
    "none" | "date" | "all_day" | "exact"
  >("none");
  const [dateValue, setDateValue] = useState("");
  const [exactValue, setExactValue] = useState("");
  const [error, setError] = useState("");
  const groups = store.groups(nowEpochSeconds, timezone);
  const items = (() => {
    if (view === "tasks") {
      return sortPlannerItems(
        store
          .list()
          .filter((item) => item.status !== "archived" && item.kind === "task"),
      );
    }
    return groups[view];
  })();

  const notifyChange = () => {
    setRevision((current) => current + 1);
    onItemsChange?.(store.list());
  };

  const scheduleFromForm = (): PlannerSchedule | undefined => {
    if (scheduleMode === "none") return undefined;
    if (
      (scheduleMode === "date" || scheduleMode === "all_day") &&
      !isDateOnly(dateValue)
    ) {
      throw new PlannerValidationError("planner.invalid_date");
    }
    if (scheduleMode === "date") return { kind: "date_only", date: dateValue };
    if (scheduleMode === "all_day") return { kind: "all_day", date: dateValue };
    if (!exactValue)
      throw new PlannerValidationError("planner.exact_time_required");
    const epochSeconds = Math.floor(new Date(exactValue).getTime() / 1_000);
    if (!Number.isFinite(epochSeconds)) {
      throw new PlannerValidationError("planner.invalid_exact_time");
    }
    return { kind: "exact", startEpochSeconds: epochSeconds, timezone };
  };

  const createItem = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const schedule = scheduleFromForm();
      const draft: PlannerItemDraft = {
        title,
        ...(schedule === undefined ? {} : { schedule }),
      };
      store.create(draft);
      setTitle("");
      setDateValue("");
      setExactValue("");
      setScheduleMode("none");
      setError("");
      setView("tasks");
      notifyChange();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "planner.create_failed",
      );
    }
  };

  const toggleComplete = (item: PlannerItem) => {
    try {
      if (item.status === "completed")
        store.update(item.id, { status: "open" });
      else store.complete(item.id);
      notifyChange();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "planner.update_failed",
      );
    }
  };

  const archive = (item: PlannerItem) => {
    try {
      store.archive(item.id);
      notifyChange();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "planner.archive_failed",
      );
    }
  };

  return (
    <section className="planner-feature" aria-labelledby="planner-title">
      <header className="planner-heading">
        <div>
          <p className="eyebrow">Local planner</p>
          <h1 id="planner-title">Plan the work in front of you.</h1>
          <p>
            Local items stay available offline. Provider links are shown only
            when explicitly present.
          </p>
        </div>
        <span className="planner-timezone" title={timezone}>
          {localDateForEpoch(nowEpochSeconds, timezone)} · {timezone}
        </span>
      </header>

      <nav className="planner-views" aria-label="Planner views">
        {views.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="button"
            aria-current={view === entry.id ? "page" : undefined}
            onClick={() => {
              setView(entry.id);
            }}
          >
            {entry.label}
            {entry.id !== "tasks"
              ? ` (${String(groups[entry.id].length)})`
              : null}
          </button>
        ))}
      </nav>

      <form
        className="planner-form"
        onSubmit={createItem}
        aria-label="Create local planner item"
      >
        <label>
          Title
          <input
            required
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder="Add a task, milestone, or focus block"
          />
        </label>
        <label>
          When
          <select
            value={scheduleMode}
            onChange={(event) => {
              setScheduleMode(event.target.value as typeof scheduleMode);
            }}
          >
            <option value="none">Unscheduled</option>
            <option value="date">Date only</option>
            <option value="all_day">All day</option>
            <option value="exact">Exact time</option>
          </select>
        </label>
        {scheduleMode === "date" || scheduleMode === "all_day" ? (
          <label>
            Date
            <input
              type="date"
              required
              value={dateValue}
              onChange={(event) => {
                setDateValue(event.target.value);
              }}
            />
          </label>
        ) : null}
        {scheduleMode === "exact" ? (
          <label>
            Start time ({timezone})
            <input
              type="datetime-local"
              required
              value={exactValue}
              onChange={(event) => {
                setExactValue(event.target.value);
              }}
            />
          </label>
        ) : null}
        <button className="button button-primary" type="submit">
          Add locally
        </button>
      </form>

      {error ? (
        <p className="planner-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="planner-status" role="status" aria-live="polite">
        {items.length} {view === "tasks" ? "task" : view} shown · local-only
        changes
      </p>

      {items.length ? (
        <ul className="planner-list" aria-label={`${view} planner items`}>
          {items.map((item) => (
            <li key={item.id} className="planner-item">
              <input
                type="checkbox"
                checked={item.status === "completed"}
                aria-label={`${item.status === "completed" ? "Reopen" : "Complete"} ${item.title}`}
                onChange={() => {
                  toggleComplete(item);
                }}
              />
              <div className="planner-item-content">
                <strong>{item.title}</strong>
                <small>
                  {item.schedule
                    ? formatSchedule(item.schedule)
                    : "Unscheduled"}{" "}
                  · {item.syncStatus.replace("_", " ")}
                </small>
                {item.sourceLink ? (
                  <button
                    type="button"
                    className="planner-source-link"
                    onClick={() => {
                      if (item.sourceLink) onOpenSource?.(item.sourceLink);
                    }}
                  >
                    Open source: {item.sourceLink.relativePath}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className="button button-small"
                aria-label={`Archive ${item.title}`}
                onClick={() => {
                  archive(item);
                }}
              >
                Archive
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="planner-empty">
          Nothing here yet. Add a local item above.
        </p>
      )}
    </section>
  );
}

function formatSchedule(schedule: PlannerSchedule): string {
  if (schedule.kind === "date_only") return schedule.date;
  if (schedule.kind === "all_day") return `${schedule.date} · all day`;
  return `${scheduleDate(schedule)} · ${new Date(schedule.startEpochSeconds * 1_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
