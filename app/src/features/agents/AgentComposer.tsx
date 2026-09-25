import { useEffect, useId, useState } from "react";
import { Send, ShieldCheck } from "lucide-react";
import { defaultAgentSessionSource } from "./source";
import type {
  AgentAvailability,
  AgentSession,
  AgentSessionSource,
} from "./types";

export type AgentComposerProps = {
  workspaceId: string;
  source?: AgentSessionSource;
  onStarted?: (session: AgentSession) => void;
  compact?: boolean;
  defaultSandbox?: "read_only" | "workspace_write";
};

export function AgentComposer({
  workspaceId,
  source = defaultAgentSessionSource,
  onStarted,
  compact = false,
  defaultSandbox = "read_only",
}: AgentComposerProps) {
  const objectiveId = useId();
  const permissionId = useId();
  const [objective, setObjective] = useState("");
  const [sandbox, setSandbox] = useState<"read_only" | "workspace_write">(
    defaultSandbox,
  );
  const [availability, setAvailability] = useState<AgentAvailability>(
    source.availability,
  );
  const [submitting, setSubmitting] = useState(false);
  const [issue, setIssue] = useState<string>();

  useEffect(() => {
    setSandbox(defaultSandbox);
  }, [defaultSandbox, workspaceId]);

  useEffect(() => {
    let disposed = false;
    void source.probe().then((next) => {
      if (!disposed) setAvailability(next);
    });
    return () => {
      disposed = true;
    };
  }, [source]);

  const submit = async () => {
    if (!objective.trim() || submitting) return;
    setSubmitting(true);
    setIssue(undefined);
    try {
      const result = await source.start(workspaceId, objective.trim(), sandbox);
      if (!result.ok) {
        setIssue(result.error.message);
        return;
      }
      setObjective("");
      onStarted?.(result.session);
    } catch (error: unknown) {
      setIssue(
        error instanceof Error
          ? error.message
          : "The managed agent could not be started.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="agent-composer"
      data-compact={compact || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="agent-composer-copy">
        <span aria-hidden="true">
          <ShieldCheck size={18} />
        </span>
        <div>
          <strong>Ask Second Brain</strong>
          <small>
            {availability.status === "available"
              ? "Runs locally through Codex with explicit permissions."
              : (availability.reason ?? "Codex is unavailable.")}
          </small>
        </div>
      </div>
      <label className="sr-only" htmlFor={objectiveId}>
        What should the agent do?
      </label>
      <textarea
        id={objectiveId}
        rows={compact ? 2 : 3}
        maxLength={4000}
        value={objective}
        placeholder="Ask a question, plan work, or make a scoped change…"
        onChange={(event) => {
          setObjective(event.target.value);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="agent-composer-actions">
        <label htmlFor={permissionId}>
          Access
          <select
            id={permissionId}
            value={sandbox}
            onChange={(event) => {
              setSandbox(
                event.target.value === "workspace_write"
                  ? "workspace_write"
                  : "read_only",
              );
            }}
          >
            <option value="read_only">Read only</option>
            <option value="workspace_write">Workspace write</option>
          </select>
        </label>
        <span>Ctrl/⌘ + Enter</span>
        <button
          type="submit"
          className="button button-primary"
          disabled={
            submitting ||
            !objective.trim() ||
            availability.status === "unavailable"
          }
        >
          <Send size={15} aria-hidden="true" />
          {submitting ? "Starting…" : "Run"}
        </button>
      </div>
      {issue ? <p role="alert">{issue}</p> : null}
    </form>
  );
}
