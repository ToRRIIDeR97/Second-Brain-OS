import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitDiffEditor } from "./GitDiffEditor";

type DiffRenderProps = {
  original?: string;
  modified?: string;
  language?: string;
  options?: {
    automaticLayout?: boolean;
    readOnly?: boolean;
    renderSideBySide?: boolean;
    useInlineViewWhenSpaceIsLimited?: boolean;
  };
};

const { renderDiff } = vi.hoisted(() => ({
  renderDiff: vi.fn<(props: DiffRenderProps) => void>(),
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  return {
    DiffEditor: (props: DiffRenderProps) => {
      renderDiff(props);
      return React.createElement("div", { "data-testid": "monaco-diff" });
    },
  };
});

describe("GitDiffEditor", () => {
  beforeEach(() => {
    renderDiff.mockReset();
  });

  it("renders labeled read-only inline diffs with automatic layout", () => {
    render(
      <GitDiffEditor
        original="before"
        modified="after"
        originalLabel="HEAD"
        modifiedLabel="Working tree"
        language="markdown"
      />,
    );

    expect(screen.getByText("HEAD")).toBeInTheDocument();
    expect(screen.getByText("Working tree")).toBeInTheDocument();
    expect(screen.getByTestId("monaco-diff")).toBeInTheDocument();
    const props = renderDiff.mock.calls[0]?.[0];
    expect(props?.original).toBe("before");
    expect(props?.modified).toBe("after");
    expect(props?.language).toBe("markdown");
    expect(props?.options).toMatchObject({
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
    });
  });

  it("shows the safe fallback instead of mounting Monaco", () => {
    render(<GitDiffEditor binary />);
    expect(screen.getByRole("status")).toHaveTextContent("Binary files");
    expect(screen.queryByTestId("monaco-diff")).not.toBeInTheDocument();
  });
});
