import { describe, expect, test } from "bun:test"
import { windowsPath } from "./shell-env"

describe("windowsPath", () => {
  const env = {
    USERPROFILE: String.raw`C:\Users\me`,
    APPDATA: String.raw`C:\Users\me\AppData\Roaming`,
    LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
    SystemRoot: String.raw`C:\WINDOWS`,
  }

  test("adds registry entries and CLI folders a sign-in-time PATH is missing", () => {
    const result = windowsPath(
      String.raw`C:\WINDOWS\system32;C:\Users\me\AppData\Roaming\npm` + "\\",
      [String.raw`%USERPROFILE%\.cargo\bin;C:\Users\me\AppData\Roaming\npm`, String.raw`%SystemRoot%\system32`],
      env,
    ).split(";")
    expect(result.slice(0, 2)).toEqual([
      String.raw`C:\WINDOWS\system32`,
      String.raw`C:\Users\me\AppData\Roaming\npm` + "\\",
    ])
    expect(result).toContain(String.raw`C:\Users\me\.cargo\bin`)
    expect(result).toContain(String.raw`C:\Users\me\AppData\Local\Microsoft\WinGet\Links`)
    expect(result).toContain(String.raw`C:\Users\me\scoop\shims`)
    // Entries already present, in any case or with a trailing slash, are not repeated.
    expect(
      result.filter((entry) => entry.toLowerCase().startsWith(String.raw`c:\users\me\appdata\roaming\npm`)),
    ).toHaveLength(1)
    expect(result.filter((entry) => entry.toLowerCase() === String.raw`c:\windows\system32`)).toHaveLength(1)
  })

  test("drops entries whose variables are unknown", () => {
    expect(windowsPath("", [String.raw`%NOPE%\bin`], {})).toBe("")
  })
})
