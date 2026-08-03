/* eslint-disable react-refresh/only-export-components */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Activity } from "../../state/shell";

/** The activities that are always visible in the workbench rail. */
export const PRIMARY_ACTIVITIES = [
  "home",
  "knowledge",
  "graph",
  "planner",
  "agents",
] as const satisfies readonly Activity[];

export type PrimaryActivity = (typeof PRIMARY_ACTIVITIES)[number];

const labels: Record<Activity, string> = {
  home: "Home",
  knowledge: "Knowledge",
  files: "Files",
  graph: "Graph",
  search: "Search",
  planner: "Tasks",
  calendar: "Calendar",
  agents: "Agents",
  terminal: "Terminal",
  "source-control": "Git",
  settings: "Settings",
};

type ActivityIconProps = { activity: Activity };

/**
 * Keep the rail icon-only at the visual level while exposing a text label to
 * screen readers. Inline SVGs avoid adding an icon package to the shell's
 * critical path and inherit the current text color from the button.
 */
function ActivityIcon({ activity }: ActivityIconProps) {
  const common = {
    className: "activity-icon",
    viewBox: "0 0 24 24",
    width: 17,
    height: 17,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (activity) {
    case "home":
      return (
        <svg {...common}>
          <path d="m3.5 10.6 8.5-7 8.5 7" />
          <path d="M5.5 9.8v10.7h13V9.8M9.5 20.5v-6h5v6" />
        </svg>
      );
    case "knowledge":
      return (
        <svg {...common}>
          <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17z" />
          <path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18M8.5 8h6M8.5 11h4" />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path d="M3.5 7.5h6l2 2h9v9.8a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" />
          <path d="M3.5 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h4l2 2h4" />
        </svg>
      );
    case "graph":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="18" cy="7.5" r="2.2" />
          <circle cx="12" cy="18" r="2.2" />
          <path d="m7.9 7 7.9 1.6M7.4 7.8l3.2 8.2m5.9-.7-3-5.8" />
        </svg>
      );
    case "agents":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path d="M8 10h.01M16 10h.01M8 14h8M12 5V3" />
          <path d="M2.5 10v4M21.5 10v4" />
        </svg>
      );
    case "source-control":
      return (
        <svg {...common}>
          <circle cx="7" cy="6" r="2.2" />
          <circle cx="17" cy="18" r="2.2" />
          <circle cx="17" cy="6" r="2.2" />
          <path d="M9.2 6H14M7 8.2v5a4.8 4.8 0 0 0 4.8 4.8H15" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
          <circle cx="12" cy="12" r="4.2" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.8" cy="10.8" r="6.3" />
          <path d="m16 16 4.3 4.3" />
        </svg>
      );
    case "planner":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 9h16M8 13h2M12 13h2M16 13h.01M8 16h2" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 9h16M8 13h2M12 13h2M16 13h.01M8 16h2" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <path d="m5 7 5 5-5 5M12.5 17H19" />
        </svg>
      );
    default:
      return null;
  }
}

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
        <ActivityIcon activity={activity} />
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
  const focusActivity = (activity: Activity) => {
    buttonRefs.current[activity]?.focus();
  };
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
    if (nextActivity) focusActivity(nextActivity);
  };

  return (
    <nav className="activity-bar" aria-label="Primary activity">
      <div className="activity-logo" aria-label="Second Brain OS" role="img">
        SB
      </div>
      <div className="activity-list">
        {PRIMARY_ACTIVITIES.map((activity) => (
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
        ))}
      </div>
      <div className="activity-settings" data-section="settings">
        <RailButton
          activity="settings"
          active={active === "settings"}
          badge={badges.settings}
          onChange={onChange}
          onKeyDown={(event) => {
            handleKeyDown("settings", event);
          }}
          buttonRef={(element) => {
            buttonRefs.current.settings = element;
          }}
        />
      </div>
    </nav>
  );
}
