// Mirrors @opencode-ai/core/session/thread-reference: the server replaces an attachment with this URI
// by the referenced thread's text when the prompt is admitted.
export const THREAD_REFERENCE_MIME = "application/x-tenon-thread"

export const threadReferenceURI = (sessionID: string, full = false) =>
  `tenon-thread://${encodeURIComponent(sessionID)}${full ? "?full=1" : ""}`

/** The drag payload a thread row carries; the composer turns it into a reference. */
export const THREAD_DRAG_PREFIX = "thread:"
