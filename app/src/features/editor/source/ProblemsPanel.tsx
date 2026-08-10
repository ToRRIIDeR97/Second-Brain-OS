import { CircleAlert, Info, Lightbulb, TriangleAlert } from "lucide-react";

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

/** A provider-neutral diagnostic that can be rendered by the source editor. */
export type SourceDiagnostic = {
  path: string;
  line: number;
  column: number;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string | number;
  category?: string;
};

export type ProblemsPanelProps = {
  diagnostics: readonly SourceDiagnostic[];
  onOpenLocation: (diagnostic: SourceDiagnostic) => void;
};

const severityLabels: Record<DiagnosticSeverity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Information",
  hint: "Hint",
};

function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  const iconProps = { size: 15, strokeWidth: 1.9, "aria-hidden": true };
  switch (severity) {
    case "error":
      return <CircleAlert {...iconProps} />;
    case "warning":
      return <TriangleAlert {...iconProps} />;
    case "hint":
      return <Lightbulb {...iconProps} />;
    case "info":
      return <Info {...iconProps} />;
  }
}

function diagnosticCode(diagnostic: SourceDiagnostic) {
  return diagnostic.code ?? diagnostic.category;
}

export function ProblemsPanel({
  diagnostics,
  onOpenLocation,
}: ProblemsPanelProps) {
  return (
    <section
      className="source-problems-panel"
      aria-labelledby="source-problems-title"
    >
      <header className="source-problems-header">
        <div>
          <p className="eyebrow">Language tooling</p>
          <h2 id="source-problems-title">Problems</h2>
        </div>
        <span
          className="source-problems-count"
          aria-label={`${String(diagnostics.length)} problems`}
        >
          {diagnostics.length}
        </span>
      </header>

      {diagnostics.length === 0 ? (
        <p className="source-problems-empty" role="status">
          No problems detected.
        </p>
      ) : (
        <ul className="source-problems-list">
          {diagnostics.map((diagnostic, index) => {
            const code = diagnosticCode(diagnostic);
            const location = `${diagnostic.path}:${String(diagnostic.line)}:${String(diagnostic.column)}`;
            const key = `${location}:${diagnostic.severity}:${String(code ?? "")}:${String(index)}`;
            const severity = severityLabels[diagnostic.severity];
            return (
              <li key={key}>
                <button
                  type="button"
                  className="source-problem"
                  data-severity={diagnostic.severity}
                  onClick={() => {
                    onOpenLocation(diagnostic);
                  }}
                  aria-label={`${severity} in ${location}: ${diagnostic.message}`}
                >
                  <span className="source-problem-icon" aria-hidden="true">
                    <SeverityIcon severity={diagnostic.severity} />
                  </span>
                  <span className="source-problem-body">
                    <span className="source-problem-message">
                      {diagnostic.message}
                    </span>
                    <span className="source-problem-location">
                      <code>{location}</code>
                      {diagnostic.source ? (
                        <span>{diagnostic.source}</span>
                      ) : null}
                      {code !== undefined ? <code>{String(code)}</code> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
