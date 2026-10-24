import { expect, test } from "bun:test"
import { localFileAction } from "./local-file-policy"

const file = { isDirectory: false, mode: 0o644 }

test("reveals Windows executables and shell launchers instead of opening them", () => {
  for (const name of [
    "C:\\x\\setup.EXE",
    "C:\\x\\run.bat",
    "C:\\x\\a.lnk",
    "C:\\x\\a.hta",
    "C:\\x\\a.msi",
    "C:\\x\\a.scr",
  ])
    expect(localFileAction(name, file, "win32", ".COM;.EXE;.BAT;.CMD")).toBe("reveal")
  // Without PATHEXT the Windows defaults apply.
  expect(localFileAction("C:\\x\\script.ps1", file, "win32", undefined)).toBe("reveal")
  expect(localFileAction("C:\\x\\notes.md", file, "win32", ".EXE")).toBe("open")
})

test("reveals macOS bundles and scripts", () => {
  for (const name of ["/Applications/X.app", "/tmp/run.command", "/tmp/a.terminal", "/tmp/a.workflow"])
    expect(localFileAction(name, { isDirectory: name.endsWith(".app"), mode: 0o755 }, "darwin")).toBe("reveal")
  expect(localFileAction("/tmp/report.pdf", file, "darwin")).toBe("open")
})

test("reveals any POSIX file with an execute bit", () => {
  expect(localFileAction("/tmp/tool", { isDirectory: false, mode: 0o755 }, "linux")).toBe("reveal")
  expect(localFileAction("/tmp/tool", { isDirectory: false, mode: 0o700 }, "linux")).toBe("reveal")
  expect(localFileAction("/tmp/readme.txt", file, "linux")).toBe("open")
  expect(localFileAction("/tmp/folder", { isDirectory: true, mode: 0o755 }, "linux")).toBe("open")
})
