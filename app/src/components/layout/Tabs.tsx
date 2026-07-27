import type { ShellTab } from "../../state/shell";

export function Tabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
}: {
  tabs: ShellTab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Open views">
      {tabs.map((tab) => (
        <div
          className="tab"
          key={tab.id}
          data-active={tab.id === activeTabId ? "true" : undefined}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId}
            className="tab-label"
            onClick={() => {
              onActivate(tab.id);
            }}
          >
            <span className="tab-dot" aria-hidden="true" />
            {tab.title}
            {tab.dirty ? " •" : ""}
          </button>
          {tabs.length > 1 ? (
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={() => {
                onClose(tab.id);
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="tab-add"
        aria-label="Open a new view"
        title="Open a new view"
      >
        +
      </button>
    </div>
  );
}
