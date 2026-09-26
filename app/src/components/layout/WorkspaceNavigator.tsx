import { useCallback, useEffect, useMemo, useState } from "react";
import { File, FileText, Folder, FolderOpen } from "lucide-react";
import type { IpcClient, WorkspaceDirectoryEntry } from "../../lib/ipc";
import type { Activity } from "../../state/shell";
import type { PlannerView, ProjectView } from "../../state/shell";
import { useProjects } from "../../state/projects";
import { useWorkspace } from "../../state/workspace";
import {
  Navigator,
  type NavigatorEntry,
  type NavigatorSection,
} from "./Navigator";

function isMarkdown(path: string) {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function entryIcon(entry: WorkspaceDirectoryEntry, expanded: boolean) {
  if (entry.kind === "directory") {
    const Icon = expanded ? FolderOpen : Folder;
    return <Icon size={14} strokeWidth={1.7} />;
  }
  const Icon = isMarkdown(entry.relativePath) ? FileText : File;
  return <Icon size={14} strokeWidth={1.7} />;
}

export function WorkspaceNavigator({
  activity,
  ipc,
  onOpenPath,
  onOpenDailyNote,
  projectView,
  onProjectViewChange,
  plannerView,
  onPlannerViewChange,
  onClose,
}: {
  activity: Activity;
  ipc: IpcClient;
  onOpenPath: (relativePath: string) => void;
  onOpenDailyNote: () => void;
  projectView?: ProjectView;
  onProjectViewChange?: (view: ProjectView) => void;
  plannerView?: PlannerView;
  onPlannerViewChange?: (view: PlannerView) => void;
  onClose?: () => void;
}) {
  const { activeWorkspace, workspaces, selectWorkspace } = useWorkspace();
  const { activeProject, projects, selectProject } = useProjects();
  const [childrenByPath, setChildrenByPath] = useState<
    Record<string, WorkspaceDirectoryEntry[]>
  >({});
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [loadingPaths, setLoadingPaths] = useState<string[]>([]);

  const loadDirectory = useCallback(
    async (relativePath: string) => {
      if (!activeWorkspace || activeWorkspace.kind === "collection") return;
      setLoadingPaths((current) =>
        current.includes(relativePath) ? current : [...current, relativePath],
      );
      const result = await ipc.workspaces.listDirectory({
        workspaceId: activeWorkspace.id,
        relativePath,
      });
      setLoadingPaths((current) =>
        current.filter((path) => path !== relativePath),
      );
      if (!result.ok) return;
      setChildrenByPath((current) => ({
        ...current,
        [relativePath]: result.data.entries,
      }));
    },
    [activeWorkspace, ipc],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setChildrenByPath({});
      setExpandedIds([]);
      if (activity === "knowledge" || activity === "files") {
        void loadDirectory("");
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeWorkspace?.id, activity, loadDirectory]);

  const tree = useMemo(() => {
    const build = (parent: string): NavigatorEntry[] =>
      (childrenByPath[parent] ?? [])
        .filter(
          (entry) =>
            activity === "files" ||
            entry.kind === "directory" ||
            isMarkdown(entry.relativePath),
        )
        .map((entry) => {
          const expanded = expandedIds.includes(entry.relativePath);
          const children = childrenByPath[entry.relativePath];
          return {
            id: entry.relativePath,
            label: entry.name,
            kind:
              entry.kind === "directory"
                ? ("folder" as const)
                : isMarkdown(entry.relativePath)
                  ? ("note" as const)
                  : ("file" as const),
            ...(entry.kind === "file"
              ? {
                  secondary: `${String(Math.max(1, Math.round(entry.sizeBytes / 1024)))} KB`,
                }
              : {}),
            icon: entryIcon(entry, expanded),
            hasChildren: entry.kind === "directory",
            ...(children ? { children: build(entry.relativePath) } : {}),
          } satisfies NavigatorEntry;
        });
    return build("");
  }, [activity, childrenByPath, expandedIds]);

  if (activity === "projects") {
    const projectViews: Array<{ id: ProjectView; label: string }> = [
      { id: "overview", label: "Overview" },
      { id: "plan", label: "Plan" },
      { id: "work", label: "Work" },
      { id: "files", label: "Files" },
      { id: "activity", label: "Activity" },
      { id: "map", label: "Map" },
    ];
    return (
      <Navigator
        activity={activity}
        selectedItemId={
          activeProject ? (projectView ?? "overview") : "all-projects"
        }
        sections={[
          {
            id: "project-views",
            label: activeProject?.name ?? "Projects",
            entries: activeProject
              ? [
                  {
                    id: "all-projects",
                    label: "All Projects",
                    kind: "project-list",
                  },
                  ...projectViews.map(({ id, label }) => ({
                    id,
                    label,
                    kind: "project-view",
                  })),
                ]
              : [
                  {
                    id: "all-projects",
                    label: "All Projects",
                    kind: "project-list",
                  },
                ],
          },
          ...(projects.length
            ? [
                {
                  id: "project-list",
                  label: "Projects",
                  entries: projects
                    .filter(({ status }) => status !== "archived")
                    .map(({ id, name, status }) => ({
                      id,
                      label: name,
                      secondary: status,
                      kind: "project",
                    })),
                },
              ]
            : []),
        ]}
        onItemSelect={(entry) => {
          if (entry.kind === "project-list") selectProject(undefined);
          else if (entry.kind === "project") selectProject(entry.id);
          else if (entry.kind === "project-view")
            onProjectViewChange?.(entry.id as ProjectView);
        }}
        {...(onClose ? { onClose } : {})}
      />
    );
  }

  if (activity === "calendar") {
    const plannerViews: Array<{ id: PlannerView; label: string }> = [
      { id: "today", label: "Today" },
      { id: "week", label: "Week" },
      { id: "month", label: "Month" },
      { id: "agenda", label: "Agenda" },
      { id: "tasks", label: "Tasks" },
      { id: "unscheduled", label: "Unscheduled" },
      { id: "completed", label: "Completed" },
    ];
    return (
      <Navigator
        activity={activity}
        selectedItemId={plannerView ?? "today"}
        sections={[
          {
            id: "planner-views",
            label: "Calendar",
            entries: plannerViews.map(({ id, label }) => ({
              id,
              label,
              kind: "planner-view",
            })),
          },
        ]}
        onItemSelect={(entry) => {
          onPlannerViewChange?.(entry.id as PlannerView);
        }}
        {...(onClose ? { onClose } : {})}
      />
    );
  }

  if (activity !== "knowledge" && activity !== "files") {
    return <Navigator activity={activity} {...(onClose ? { onClose } : {})} />;
  }

  const sections: NavigatorSection[] = [
    {
      id: "workspace",
      label: activity === "knowledge" ? "Files" : "Workspace",
      entries: tree,
      badge: loadingPaths.includes("") ? "…" : tree.length,
    },
  ];
  if (activity === "knowledge") {
    sections.push(
      {
        id: "daily-notes",
        label: "Daily notes",
        entries: [
          {
            id: "notes/today.md",
            label: "Today",
            secondary: new Date().toLocaleDateString(),
            kind: "daily-note",
          },
        ],
      },
      {
        id: "collections",
        label: "Collections",
        entries: workspaces
          .filter(({ kind }) => kind === "collection")
          .map(({ id, name }) => ({
            id,
            label: name,
            kind: "collection" as const,
          })),
      },
    );
  }

  return (
    <Navigator
      activity={activity}
      sections={sections}
      expandedIds={expandedIds}
      onToggle={(entry, expanded) => {
        setExpandedIds((current) =>
          expanded
            ? [...new Set([...current, entry.id])]
            : current.filter((id) => id !== entry.id),
        );
        if (expanded && !childrenByPath[entry.id]) void loadDirectory(entry.id);
      }}
      onItemSelect={(entry) => {
        if (entry.kind === "daily-note") onOpenDailyNote();
        else if (entry.kind === "collection") selectWorkspace(entry.id);
        else if (entry.kind === "folder") {
          const expanded = !expandedIds.includes(entry.id);
          setExpandedIds((current) =>
            expanded
              ? [...new Set([...current, entry.id])]
              : current.filter((id) => id !== entry.id),
          );
          if (expanded && !childrenByPath[entry.id])
            void loadDirectory(entry.id);
        } else onOpenPath(entry.id);
      }}
      {...(onClose ? { onClose } : {})}
    />
  );
}
