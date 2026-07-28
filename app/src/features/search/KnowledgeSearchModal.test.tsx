import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeSearchModal } from "./KnowledgeSearchModal";

const result = {
  id: "chunk_1",
  title: "SQLite decision",
  path: "decisions/database.md",
  snippet: "Use SQLite for local authoritative state.",
  authority: "explicit_file",
  indexState: "current" as const,
  reasonCodes: ["fts_match"],
};

describe("KnowledgeSearchModal", () => {
  it("submits a query and opens a selected knowledge result", () => {
    const onSearch = vi.fn();
    const onOpen = vi.fn();
    render(
      <KnowledgeSearchModal
        open
        response={{ results: [result], structuredPlan: "type:decision" }}
        onClose={vi.fn()}
        onSearch={onSearch}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "SQLite" },
    });
    fireEvent.submit(screen.getByRole("search"));
    fireEvent.click(screen.getByRole("button", { name: /SQLite decision/ }));

    expect(onSearch).toHaveBeenCalledWith("SQLite");
    expect(onOpen).toHaveBeenCalledWith(result);
    expect(screen.getByText("explicit_file · current")).toBeInTheDocument();
  });

  it("closes on Escape and backdrop click", () => {
    const onClose = vi.fn();
    render(
      <KnowledgeSearchModal
        open
        response={{ results: [], structuredPlan: "" }}
        onClose={onClose}
        onSearch={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("knowledge-search-backdrop"));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not render while closed", () => {
    render(
      <KnowledgeSearchModal
        open={false}
        response={{ results: [], structuredPlan: "" }}
        onClose={vi.fn()}
        onSearch={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
