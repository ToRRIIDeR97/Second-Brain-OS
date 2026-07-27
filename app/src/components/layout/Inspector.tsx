import type { Activity } from "../../state/shell";

export function Inspector({ activity }: { activity: Activity }) {
  const label =
    activity === "source-control"
      ? "Source control"
      : `${activity.slice(0, 1).toUpperCase()}${activity.slice(1)}`;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="region-heading">
        <div>
          <p className="eyebrow">Context</p>
          <h2>Inspector</h2>
        </div>
        <span className="inspector-key" aria-hidden="true">
          ⌘J
        </span>
      </div>
      <div className="inspector-card">
        <span className="card-label">Active surface</span>
        <strong>{label}</strong>
        <p>Selection details and actions will appear here.</p>
      </div>
      <div className="inspector-card inspector-card-muted">
        <span className="card-label">Workspace</span>
        <strong>Personal knowledge base</strong>
        <p>Private · local-first</p>
      </div>
    </aside>
  );
}
