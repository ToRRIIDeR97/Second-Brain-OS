/* eslint-disable react-refresh/only-export-components */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  Activity as ActivityIconGlyph,
  CalendarDays,
  FileText,
  Folder,
  GitBranch,
  House,
  LibraryBig,
  Network,
  Search,
  Settings,
  Sparkles,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type { Activity } from "../../state/shell";

export const PRIMARY_ACTIVITIES = [
  "home",
  "projects",
  "calendar",
  "knowledge",
  "activity",
] as const satisfies readonly Activity[];

export type PrimaryActivity = (typeof PRIMARY_ACTIVITIES)[number];

const labels: Record<Activity, string> = {
  home: "Home",
  projects: "Projects",
  calendar: "Calendar",
  knowledge: "Knowledge",
  activity: "Activity",
  files: "Files",
  graph: "Graph",
  search: "Search",
  planner: "Tasks",
  agents: "Agents",
  terminal: "Terminal",
  "source-control": "Git",
  settings: "Settings",
};

const icons: Record<Activity, LucideIcon> = {
  home: House,
  projects: Folder,
  calendar: CalendarDays,
  knowledge: LibraryBig,
  activity: ActivityIconGlyph,
  files: FileText,
  graph: Network,
  search: Search,
  planner: CalendarDays,
  agents: Sparkles,
  terminal: SquareTerminal,
  "source-control": GitBranch,
  settings: Settings,
};

export type ActivityBadges = Partial<Record<Activity, ReactNode>>;

function RailButton({
  activity,
  active,
  badge,
  onChange,
  onKeyDown,
  buttonRef,
}: {
  activity: Activity;
  active: boolean;
  badge?: ReactNode;
  onChange: (activity: Activity) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  const Icon = icons[activity];
  return (
    <button
      ref={buttonRef}
      type="button"
      className="activity-button"
      data-activity={activity}
      aria-label={labels[activity]}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : undefined}
      title={labels[activity]}
      tabIndex={active ? 0 : -1}
      onKeyDown={onKeyDown}
      onClick={() => {
        onChange(activity);
      }}
    >
      <span className="activity-icon-wrap" aria-hidden="true">
        <Icon className="activity-icon" size={18} strokeWidth={1.8} />
        {badge !== undefined ? (
          <span className="activity-badge">{badge}</span>
        ) : null}
      </span>
      <small>{labels[activity]}</small>
    </button>
  );
}

export function ActivityBar({
  active,
  onChange,
  badges = {},
}: {
  active: Activity;
  onChange: (activity: Activity) => void;
  badges?: ActivityBadges;
}) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const visibleActivities: readonly Activity[] = [
    ...PRIMARY_ACTIVITIES,
    "settings",
  ];
  const handleKeyDown = (
    activity: Activity,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const currentIndex = visibleActivities.indexOf(activity);
    if (currentIndex < 0) return;
    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % visibleActivities.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextIndex =
          (currentIndex - 1 + visibleActivities.length) %
          visibleActivities.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = visibleActivities.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextActivity = visibleActivities[nextIndex];
    if (nextActivity) buttonRefs.current[nextActivity]?.focus();
  };
  const railButton = (activity: Activity) => (
    <RailButton
      key={activity}
      activity={activity}
      active={active === activity}
      badge={badges[activity]}
      onChange={onChange}
      onKeyDown={(event) => {
        handleKeyDown(activity, event);
      }}
      buttonRef={(element) => {
        buttonRefs.current[activity] = element;
      }}
    />
  );
  return (
    <nav className="activity-bar" aria-label="Primary activity">
      <div className="activity-logo" aria-label="Second Brain OS" role="img">
        SB
      </div>
      <div className="activity-list">{PRIMARY_ACTIVITIES.map(railButton)}</div>
      <div className="activity-settings" data-section="settings">
        {railButton("settings")}
      </div>
    </nav>
  );
}
