import type { FileDescriptor } from "./types";

export interface SafePreviewProps {
  descriptor: FileDescriptor;
  source?: string;
  externalOpen?: () => void;
}

/** Read-only fallback for content that must never be interpreted as active markup. */
export function SafePreview({
  descriptor,
  source,
  externalOpen,
}: SafePreviewProps) {
  return (
    <section aria-label={`${descriptor.name} preview`}>
      <p>
        {descriptor.kind === "html" || descriptor.mediaType === "image/svg+xml"
          ? "Active preview is disabled for this file."
          : "This file has no safe in-app preview."}
      </p>
      {source === undefined ? null : <pre>{source}</pre>}
      {externalOpen === undefined ? null : (
        <button type="button" onClick={externalOpen}>
          Open in default application
        </button>
      )}
    </section>
  );
}
