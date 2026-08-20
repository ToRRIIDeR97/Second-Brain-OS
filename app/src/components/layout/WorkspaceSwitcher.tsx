import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Check, ChevronDown, FolderPlus } from "lucide-react";
import { ModalDialog } from "../common/ModalDialog";
import type { WorkspaceTrustLevel } from "../../lib/ipc";
import { pickWorkspaceFolder } from "../../lib/workspaceFolderPicker";
import { useWorkspace } from "../../state/workspace";

export type WorkspaceChangeGuard = (workspaceId?: string) => string | undefined;

const trustOptions: Array<{ value: WorkspaceTrustLevel; label: string }> = [
  { value: "untrusted", label: "Untrusted (read-only)" },
  { value: "trusted_read_only", label: "Trusted read-only" },
  { value: "trusted", label: "Trusted (editing and terminal enabled)" },
  { value: "restricted", label: "Restricted (read-only)" },
];

function nameFromRoot(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).at(-1) || "Workspace";
}

function trustLabel(level: WorkspaceTrustLevel) {
  return trustOptions.find(({ value }) => value === level)?.label ?? level;
}

function kindLabel(kind: string) {
  return kind === "brain"
    ? "Brain"
    : kind === "project"
      ? "Project"
      : "Collection";
}

export function WorkspaceSwitcher({
  onBeforeWorkspaceChange,
}: {
  onBeforeWorkspaceChange?: WorkspaceChangeGuard;
}) {
  const {
    activeWorkspace,
    error,
    loading,
    registerWorkspace,
    selectWorkspace,
    workspaces,
  } = useWorkspace();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [trustLevel, setTrustLevel] = useState<WorkspaceTrustLevel>("trusted");
  const [folderPickerBusy, setFolderPickerBusy] = useState(false);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [switchError, setSwitchError] = useState("");
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !switcherRef.current?.contains(event.target)
      ) {
        setPopoverOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [popoverOpen]);

  const chooseWorkspace = (workspaceId: string) => {
    if (workspaceId === activeWorkspace?.id) {
      setPopoverOpen(false);
      return;
    }
    const blocked = onBeforeWorkspaceChange?.(workspaceId);
    if (blocked) {
      setSwitchError(blocked);
      return;
    }
    setSwitchError("");
    selectWorkspace(workspaceId);
    setPopoverOpen(false);
  };

  const openNewWorkspace = () => {
    setFormError("");
    setSwitchError("");
    setRootPath(activeWorkspace?.rootPath ?? "");
    setName("");
    setTrustLevel("trusted");
    setPopoverOpen(false);
    setNewWorkspaceOpen(true);
  };

  const chooseFolder = async () => {
    setFolderPickerBusy(true);
    setFormError("");
    try {
      const selected = await pickWorkspaceFolder();
      if (!selected) return;
      setRootPath(selected);
      setName((current) => current.trim() || nameFromRoot(selected));
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : "The folder picker could not be opened.",
      );
    } finally {
      setFolderPickerBusy(false);
    }
  };

  const submitNewWorkspace = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedRoot = rootPath.trim();
    if (!selectedRoot) {
      setFormError("Choose a workspace folder first.");
      return;
    }
    const blocked = onBeforeWorkspaceChange?.();
    if (blocked) {
      setFormError(blocked);
      return;
    }
    setRegistrationBusy(true);
    setFormError("");
    const workspace = await registerWorkspace({
      name: name.trim() || nameFromRoot(selectedRoot),
      rootPath: selectedRoot,
      kind: "brain",
      trustLevel,
    });
    setRegistrationBusy(false);
    if (!workspace) {
      setFormError("The workspace could not be registered.");
      return;
    }
    setNewWorkspaceOpen(false);
  };

  const activeLabel = activeWorkspace?.name ?? "No workspace";
  const busy = loading || registrationBusy || folderPickerBusy;

  return (
    <div className="workspace-switcher-wrap" ref={switcherRef}>
      <button
        type="button"
        className="workspace-switcher"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-label={`Switch workspace, current ${activeLabel}`}
        onClick={() => {
          setSwitchError("");
          setPopoverOpen((open) => !open);
        }}
      >
        <span className="workspace-avatar" aria-hidden="true">
          {activeLabel.slice(0, 1).toUpperCase() || "?"}
        </span>
        <span>
          <strong>{activeLabel}</strong>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {popoverOpen ? (
        <div
          className="workspace-switcher-popover"
          role="dialog"
          aria-label="Workspace switcher"
        >
          <header>
            <div>
              <p className="eyebrow">Workspaces</p>
              <strong>Switch workspace</strong>
            </div>
            <span>{workspaces.length}</span>
          </header>
          <div className="workspace-switcher-list" role="list">
            {workspaces.length ? (
              workspaces.map((workspace) => (
                <button
                  type="button"
                  className="workspace-switcher-option"
                  key={workspace.id}
                  aria-current={
                    workspace.id === activeWorkspace?.id ? "true" : undefined
                  }
                  onClick={() => {
                    chooseWorkspace(workspace.id);
                  }}
                >
                  <span className="workspace-option-avatar" aria-hidden="true">
                    {workspace.name.slice(0, 1).toUpperCase() || "?"}
                  </span>
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>
                      {kindLabel(workspace.kind)} ·{" "}
                      {trustLabel(workspace.trustLevel)}
                    </small>
                  </span>
                  {workspace.id === activeWorkspace?.id ? (
                    <Check size={15} aria-label="Active workspace" />
                  ) : null}
                </button>
              ))
            ) : (
              <p className="workspace-switcher-empty">
                {loading
                  ? "Loading workspaces…"
                  : "No workspaces registered yet."}
              </p>
            )}
          </div>
          {switchError ? (
            <p className="workspace-switcher-feedback" role="alert">
              {switchError}
            </p>
          ) : null}
          {error ? (
            <p className="workspace-switcher-feedback" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="workspace-switcher-new button"
            onClick={openNewWorkspace}
          >
            <FolderPlus size={15} aria-hidden="true" />
            New workspace
          </button>
        </div>
      ) : null}
      <ModalDialog
        open={newWorkspaceOpen}
        title="New workspace"
        eyebrow="Workspace registry"
        onClose={() => {
          if (!busy) setNewWorkspaceOpen(false);
        }}
      >
        <form
          className="workspace-switcher-form"
          onSubmit={(event) => void submitNewWorkspace(event)}
        >
          <p>
            Register a local folder as a Brain workspace. Its name can be
            changed before opening.
          </p>
          <label>
            Workspace folder
            <button
              className="button"
              type="button"
              aria-label={
                rootPath ? "Choose a different folder" : "Choose folder…"
              }
              onClick={() => void chooseFolder()}
              disabled={busy}
            >
              {folderPickerBusy
                ? "Choosing folder…"
                : rootPath
                  ? "Choose a different folder"
                  : "Choose folder…"}
            </button>
            <output
              className="workspace-folder-selection"
              aria-live="polite"
              aria-label="Selected workspace folder"
            >
              {rootPath || "No folder selected yet."}
            </output>
          </label>
          <label>
            Workspace name
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="My Brain"
            />
          </label>
          <label>
            Trust level
            <select
              value={trustLevel}
              onChange={(event) => {
                setTrustLevel(event.target.value as WorkspaceTrustLevel);
              }}
            >
              {trustOptions.map(({ value, label }) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {formError ? <p role="alert">{formError}</p> : null}
          {error && !formError ? <p role="alert">{error}</p> : null}
          <footer className="modal-dialog-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setNewWorkspaceOpen(false);
              }}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={busy || !rootPath.trim()}
            >
              {registrationBusy ? "Opening…" : "Open workspace"}
            </button>
          </footer>
        </form>
      </ModalDialog>
    </div>
  );
}
