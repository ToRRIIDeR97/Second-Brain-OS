import { describe, expect, test } from "bun:test"
import {
  activeCommandRegistrations,
  addCommandRegistration,
  commandPaletteOptions,
  outsideEditable,
  resolveKeybindOption,
  type CommandOption,
} from "./command"

const paletteOptions: CommandOption[] = [
  { id: "settings.open", title: "Open settings" },
  { id: "session.undo", title: "Undo" },
  { id: "file.open", title: "Open file" },
  { id: "hidden", title: "Hidden", hidden: true },
  { id: "disabled", title: "Disabled", disabled: true },
]

describe("commandPaletteOptions", () => {
  test("keeps visible enabled commands", () => {
    expect(commandPaletteOptions(paletteOptions).map((option) => option.id)).toEqual(["settings.open", "session.undo"])
  })
})

describe("command registrations", () => {
  test("shadows keyed registrations while retaining the previous owner", () => {
    const one = () => [{ id: "one", title: "One" }]
    const two = () => [{ id: "two", title: "Two" }]

    const registrations = addCommandRegistration([{ key: "layout", options: one }], {
      key: "layout",
      options: two,
    })
    const active = activeCommandRegistrations(registrations)

    expect(registrations).toHaveLength(2)
    expect(active).toHaveLength(1)
    expect(active[0]?.options).toBe(two)

    const restored = activeCommandRegistrations(registrations.filter((entry) => entry.options !== two))
    expect(restored).toHaveLength(1)
    expect(restored[0]?.options).toBe(one)
  })

  test("keeps unkeyed registrations additive", () => {
    const one = () => [{ id: "one", title: "One" }]
    const two = () => [{ id: "two", title: "Two" }]

    const next = activeCommandRegistrations(addCommandRegistration([{ options: one }], { options: two }))

    expect(next).toHaveLength(2)
    expect(next[0]?.options).toBe(two)
    expect(next[1]?.options).toBe(one)
  })
})

describe("resolveKeybindOption", () => {
  test("prefers a matching contextual command over the global fallback", () => {
    const fallback = { id: "tab.close", title: "Close tab" }
    const contextual = { id: "terminal.close", title: "Close terminal", when: () => true }

    expect(resolveKeybindOption([fallback, contextual], new KeyboardEvent("keydown"))).toBe(contextual)
  })

  test("uses the global fallback outside the command context", () => {
    const fallback = { id: "tab.close", title: "Close tab" }
    const contextual = { id: "terminal.close", title: "Close terminal", when: () => false }

    expect(resolveKeybindOption([fallback, contextual], new KeyboardEvent("keydown"))).toBe(fallback)
  })
})

describe("outsideEditable guard", () => {
  const undo: CommandOption = { id: "undo.latest", title: "Undo", keybind: "mod+z", when: outsideEditable }
  const press = (target: EventTarget) => ({ target }) as unknown as KeyboardEvent

  test("leaves mod+z to text fields and editors", () => {
    const editor = document.createElement("div")
    editor.setAttribute("contenteditable", "")
    const line = document.createElement("span")
    editor.append(line)
    for (const target of [document.createElement("input"), document.createElement("textarea"), line])
      expect(resolveKeybindOption([undo], press(target))).toBeUndefined()
  })

  test("runs the shortcut elsewhere", () => {
    const readonly = document.createElement("div")
    readonly.setAttribute("contenteditable", "false")
    for (const target of [document.createElement("button"), readonly, document.body])
      expect(resolveKeybindOption([undo], press(target))).toBe(undo)
  })
})
