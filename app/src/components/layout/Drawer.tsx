import type { Drawer as DrawerId } from "../../state/shell";

const drawers: Array<[DrawerId, string]> = [
  ["agents", "Agents"],
  ["changes", "Changes"],
  ["diagnostics", "Diagnostics"],
  ["system", "System"],
];

export function Drawer({
  active,
  onSelect,
}: {
  active: DrawerId;
  onSelect: (drawer: DrawerId) => void;
}) {
  const activeLabel = drawers.find(([id]) => id === active)?.[1] ?? "System";
  return (
    <section className="drawer" aria-label="Bottom drawer">
      <div className="drawer-tabs" role="tablist" aria-label="Drawer views">
        {drawers.map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={id === active}
            className="drawer-tab"
            data-active={id === active ? "true" : undefined}
            onClick={() => {
              onSelect(id);
            }}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="drawer-content">
        <span className="status-dot" aria-hidden="true" />
        {active === "diagnostics"
          ? "No diagnostics in this window."
          : `${activeLabel} is ready.`}
      </div>
    </section>
  );
}
