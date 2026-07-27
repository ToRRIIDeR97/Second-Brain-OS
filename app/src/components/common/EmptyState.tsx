type EmptyStateProps = {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className="empty-state" aria-labelledby="empty-state-title">
      <span className="empty-state-mark" aria-hidden="true">
        ✦
      </span>
      <h2 id="empty-state-title">{title}</h2>
      <p>{description}</p>
      {action ? (
        <button
          type="button"
          className="button button-primary"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </section>
  );
}
