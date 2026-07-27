import type { Activity } from "../../state/shell";

const items: Record<Activity, string[]> = {
  home: ["Overview", "Recent", "Pinned"],
  knowledge: ["All notes", "Daily notes", "Collections"],
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

export function Navigator({ activity }: { activity: Activity }) {
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
        {items[activity].map((item, index) => (
          <button
            type="button"
            className="navigator-item"
            key={item}
            data-selected={index === 0 ? "true" : undefined}
          >
            <span className="navigator-glyph" aria-hidden="true">
              {index === 0 ? "◆" : "◇"}
            </span>
            {item}
          </button>
        ))}
      </div>
      <div className="navigator-hint">
        <span className="status-dot" aria-hidden="true" />
        Local workspace ready
      </div>
    </aside>
  );
}
