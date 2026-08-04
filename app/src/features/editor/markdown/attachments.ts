import type { ImageMediaType } from "../../../lib/ipc/types";
import { validateAttachmentPath } from "./knowledge";

/** Keep image reads/writes bounded before they cross the IPC boundary. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MEDIA_TYPE_EXTENSIONS: Record<ImageMediaType, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type SupportedImageMediaType = ImageMediaType;

const EXTENSION_MEDIA_TYPES: Record<string, SupportedImageMediaType> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type ImageAttachmentPlacement = {
  workspaceRelativePath: string;
  markdownPath: string;
  mediaType: SupportedImageMediaType;
};

function safeRelativePath(path: string): string | undefined {
  for (const character of path) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return undefined;
  }
  return validateAttachmentPath(path);
}

function noteDirectory(notePath: string): string | undefined {
  const safeNotePath = safeRelativePath(notePath.trim());
  if (!safeNotePath) return undefined;
  const separator = safeNotePath.lastIndexOf("/");
  return separator < 0 ? "" : safeNotePath.slice(0, separator);
}

function uniqueSuffix(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function safeFileStem(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).at(-1) ?? "";
  const stem = leaf.replace(/\.[^.]*$/, "");
  return (
    stem
      .normalize("NFKC")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "image"
  );
}

export function supportedImageMediaType(
  fileName: string,
  declaredType: string,
): SupportedImageMediaType | undefined {
  const type = declaredType.trim().toLowerCase();
  if (type in MEDIA_TYPE_EXTENSIONS) return type as SupportedImageMediaType;
  if (type) return undefined;
  const extension = fileName
    .split(/[\\/.]/)
    .at(-1)
    ?.toLowerCase();
  return extension ? EXTENSION_MEDIA_TYPES[extension] : undefined;
}

export function createImageAttachmentPlacement(
  notePath: string,
  fileName: string,
  declaredType: string,
  suffix = uniqueSuffix(),
): ImageAttachmentPlacement | undefined {
  const mediaType = supportedImageMediaType(fileName, declaredType);
  const directory = noteDirectory(notePath);
  if (!mediaType || directory === undefined) return undefined;
  const safeSuffix = suffix
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!safeSuffix) return undefined;
  const filename = `${safeFileStem(fileName)}-${safeSuffix}.${MEDIA_TYPE_EXTENSIONS[mediaType]}`;
  const relativeDirectory = directory ? `${directory}/` : "";
  return {
    workspaceRelativePath: `${relativeDirectory}assets/${filename}`,
    markdownPath: `assets/${filename}`,
    mediaType,
  };
}

export function resolveImageAttachmentPath(
  notePath: string,
  source: string,
): string | undefined {
  const candidate = source.trim();
  if (
    !candidate ||
    /[?#]/.test(candidate) ||
    /^[a-z][a-z\d+.-]*:/i.test(candidate) ||
    candidate.startsWith("/") ||
    candidate.startsWith("\\")
  )
    return undefined;
  const directory = noteDirectory(notePath);
  const safeSource = safeRelativePath(candidate);
  if (directory === undefined || !safeSource || /[?#]/.test(safeSource))
    return undefined;
  return directory ? `${directory}/${safeSource}` : safeSource;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa !== "function")
    throw new Error("The browser base64 encoder is unavailable.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)),
    );
  return globalThis.btoa(binary);
}

function validBase64(base64: string): boolean {
  return (
    base64.length > 0 &&
    base64.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  );
}

export function imageDataUrl(
  base64: string,
  mediaType: string,
  sizeBytes: number,
): string | undefined {
  const normalizedType = mediaType.trim().toLowerCase();
  if (
    !(normalizedType in MEDIA_TYPE_EXTENSIONS) ||
    !validBase64(base64) ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_IMAGE_BYTES
  )
    return undefined;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const decodedSize = (base64.length * 3) / 4 - padding;
  if (decodedSize !== sizeBytes) return undefined;
  return `data:${normalizedType};base64,${base64}`;
}
