import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchWorkspace } from "./SearchWorkspace";

describe("SearchWorkspace", () => {
  it("submits the visible query and opens the selected source", () => {
    const onSearch = vi.fn();
    const onOpen = vi.fn();
    const result = {
      id: "chunk_1",
      title: "SQLite decision",
      path: "decisions/database.md",
      snippet: "Use SQLite for local authoritative state.",
      authority: "explicit_file",
      indexState: "current" as const,
      reasonCodes: ["fts_match"],
    };
    render(
      <SearchWorkspace
        response={{ results: [result], structuredPlan: "type:decision" }}
        onSearch={onSearch}
        onOpen={onOpen}
      />,
    );

    fireEvent.change(screen.getByLabelText("Query"), {
      target: { value: "SQLite" },
    });
    fireEvent.submit(screen.getByRole("search"));
    fireEvent.click(screen.getByRole("button", { name: /SQLite decision/ }));

    expect(onSearch).toHaveBeenCalledWith("SQLite");
    expect(onOpen).toHaveBeenCalledWith(result);
    expect(screen.getByText("explicit_file · current")).toBeInTheDocument();
  });
});
