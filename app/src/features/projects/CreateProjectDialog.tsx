import { useId, useState, type SyntheticEvent } from "react";
import { FolderOpen, ShieldCheck } from "lucide-react";
import { ModalDialog } from "../../components/common/ModalDialog";
import type {
  IpcClient,
  ProjectLocationInput,
  RootSelection,
  WorkspaceTrustLevel,
} from "../../lib/ipc";
import { useProjects } from "../../state/projects";

export function CreateProjectDialog({
  open,
  ipc,
  onClose,
  onCreated,
}: {
  open: boolean;
  ipc: IpcClient;
  onClose: () => void;
  onCreated?: (projectId: string) => void;
}) {
  const { createProject, error: projectError, loading } = useProjects();
  const nameErrorId = useId();
  const outcomeErrorId = useId();
  const locationErrorId = useId();
  const backendErrorId = useId();
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState("");
  const [locationMode, setLocationMode] = useState<"none" | "existing" | "new">(
    "none",
  );
  const [rootSelection, setRootSelection] = useState<RootSelection>();
  const [templateId, setTemplateId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tags, setTags] = useState("");
  const [trustLevel, setTrustLevel] = useState<WorkspaceTrustLevel>("trusted");
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const chooseFolder = async () => {
    setSelectingFolder(true);
    setFieldErrors((current) => ({ ...current, location: "" }));
    const result = await ipc.workspaces.selectRoot();
    setSelectingFolder(false);
    if (!result.ok) {
      setFieldErrors((current) => ({
        ...current,
        location: result.error.message,
      }));
      return;
    }
    if (!result.data) return;
    setRootSelection(result.data);
    setName((current) => current.trim() || result.data?.suggestedName || "");
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Enter a Project name.";
    if (!outcome.trim()) errors.outcome = "Describe the outcome you want.";
    if (locationMode !== "none" && !rootSelection)
      errors.location =
        locationMode === "new"
          ? "Create and choose the new Project folder."
          : "Choose a Project folder.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    const location: ProjectLocationInput =
      locationMode !== "none" && rootSelection
        ? {
            mode: "rootSelection",
            grantId: rootSelection.grantId,
            trustLevel,
          }
        : { mode: "none" };
    const project = await createProject({
      name: name.trim(),
      outcome: outcome.trim(),
      templateId: templateId || null,
      instructions: instructions.trim(),
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      location,
    });
    if (!project) return;
    onCreated?.(project.id);
    onClose();
  };

  return (
    <ModalDialog
      open={open}
      title="Create a Project"
      eyebrow="New Project"
      onClose={() => {
        if (!loading && !selectingFolder) onClose();
      }}
    >
      <form
        className="project-create-form"
        aria-describedby={projectError ? backendErrorId : undefined}
        onSubmit={(event) => void submit(event)}
      >
        <p className="project-create-intro">
          Start with the outcome. You can connect files and tune agent access
          now or later.
        </p>
        <label>
          Project name
          <input
            autoFocus
            value={name}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? nameErrorId : undefined}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="Launch the new research workflow"
            maxLength={200}
          />
          {fieldErrors.name ? (
            <small className="field-error" id={nameErrorId}>
              {fieldErrors.name}
            </small>
          ) : null}
        </label>
        <label>
          Outcome
          <textarea
            value={outcome}
            aria-invalid={Boolean(fieldErrors.outcome)}
            aria-describedby={fieldErrors.outcome ? outcomeErrorId : undefined}
            onChange={(event) => {
              setOutcome(event.target.value);
            }}
            placeholder="What will be true when this Project is successful?"
            rows={3}
            maxLength={4000}
          />
          {fieldErrors.outcome ? (
            <small className="field-error" id={outcomeErrorId}>
              {fieldErrors.outcome}
            </small>
          ) : null}
        </label>
        <fieldset
          className="project-location-fieldset"
          aria-describedby={fieldErrors.location ? locationErrorId : undefined}
        >
          <legend>Project files</legend>
          <label>
            <input
              type="radio"
              name="project-location"
              checked={locationMode === "none"}
              onChange={() => {
                setLocationMode("none");
              }}
            />
            No folder yet
          </label>
          <label>
            <input
              type="radio"
              name="project-location"
              checked={locationMode === "existing"}
              onChange={() => {
                setLocationMode("existing");
              }}
            />
            Connect an existing folder
          </label>
          <label>
            <input
              type="radio"
              name="project-location"
              checked={locationMode === "new"}
              onChange={() => {
                setLocationMode("new");
              }}
            />
            Create a new folder
          </label>
          {locationMode !== "none" ? (
            <div className="project-folder-choice">
              {locationMode === "new" ? (
                <p>Create the folder in the system picker, then select it.</p>
              ) : null}
              <button
                className="button"
                type="button"
                disabled={loading || selectingFolder}
                onClick={() => void chooseFolder()}
              >
                <FolderOpen size={16} aria-hidden="true" />
                {selectingFolder
                  ? "Choosing folder…"
                  : rootSelection
                    ? "Choose a different folder"
                    : "Choose folder"}
              </button>
              <output aria-live="polite">
                {rootSelection?.displayPath ?? "No folder selected."}
              </output>
              {fieldErrors.location ? (
                <small className="field-error" id={locationErrorId}>
                  {fieldErrors.location}
                </small>
              ) : null}
            </div>
          ) : null}
        </fieldset>
        <details className="project-advanced">
          <summary>Advanced details</summary>
          <div>
            <label>
              Starting template
              <select
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value);
                }}
              >
                <option value="">Blank Project</option>
                <option value="software">Software project</option>
                <option value="research">Research</option>
                <option value="personal">Personal goal</option>
              </select>
            </label>
            <label>
              Agent instructions
              <textarea
                value={instructions}
                onChange={(event) => {
                  setInstructions(event.target.value);
                }}
                placeholder="Project-specific constraints, preferences, and definition of done."
                rows={4}
                maxLength={16000}
              />
            </label>
            <label>
              Tags
              <input
                value={tags}
                onChange={(event) => {
                  setTags(event.target.value);
                }}
                placeholder="research, personal"
              />
            </label>
            {locationMode !== "none" ? (
              <label>
                Folder access
                <select
                  value={trustLevel}
                  onChange={(event) => {
                    setTrustLevel(event.target.value as WorkspaceTrustLevel);
                  }}
                >
                  <option value="trusted">Read, write, and terminal</option>
                  <option value="trusted_read_only">Read only</option>
                  <option value="untrusted">Untrusted read only</option>
                  <option value="restricted">Restricted read only</option>
                </select>
              </label>
            ) : null}
            <p className="project-access-preview">
              <ShieldCheck size={16} aria-hidden="true" />
              Displayed paths never grant access. Every file and agent action is
              checked against the linked workspace.
            </p>
          </div>
        </details>
        {projectError ? (
          <p className="form-error" id={backendErrorId} role="alert">
            {projectError}
          </p>
        ) : null}
        <footer className="modal-dialog-actions">
          <button
            className="button"
            type="button"
            disabled={loading || selectingFolder}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={loading || selectingFolder}
          >
            {loading ? "Creating Project…" : "Create Project"}
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}
