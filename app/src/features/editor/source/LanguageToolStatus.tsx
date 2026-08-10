import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FileCode2,
  Info,
  LoaderCircle,
  ScanSearch,
} from "lucide-react";

export type LanguageToolState =
  | "available"
  | "missing"
  | "disabled"
  | "loading"
  | "error";

/** The small, provider-neutral status entry used by the source toolbar. */
export type LanguageToolStatusItem = {
  id?: string;
  name?: string;
  label?: string;
  tool?: string;
  status?: LanguageToolState;
  state?: LanguageToolState;
  available?: boolean;
  loading?: boolean;
  disabled?: boolean;
  detail?: string;
  message?: string;
};

export type LanguageToolStatusProps = {
  statuses:
    | readonly LanguageToolStatusItem[]
    | Readonly<Record<string, LanguageToolStatusItem>>;
};

const stateLabels: Record<LanguageToolState, string> = {
  available: "Ready",
  missing: "Missing",
  disabled: "Disabled",
  loading: "Loading",
  error: "Error",
};

function entries(
  statuses: LanguageToolStatusProps["statuses"],
): readonly LanguageToolStatusItem[] {
  if (Array.isArray(statuses)) {
    return statuses as readonly LanguageToolStatusItem[];
  }
  const record = statuses as Readonly<Record<string, LanguageToolStatusItem>>;
  return Object.keys(record).reduce<LanguageToolStatusItem[]>((result, id) => {
    const item = record[id];
    if (item) result.push({ id, ...item });
    return result;
  }, []);
}

function stateFor(item: LanguageToolStatusItem): LanguageToolState {
  const explicitState = item.status ?? item.state;
  if (explicitState) return explicitState;
  if (item.loading) return "loading";
  if (item.disabled) return "disabled";
  if (item.available === false) return "missing";
  return "available";
}

function StatusIcon({ state }: { state: LanguageToolState }) {
  const iconProps = { size: 14, strokeWidth: 1.9, "aria-hidden": true };
  switch (state) {
    case "available":
      return <CircleCheck {...iconProps} />;
    case "missing":
      return <CircleX {...iconProps} />;
    case "disabled":
      return <Info {...iconProps} />;
    case "loading":
      return <LoaderCircle {...iconProps} />;
    case "error":
      return <CircleAlert {...iconProps} />;
  }
}

export function LanguageToolStatus({ statuses }: LanguageToolStatusProps) {
  const items = entries(statuses);
  return (
    <section className="source-tool-status" aria-label="Language tool status">
      {items.length === 0 ? (
        <span className="source-tool-status-empty">
          No language tools configured
        </span>
      ) : (
        <ul>
          {items.map((item, index) => {
            const state = stateFor(item);
            const name =
              item.name ??
              item.label ??
              item.tool ??
              item.id ??
              "Language tool";
            const detail = item.detail ?? item.message;
            return (
              <li
                key={`${item.id ?? name}-${String(index)}`}
                data-state={state}
              >
                <StatusIcon state={state} />
                <span className="source-tool-status-name">{name}</span>
                <span className="source-tool-status-state">
                  {stateLabels[state]}
                </span>
                {detail ? <small>{detail}</small> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export type LanguageToolActionsProps = {
  onFormat?: () => void | Promise<void>;
  onAnalyze?: () => void | Promise<void>;
  formatting?: boolean;
  analyzing?: boolean;
  canFormat?: boolean;
  canAnalyze?: boolean;
  formatMissing?: boolean;
  analyzeMissing?: boolean;
};

function actionButtonState(
  callback: (() => void | Promise<void>) | undefined,
  canRun: boolean | undefined,
  missing: boolean | undefined,
) {
  return callback !== undefined && canRun !== false && missing !== true;
}

export function LanguageToolActions({
  onFormat,
  onAnalyze,
  formatting = false,
  analyzing = false,
  canFormat = true,
  canAnalyze = true,
  formatMissing = false,
  analyzeMissing = false,
}: LanguageToolActionsProps) {
  const formatEnabled = actionButtonState(onFormat, canFormat, formatMissing);
  const analyzeEnabled = actionButtonState(
    onAnalyze,
    canAnalyze,
    analyzeMissing,
  );
  const formatUnavailable = !formatEnabled && !formatting;
  const analyzeUnavailable = !analyzeEnabled && !analyzing;

  return (
    <div className="source-tool-actions" aria-label="Language tool actions">
      <button
        type="button"
        className="button button-small"
        disabled={!formatEnabled || formatting}
        aria-label="Format Document"
        aria-busy={formatting}
        title={formatUnavailable ? "Formatter unavailable" : "Format Document"}
        onClick={() => {
          void onFormat?.();
        }}
      >
        {formatting ? (
          <LoaderCircle
            size={14}
            className="source-tool-spinner"
            aria-hidden="true"
          />
        ) : (
          <FileCode2 size={14} aria-hidden="true" />
        )}
        <span>{formatting ? "Formatting…" : "Format Document"}</span>
      </button>
      <button
        type="button"
        className="button button-small"
        disabled={!analyzeEnabled || analyzing}
        aria-label="Analyze Workspace"
        aria-busy={analyzing}
        title={
          analyzeUnavailable ? "Analyzer unavailable" : "Analyze Workspace"
        }
        onClick={() => {
          void onAnalyze?.();
        }}
      >
        {analyzing ? (
          <LoaderCircle
            size={14}
            className="source-tool-spinner"
            aria-hidden="true"
          />
        ) : (
          <ScanSearch size={14} aria-hidden="true" />
        )}
        <span>{analyzing ? "Analyzing…" : "Analyze Workspace"}</span>
      </button>
      {formatUnavailable ? (
        <span className="source-tool-action-note" role="status">
          Formatter unavailable
        </span>
      ) : null}
      {analyzeUnavailable ? (
        <span className="source-tool-action-note" role="status">
          Analyzer unavailable
        </span>
      ) : null}
    </div>
  );
}

export const LanguageToolToolbar = LanguageToolActions;
