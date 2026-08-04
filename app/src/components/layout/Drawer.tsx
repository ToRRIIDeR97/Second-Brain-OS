import type { ReactNode } from "react";

export function Drawer({ terminal }: { terminal?: ReactNode }) {
  return (
    <section className="drawer" aria-label="Bottom drawer">
      <div className="drawer-content">
        {terminal ?? "No terminal sessions are open."}
      </div>
    </section>
  );
}
