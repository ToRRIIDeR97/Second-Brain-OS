export * as HarnessBrowserTools from "./browser-tools"

// The Workbench panel's browser, offered to every harness through the `tenon` MCP server. The desktop
// main process owns the browser and listens on a loopback URL; it passes the URL and a bearer token to
// this server process in these variables. Without them (the web app, a remote server) the tools are absent.
export const URL_ENV = "TENON_BROWSER_URL"
export const TOKEN_ENV = "TENON_BROWSER_TOKEN"

export const available = () => !!process.env[URL_ENV] && !!process.env[TOKEN_ENV]

export const TOOLS = [
  {
    name: "browser_navigate",
    description:
      "Open a URL in the browser in the user's Tenon Workbench panel, which the user can see. localhost and 127.0.0.1 open directly; any other site asks the user first. Returns the page's URL and title once it has loaded.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Read the current page: its URL, title, visible text, and the interactive elements with a CSS selector for each. Use the selectors with browser_click and browser_type.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_click",
    description: "Click the element matching a CSS selector from browser_snapshot.",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_type",
    description:
      "Type text into the input matching a CSS selector, replacing its value. Set submit to press Enter after.",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string" }, text: { type: "string" }, submit: { type: "boolean" } },
      required: ["selector", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture what the browser shows as a PNG image.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_console",
    description: "The page's recent console messages and failed network requests, newest last.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "device_list",
    description:
      "List phones the Workbench can drive: Android emulators and connected devices (macOS and Windows) and iOS simulators (macOS only), with which are running.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "device_screenshot",
    description: "Capture the running device's screen as a PNG. Pass device to pick one from device_list.",
    inputSchema: { type: "object", properties: { device: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "device_tap",
    description: "Tap the running device's screen at x, y in screen pixels (as in device_screenshot).",
    inputSchema: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, device: { type: "string" } },
      required: ["x", "y"],
      additionalProperties: false,
    },
  },
  {
    name: "device_swipe",
    description: "Swipe on the running device from x, y to to_x, to_y in screen pixels.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        to_x: { type: "number" },
        to_y: { type: "number" },
        device: { type: "string" },
      },
      required: ["x", "y", "to_x", "to_y"],
      additionalProperties: false,
    },
  },
  {
    name: "device_type",
    description: "Type text into the focused field on the running device.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, device: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "device_key",
    description: "Press home, back (Android) or enter on the running device.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", enum: ["home", "back", "enter"] }, device: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "device_install",
    description: "Install an app build (.apk on Android, .app on the iOS Simulator) from an absolute path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, device: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "device_launch",
    description: "Launch an installed app by package or bundle ID (com.example.app).",
    inputSchema: {
      type: "object",
      properties: { app: { type: "string" }, device: { type: "string" } },
      required: ["app"],
      additionalProperties: false,
    },
  },
  {
    name: "device_logs",
    description: "The running device's recent log lines (logcat on Android, the simulator log on iOS).",
    inputSchema: {
      type: "object",
      properties: { lines: { type: "number" }, device: { type: "string" } },
      additionalProperties: false,
    },
  },
] as const

const names = new Set<string>(TOOLS.map((tool) => tool.name))
export const isTool = (name: string) => names.has(name)

/** An MCP tool result: text, or an image for browser_screenshot. */
export type Result = { readonly text: string } | { readonly image: string; readonly mimeType: string }

export async function call(name: string, args: Record<string, unknown>, sessionID: string): Promise<Result> {
  const url = process.env[URL_ENV]
  const token = process.env[TOKEN_ENV]
  if (!url || !token) throw new Error("The Workbench browser is only available in the desktop app.")
  const response = await fetch(`${url}/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...args, sessionID }),
    signal: AbortSignal.timeout(60_000),
  })
  const body = (await response.json().catch(() => undefined)) as
    | { error?: string; text?: string; image?: string; mimeType?: string }
    | undefined
  if (!response.ok || !body || body.error) throw new Error(body?.error ?? `The browser answered ${response.status}.`)
  if (body.image) return { image: body.image, mimeType: body.mimeType ?? "image/png" }
  return { text: body.text ?? "" }
}
