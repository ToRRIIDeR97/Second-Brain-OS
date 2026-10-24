// The side panel (Review, Session, files, terminal) owns its width and the chat
// panel takes everything else, so a large monitor widens the chat instead of the
// panel. Dragging the panel's edge below the collapse threshold hides it.
export const SESSION_PANEL_WIDTH_MIN = 450
export const SIDE_PANEL_WIDTH_MIN = 320
export const SIDE_PANEL_COLLAPSE_THRESHOLD = 240
// Split diffs need this much room; a narrower panel renders unified diffs.
export const SIDE_PANEL_WIDTH_SPLIT = 800

export function sidePanelWidthMax(available: number) {
  return Math.max(SIDE_PANEL_WIDTH_MIN, available - SESSION_PANEL_WIDTH_MIN)
}

// `available` is undefined until the layout row is first measured; skip the
// upper bound until then to avoid a first-frame snap.
export function clampSidePanelWidth(input: { width: number; available: number | undefined }) {
  const width = Math.max(SIDE_PANEL_WIDTH_MIN, input.width)
  if (input.available === undefined) return width
  return Math.min(width, sidePanelWidthMax(input.available))
}

export function reviewDiffStyle(input: { preferred: "unified" | "split"; width: number }) {
  return input.preferred === "split" && input.width >= SIDE_PANEL_WIDTH_SPLIT ? "split" : "unified"
}
