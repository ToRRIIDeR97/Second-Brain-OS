import { describe, expect, test } from "bun:test"
import { HarnessUpdate } from "@opencode-ai/core/harness/update"

describe("harness CLI install source on Windows and macOS", () => {
  test("reads pnpm globals on both platforms", () => {
    expect(
      HarnessUpdate.sourceFromPath(
        String.raw`C:\Users\me\AppData\Local\pnpm\global\5\node_modules\@openai\codex\bin\codex.js`,
      ),
    ).toMatchObject({ method: "pnpm", packageName: "@openai/codex" })
    expect(
      HarnessUpdate.sourceFromPath("/Users/me/Library/pnpm/global/5/node_modules/opencode-ai/bin/opencode"),
    ).toMatchObject({ method: "pnpm", packageName: "opencode-ai" })
  })

  test("reads WinGet, Scoop and Chocolatey installs", () => {
    expect(
      HarnessUpdate.sourceFromPath(
        String.raw`C:\Users\me\AppData\Local\Microsoft\WinGet\Packages\SST.opencode_Microsoft.Winget.Source_8wekyb3d8bbwe\opencode.exe`,
      ),
    ).toEqual({ method: "winget", id: "SST.opencode" })
    expect(HarnessUpdate.sourceFromPath(String.raw`C:\Users\me\scoop\apps\gemini\0.33.2\gemini.exe`)).toEqual({
      method: "scoop",
      root: "C:/Users/me/scoop",
      name: "gemini",
      version: "0.33.2",
    })
    expect(HarnessUpdate.sourceFromPath(String.raw`C:\ProgramData\chocolatey\lib\gemini-cli\tools\gemini.exe`)).toEqual(
      { method: "choco", name: "gemini-cli" },
    )
  })

  test("reads pipx and uv tools", () => {
    expect(HarnessUpdate.sourceFromPath("/Users/me/.local/pipx/venvs/aider-chat/bin/aider")).toEqual({
      method: "pipx",
      name: "aider-chat",
    })
    expect(
      HarnessUpdate.sourceFromPath(String.raw`C:\Users\me\AppData\Roaming\uv\tools\aider-chat\Scripts\aider.exe`),
    ).toEqual({ method: "uv", name: "aider-chat" })
  })

  test("finds the package an npm shim launches", () => {
    const cmd = String.raw`@ECHO off
"%_prog%"  "%dp0%\node_modules\@google\gemini-cli\dist\index.js" %*`
    expect(
      HarnessUpdate.shimTarget(String.raw`C:\Users\me\AppData\Roaming\npm\gemini.cmd`, cmd)?.replaceAll("\\", "/"),
    ).toBe("C:/Users/me/AppData/Roaming/npm/node_modules/@google/gemini-cli/package.json")
    expect(HarnessUpdate.shimTarget(String.raw`C:\npm\x.cmd`, "echo hello")).toBeUndefined()
  })

  test("builds each installer's update command and marks Chocolatey as needing the user", () => {
    expect(HarnessUpdate.updateCommand({ method: "winget", id: "SST.opencode" }).display).toBe(
      "winget upgrade --id SST.opencode --exact --silent --accept-source-agreements --accept-package-agreements",
    )
    expect(HarnessUpdate.updateCommand({ method: "scoop", name: "gemini", root: "C:/scoop" }).display).toBe(
      "scoop update gemini",
    )
    expect(HarnessUpdate.updateCommand({ method: "choco", name: "gemini-cli" })).toMatchObject({ manual: true })
    expect(
      HarnessUpdate.updateCommand({
        method: "self",
        bin: String.raw`C:\Users\me\.local\bin\claude.exe`,
        args: ["update"],
      }).display,
    ).toBe("claude.exe update")
  })
})
