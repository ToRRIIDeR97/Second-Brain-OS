import type { Activity } from "../../state/shell";

const primaryActivities: Activity[] = [
  "home",
  "knowledge",
  "files",
  "graph",
  "source-control",
  "settings",
];

const labels: Record<Activity, string> = {
  home: "Home",
  knowledge: "Knowledge",
  files: "Files",
  graph: "Graph",
  search: "Search",
  planner: "Planner",
  agents: "Agents",
  terminal: "Terminal",
  "source-control": "Source Control",
  settings: "Settings",
};

const symbols: Record<Activity, string> = {
  home: "⌂",
  knowledge: "✦",
  files: "▤",
  graph: "⌘",
  search: "⌕",
  planner: "◷",
  agents: "◎",
  terminal: "›_",
  "source-control": "⑂",
  settings: "⚙",
};

export function ActivityBar({
  active,
  onChange,
}: {
  active: Activity;
  onChange: (activity: Activity) => void;
}) {
  return (
    <nav className="activity-bar" aria-label="Primary activity">
      <div className="activity-logo" aria-label="Second Brain OS">
        SB
      </div>
      <div className="activity-list">
        {primaryActivities.map((activity) => (
          <button
            type="button"
            key={activity}
            className="activity-button"
            aria-label={labels[activity]}
            aria-current={active === activity ? "page" : undefined}
            data-active={active === activity ? "true" : undefined}
            title={labels[activity]}
            onClick={() => {
              onChange(activity);
            }}
          >
            <span aria-hidden="true">{symbols[activity]}</span>
            <small>{labels[activity]}</small>
          </button>
        ))}
      </div>
    </nav>
  );
}
