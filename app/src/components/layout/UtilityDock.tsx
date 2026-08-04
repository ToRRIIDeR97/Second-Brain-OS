import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Files,
  GitCompareArrows,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import { ReferenceCalendar } from "../../features/planner/ReferenceCalendar";
import { SourceControlWorkspace } from "../../features/source-control";
import {
  TerminalWorkspace,
  type TerminalRequest,
} from "../../features/terminal/TerminalWorkspace";
import type {
  GitWorkspaceDiff,
  GitWorkspaceStatus,
  IpcClient,
} from "../../lib/ipc";
import { useWorkspace } from "../../state/workspace";
import { WorkspaceNavigator } from "./WorkspaceNavigator";

export type UtilityDockTab = "files" | "calendar" | "git" | "terminal";

const tabs = [
  { id: "files", label: "Files", icon: Files },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "git", label: "Git", icon: GitCompareArrows },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
] as const;

export function UtilityDock({
  activeTab,
  openTabs,
  ipc,
  terminalRequest,
  onOpenTab,
  onTabChange,
  onCloseTab,
  onClose,
  onOpenPath,
  onOpenDailyNote,
}: {
  activeTab?: UtilityDockTab;
  openTabs: readonly UtilityDockTab[];
  ipc: IpcClient;
  terminalRequest?: TerminalRequest;
  onOpenTab: (tab: UtilityDockTab) => void;
  onTabChange: (tab: UtilityDockTab) => void;
  onCloseTab: (tab: UtilityDockTab) => void;
  onClose: () => void;
  onOpenPath: (relativePath: string) => void;
  onOpenDailyNote: () => void;
}) {
  const { activeWorkspace } = useWorkspace();
  const [git, setGit] = useState<GitWorkspaceStatus>();
  const [diff, setDiff] = useState<{ path: string; data: GitWorkspaceDiff }>();
  const [gitError, setGitError] = useState("");
  const availableTabs = tabs.filter(({ id }) => !openTabs.includes(id));

  const refreshGit = useCallback(async () => {
    if (!activeWorkspace) return;
    const result = await ipc.git.status(activeWorkspace.id);
    if (result.ok) {
      setGit(result.data);
      setGitError("");
    } else setGitError(result.error.message);
  }, [activeWorkspace, ipc]);

  useEffect(() => {
    if (activeTab !== "git") return;
    const timer = window.setTimeout(() => {
      void refreshGit();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeTab, refreshGit]);

  const mutateGit = async (
    operation: "stage" | "unstage" | "discard",
    path: string,
  ) => {
    if (!activeWorkspace) return;
    const result =
      operation === "stage"
        ? await ipc.git.stage(activeWorkspace.id, [path])
        : operation === "unstage"
          ? await ipc.git.unstage(activeWorkspace.id, [path])
          : await ipc.git.discard(activeWorkspace.id, [path], true);
    if (result.ok) void refreshGit();
    else setGitError(result.error.message);
  };

  const openDiff = async (path: string, staged: boolean) => {
    if (!activeWorkspace) return;
    const result = await ipc.git.diff(activeWorkspace.id, staged, [path]);
    if (result.ok) {
      setDiff({ path, data: result.data });
      setGitError("");
    } else setGitError(result.error.message);
  };

  return (
    <aside className="utility-dock" aria-label="Utility panel">
      <header className="utility-dock-header">
        <div className="utility-tabs" role="tablist" aria-label="Utilities">
          {openTabs.map((id) => {
            const tab = tabs.find((item) => item.id === id);
            if (!tab) return null;
            const Icon = tab.icon;
            return (
              <div
                className="utility-tab"
                data-active={activeTab === id}
                key={id}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === id}
                  onClick={() => {
                    onTabChange(id);
                  }}
                >
                  <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                  {tab.label}
                </button>
                <button
                  type="button"
                  className="utility-tab-close"
                  aria-label={`Close ${tab.label}`}
                  onClick={() => {
                    onCloseTab(id);
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        {availableTabs.length ? (
          <details className="utility-add-menu">
            <summary aria-label="Add utility tab" title="Add utility tab">
              <Plus size={16} aria-hidden="true" />
            </summary>
            <div>
              {availableTabs.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  onClick={(event) => {
                    onOpenTab(id);
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                  }}
                >
                  <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>Open in this panel</small>
                  </span>
                </button>
              ))}
            </div>
          </details>
        ) : null}
        <button
          type="button"
          className="icon-button"
          aria-label="Close utility panel"
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="utility-dock-content">
        {!activeTab || !openTabs.includes(activeTab) ? (
          <section
            className="utility-launcher"
            aria-labelledby="utility-launcher-title"
          >
            <div>
              <p className="eyebrow">Right panel</p>
              <h2 id="utility-launcher-title">Open a utility</h2>
              <p>Choose a tool to add it as a tab in this panel.</p>
            </div>
            <div className="utility-launcher-options">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => {
                    onOpenTab(id);
                  }}
                >
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>
                      {id === "files"
                        ? "Browse workspace files"
                        : id === "calendar"
                          ? "Calendar and Google Tasks"
                          : id === "git"
                            ? "Changes and file diffs"
                            : "Open a workspace shell"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {activeTab === "files" ? (
          <WorkspaceNavigator
            activity="files"
            ipc={ipc}
            onOpenPath={onOpenPath}
            onOpenDailyNote={onOpenDailyNote}
          />
        ) : null}
        {activeTab === "calendar" ? <ReferenceCalendar compact /> : null}
        {activeTab === "git" ? (
          diff ? (
            <section
              className="git-diff-view"
              aria-labelledby="utility-diff-title"
            >
              <header className="git-diff-header">
                <div>
                  <p className="eyebrow">
                    {diff.data.staged ? "Staged diff" : "Working tree diff"}
                  </p>
                  <h1 id="utility-diff-title">{diff.path}</h1>
                </div>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => {
                    setDiff(undefined);
                  }}
                >
                  Changes
                </button>
              </header>
              <pre className="git-diff-patch" tabIndex={0}>
                <code>{diff.data.patch || "No textual changes."}</code>
              </pre>
            </section>
          ) : (
            <>
              {gitError ? (
                <p className="utility-error" role="alert">
                  {gitError}
                </p>
              ) : null}
              <SourceControlWorkspace
                {...(git?.branch ? { branch: git.branch } : {})}
                changes={git?.changes ?? []}
                onStage={(path) => {
                  void mutateGit("stage", path);
                }}
                onUnstage={(path) => {
                  void mutateGit("unstage", path);
                }}
                onDiscard={(path) => {
                  if (window.confirm(`Discard changes to ${path}?`)) {
                    void mutateGit("discard", path);
                  }
                }}
                onOpenDiff={(path, staged) => {
                  void openDiff(path, staged);
                }}
              />
            </>
          )
        ) : null}
        {openTabs.includes("terminal") ? (
          <TerminalWorkspace
            ipc={ipc}
            hidden={activeTab !== "terminal"}
            {...(terminalRequest ? { request: terminalRequest } : {})}
          />
        ) : null}
      </div>
    </aside>
  );
}
