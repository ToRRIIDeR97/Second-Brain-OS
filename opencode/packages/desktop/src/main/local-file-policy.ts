import path from "node:path"

// Opened by the shell, these run code rather than show a document.
const windowsLaunchers = [".lnk", ".hta", ".msi", ".msp", ".scr", ".url", ".appref-ms", ".reg"]
const windowsDefaultPathext = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PS1"
const macLaunchers = [".app", ".command", ".terminal", ".workflow", ".tool", ".pkg", ".mpkg", ".scpt"]

/**
 * Whether a local file link may be opened with its default app or should only be revealed in the
 * file manager. Executables are revealed: on Windows by PATHEXT plus shell launchers, on macOS
 * by bundle and script extensions, and on any POSIX system when an execute bit is set.
 */
export function localFileAction(
  file: string,
  info: { isDirectory: boolean; mode: number },
  platform: NodeJS.Platform = process.platform,
  pathext = process.env.PATHEXT,
): "open" | "reveal" {
  const extension = path.extname(file).toLowerCase()
  if (platform === "win32") {
    const executable = (pathext || windowsDefaultPathext)
      .split(";")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    return [...executable, ...windowsLaunchers].includes(extension) ? "reveal" : "open"
  }
  if (platform === "darwin" && macLaunchers.includes(extension)) return "reveal"
  if (info.isDirectory) return "open"
  return (info.mode & 0o111) !== 0 ? "reveal" : "open"
}
