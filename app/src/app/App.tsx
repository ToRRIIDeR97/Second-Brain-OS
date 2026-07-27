import { AppShell } from "../components/layout/AppShell";
import { ErrorBoundary } from "../components/common/ErrorBoundary";

export function App() {
  return (
    <ErrorBoundary label="Your shell is still available. Try the pane again or choose another activity.">
      <AppShell />
    </ErrorBoundary>
  );
}
