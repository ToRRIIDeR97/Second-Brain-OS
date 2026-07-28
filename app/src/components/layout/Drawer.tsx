import type { ReactNode } from "react";
import type { Drawer as DrawerId } from "../../state/shell";

const DRAWER_TABS = [["terminal", "Terminal"]] as const;

export type DrawerTabId = (typeof DRAWER_TABS)[number][0];
export type DrawerContent = Partial<Record<DrawerTabId, ReactNode>>;
type DrawerSelection = DrawerId;

export function Drawer({
  onSelect,
  content = {},
  terminal,
}: {
  active: DrawerSelection;
  onSelect: (drawer: DrawerSelection) => void;
  content?: DrawerContent;
  terminal?: ReactNode;
}) {
  const activeContent =
    terminal ?? content.terminal ?? "No terminal sessions are open.";

  return (
    <section className="drawer" aria-label="Bottom drawer">
      <div className="drawer-tabs" role="tablist" aria-label="Drawer views">
        {DRAWER_TABS.map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="drawer-tab"
            data-active="true"
            onClick={() => {
              onSelect(id);
            }}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="drawer-content">{activeContent}</div>
    </section>
  );
}
