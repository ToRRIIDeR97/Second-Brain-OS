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
}: {
  branch?: string;
  changes: SourceControlChange[];
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onDiscard?: (path: string) => void;
}) {
  return (
    <section aria-labelledby="source-control-title">
      <p className="eyebrow">System Git</p>
      <h1 id="source-control-title">Changes</h1>
      <p role="status">
        {branch ? `${branch} · ` : ""}
        {changes.length} changed {changes.length === 1 ? "file" : "files"}
      </p>
      {changes.length ? (
        <ul aria-label="Repository changes">
          {changes.map((change) => (
            <li key={change.path}>
              <code>{change.path}</code> · {change.status} ·{" "}
              {change.attribution ?? "unknown attribution"}
              <button
                type="button"
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
                onClick={() => onDiscard?.(change.path)}
                aria-label={`Discard ${change.path} after confirmation`}
              >
                Discard…
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No repository changes are loaded.</p>
      )}
      <p>
        Discard and restore actions require confirmation in the backend. Agent
        attribution remains unknown unless operation evidence is unambiguous.
      </p>
    </section>
  );
}
