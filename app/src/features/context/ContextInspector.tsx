import { useMemo, useState } from "react";
import {
  contextUsagePercent,
  type ContextInspectorItem,
  type ContextInspectorPacket,
} from "./types";

export type ContextInspectorProps = {
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
  const [budgetDraft, setBudgetDraft] = useState({
    packetId: packet.packetId,
    value: Math.max(1, packet.tokenBudget),
  });
  const budget =
    budgetDraft.packetId === packet.packetId
      ? budgetDraft.value
      : Math.max(1, packet.tokenBudget);
  const stale = packet.indexGeneration !== packet.currentGeneration;
  const requiredItems = useMemo(
    () => packet.items.filter((item) => item.required),
    [packet.items],
  );
  const optionalItems = useMemo(
    () => packet.items.filter((item) => !item.required),
    [packet.items],
  );
  const usage = contextUsagePercent(packet.tokenCount, budget);
  const overBudget = packet.tokenCount > budget;
  const staleItems = packet.items.filter((item) => item.stale);

  const updateBudget = (value: number) => {
    const next = Math.max(1, Number.isFinite(value) ? value : 1);
    setBudgetDraft({ packetId: packet.packetId, value: next });
    onBudgetChange?.(next);
  };

  return (
    <section
      className="context-inspector"
      aria-labelledby="context-inspector-title"
    >
      <header className="region-heading">
        <div>
          <p className="eyebrow">Agent context</p>
          <h2 id="context-inspector-title">Context packet</h2>
        </div>
        <code>{packet.packetId}</code>
      </header>

      <div className="context-budget" aria-label="Context token budget">
        <div className="context-budget-heading">
          <strong>
            {packet.tokenCount.toLocaleString()} / {budget.toLocaleString()}{" "}
            tokens
          </strong>
          <span>{usage}% used</span>
        </div>
        <progress
          max={budget}
          value={Math.min(packet.tokenCount, budget)}
          aria-label={`Context budget ${String(usage)}% used`}
        />
        <p className={overBudget ? "context-budget-warning" : undefined}>
          {overBudget
            ? `${(packet.tokenCount - budget).toLocaleString()} tokens over budget.`
            : `${(budget - packet.tokenCount).toLocaleString()} tokens remaining.`}
        </p>
      </div>

      <p className="context-freshness" role="status">
        <span aria-hidden="true">{stale ? "⚠" : "●"}</span>{" "}
        {stale ? "Stale · sources changed" : "Current"} · packet generation{" "}
        {packet.indexGeneration}/{packet.currentGeneration}
      </p>
      {staleItems.length > 0 ? (
        <p className="context-stale-disclosure">
          {staleItems.length} source{staleItems.length === 1 ? "" : "s"} changed
          since this packet was compiled. Review before running an agent.
        </p>
      ) : null}

      <div className="context-controls">
        <label>
          Graph depth
          <select
            value={packet.graphDepth}
            onChange={(event) => {
              const depth = Number(event.target.value);
              if (depth === 0 || depth === 1 || depth === 2) {
                onDepthChange?.(depth);
              }
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
            inputMode="numeric"
            value={budget}
            onChange={(event) => {
              updateBudget(Number(event.target.value));
            }}
          />
        </label>
      </div>

      <section aria-labelledby="context-required-title">
        <div className="region-heading">
          <h3 id="context-required-title">Required sources</h3>
          <span>{requiredItems.length}</span>
        </div>
        {requiredItems.length > 0 ? (
          <SourceList
            items={requiredItems}
            label="Required context sources"
            onToggleItem={onToggleItem}
          />
        ) : (
          <p>No required sources.</p>
        )}
      </section>

      <section aria-labelledby="context-optional-title">
        <div className="region-heading">
          <h3 id="context-optional-title">Optional sources</h3>
          <span>{optionalItems.length}</span>
        </div>
        {optionalItems.length > 0 ? (
          <SourceList
            items={optionalItems}
            label="Optional context sources"
            onToggleItem={onToggleItem}
          />
        ) : (
          <p>No optional sources selected.</p>
        )}
      </section>

      <details open={packet.exclusions.length > 0}>
        <summary>Excluded sources ({packet.exclusions.length})</summary>
        {packet.exclusions.length > 0 ? (
          <ul aria-label="Context exclusions">
            {packet.exclusions.map((exclusion) => (
              <li key={`${exclusion.candidateId}-${exclusion.reason}`}>
                {exclusion.candidateId} · {exclusion.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p>No candidates were excluded.</p>
        )}
      </details>

      <details>
        <summary>Raw packet preview</summary>
        <pre>{packet.rawSerialization}</pre>
      </details>
    </section>
  );
}

function SourceList({
  items,
  label,
  onToggleItem,
}: {
  items: ContextInspectorItem[];
  label: string;
  onToggleItem?: ((itemId: string, included: boolean) => void) | undefined;
}) {
  return (
    <ul aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <div>
            <strong>{item.label}</strong>
            <span>
              {" "}
              · {item.authority} · score {item.score} · {item.tokenCount} tokens
            </span>
            {item.stale ? <span> · stale</span> : null}
          </div>
          <small>
            {item.reasons.length > 0 ? `${item.reasons.join(" · ")} · ` : ""}
            {item.sourceHash}
          </small>
          <button
            type="button"
            className="button button-small"
            disabled={item.required}
            aria-label={
              item.required ? "Required" : item.included ? "Remove" : "Add"
            }
            title={`${item.included ? "Remove" : "Add"} ${item.label}`}
            onClick={() => onToggleItem?.(item.id, !item.included)}
          >
            {item.required ? "Required" : item.included ? "Remove" : "Add"}
          </button>
        </li>
      ))}
    </ul>
  );
}
