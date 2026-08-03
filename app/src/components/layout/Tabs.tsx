import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ShellTab } from "../../state/shell";

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
  const common = {
    className: "tab-icon",
    viewBox: "0 0 24 24",
    width: 15,
    height: 15,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "file":
    case "preview":
      return (
        <svg {...common}>
          <path d="M6 3.8h8l4 4v12.4H6zM14 3.8v4h4M9 12h6M9 15.5h6" />
        </svg>
      );
    case "graph":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="m7.8 7 8.4-1m-9.4 1.7 3.9 8.4m5.8-6.2-3 6.1" />
        </svg>
      );
    case "git-diff":
      return (
        <svg {...common}>
          <path d="M7 4v16M17 4v16M4 7h6M14 17h6" />
          <path d="m7 4-2 2 2 2M17 20l2-2-2-2" />
        </svg>
      );
    case "agent-session":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path d="M8 10h.01M16 10h.01M8 14h8M12 5V3" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <path d="m5 7 5 5-5 5M12.5 17H19" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.6 2" />
        </svg>
      );
    case "custom":
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
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
  onAdd?: () => void;
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
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        className="tab-add"
        aria-label="Open a new resource"
        title={onAdd ? "Open a new resource" : "No resource action available"}
        disabled={!onAdd}
        onClick={() => {
          onAdd?.();
        }}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
