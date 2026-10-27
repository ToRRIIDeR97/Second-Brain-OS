import { describe, expect, test } from "bun:test"
import {
  clampSidePanelWidth,
  reviewDiffStyle,
  SESSION_PANEL_WIDTH_MIN,
  SIDE_PANEL_COLLAPSE_THRESHOLD,
  SIDE_PANEL_WIDTH_MIN,
  SIDE_PANEL_WIDTH_SPLIT,
  sidePanelWidthMax,
} from "./session-panel-width"

describe("sidePanelWidthMax", () => {
  test("leaves the chat panel its minimum", () => {
    expect(sidePanelWidthMax(1700)).toBe(1700 - SESSION_PANEL_WIDTH_MIN)
  })

  test("never drops below the side panel minimum on small windows", () => {
    expect(sidePanelWidthMax(600)).toBe(SIDE_PANEL_WIDTH_MIN)
    expect(sidePanelWidthMax(0)).toBe(SIDE_PANEL_WIDTH_MIN)
  })
})

describe("clampSidePanelWidth", () => {
  test("keeps widths already within the limit", () => {
    expect(clampSidePanelWidth({ width: 420, available: 1700 })).toBe(420)
  })

  test("does not grow with the window", () => {
    // Regression: the panel used to take everything the chat panel left over.
    expect(clampSidePanelWidth({ width: 420, available: 3440 })).toBe(420)
  })

  test("forces the width down when the window shrinks", () => {
    expect(clampSidePanelWidth({ width: 1600, available: 1700 })).toBe(1700 - SESSION_PANEL_WIDTH_MIN)
  })

  test("raises widths below the minimum", () => {
    expect(clampSidePanelWidth({ width: 100, available: 1700 })).toBe(SIDE_PANEL_WIDTH_MIN)
  })

  test("skips the upper bound before the layout is measured", () => {
    expect(clampSidePanelWidth({ width: 1600, available: undefined })).toBe(1600)
  })

  test("collapses below the minimum, not at it", () => {
    expect(SIDE_PANEL_COLLAPSE_THRESHOLD).toBeLessThan(SIDE_PANEL_WIDTH_MIN)
  })
})

describe("reviewDiffStyle", () => {
  test("renders split only when the panel is wide enough", () => {
    expect(reviewDiffStyle({ preferred: "split", width: SIDE_PANEL_WIDTH_SPLIT })).toBe("split")
    expect(reviewDiffStyle({ preferred: "split", width: SIDE_PANEL_WIDTH_SPLIT - 1 })).toBe("unified")
    expect(reviewDiffStyle({ preferred: "unified", width: 2000 })).toBe("unified")
  })
})
