import { DiffEditor } from "@monaco-editor/react";

export interface GitDiffEditorProps {
  original?: string | null;
  modified?: string | null;
  originalLabel?: string;
  modifiedLabel?: string;
  language?: string;
  /** A binary/oversized explanation supplied by the Git adapter. */
  fallback?: string;
  /** Convenience flags for callers that keep the fallback reason typed. */
  binary?: boolean;
  oversized?: boolean;
  height?: number | string;
  width?: number | string;
  className?: string;
}

function fallbackMessage(
  fallback: string | undefined,
  binary: boolean,
  oversized: boolean,
): string | undefined {
  if (fallback === "binary")
    return "Binary files cannot be shown in the text diff viewer.";
  if (fallback === "oversized")
    return "This diff is too large for the text diff viewer.";
  if (fallback) return fallback;
  if (binary) return "Binary files cannot be shown in the text diff viewer.";
  if (oversized) return "This diff is too large for the text diff viewer.";
  return undefined;
}

/** Read-only Git before/after view shared by source-control and recovery UIs. */
export function GitDiffEditor({
  original,
  modified,
  originalLabel = "Original",
  modifiedLabel = "Modified",
  language,
  fallback,
  binary = false,
  oversized = false,
  height = "100%",
  width = "100%",
  className,
}: GitDiffEditorProps) {
  const message = fallbackMessage(fallback, binary, oversized);
  return (
    <section
      aria-label={`${originalLabel} and ${modifiedLabel} diff`}
      className={className}
      style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <header
        aria-label="Diff labels"
        style={{ display: "flex", gap: "1rem", padding: "0.35rem 0.6rem" }}
      >
        <span data-diff-side="original">{originalLabel}</span>
        <span data-diff-side="modified">{modifiedLabel}</span>
      </header>
      {message ? (
        <p role="status" style={{ margin: "0.75rem", whiteSpace: "pre-wrap" }}>
          {message}
        </p>
      ) : (
        <div style={{ minHeight: 0, flex: 1 }}>
          <DiffEditor
            original={original ?? ""}
            modified={modified ?? ""}
            {...(language === undefined
              ? {}
              : {
                  language,
                  originalLanguage: language,
                  modifiedLanguage: language,
                })}
            height={height}
            width={width}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              readOnly: true,
              renderSideBySide: true,
              useInlineViewWhenSpaceIsLimited: true,
              scrollBeyondLastLine: false,
              wordWrap: "off",
            }}
            wrapperProps={{ "aria-label": "Read-only Git diff editor" }}
          />
        </div>
      )}
    </section>
  );
}

export default GitDiffEditor;
