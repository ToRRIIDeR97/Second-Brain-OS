/* eslint-disable react-refresh/only-export-components */
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Activity } from "../../state/shell";

export const INSPECTOR_TAB_IDS = [
  "overview",
  "relationships",
  "source",
  "context",
  "history",
  "provider",
  "actions",
] as const;

export type InspectorTabId = string;

export type InspectorMetadata = {
  label: string;
  value: ReactNode;
};

/**
 * The common selection contract used by files, graph nodes, Git changes, and
 * agent sessions. Consumers can attach their own kind while keeping the
 * inspector independent from feature-domain types.
 */
export type InspectorSelection = {
  /** Feature domains may add their own namespaced kind. */
  kind: string;
  id: string;
  title?: string;
  label?: string;
  subtitle?: string;
  description?: string;
  status?: string;
  metadata?: readonly InspectorMetadata[];
  content?: ReactNode;
};

export type InspectorTab = {
  id: InspectorTabId;
  label: string;
  content?: ReactNode;
  disabled?: boolean;
};

const defaultTabs: readonly InspectorTab[] = [
  { id: "overview", label: "Inspector" },
  { id: "source", label: "Provenance" },
];

function activityLabel(activity: Activity) {
  return activity === "source-control"
    ? "Source control"
    : `${activity.slice(0, 1).toUpperCase()}${activity.slice(1)}`;
}

function defaultTabCopy(
  tabId: InspectorTabId,
  selection: InspectorSelection | null | undefined,
) {
  if (!selection) {
    return tabId === "overview"
      ? "Select a file, graph node, change, or session to inspect its context."
      : "No selection is available for this surface.";
  }
  switch (tabId) {
    case "relationships":
      return `Relationships for ${selection.title ?? selection.label ?? selection.id} will appear here.`;
    case "source":
      return "Source and provenance metadata are available when this resource provides them.";
    case "context":
      return "Context sources, budget, and exclusions are shown for this selection.";
    case "history":
      return "No history has been recorded for this resource yet.";
    case "provider":
      return "Provider authority and synchronization state are shown here.";
    case "actions":
      return "Available actions are scoped to the selected resource.";
    case "overview":
    default:
      return (
        selection.description ??
        "Selection details and actions will appear here."
      );
  }
}

export type InspectorProps = {
  /** Kept optional so feature surfaces can provide only a selection. */
  activity?: Activity;
  selection?: InspectorSelection | null;
  tabs?: readonly InspectorTab[];
  activeTabId?: InspectorTabId;
  defaultTabId?: InspectorTabId;
  onTabChange?: (id: InspectorTabId) => void;
  onClose?: () => void;
  children?: ReactNode;
  workspaceName?: string;
};

export function Inspector({
  activity = "home",
  selection,
  tabs = defaultTabs,
  activeTabId,
  defaultTabId = "overview",
  onTabChange,
  onClose,
  children,
  workspaceName = "Personal knowledge base",
}: InspectorProps) {
  const [internalTabId, setInternalTabId] =
    useState<InspectorTabId>(defaultTabId);
  const baseId = useId();
  const selectedTabId = activeTabId ?? internalTabId;
  const selectedTabIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === selectedTabId),
  );
  const selectedTab = tabs[selectedTabIndex] ?? tabs[0];

  const selectTab = (id: InspectorTabId) => {
    if (activeTabId === undefined) setInternalTabId(id);
    onTabChange?.(id);
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (tabs.length === 0) return;
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
      default:
        return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (nextTab && !nextTab.disabled) selectTab(nextTab.id);
  };

  const selectedTitle = selection?.title ?? selection?.label ?? selection?.id;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="region-heading">
        <span className="visually-hidden">Context inspector</span>
        <div className="inspector-heading-actions">
          <span className="inspector-key" aria-hidden="true">
            ⌘J
          </span>
          {onClose ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Close inspector"
              title="Close inspector"
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="inspector-context" aria-live="polite">
        <span className="card-label">
          {selection?.kind ?? "Active surface"}
        </span>
        <strong>{selectedTitle ?? activityLabel(activity)}</strong>
        <p>
          {selection?.subtitle ??
            (selection?.status
              ? selection.status
              : "Selection details and actions will appear here.")}
        </p>
      </div>

      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Inspector views"
        aria-orientation="horizontal"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === selectedTab?.id;
          return (
            <button
              type="button"
              role="tab"
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => {
                selectTab(tab.id);
              }}
              onKeyDown={(event) => {
                handleTabKeyDown(event, index);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {selectedTab ? (
        <div
          className="inspector-tabpanel"
          role="tabpanel"
          id={`${baseId}-panel-${selectedTab.id}`}
          aria-labelledby={`${baseId}-tab-${selectedTab.id}`}
          tabIndex={0}
        >
          {selectedTab.content !== undefined ? (
            selectedTab.content
          ) : selectedTab.id === "overview" && selection?.metadata ? (
            <div className="inspector-card">
              <span className="card-label">Metadata</span>
              {selection.metadata.map((item) => (
                <div className="inspector-metadata" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
              <p>{defaultTabCopy(selectedTab.id, selection)}</p>
            </div>
          ) : (
            <div className="inspector-card">
              <span className="card-label">{selectedTab.label}</span>
              <p>
                {selection?.content ??
                  children ??
                  defaultTabCopy(selectedTab.id, selection)}
              </p>
            </div>
          )}
        </div>
      ) : null}

      <div className="inspector-card inspector-card-muted">
        <span className="card-label">Workspace</span>
        <strong>{workspaceName}</strong>
        <p>Private · local-first</p>
      </div>
    </aside>
  );
}
