export type SourceControlChange = {
  path: string;
  status: string;
  staged: boolean;
  attribution?: "agent" | "user" | "unknown";
};

export function SourceControlWorkspace({
  branch,
  changes,
  onStage,
  onUnstage,
  onDiscard,
  onOpenDiff,
}: {
  branch?: string;
  changes: SourceControlChange[];
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onDiscard?: (path: string) => void;
  onOpenDiff?: (path: string, staged: boolean) => void;
}) {
  const staged = changes.filter((change) => change.staged);
  const unstaged = changes.filter((change) => !change.staged);
  const renderChanges = (items: SourceControlChange[]) =>
    items.length ? (
      <ul className="source-change-list">
        {items.map((change) => (
          <li key={change.path}>
            <button
              type="button"
              className="source-change-main"
              onClick={() => onOpenDiff?.(change.path, change.staged)}
            >
              <span className="source-change-status">
                {change.status.slice(0, 1) || "M"}
              </span>
              <code>{change.path}</code>
              <small>{change.attribution ?? "unknown"}</small>
            </button>
            <button
              type="button"
              className="button button-small"
              onClick={() =>
                change.staged
                  ? onUnstage?.(change.path)
                  : onStage?.(change.path)
              }
            >
              {change.staged ? "Unstage" : "Stage"}
            </button>
            <button
              type="button"
              className="button button-small"
              onClick={() => onDiscard?.(change.path)}
              aria-label={`Discard ${change.path} after confirmation`}
            >
              Discard…
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="source-empty">No files in this group.</p>
    );

  return (
    <section
      className="source-control-workspace"
      aria-labelledby="source-control-title"
    >
      <header className="surface-toolbar">
        <div>
          <p className="eyebrow">Git</p>
          <h1 id="source-control-title">Changes</h1>
        </div>
        <p className="source-branch" role="status">
          <span className="status-dot" /> {branch ?? "No repository branch"}
        </p>
      </header>
      <div className="source-summary">
        <strong>{changes.length}</strong> changed{" "}
        {changes.length === 1 ? "file" : "files"}
        <span>
          {staged.length} staged · {unstaged.length} unstaged
        </span>
      </div>
      <section className="source-group" aria-labelledby="staged-title">
        <div className="source-group-heading">
          <h2 id="staged-title">Staged</h2>
          <span>{staged.length}</span>
        </div>
        {renderChanges(staged)}
      </section>
      <section className="source-group" aria-labelledby="unstaged-title">
        <div className="source-group-heading">
          <h2 id="unstaged-title">Unstaged</h2>
          <span>{unstaged.length}</span>
        </div>
        {renderChanges(unstaged)}
      </section>
      <footer className="source-safety-note">
        Discard actions always require confirmation. Attribution stays unknown
        unless operation evidence is unambiguous.
      </footer>
    </section>
  );
}
