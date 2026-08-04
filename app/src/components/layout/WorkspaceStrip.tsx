import {
  BriefcaseBusiness,
  FlaskConical,
  FolderKanban,
  PanelTop,
} from "lucide-react";
import type { Activity } from "../../state/shell";
import { useWorkspace } from "../../state/workspace";

export function WorkspaceStrip({
  onNavigate,
}: {
  onNavigate?: (activity: Activity) => void;
}) {
  const { activeWorkspaceId, selectWorkspace } = useWorkspace();

  const destinations = [
    {
      id: "work",
      label: "Work",
      icon: BriefcaseBusiness,
      activity: "home" as const,
    },
    {
      id: "research",
      label: "Research",
      icon: FlaskConical,
      activity: "knowledge" as const,
    },
    {
      id: "projects",
      label: "Projects",
      icon: FolderKanban,
      activity: "files" as const,
    },
  ];

  return (
    <nav className="workspace-strip" aria-label="Recent workspaces">
      <button
        type="button"
        className="workspace-strip-primary"
        data-active="true"
        onClick={() => {
          if (activeWorkspaceId) selectWorkspace(activeWorkspaceId);
          onNavigate?.("home");
        }}
      >
        <PanelTop size={15} strokeWidth={1.8} aria-hidden="true" />
        <strong>Personal</strong>
        <span aria-hidden="true">⌄</span>
      </button>
      <div className="workspace-shortcuts">
        {destinations.map(({ id, label, icon: Icon, activity }) => (
          <button
            key={id}
            type="button"
            className="workspace-shortcut"
            onClick={() => {
              onNavigate?.(activity);
            }}
          >
            <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
