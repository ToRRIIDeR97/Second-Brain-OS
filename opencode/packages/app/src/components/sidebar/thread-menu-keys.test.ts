import { describe, expect, test } from "bun:test"
import { THREAD_MENU_KEYS, threadMenuAction } from "./thread-menu-keys"

const press = (key: string, extra: Partial<KeyboardEvent> = {}) =>
  threadMenuAction({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, ...extra })

describe("thread menu keys", () => {
  test("runs each item from its single key, in either case", () => {
    expect(press("r")).toBe("rename")
    expect(press("P")).toBe("pin")
    expect(press("f")).toBe("fork")
    expect(press("a")).toBe("archive")
    expect(press("Delete")).toBe("delete")
    expect(press("Backspace")).toBe("delete")
  })

  test("ignores other keys, modified presses, repeats, and IME composition", () => {
    for (const key of ["x", "Enter", "Escape", " ", "ArrowDown"]) expect(press(key)).toBeUndefined()
    expect(press("r", { ctrlKey: true })).toBeUndefined()
    expect(press("a", { metaKey: true })).toBeUndefined()
    expect(press("Delete", { altKey: true })).toBeUndefined()
    expect(press("f", { repeat: true })).toBeUndefined()
    expect(press("p", { isComposing: true })).toBeUndefined()
  })

  test("each hint names the key that runs its item", () => {
    expect(press(THREAD_MENU_KEYS.rename)).toBe("rename")
    expect(press(THREAD_MENU_KEYS.pin)).toBe("pin")
    expect(press(THREAD_MENU_KEYS.fork)).toBe("fork")
    expect(press(THREAD_MENU_KEYS.archive)).toBe("archive")
    expect(press(THREAD_MENU_KEYS.delete)).toBe("delete")
  })
})
