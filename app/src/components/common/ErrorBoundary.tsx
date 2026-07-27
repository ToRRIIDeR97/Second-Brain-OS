import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null; correlationId: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, correlationId: "" };

  static getDerivedStateFromError(error: Error): State {
    return { error, correlationId: `ui-${Date.now().toString(36)}` };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostics safe: names and stack traces stay in the local console,
    // never in IPC or telemetry payloads.
    console.error("Unhandled feature error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section
        className="error-state"
        role="alert"
        aria-labelledby="error-title"
      >
        <p className="eyebrow">Feature unavailable</p>
        <h2 id="error-title">This pane could not be rendered.</h2>
        <p>
          {this.props.label ?? "The rest of your workspace is still available."}
        </p>
        <p className="error-correlation">
          Correlation ID: {this.state.correlationId}
        </p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            this.setState({ error: null, correlationId: "" });
          }}
        >
          Try again
        </button>
      </section>
    );
  }
}
