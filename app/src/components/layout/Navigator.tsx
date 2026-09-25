import { useState, type KeyboardEvent, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import type { Activity } from "../../state/shell";

/** A workspace-scoped item rendered in the navigator. */
export type NavigatorEntry = {
  id: string;
  label: string;
  secondary?: string;
  /** Semantic kind lets consumers map selections to a resource. */
  /** Feature domains may add their own namespaced kinds. */
  kind?: string;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  /** Child entries make the item a tree node without coupling to a store. */
  children?: readonly NavigatorEntry[];
  /** Set when children are loaded lazily and are not present yet. */
  hasChildren?: boolean;
};

export type NavigatorItem = NavigatorEntry;

export type NavigatorSection = {
  id: string;
  label: string;
  entries?: readonly NavigatorEntry[];
  /** Sections can be collapsed independently of tree node expansion. */
  collapsible?: boolean;
  defaultExpanded?: boolean;
  badge?: ReactNode;
};

export type NavigatorWorkspace = {
  id: string;
  label: string;
  sections?: readonly NavigatorSection[];
  entries?: readonly NavigatorEntry[];
};

const items: Record<Activity, readonly string[]> = {
  home: ["Overview", "Recent", "Pinned"],
  projects: ["Overview", "Plan", "Work", "Files", "Activity", "Map"],
  activity: ["Needs attention", "Agent runs", "Changes", "History"],
  knowledge: ["All notes"],
  files: ["Workspace files", "Favorites", "Recent files"],
  graph: ["Focused graph", "Saved lenses", "Backlinks"],
  search: ["Search everywhere", "Recent searches", "Filters"],
  planner: ["Tasks"],
  calendar: ["Calendar", "Tasks"],
  agents: ["Sessions", "Review queue", "Context packets"],
  terminal: ["Terminal tabs", "Presets", "Output"],
  "source-control": ["Changes", "History", "Branches"],
  settings: ["General", "Workspaces", "Permissions"],
};

const title = (activity: Activity) => {
  switch (activity) {
    case "source-control":
      return "Source control";
    case "planner":
      return "Tasks";
    case "agents":
      return "Agents";
    case "activity":
      return "Activity";
    default:
      return `${activity.slice(0, 1).toUpperCase()}${activity.slice(1)}`;
  }
};

const defaultEntry = (label: string): NavigatorEntry => ({
  id: label,
  label,
  kind: "custom",
});

export type NavigatorProps = {
  activity: Activity;
  /** Existing shell data sources. They remain supported for compatibility. */
  dailyNotes?: readonly NavigatorEntry[];
  collections?: readonly NavigatorEntry[];
  selectedItemId?: string;
  onDailyNoteSelect?: (note: NavigatorEntry) => void;
  onCollectionSelect?: (collection: NavigatorEntry) => void;
  onItemSelect?: (item: NavigatorItem) => void;
  /** Optional workspace data; when present it replaces static activity items. */
  workspace?: NavigatorWorkspace;
  sections?: readonly NavigatorSection[];
  /** Alias for a single tree-backed workspace section. */
  tree?: readonly NavigatorEntry[];
  expandedIds?: readonly string[];
  onToggle?: (entry: NavigatorEntry, expanded: boolean) => void;
  onSectionToggle?: (section: NavigatorSection, expanded: boolean) => void;
  onActions?: () => void;
  onClose?: () => void;
};

function entryKind(
  entry: NavigatorEntry,
  fallback: "daily-note" | "collection" | undefined,
) {
  return entry.kind ?? fallback;
}

export function Navigator({
  activity,
  dailyNotes = [],
  collections = [],
  selectedItemId,
  onDailyNoteSelect,
  onCollectionSelect,
  onItemSelect,
  workspace,
  sections,
  tree,
  expandedIds,
  onToggle,
  onSectionToggle,
  onActions,
  onClose,
}: NavigatorProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const dataSections = sections ?? workspace?.sections;
  const workspaceEntries = tree ?? workspace?.entries;
  const sectionList: NavigatorSection[] = dataSections
    ? [...dataSections]
    : workspaceEntries
      ? [
          {
            id: "workspace",
            label: workspace?.label ?? "Workspace",
            entries: workspaceEntries,
          },
        ]
      : [
          {
            id: "views",
            label: "Views",
            entries: items[activity].map(defaultEntry),
          },
        ];

  const sectionListWithData =
    dataSections || workspaceEntries
      ? sectionList
      : [
          ...sectionList,
          ...(activity === "knowledge"
            ? [
                {
                  id: "daily-notes",
                  label: "Daily notes",
                  entries: dailyNotes,
                },
                {
                  id: "collections",
                  label: "Collections",
                  entries: collections,
                },
              ]
            : []),
        ];

  const allVisibleEntries = sectionListWithData.flatMap(
    (section) => section.entries ?? [],
  );
  const firstEntryId = allVisibleEntries[0]?.id;
  const isExpanded = (id: string, defaultExpanded = false) => {
    if (expandedIds) return expandedIds.includes(id) || defaultExpanded;
    if (collapsed.has(id)) return false;
    return expanded.has(id) || defaultExpanded;
  };

  const setEntryExpanded = (entry: NavigatorEntry, next: boolean) => {
    if (!expandedIds) {
      setExpanded((current) => {
        const updated = new Set(current);
        if (next) updated.add(entry.id);
        else updated.delete(entry.id);
        return updated;
      });
      setCollapsed((current) => {
        const updated = new Set(current);
        if (next) updated.delete(entry.id);
        else updated.add(entry.id);
        return updated;
      });
    }
    onToggle?.(entry, next);
  };

  const handleTreeKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    entry: NavigatorEntry,
    open: boolean,
  ) => {
    if (!entry.children?.length && !entry.hasChildren) return;
    if (event.key === "ArrowRight" && !open) {
      event.preventDefault();
      setEntryExpanded(entry, true);
    } else if (event.key === "ArrowLeft" && open) {
      event.preventDefault();
      setEntryExpanded(entry, false);
    }
  };

  const selectEntry = (
    entry: NavigatorEntry,
    fallbackKind?: "daily-note" | "collection",
  ) => {
    const kind = entryKind(entry, fallbackKind);
    if (kind === "daily-note") onDailyNoteSelect?.(entry);
    if (kind === "collection") onCollectionSelect?.(entry);
    onItemSelect?.(entry);
  };

  const renderEntry = (
    entry: NavigatorEntry,
    depth: number,
    fallbackKind?: "daily-note" | "collection",
    keyPrefix = "entry",
  ): ReactNode => {
    const selected =
      entry.id === selectedItemId ||
      (selectedItemId === undefined && entry.id === firstEntryId);
    const hasChildren = Boolean(entry.children?.length || entry.hasChildren);
    const open = hasChildren && isExpanded(entry.id);
    const icon =
      entry.icon ?? (hasChildren ? (open ? "⌄" : "›") : selected ? "●" : "○");
    return (
      <div
        className="navigator-tree-item"
        key={`${keyPrefix}-${entry.id}`}
        data-depth={depth}
        data-expanded={open ? "true" : undefined}
      >
        <button
          type="button"
          className="navigator-item"
          data-selected={selected ? "true" : undefined}
          data-kind={entryKind(entry, fallbackKind)}
          data-depth={depth}
          aria-current={selected ? "page" : undefined}
          aria-expanded={hasChildren ? open : undefined}
          disabled={entry.disabled}
          onKeyDown={(event) => {
            handleTreeKeyDown(event, entry, open);
          }}
          onClick={() => {
            selectEntry(entry, fallbackKind);
          }}
        >
          <span className="navigator-glyph" aria-hidden="true">
            {icon}
          </span>
          <span className="navigator-item-label">
            {entry.label}
            {entry.secondary ? <small> · {entry.secondary}</small> : null}
          </span>
          {entry.badge !== undefined ? (
            <span className="navigator-badge">{entry.badge}</span>
          ) : null}
        </button>
        {open && entry.children?.length
          ? entry.children.map((child) =>
              renderEntry(
                child,
                depth + 1,
                undefined,
                `${keyPrefix}-${entry.id}`,
              ),
            )
          : null}
      </div>
    );
  };

  return (
    <aside className="navigator" aria-label={`${title(activity)} navigator`}>
      <div className="region-heading">
        <div>
          <h2>{title(activity)}</h2>
        </div>
        {onClose || onActions ? (
          <div>
            {onClose ? (
              <button
                type="button"
                className="icon-button"
                aria-label="Hide navigator"
                title="Hide navigator"
                onClick={onClose}
              >
                <PanelLeft size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
            {onActions ? (
              <button
                type="button"
                className="icon-button"
                aria-label="Navigator actions"
                title="Navigator actions"
                onClick={onActions}
              >
                <span aria-hidden="true">•••</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        className="navigator-items"
        data-tree={workspaceEntries ? "true" : undefined}
      >
        {sectionListWithData.map((section) => {
          const sectionEntries = section.entries ?? [];
          const sectionOpen = isExpanded(
            `section:${section.id}`,
            section.defaultExpanded ?? true,
          );
          const sectionCanCollapse = section.collapsible === true;
          return (
            <section
              className="navigator-section"
              key={section.id}
              data-section={section.id}
              data-expanded={sectionOpen ? "true" : undefined}
            >
              {sectionCanCollapse ? (
                <button
                  type="button"
                  className="navigator-section-heading"
                  aria-expanded={sectionOpen}
                  onClick={() => {
                    const next = !sectionOpen;
                    if (!expandedIds) {
                      setExpanded((current) => {
                        const updated = new Set(current);
                        if (next) updated.add(`section:${section.id}`);
                        else updated.delete(`section:${section.id}`);
                        return updated;
                      });
                      setCollapsed((current) => {
                        const updated = new Set(current);
                        if (next) updated.delete(`section:${section.id}`);
                        else updated.add(`section:${section.id}`);
                        return updated;
                      });
                    }
                    onSectionToggle?.(section, next);
                  }}
                >
                  <span aria-hidden="true">{sectionOpen ? "⌄" : "›"}</span>
                  <span>{section.label}</span>
                  {section.badge !== undefined ? (
                    <span className="navigator-badge">{section.badge}</span>
                  ) : null}
                </button>
              ) : (
                <p className="eyebrow navigator-section-label">
                  {section.label}
                  {section.badge !== undefined ? (
                    <span className="navigator-badge">{section.badge}</span>
                  ) : null}
                </p>
              )}
              {sectionOpen ? (
                sectionEntries.length > 0 ? (
                  sectionEntries.map((entry, index) =>
                    renderEntry(
                      entry,
                      0,
                      section.id === "daily-notes"
                        ? "daily-note"
                        : section.id === "collections"
                          ? "collection"
                          : undefined,
                      `${section.id}-${String(index)}`,
                    ),
                  )
                ) : section.id === "daily-notes" ||
                  section.id === "collections" ? (
                  <p className="navigator-empty">
                    {section.id === "daily-notes"
                      ? "No daily notes."
                      : "No collections."}
                  </p>
                ) : null
              ) : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
