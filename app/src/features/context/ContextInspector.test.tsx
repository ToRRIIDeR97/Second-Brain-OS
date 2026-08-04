import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextInspector } from "./ContextInspector";
import { contextUsagePercent, type ContextInspectorPacket } from "./types";

const packet: ContextInspectorPacket = {
  packetId: "packet_test",
  tokenBudget: 1200,
  tokenCount: 400,
  indexGeneration: 3,
  currentGeneration: 4,
  graphDepth: 1,
  rawSerialization: '{"contract":"context_packet"}',
  items: [
    {
      id: "decision_1",
      label: "SQLite decision",
      kind: "decision",
      authority: "explicit_file",
      score: 900,
      reasons: ["context.current"],
      sourceHash: "blake3:test",
      tokenCount: 80,
      required: false,
      included: true,
      stale: false,
    },
  ],
  exclusions: [{ candidateId: "secret", reason: "context.sensitive" }],
};

describe("ContextInspector", () => {
  it("calculates bounded token budget usage", () => {
    expect(contextUsagePercent(400, 1200)).toBe(33);
    expect(contextUsagePercent(1600, 1200)).toBe(100);
    expect(contextUsagePercent(400, 0)).toBe(0);
  });

  it("shows stale/excluded state and emits packet controls", () => {
    const onToggleItem = vi.fn();
    const onDepthChange = vi.fn();
    const onBudgetChange = vi.fn();
    render(
      <ContextInspector
        packet={packet}
        onToggleItem={onToggleItem}
        onDepthChange={onDepthChange}
        onBudgetChange={onBudgetChange}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Stale");
    expect(screen.getByText(/score 900/)).toBeInTheDocument();
    expect(screen.getByText(/blake3:test/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Graph depth"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Token budget"), {
      target: { value: "900" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onDepthChange).toHaveBeenCalledWith(2);
    expect(onBudgetChange).toHaveBeenCalledWith(900);
    expect(onToggleItem).toHaveBeenCalledWith("decision_1", false);
    fireEvent.click(screen.getByText(/Excluded sources/));
    expect(screen.getByText("secret · context.sensitive")).toBeInTheDocument();
  });
});
