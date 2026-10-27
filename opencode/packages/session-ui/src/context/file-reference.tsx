import { createContext, useContext, type Accessor } from "solid-js"
import type { FileReference } from "../components/markdown-file-reference"

export type { FileReference }

/**
 * Lines of a cited file for the hover peek. `start` is the 1-based number of `lines[0]`. A folder
 * reports how many entries it lists instead.
 */
export type FileReferencePreview =
  | { status: "found"; path: string; start: number; lines: string[] }
  | { status: "folder"; path: string; count: number }
  | { status: "binary"; path: string }
  | { status: "missing"; path: string }

/**
 * App-supplied actions for file references in assistant replies. `directory` is the thread's
 * folder; references are validated against it before either callback sees them, so `path` is
 * always relative and free of `..` segments.
 */
export type FileReferenceActions = {
  directory: string
  /** Reads at most `limit` lines from the start of the reference (or of the file). */
  readFileRange: (reference: FileReference, limit: number) => Promise<FileReferencePreview>
  /** Reveals the reference in the right panel's Files view: a file in its viewer, a folder in the tree. */
  onFileReference: (reference: FileReference) => void
}

const FileReferenceContext = createContext<Accessor<FileReferenceActions | undefined>>()

/** Optional: without a provider, or while the accessor returns undefined, references stay plain code. */
export const FileReferenceProvider = FileReferenceContext.Provider

/** Returns an accessor so callers track the app turning references on or off (e.g. narrow layouts). */
export function useFileReferences(): Accessor<FileReferenceActions | undefined> {
  const actions = useContext(FileReferenceContext)
  return () => actions?.()
}
