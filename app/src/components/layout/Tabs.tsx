import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Bot,
  CirclePlus,
  Clock3,
  FileText,
  GitCompareArrows,
  Network,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import type { Activity, ShellTab } from "../../state/shell";

const activityTabChoices: readonly { activity: Activity; label: string }[] = [
  { activity: "home", label: "Home" },
  { activity: "knowledge", label: "Files" },
  { activity: "planner", label: "Tasks" },
  { activity: "agents", label: "Agents" },
];

export type ResourceKind =
  | "activity"
  | "file"
  | "preview"
  | "graph"
  | "git-diff"
  | "agent-session"
  | "terminal"
  | "custom";

type ResourceTabKind = ResourceKind | (string & {});

/** A shell tab with enough metadata for resource-oriented tab strips. */
export type ResourceTab = ShellTab & {
  kind?: ResourceTabKind;
  resourceType?: ResourceTabKind;
  icon?: ReactNode;
  description?: string;
  closable?: boolean;
  pinned?: boolean;
  preview?: boolean;
};

const resourceLabels: Record<ResourceKind, string> = {
  activity: "Activity",
  file: "File",
  preview: "Preview",
  graph: "Graph",
  "git-diff": "Git diff",
  "agent-session": "Agent session",
  terminal: "Terminal",
  custom: "Resource",
};

function ResourceIcon({ kind }: { kind: ResourceKind }) {
  const common = { size: 15, strokeWidth: 1.8, "aria-hidden": true } as const;
  switch (kind) {
    case "file":
    case "preview":
      return <FileText {...common} />;
    case "graph":
      return <Network {...common} />;
    case "git-diff":
      return <GitCompareArrows {...common} />;
    case "agent-session":
      return <Bot {...common} />;
    case "terminal":
      return <SquareTerminal {...common} />;
    case "activity":
      return <Clock3 {...common} />;
    case "custom":
    default:
      return <CirclePlus {...common} />;
  }
}

const resourceKinds: readonly ResourceKind[] = [
  "activity",
  "file",
  "preview",
  "graph",
  "git-diff",
  "agent-session",
  "terminal",
  "custom",
];

function getKind(tab: ResourceTab): ResourceKind {
  const candidate = tab.kind ?? tab.resourceType;
  return candidate && resourceKinds.includes(candidate as ResourceKind)
    ? (candidate as ResourceKind)
    : "custom";
}

export type TabsProps = {
  tabs: readonly ResourceTab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd?: (activity: Activity) => void;
  onMove?: (id: string, toIndex: number) => void;
};

export function Tabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onAdd,
}: TabsProps) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const focusTab = (index: number) => {
    const tab = tabs[index];
    if (tab) tabRefs.current[tab.id]?.focus();
  };
  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    tab: ResourceTab,
  ) => {
    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onActivate(tab.id);
        return;
      case "Delete":
      case "Backspace":
        if (tabs.length > 1 && tab.closable !== false && !tab.pinned) {
          event.preventDefault();
          onClose(tab.id);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    focusTab(nextIndex);
  };

  return (
    <div
      className="tabs"
      role="tablist"
      aria-label="Open resources"
      aria-orientation="horizontal"
    >
      {tabs.map((tab, index) => {
        const active = tab.id === activeTabId;
        const kind = getKind(tab);
        const closable =
          tabs.length > 1 && tab.closable !== false && !tab.pinned;
        const accessibleLabel = `${tab.title}${tab.dirty ? ", unsaved changes" : ""}`;
        return (
          <div
            className="tab"
            key={tab.id}
            data-active={active ? "true" : undefined}
            data-resource-kind={kind}
            data-pinned={tab.pinned ? "true" : undefined}
            data-preview={tab.preview ? "true" : undefined}
          >
            <button
              ref={(element) => {
                tabRefs.current[tab.id] = element;
              }}
              type="button"
              role="tab"
              id={`resource-tab-${tab.id}`}
              aria-selected={active}
              aria-label={accessibleLabel}
              aria-description={
                tab.description ?? `${resourceLabels[kind]} resource`
              }
              aria-controls={`resource-panel-${tab.id}`}
              className="tab-label"
              tabIndex={active ? 0 : -1}
              title={tab.description ?? tab.title}
              onKeyDown={(event) => {
                handleKeyDown(event, index, tab);
              }}
              onClick={() => {
                onActivate(tab.id);
              }}
            >
              <span className="tab-icon-wrap" aria-hidden="true">
                {tab.icon ?? <ResourceIcon kind={kind} />}
              </span>
              <span className="tab-title">{tab.title}</span>
              {tab.preview ? (
                <span className="tab-preview-mark" aria-hidden="true">
                  Preview
                </span>
              ) : null}
              {tab.dirty ? (
                <span className="tab-dirty" aria-label="Unsaved changes">
                  •
                </span>
              ) : null}
            </button>
            {closable ? (
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${tab.title}`}
                title={`Close ${tab.title}`}
                onClick={() => {
                  onClose(tab.id);
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
      <div
        className="tab-add-group"
        onMouseEnter={() => {
          setAddMenuOpen(true);
        }}
        onMouseLeave={() => {
          setAddMenuOpen(false);
        }}
        onFocusCapture={() => {
          setAddMenuOpen(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setAddMenuOpen(false);
        }}
      >
        <button
          type="button"
          className="tab-add"
          aria-label="Open a new resource"
          title={onAdd ? "Open Home tab" : "No resource action available"}
          disabled={!onAdd}
          onClick={() => {
            onAdd?.("home");
          }}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        {onAdd && addMenuOpen ? (
          <div className="tab-add-menu" aria-label="Choose a tab to open">
            {activityTabChoices.map(({ activity, label }) => (
              <button
                key={activity}
                type="button"
                onClick={() => {
                  onAdd(activity);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
