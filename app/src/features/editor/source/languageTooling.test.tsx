import { fireEvent, render, screen } from "@testing-library/react";

import { LanguageToolActions, LanguageToolStatus } from "./LanguageToolStatus";
import { ProblemsPanel, type SourceDiagnostic } from "./ProblemsPanel";

const diagnostic: SourceDiagnostic = {
  path: "src/main.ts",
  line: 8,
  column: 12,
  severity: "error",
  message: "Expected a semicolon",
  source: "typescript",
  code: 1005,
};

describe("source language tooling", () => {
  it("opens a diagnostic location from the accessible Problems list", () => {
    const onOpenLocation = vi.fn();
    render(
      <ProblemsPanel
        diagnostics={[diagnostic]}
        onOpenLocation={onOpenLocation}
      />,
    );

    const problem = screen.getByRole("button", {
      name: /Error in src\/main\.ts:8:12/i,
    });
    fireEvent.click(problem);

    expect(onOpenLocation).toHaveBeenCalledWith(diagnostic);
    expect(screen.getByText("Expected a semicolon")).toBeInTheDocument();
  });

  it("renders tool availability and disables unavailable actions", () => {
    const onFormat = vi.fn();
    const onAnalyze = vi.fn();
    render(
      <>
        <LanguageToolStatus
          statuses={[
            { name: "Formatter", status: "available" },
            { name: "Analyzer", status: "missing" },
          ]}
        />
        <LanguageToolActions
          onFormat={onFormat}
          onAnalyze={onAnalyze}
          canAnalyze={false}
        />
      </>,
    );

    expect(screen.getByText("Formatter")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Analyze Workspace" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Format Document" }));
    expect(onFormat).toHaveBeenCalledOnce();
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it("announces loading actions and disables them while running", () => {
    render(
      <LanguageToolActions
        onFormat={() => undefined}
        onAnalyze={() => undefined}
        formatting
        analyzing
      />,
    );

    expect(
      screen.getByRole("button", { name: "Format Document" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Format Document" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Formatting…")).toBeInTheDocument();
    expect(screen.getByText("Analyzing…")).toBeInTheDocument();
  });
});
