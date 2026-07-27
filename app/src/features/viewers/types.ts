export type FileKind =
  | "markdown"
  | "text"
  | "code"
  | "image"
  | "pdf"
  | "csv"
  | "json"
  | "yaml"
  | "audio"
  | "video"
  | "html"
  | "binary"
  | "unsupported";

export type ViewerMode = "edit" | "preview" | "both";

export interface FileDescriptor {
  workspaceId: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  kind: FileKind;
  mediaType?: string;
  encoding?: string;
  sniffed: boolean;
  isText: boolean;
  dimensions?: { width: number; height: number };
}

export interface LargeFileSettings {
  richEditorMaxBytes: number;
  tokenizationMaxBytes: number;
  textPreviewMaxBytes: number;
  previewChunkBytes: number;
  csvMaxRows: number;
  csvMaxColumns: number;
  imageMaxPixels: number;
  pdfMaxPages: number;
}

export const DEFAULT_LARGE_FILE_SETTINGS: Readonly<LargeFileSettings> = {
  richEditorMaxBytes: 1_000_000,
  tokenizationMaxBytes: 2_000_000,
  textPreviewMaxBytes: 4_000_000,
  previewChunkBytes: 64_000,
  csvMaxRows: 10_000,
  csvMaxColumns: 200,
  imageMaxPixels: 25_000_000,
  pdfMaxPages: 100,
};

export interface ViewerLimits {
  maxBytes?: number;
  maxRows?: number;
  maxColumns?: number;
  maxPixels?: number;
  maxPages?: number;
  supportsStreaming: boolean;
}

export interface OpenFileInput {
  descriptor: FileDescriptor;
  openAt?: { line: number; column?: number };
  readChunk?: (offset: number, length: number) => Promise<Uint8Array>;
}

export interface RendererSession {
  readonly rendererId: string;
  readonly mode: ViewerMode;
  close?: () => void;
}

export interface FileRenderer {
  readonly id: string;
  readonly mode: ViewerMode;
  readonly limits: ViewerLimits;
  canHandle(file: FileDescriptor): boolean;
  open(input: OpenFileInput): RendererSession;
}

export type RouteReason =
  | "supported"
  | "large-file"
  | "unsafe-content"
  | "unsupported";

export interface FileRoute {
  renderer: FileRenderer;
  reason: RouteReason;
  largeFile: boolean;
  estimatedContextCost: number;
}
