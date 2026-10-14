import { describe, expect, test } from "bun:test"
import { reviewTooltipKeybind } from "./command-tooltip-keybind"

describe("command tooltip keybinds", () => {
  test("keeps localized review shortcut modifiers", () => {
    const command = {
      keybind: () => "Ctrl+Maj+R",
      keybindParts: () => ["Ctrl", "Maj", "R"],
    }

    expect(reviewTooltipKeybind(command, (key) => key)).toEqual(["Ctrl", "Maj", "R"])
  })
})
