/**
 * File name for a new note: letters and digits from any script, lowercased, with runs of anything
 * else collapsed to one dash. A title with no letters or digits (e.g. only emoji) gets a
 * time-based name; the typed title is still stored as the note's title.
 */
export function noteSlug(title: string, now = Date.now()) {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  return slug || `note-${now.toString(36)}`
}
