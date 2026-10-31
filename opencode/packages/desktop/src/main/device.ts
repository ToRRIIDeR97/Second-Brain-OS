import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

// Phones for the Workbench panel's Device tab and for agents. Android runs on macOS and Windows through
// the Android SDK (adb for screens and input, the emulator for virtual devices). The iOS Simulator only
// exists on macOS (Xcode's simctl); taps there need Meta's idb. Everything here shells out to those
// tools with fixed argument lists; nothing from a caller reaches a shell.
export type DevicePlatform = "android" | "ios"
export type Device = { platform: DevicePlatform; id: string; name: string; state: string }
export type DeviceStatus = {
  android: { sdk: boolean; devices: Device[]; avds: string[] }
  ios: { supported: boolean; devices: Device[]; input: boolean }
}

const exe = process.platform === "win32" ? ".exe" : ""

function sdkRoot() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk") : undefined,
    process.platform === "darwin" ? join(homedir(), "Library", "Android", "sdk") : join(homedir(), "Android", "Sdk"),
  ]
  return candidates.find((dir) => dir && existsSync(join(dir, "platform-tools", `adb${exe}`)))
}

const adbPath = () => {
  const root = sdkRoot()
  return root ? join(root, "platform-tools", `adb${exe}`) : undefined
}
const emulatorPath = () => {
  const root = sdkRoot()
  const file = root ? join(root, "emulator", `emulator${exe}`) : undefined
  return file && existsSync(file) ? file : undefined
}

function run(file: string, args: string[], options: { timeout?: number; binary?: boolean } = {}) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: options.timeout ?? 15_000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer", windowsHide: true },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr.toString().trim() || error.message)) : resolve(stdout),
    )
  })
}

const which = (name: string) =>
  run(process.platform === "win32" ? "where" : "which", [name], { timeout: 3_000 }).then(
    (out) => out.toString().split(/\r?\n/)[0]?.trim() || undefined,
    () => undefined,
  )

export async function deviceStatus(): Promise<DeviceStatus> {
  const adb = adbPath()
  const emulator = emulatorPath()
  const [android, avds, ios, idb] = await Promise.all([
    adb ? run(adb, ["devices", "-l"]).then(parseAdbDevices, () => []) : Promise.resolve([]),
    emulator
      ? run(emulator, ["-list-avds"]).then(
          (out) =>
            out
              .toString()
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          () => [],
        )
      : Promise.resolve([]),
    process.platform === "darwin"
      ? run("xcrun", ["simctl", "list", "devices", "-j"]).then(parseSimctl, () => [])
      : Promise.resolve([]),
    process.platform === "darwin" ? which("idb") : Promise.resolve(undefined),
  ])
  return {
    android: { sdk: !!adb, devices: android, avds },
    ios: { supported: process.platform === "darwin", devices: ios, input: !!idb },
  }
}

export function parseAdbDevices(out: Buffer | string): Device[] {
  return out
    .toString()
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const [id, state, ...rest] = line.trim().split(/\s+/)
      if (!id || !state) return []
      const model = rest
        .find((part) => part.startsWith("model:"))
        ?.slice(6)
        .replaceAll("_", " ")
      return [{ platform: "android" as const, id, state, name: model ?? id }]
    })
}

export function parseSimctl(out: Buffer | string): Device[] {
  const value = JSON.parse(out.toString()) as {
    devices?: Record<string, Array<{ udid: string; name: string; state: string; isAvailable?: boolean }>>
  }
  return Object.entries(value.devices ?? {})
    .filter(([runtime]) => runtime.includes("iOS"))
    .flatMap(([, devices]) => devices)
    .filter((device) => device.isAvailable !== false)
    .map((device) => ({ platform: "ios" as const, id: device.udid, name: device.name, state: device.state }))
}

/** Starts an Android virtual device by name, or boots an iOS simulator by UDID. */
export async function bootDevice(platform: DevicePlatform, id: string) {
  if (platform === "android") {
    const emulator = emulatorPath()
    if (!emulator) throw new Error("The Android emulator isn't installed. Add it with the Android SDK Manager.")
    if (!/^[\w.-]+$/.test(id)) throw new Error("That isn't an Android virtual device name.")
    spawn(emulator, ["-avd", id], { detached: true, stdio: "ignore", windowsHide: true }).unref()
    return
  }
  requireMac()
  await run("xcrun", ["simctl", "boot", id]).catch((error: Error) => {
    if (!/current state: Booted/i.test(error.message)) throw error
  })
}

/** The device's screen as a PNG. */
export async function deviceScreenshot(platform: DevicePlatform, id: string) {
  if (platform === "android") return run(requireAdb(), ["-s", id, "exec-out", "screencap", "-p"], { timeout: 10_000 })
  requireMac()
  const file = join(tmpdir(), `tenon-sim-${Date.now()}.png`)
  await run("xcrun", ["simctl", "io", id, "screenshot", file])
  const png = await readFile(file)
  await rm(file, { force: true })
  return png
}

export type DeviceInput =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x: number; y: number; toX: number; toY: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: "home" | "back" | "enter" }

/** Sends one touch or key to the device. Coordinates are screen pixels. */
export async function deviceInput(platform: DevicePlatform, id: string, input: DeviceInput) {
  const n = (value: number) => String(Math.max(0, Math.round(value)))
  if (platform === "android") {
    const adb = requireAdb()
    if (input.kind === "tap") return run(adb, ["-s", id, "shell", "input", "tap", n(input.x), n(input.y)])
    if (input.kind === "swipe")
      return run(adb, ["-s", id, "shell", "input", "swipe", n(input.x), n(input.y), n(input.toX), n(input.toY), "300"])
    if (input.kind === "text") return run(adb, ["-s", id, "shell", "input", "text", androidText(input.text)])
    const code = { home: "KEYCODE_HOME", back: "KEYCODE_BACK", enter: "KEYCODE_ENTER" }[input.key]
    return run(adb, ["-s", id, "shell", "input", "keyevent", code])
  }
  requireMac()
  const idb = await which("idb")
  if (!idb) throw new Error("Taps on the iOS Simulator need idb (brew install idb-companion, pipx install fb-idb).")
  if (input.kind === "tap") return run(idb, ["ui", "tap", "--udid", id, n(input.x), n(input.y)])
  if (input.kind === "swipe")
    return run(idb, ["ui", "swipe", "--udid", id, n(input.x), n(input.y), n(input.toX), n(input.toY)])
  if (input.kind === "text") return run(idb, ["ui", "text", "--udid", id, input.text])
  const button = { home: "HOME", back: "HOME", enter: "HOME" }[input.key]
  return run(idb, ["ui", "button", "--udid", id, button])
}

// adb's `input text` treats spaces and shell metacharacters specially; %s is its space.
export function androidText(text: string) {
  return text.replace(/[^\w.@:/-]/g, (char) => (char === " " ? "%s" : `\\${char}`))
}

export async function installApp(platform: DevicePlatform, id: string, file: string) {
  if (platform === "android") return run(requireAdb(), ["-s", id, "install", "-r", file], { timeout: 180_000 })
  requireMac()
  return run("xcrun", ["simctl", "install", id, file], { timeout: 180_000 })
}

export async function launchApp(platform: DevicePlatform, id: string, app: string) {
  if (!/^[\w.]+$/.test(app)) throw new Error("App IDs look like com.example.app.")
  if (platform === "android")
    return run(requireAdb(), ["-s", id, "shell", "monkey", "-p", app, "-c", "android.intent.category.LAUNCHER", "1"])
  requireMac()
  return run("xcrun", ["simctl", "launch", id, app])
}

/** The device's recent log lines. */
export async function deviceLogs(platform: DevicePlatform, id: string, lines = 200) {
  if (platform === "android")
    return (await run(requireAdb(), ["-s", id, "logcat", "-d", "-t", String(lines)])).toString()
  requireMac()
  return (
    await run("xcrun", ["simctl", "spawn", id, "log", "show", "--last", "2m", "--style", "compact"], {
      timeout: 30_000,
    })
  )
    .toString()
    .split("\n")
    .slice(-lines)
    .join("\n")
}

function requireAdb() {
  const adb = adbPath()
  if (!adb) throw new Error("Android tools weren't found. Install the Android SDK platform-tools, or set ANDROID_HOME.")
  return adb
}

function requireMac() {
  if (process.platform !== "darwin") throw new Error("The iOS Simulator only runs on macOS.")
}
