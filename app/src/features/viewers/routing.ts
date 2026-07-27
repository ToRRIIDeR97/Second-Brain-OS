import {
  DEFAULT_LARGE_FILE_SETTINGS,
  type FileDescriptor,
  type FileKind,
  type FileRenderer,
  type FileRoute,
  type LargeFileSettings,
  type RendererSession,
  type RouteReason,
  type ViewerLimits,
  type ViewerMode,
} from "./types";

function session(id: string, mode: ViewerMode): RendererSession {
  return { rendererId: id, mode };
}

function renderer(
  id: string,
  kinds: readonly FileKind[],
  mode: ViewerMode,
  limits: ViewerLimits,
  openMode: ViewerMode = mode,
): FileRenderer {
  return {
    id,
    mode,
    limits,
    canHandle: (file) => kinds.includes(file.kind),
    open: () => session(id, openMode),
  };
}

export function createDefaultViewers(
  settings: LargeFileSettings = DEFAULT_LARGE_FILE_SETTINGS,
): FileRenderer[] {
  return [
    renderer("markdown", ["markdown"], "both", {
      maxBytes: settings.richEditorMaxBytes,
      supportsStreaming: false,
    }),
    renderer("monaco-text", ["text", "code"], "both", {
      maxBytes: settings.textPreviewMaxBytes,
      supportsStreaming: true,
    }),
    renderer("image", ["image"], "preview", {
      maxPixels: settings.imageMaxPixels,
      supportsStreaming: false,
    }),
    renderer("pdf", ["pdf"], "preview", {
      maxPages: settings.pdfMaxPages,
      supportsStreaming: true,
    }),
    renderer("csv", ["csv"], "preview", {
      maxRows: settings.csvMaxRows,
      maxColumns: settings.csvMaxColumns,
      supportsStreaming: true,
    }),
    renderer("json-tree", ["json"], "both", {
      maxBytes: settings.textPreviewMaxBytes,
      supportsStreaming: false,
    }),
    renderer("yaml-tree", ["yaml"], "both", {
      maxBytes: settings.textPreviewMaxBytes,
      supportsStreaming: false,
    }),
    renderer("safe-html-source", ["html"], "preview", {
      maxBytes: settings.textPreviewMaxBytes,
      supportsStreaming: true,
    }),
    renderer("binary-metadata", ["binary", "audio", "video"], "preview", {
      supportsStreaming: false,
    }),
    renderer("unsupported-external", ["unsupported"], "preview", {
      supportsStreaming: false,
    }),
  ];
}

function isRichEditorLimited(
  file: FileDescriptor,
  settings: LargeFileSettings,
): boolean {
  return (
    file.kind === "markdown" && file.sizeBytes > settings.richEditorMaxBytes
  );
}

function isTextLimited(
  file: FileDescriptor,
  settings: LargeFileSettings,
): boolean {
  return (
    (file.kind === "text" ||
      file.kind === "code" ||
      file.kind === "json" ||
      file.kind === "yaml") &&
    file.sizeBytes > settings.textPreviewMaxBytes
  );
}

function contextCost(
  file: FileDescriptor,
  settings: LargeFileSettings,
): number {
  if (file.sizeBytes <= 0) return 0;
  return Math.ceil(Math.min(file.sizeBytes, settings.textPreviewMaxBytes) / 4);
}

export function routeFile(
  file: FileDescriptor,
  viewers: readonly FileRenderer[] = createDefaultViewers(),
  settings: LargeFileSettings = DEFAULT_LARGE_FILE_SETTINGS,
): FileRoute {
  const selected =
    viewers.find((candidate) => candidate.canHandle(file)) ??
    viewers[viewers.length - 1];
  if (selected === undefined)
    throw new Error("Viewer registry must contain an unsupported fallback");
  const largeFile =
    isRichEditorLimited(file, settings) || isTextLimited(file, settings);
  const unsafeContent =
    file.kind === "html" ||
    (file.kind === "image" && file.mediaType === "image/svg+xml");
  const reason: RouteReason = unsafeContent
    ? "unsafe-content"
    : largeFile
      ? "large-file"
      : file.kind === "unsupported"
        ? "unsupported"
        : "supported";
  return {
    renderer: selected,
    reason,
    largeFile,
    estimatedContextCost: contextCost(file, settings),
  };
}

export function isValidWorkspaceRelativePath(relativePath: string): boolean {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  )
    return false;
  const segments = relativePath.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function createWorkspaceAssetUrl(
  workspaceId: string,
  relativePath: string,
): string | undefined {
  if (!workspaceId || !isValidWorkspaceRelativePath(relativePath))
    return undefined;
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `asset://workspace/${encodeURIComponent(workspaceId)}/${encodedPath}`;
}
