import { MainLogger } from "electron-log"
import log from "electron-log/main.js"
import { app, crashReporter, shell } from "electron"
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { ZipWriter, Uint8ArrayReader } from "@zip.js/zip.js"
import { Writable } from "node:stream"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

const MAX_LOG_AGE_DAYS = 7
const TAIL_LINES = 1000
const EXPORT_WINDOW = 24 * 60 * 60 * 1000
const MAX_EXPORT_FILE_SIZE = 50 * 1024 * 1024

let root = ""
let run = ""

let logger: MainLogger
export const getLogger = () => logger

export function initLogging() {
  initRunDirectory()
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.resolvePathFn = (_vars, message) =>
    join(
      run,
      `${safeLogName(message?.scope ?? (message?.variables?.processType === "renderer" ? "renderer" : "main"))}.log`,
    )
  // Renderer console output can carry note or terminal text, so packaged
  // builds don't copy it into the log files.
  log.initialize({ preload: false, spyRendererConsole: !app.isPackaged })
  initConsoleTransport()
  cleanup()
  // Logs uncaught exceptions and unhandled rejections in the main process without a blocking dialog.
  log.errorHandler.startCatching({ showDialog: false })
  return (logger = log)
}

export function initCrashReporter() {
  const dir = join(app.getPath("userData"), "Crashpad")
  mkdirSync(dir, { recursive: true })
  app.setPath("crashDumps", dir)
  crashReporter.start({ uploadToServer: false, compress: true })
  write("crash", "crash reporter started", { path: dir })
}

// NetLog is not recorded: it captures full request URLs, including the server
// `auth_token` query parameter. Developers can still launch with Electron's
// `--log-net-log=<path>` switch. Leftover .netlog files are never exported.
export async function exportDebugLogs() {
  const output = join(app.getPath("downloads"), `opencode-debug-${stamp()}.zip`)
  write("main", "exporting debug logs", { output })
  await writeZip(output, [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest(), null, 2)) },
    ...collect(root, "desktop"),
    ...serverLogRoots().flatMap((dir, i) => collect(dir, `server-${i + 1}`)),
    // Minidumps hold process memory (secrets, note text), so only their names, sizes and times go in.
    { name: "crashpad.json", data: Buffer.from(JSON.stringify(crashDumpIndex(app.getPath("crashDumps")), null, 2)) },
  ])
  shell.showItemInFolder(output)
  return output
}

export function write(
  name: string,
  message: string,
  extra?: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
) {
  if (!run) return
  const scoped = log.scope(safeLogName(name))
  if (extra !== undefined) {
    scoped[level](message, extra)
    return
  }
  scoped[level](message)
}

export function tail(): string {
  try {
    const path = log.transports.file.getFile().path
    const contents = readFileSync(path, "utf8")
    const lines = contents.split("\n")
    return lines.slice(Math.max(0, lines.length - TAIL_LINES)).join("\n")
  } catch {
    return ""
  }
}

function initRunDirectory() {
  root = join(app.getPath("userData"), "logs")
  run = join(root, stamp())
  mkdirSync(run, { recursive: true })
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
}

function safeLogName(name: string) {
  return name.replace(/[^a-z0-9_.-]/gi, "_") || "main"
}

function cleanup() {
  const dir = root || dirname(log.transports.file.getFile().path)
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000

  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry)
    try {
      const info = statSync(file)
      if (info.mtimeMs < cutoff) rmSync(file, { recursive: true, force: true })
    } catch {
      continue
    }
  }
}

function manifest() {
  return {
    generated: new Date().toISOString(),
    version: app.getVersion(),
    name: app.getName(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    uptime: process.uptime(),
    userData: app.getPath("userData"),
    logs: root,
    currentRun: run,
    crashDumps: app.getPath("crashDumps"),
    serverLogs: serverLogRoots(),
  }
}

function serverLogRoots() {
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return [...new Set([join(xdgData, "tenon-workbench", "log"), join(app.getPath("userData"), "tenon-workbench", "log")])]
}

type Entry = { name: string; path?: string; data?: Buffer }

function collect(dir: string, prefix: string): Entry[] {
  if (!existsSync(dir)) return []
  const cutoff = Date.now() - EXPORT_WINDOW
  const result: Entry[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const file = join(current, entry)
      // A log can rotate away between the listing and the stat.
      const info = statSync(file, { throwIfNoEntry: false })
      if (!info) continue
      if (info.isDirectory()) {
        walk(file)
        continue
      }
      if (info.mtimeMs < cutoff) continue
      if (info.size > MAX_EXPORT_FILE_SIZE) continue
      if (file.endsWith(".heapsnapshot") || file.endsWith(".netlog")) continue
      result.push({ name: join(prefix, file.slice(dir.length + 1)).replace(/\\/g, "/"), path: file })
    }
  }
  walk(dir)
  return result
}

function crashDumpIndex(dir: string) {
  return collect(dir, "crashpad").map((entry) => {
    const info = statSync(entry.path!, { throwIfNoEntry: false })
    return { name: entry.name, size: info?.size ?? 0, modified: info ? new Date(info.mtimeMs).toISOString() : null }
  })
}

// Streams to disk, so the archive is never held in memory; a file removed since it was listed is skipped.
async function writeZip(output: string, entries: Entry[]) {
  const writer = new ZipWriter(Writable.toWeb(createWriteStream(output)) as WritableStream)
  for (const entry of entries) {
    let data: Buffer
    try {
      data = entry.data ?? readFileSync(entry.path!)
    } catch {
      continue
    }
    await writer.add(entry.name, new Uint8ArrayReader(new Uint8Array(data)))
  }
  await writer.close()
}

function initConsoleTransport() {
  if (app.isPackaged) {
    log.transports.console.level = false
    return
  }

  const write = log.transports.console.writeFn.bind(log.transports.console)
  log.transports.console.writeFn = (options) => {
    try {
      write(options)
    } catch (err) {
      if (!isBrokenPipe(err)) throw err
      log.transports.console.level = false
    }
  }
}

function isBrokenPipe(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "EPIPE"
}
