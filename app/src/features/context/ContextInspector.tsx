import { useState } from "react";
import type { ContextInspectorPacket } from "./types";

type ContextInspectorProps = {
  packet: ContextInspectorPacket;
  onToggleItem?: (itemId: string, included: boolean) => void;
  onDepthChange?: (depth: 0 | 1 | 2) => void;
  onBudgetChange?: (budget: number) => void;
};

export function ContextInspector({
  packet,
  onToggleItem,
  onDepthChange,
  onBudgetChange,
}: ContextInspectorProps) {
  const [budget, setBudget] = useState(packet.tokenBudget);
  const stale = packet.indexGeneration !== packet.currentGeneration;

  return (
    <section aria-labelledby="context-inspector-title">
      <h2 id="context-inspector-title">Context packet</h2>
      <p>
        {packet.tokenCount.toLocaleString()} /{" "}
        {packet.tokenBudget.toLocaleString()} tokens
      </p>
      <p role="status">
        {stale ? "Stale · sources changed" : "Current"} · {packet.packetId}
      </p>
      <label>
        Graph depth
        <select
          value={packet.graphDepth}
          onChange={(event) => {
            const depth = Number(event.target.value);
            if (depth === 0 || depth === 1 || depth === 2)
              onDepthChange?.(depth);
          }}
        >
          <option value={0}>None</option>
          <option value={1}>One hop</option>
          <option value={2}>Two hops</option>
        </select>
      </label>
      <label>
        Token budget
        <input
          type="number"
          min={1}
          value={budget}
          onChange={(event) => {
            const next = Math.max(1, Number(event.target.value) || 1);
            setBudget(next);
            onBudgetChange?.(next);
          }}
        />
      </label>
      <ul aria-label="Context sources">
        {packet.items.map((item) => (
          <li key={item.id}>
            <span>
              {item.label} · {item.authority} · score {item.score} ·{" "}
              {item.tokenCount} tokens
              {item.stale ? " · stale" : ""}
            </span>
            <small>
              {item.reasons.join(" · ")} · {item.sourceHash}
            </small>
            <button
              type="button"
              disabled={item.required}
              onClick={() => onToggleItem?.(item.id, !item.included)}
            >
              {item.required ? "Required" : item.included ? "Remove" : "Add"}
            </button>
          </li>
        ))}
      </ul>
      {packet.exclusions.length > 0 ? (
        <details>
          <summary>Excluded sources ({packet.exclusions.length})</summary>
          <ul aria-label="Context exclusions">
            {packet.exclusions.map((exclusion) => (
              <li key={`${exclusion.candidateId}-${exclusion.reason}`}>
                {exclusion.candidateId} · {exclusion.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <details>
        <summary>Raw packet preview</summary>
        <pre>{packet.rawSerialization}</pre>
      </details>
    </section>
  );
}
