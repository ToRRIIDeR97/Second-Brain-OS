import type { Activity } from "../../state/shell";

export type NavigatorEntry = {
  id: string;
  label: string;
  secondary?: string;
};

export type NavigatorItem = NavigatorEntry;

const items: Record<Activity, string[]> = {
  home: ["Overview", "Recent", "Pinned"],
  knowledge: ["All notes"],
  files: ["Workspace files", "Favorites", "Recent files"],
  graph: ["Focused graph", "Saved lenses", "Backlinks"],
  search: ["Search everywhere", "Recent searches", "Filters"],
  planner: ["Today", "Tasks", "Calendar"],
  agents: ["Sessions", "Review queue", "Context packets"],
  terminal: ["Terminal tabs", "Presets", "Output"],
  "source-control": ["Changes", "History", "Branches"],
  settings: ["General", "Workspaces", "Permissions"],
};

const title = (activity: Activity) =>
  activity === "source-control"
    ? "Source control"
    : `${activity.slice(0, 1).toUpperCase()}${activity.slice(1)}`;

export type NavigatorProps = {
  activity: Activity;
  dailyNotes?: readonly NavigatorEntry[];
  collections?: readonly NavigatorEntry[];
  selectedItemId?: string;
  onDailyNoteSelect?: (note: NavigatorEntry) => void;
  onCollectionSelect?: (collection: NavigatorEntry) => void;
  onItemSelect?: (item: NavigatorItem) => void;
};

export function Navigator({
  activity,
  dailyNotes = [],
  collections = [],
  selectedItemId,
  onDailyNoteSelect,
  onCollectionSelect,
  onItemSelect,
}: NavigatorProps) {
  const selectStatic = (label: string) => {
    onItemSelect?.({ id: label, label });
  };
  const renderEntry = (
    entry: NavigatorEntry,
    kind: "daily-note" | "collection",
  ) => {
    const selected = entry.id === selectedItemId;
    return (
      <button
        type="button"
        className="navigator-item"
        key={`${kind}-${entry.id}`}
        data-selected={selected ? "true" : undefined}
        onClick={() => {
          if (kind === "daily-note") onDailyNoteSelect?.(entry);
          else onCollectionSelect?.(entry);
          onItemSelect?.(entry);
        }}
      >
        <span className="navigator-glyph" aria-hidden="true">
          {selected ? "◆" : "◇"}
        </span>
        <span>
          {entry.label}
          {entry.secondary ? <small> · {entry.secondary}</small> : null}
        </span>
      </button>
    );
  };

  return (
    <aside className="navigator" aria-label={`${title(activity)} navigator`}>
      <div className="region-heading">
        <div>
          <p className="eyebrow">Navigator</p>
          <h2>{title(activity)}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Navigator actions"
          title="Navigator actions"
        >
          •••
        </button>
      </div>
      <div className="navigator-items">
        {items[activity].map((label, index) => {
          const selected = selectedItemId
            ? selectedItemId === label
            : index === 0;
          return (
            <button
              type="button"
              className="navigator-item"
              key={label}
              data-selected={selected ? "true" : undefined}
              onClick={() => {
                selectStatic(label);
              }}
            >
              <span className="navigator-glyph" aria-hidden="true">
                {selected ? "◆" : "◇"}
              </span>
              {label}
            </button>
          );
        })}
        {activity === "knowledge" ? (
          <>
            <p className="eyebrow">Daily notes</p>
            {dailyNotes.length > 0 ? (
              dailyNotes.map((entry) => renderEntry(entry, "daily-note"))
            ) : (
              <p>No daily notes.</p>
            )}
            <p className="eyebrow">Collections</p>
            {collections.length > 0 ? (
              collections.map((entry) => renderEntry(entry, "collection"))
            ) : (
              <p>No collections.</p>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
}
