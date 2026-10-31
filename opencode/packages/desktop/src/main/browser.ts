import { randomBytes } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import { BrowserWindow, dialog, session, WebContentsView } from "electron"
import { nativeT } from "./native-translations"
import { deviceInput, deviceLogs, deviceScreenshot, deviceStatus, installApp, launchApp } from "./device"

// The Workbench panel's browser: one WebContentsView laid over the panel's Browser tab, in its own
// session so it shares no cookies, storage or permissions with the app. The user drives it from the
// panel; agents drive it through the `tenon` MCP server, which reaches this module over a loopback
// HTTP bridge guarded by a bearer token (TENON_BROWSER_URL / TENON_BROWSER_TOKEN in the server's env).
const PARTITION = "persist:tenon-browser"
const MAX_LOG = 100

type Bounds = { x: number; y: number; width: number; height: number }
type LogEntry = { level: string; text: string }

const state = {
  view: undefined as WebContentsView | undefined,
  window: undefined as BrowserWindow | undefined,
  bounds: undefined as Bounds | undefined,
  visible: false,
  log: [] as LogEntry[],
  // The app's own server; the browser never loads it, so pages can't reach its API.
  blocked: new Set<string>(),
}

const isLocal = (url: URL) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost")

function push(entry: LogEntry) {
  state.log.push(entry)
  if (state.log.length > MAX_LOG) state.log.shift()
}

function ensureView() {
  if (state.view && !state.view.webContents.isDestroyed()) return state.view
  const browserSession = session.fromPartition(PARTITION)
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserSession.setPermissionCheckHandler(() => false)
  browserSession.webRequest.onBeforeRequest((details, callback) => {
    const origin = URL.canParse(details.url) ? new URL(details.url).origin : ""
    callback({ cancel: state.blocked.has(origin) })
  })
  browserSession.webRequest.onErrorOccurred((details) => {
    if (details.error !== "net::ERR_ABORTED") push({ level: "network", text: `${details.error} ${details.url}` })
  })
  const view = new WebContentsView({
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const contents = view.webContents
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void contents.loadURL(url)
    return { action: "deny" }
  })
  contents.on("will-navigate", (event, url) => {
    if (!/^https?:/.test(url)) event.preventDefault()
  })
  contents.on("console-message", (event) => push({ level: event.level, text: event.message }))
  for (const name of [
    "did-navigate",
    "did-navigate-in-page",
    "page-title-updated",
    "did-start-loading",
    "did-stop-loading",
  ] as const)
    contents.on(name as "did-navigate", () => sendState())
  state.view = view
  return view
}

function sendState() {
  const contents = state.view?.webContents
  if (!contents || !state.window || state.window.isDestroyed()) return
  state.window.webContents.send("browser-state", {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  })
}

function attach(window: BrowserWindow) {
  const view = ensureView()
  if (state.window !== window) {
    if (state.window && !state.window.isDestroyed()) state.window.contentView.removeChildView(view)
    window.contentView.addChildView(view)
    state.window = window
    window.once("closed", () => {
      if (state.window === window) state.window = undefined
    })
  }
  return view
}

/** The panel shows the browser over `bounds` (CSS pixels in the window), or hides it. */
export function showBrowser(window: BrowserWindow, bounds: Bounds | undefined) {
  const view = attach(window)
  state.visible = !!bounds
  if (bounds) state.bounds = bounds
  // A hidden view keeps loading and answering agents; it is just moved out of sight.
  view.setBounds(bounds ? roundBounds(bounds, window) : { x: 0, y: 0, width: 0, height: 0 })
  view.setVisible(!!bounds)
  sendState()
}

function roundBounds(bounds: Bounds, window: BrowserWindow) {
  const zoom = window.webContents.getZoomFactor()
  return {
    x: Math.round(bounds.x * zoom),
    y: Math.round(bounds.y * zoom),
    width: Math.max(0, Math.round(bounds.width * zoom)),
    height: Math.max(0, Math.round(bounds.height * zoom)),
  }
}

export async function navigateBrowser(window: BrowserWindow, input: string) {
  const view = attach(window)
  const url = normalizeURL(input)
  if (!url) throw new Error("Enter a web address.")
  await view.webContents.loadURL(url).catch(() => undefined)
  sendState()
}

export function normalizeURL(input: string) {
  const value = input.trim()
  if (!value) return
  if (/^https?:\/\//i.test(value)) return URL.canParse(value) ? value : undefined
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value)) return `http://${value}`
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(value)) return `https://${value}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
}

export function browserHistory(direction: "back" | "forward" | "reload") {
  const contents = state.view?.webContents
  if (!contents) return
  if (direction === "back") contents.navigationHistory.goBack()
  if (direction === "forward") contents.navigationHistory.goForward()
  if (direction === "reload") contents.reload()
}

/** A PNG of the page (or of `rect`, in page CSS pixels), as a data URL. */
export async function captureBrowser(rect?: Bounds) {
  const contents = state.view?.webContents
  if (!contents) return
  const image = await contents.capturePage(rect)
  return image.isEmpty() ? undefined : image.toDataURL()
}

// Runs in the page's isolated world: outlines the element under the pointer and resolves with the
// clicked one. Escape cancels. The page's own scripts can't see or spoof it.
const PICKER = `new Promise((resolve) => {
  const box = document.createElement("div")
  box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;outline:2px solid #3b5cf6;background:rgba(59,92,246,.08);border-radius:3px"
  document.documentElement.appendChild(box)
  const selector = (el) => {
    if (el.id) return "#" + CSS.escape(el.id)
    const parts = []
    for (let node = el; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break }
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : []
      parts.unshift(node.tagName.toLowerCase() + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(node) + 1) + ")" : ""))
    }
    return parts.join(" > ")
  }
  const move = (e) => { const r = e.target.getBoundingClientRect(); Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" }) }
  const done = (value) => { removeEventListener("mousemove", move, true); removeEventListener("click", click, true); removeEventListener("keydown", key, true); box.remove(); resolve(value) }
  const click = (e) => {
    e.preventDefault(); e.stopPropagation()
    const el = e.target, r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    done({ selector: selector(el), tag: el.tagName.toLowerCase(), text: (el.innerText || "").trim().slice(0, 200),
      html: el.outerHTML.slice(0, 1500), rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      styles: { color: cs.color, background: cs.backgroundColor, font: cs.fontSize + " " + cs.fontFamily, padding: cs.padding, margin: cs.margin } })
  }
  const key = (e) => { if (e.key === "Escape") done(null) }
  addEventListener("mousemove", move, true); addEventListener("click", click, true); addEventListener("keydown", key, true)
})`

export async function pickElement() {
  const contents = state.view?.webContents
  if (!contents) return null
  contents.focus()
  return contents.executeJavaScriptInIsolatedWorld(1001, [{ code: PICKER }], true).catch(() => null)
}

// Visible text and interactive elements, for agents.
const SNAPSHOT = `(() => {
  const selector = (el) => {
    if (el.id) return "#" + CSS.escape(el.id)
    const parts = []
    for (let node = el; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break }
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : []
      parts.unshift(node.tagName.toLowerCase() + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(node) + 1) + ")" : ""))
    }
    return parts.join(" > ")
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const elements = [...document.querySelectorAll("a[href],button,input,select,textarea,[role=button],[role=link],[contenteditable=true]")]
    .filter(visible).slice(0, 150)
    .map((el) => ({ selector: selector(el), role: el.getAttribute("role") || el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || "").trim().slice(0, 80) }))
  const headings = [...document.querySelectorAll("h1,h2,h3")].filter(visible).slice(0, 40)
    .map((el) => ({ level: el.tagName.toLowerCase(), selector: selector(el), text: el.innerText.trim().slice(0, 120) }))
  return { url: location.href, title: document.title, headings, elements, text: (document.body?.innerText || "").slice(0, 8000) }
})()`

async function runTool(name: string, args: Record<string, unknown>): Promise<{ text?: string; image?: string }> {
  if (name.startsWith("device_")) return runDeviceTool(name, args)
  const window = state.window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window) throw new Error("Open Tenon Workbench to use its browser.")
  const view = attach(window)
  const contents = view.webContents
  // Show the user what the agent is doing.
  window.webContents.send("browser-agent", { tool: name })
  if (name === "browser_navigate") {
    const url = normalizeURL(String(args.url ?? ""))
    if (!url) throw new Error("browser_navigate needs an http(s) URL.")
    const parsed = new URL(url)
    if (!isLocal(parsed)) {
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        title: nativeT("secondBrain.desktop.browser.agentNavigate.title"),
        message: nativeT("secondBrain.desktop.browser.agentNavigate.message", { host: parsed.host }),
        buttons: [nativeT("secondBrain.desktop.browser.agentNavigate.allow"), nativeT("secondBrain.desktop.browser.agentNavigate.deny")],
        defaultId: 1,
        cancelId: 1,
      })
      if (choice.response !== 0) throw new Error(`The user didn't allow opening ${parsed.host}.`)
    }
    await contents.loadURL(url).catch(() => undefined)
    sendState()
    return { text: JSON.stringify({ url: contents.getURL(), title: contents.getTitle() }) }
  }
  if (!contents.getURL()) throw new Error("No page is open. Call browser_navigate first.")
  if (name === "browser_snapshot") return { text: JSON.stringify(await contents.executeJavaScript(SNAPSHOT), null, 1) }
  if (name === "browser_click" || name === "browser_type") {
    const selector = JSON.stringify(String(args.selector ?? ""))
    const text = JSON.stringify(String(args.text ?? ""))
    const found = await contents.executeJavaScript(`(() => {
      const el = document.querySelector(${selector})
      if (!el) return false
      el.scrollIntoView({ block: "center" })
      if (${name === "browser_click"}) { el.click(); return true }
      el.focus()
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set
      setter ? setter.call(el, ${text}) : (el.value = ${text})
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      return true
    })()`)
    if (!found) throw new Error(`No element matches ${String(args.selector)}.`)
    if (name === "browser_type" && args.submit === true) {
      contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" })
      contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" })
    }
    return { text: "Done." }
  }
  if (name === "browser_screenshot") {
    const image = await contents.capturePage()
    if (image.isEmpty()) throw new Error("The browser is hidden. Ask the user to open the Browser tab.")
    return { image: image.toPNG().toString("base64") }
  }
  if (name === "browser_console")
    return { text: state.log.map((entry) => `[${entry.level}] ${entry.text}`).join("\n") || "No messages." }
  throw new Error(`Unknown tool: ${name}`)
}

/** Starts the agent bridge and returns its URL and token for the server process's environment. */
export function startBrowserBridge() {
  const token = randomBytes(32).toString("base64url")
  return new Promise<{ url: string; token: string }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const answer = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" })
        response.end(JSON.stringify(body))
      }
      // Only the server process holds the token; a web page can't set this header cross-origin.
      if (request.method !== "POST" || request.headers.authorization !== `Bearer ${token}` || request.headers.origin)
        return answer(403, { error: "Forbidden" })
      void readJSON(request)
        .then((args) => runTool((request.url ?? "").replace(/^\//, ""), args))
        .then(
          (result) =>
            answer(200, result.image ? { image: result.image, mimeType: "image/png" } : { text: result.text }),
          (cause: unknown) => answer(200, { error: cause instanceof Error ? cause.message : String(cause) }),
        )
    })
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("The browser bridge has no port."))
      server.unref()
      resolve({ url: `http://127.0.0.1:${address.port}`, token })
    })
  })
}

/** Keeps pages in the browser from reaching an origin (the app's own server). */
export function blockBrowserOrigin(origin: string) {
  state.blocked.add(origin)
}

function readJSON(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = ""
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > 64_000) request.destroy()
    })
    request.on("end", () => {
      try {
        const value: unknown = JSON.parse(body || "{}")
        resolve(value && typeof value === "object" ? (value as Record<string, unknown>) : {})
      } catch (cause) {
        reject(cause)
      }
    })
    request.on("error", reject)
  })
}

// Device tools act on the named device, or the first running one (an emulator or a booted simulator).
async function runDeviceTool(name: string, args: Record<string, unknown>): Promise<{ text?: string; image?: string }> {
  const status = await deviceStatus()
  if (name === "device_list") return { text: JSON.stringify(status, null, 1) }
  const running = [
    ...status.android.devices.filter((device) => device.state === "device"),
    ...status.ios.devices.filter((device) => device.state === "Booted"),
  ]
  const target = running.find((device) => device.id === args.device) ?? running[0]
  if (!target) throw new Error("No device is running. Start one from the Device tab, or call device_list.")
  const notify = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  notify?.webContents.send("device-agent", { tool: name, platform: target.platform, id: target.id })
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)
  if (name === "device_screenshot")
    return { image: (await deviceScreenshot(target.platform, target.id)).toString("base64") }
  if (name === "device_logs") return { text: await deviceLogs(target.platform, target.id, num(args.lines) || 200) }
  if (name === "device_tap")
    await deviceInput(target.platform, target.id, { kind: "tap", x: num(args.x), y: num(args.y) })
  else if (name === "device_swipe")
    await deviceInput(target.platform, target.id, {
      kind: "swipe",
      x: num(args.x),
      y: num(args.y),
      toX: num(args.to_x),
      toY: num(args.to_y),
    })
  else if (name === "device_type")
    await deviceInput(target.platform, target.id, { kind: "text", text: String(args.text ?? "") })
  else if (name === "device_key")
    await deviceInput(target.platform, target.id, {
      kind: "key",
      key: args.key === "back" || args.key === "enter" ? args.key : "home",
    })
  else if (name === "device_install") await installApp(target.platform, target.id, String(args.path ?? ""))
  else if (name === "device_launch") await launchApp(target.platform, target.id, String(args.app ?? ""))
  else throw new Error(`Unknown tool: ${name}`)
  return { text: `Done on ${target.name}.` }
}
