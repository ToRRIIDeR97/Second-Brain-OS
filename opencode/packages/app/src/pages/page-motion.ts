import { NEW_THREAD_PATH } from "@/context/drafts"

/** The shell section a pathname belongs to. Draft and session routes share one section: the thread view. */
export function routeSection(pathname: string) {
  if (pathname === NEW_THREAD_PATH || pathname.startsWith("/server/")) return "thread"
  return pathname
}

export type PageMotionKey = { section: string; count: number }

/**
 * Key for the page fade-through in the shell's `<main>`. It changes when the user moves between sections,
 * except into the thread view: its composer focuses itself right after mounting, which a fade-out would
 * hold off the page, so that swap is immediate. Query-string changes within a page do not fade.
 */
export function nextPageMotionKey(previous: PageMotionKey, pathname: string): PageMotionKey {
  const section = routeSection(pathname)
  if (section === previous.section) return previous
  return { section, count: section === "thread" ? previous.count : previous.count + 1 }
}
