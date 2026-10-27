import { checksum } from "@opencode-ai/core/util/encode"

/**
 * Agent-authored designs: ```html fenced blocks in chat.
 *
 * `html` alone is a small design shown inline in the thread; an info string with the word `canvas`
 * (```html canvas title="Name") is a large design shown as an artboard in the Canvas tab. The page
 * is untrusted model output: it only ever runs inside an iframe with `sandbox="allow-scripts"`
 * (opaque origin, no navigation, popups, forms or modals) whose srcdoc starts with a CSP that blocks
 * every network load.
 */

export type DesignInfo = { title?: string; canvas: boolean }

export type DesignFence = DesignInfo & { source: string; closed: boolean }

export type Design = { id: string; title?: string; source: string; canvas: boolean }

/** Larger pages show a notice instead of rendering. */
export const MAX_DESIGN_BYTES = 512 * 1024

/** The only sandbox token a design frame gets. Never add allow-same-origin, navigation, popups, forms or modals. */
export const DESIGN_SANDBOX = "allow-scripts"

export const DESIGN_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:"

const MAX_TITLE = 120
const fence = /^([ \t]*)(`{3,}|~{3,})(.*)$/
const attribute = /([A-Za-z][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))|(\S+)/g

/** Reads `canvas` and `title="…"` from the words after `html` in a fence info string. */
export function designInfo(info: string): DesignInfo {
  const rest = info.trim().replace(/^\S+/, "")
  const words = [...rest.matchAll(attribute)]
  const title = words.find((match) => match[1]?.toLowerCase() === "title")
  const text = title ? (title[2]?.replace(/\\(.)/g, "$1") ?? title[3] ?? title[4] ?? "") : ""
  return {
    title: cleanTitle(text),
    canvas: words.some((match) => match[5]?.toLowerCase() === "canvas"),
  }
}

/** Whether a fence info string opens an html design block. */
export function isDesignInfo(info: string) {
  return info.trim().split(/\s+/, 1)[0] === "html"
}

/** Every ```html fence in a markdown text, in order; an unclosed last fence is still streaming. */
export function designFences(text: string): DesignFence[] {
  const lines = text.split(/\r?\n/)
  const result: DesignFence[] = []
  let open: { mark: string; indent: number; info: string; body: string[] } | undefined
  for (const line of lines) {
    if (open) {
      if (closes(line, open.mark)) {
        if (isDesignInfo(open.info))
          result.push({ ...designInfo(open.info), source: open.body.join("\n"), closed: true })
        open = undefined
        continue
      }
      open.body.push(dedent(line, open.indent))
      continue
    }
    const match = line.match(fence)
    if (!match) continue
    // A backtick fence's info string can't contain backticks (CommonMark), so ```x``` is inline code.
    if (match[2].startsWith("`") && match[3].includes("`")) continue
    open = { mark: match[2], indent: match[1].length, info: match[3], body: [] }
  }
  if (open && isDesignInfo(open.info))
    result.push({ ...designInfo(open.info), source: open.body.join("\n"), closed: false })
  return result
}

/** Stable identity of a design across the thread, the inline window and the Canvas tab. */
export function designID(source: string) {
  return checksum(source.trimEnd()) ?? "empty"
}

export function designTooLarge(source: string) {
  // UTF-16 length is a lower bound on the UTF-8 size; skip encoding when that alone is over the cap.
  if (source.length > MAX_DESIGN_BYTES) return true
  return new TextEncoder().encode(source).length > MAX_DESIGN_BYTES
}

/**
 * The srcdoc for a design frame. The CSP meta is the first thing in <head>, so no tag in the page
 * can load anything before it applies; the page's own doctype, <html> and <head> tags that follow
 * are ignored or merged by the HTML parser, and its head elements still land in this head.
 * DNS prefetch is turned off and the WebRTC guard runs before any page script, because the CSP
 * covers neither. `autosize` adds a script that reports the content height to the parent (a bare number).
 */
export function designDocument(source: string, options: { autosize?: boolean } = {}) {
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${DESIGN_CSP}">`,
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    webrtcGuardScript,
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    options.autosize ? autosizeScript : "",
    source,
  ].join("")
}

/**
 * Removes the WebRTC constructors from the frame's window for good, so the page can't open a peer
 * connection whose STUN/TURN (ICE) lookups would leak data. Defence in depth only: a page can still
 * reach them through a nested frame it creates; Electron main also turns off non-proxied WebRTC UDP.
 */
const webrtcGuardScript =
  '<script>["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel"].forEach((name)=>' +
  "Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false}))</script>"

const autosizeScript =
  "<script>(()=>{let last=0;const send=()=>{const h=Math.ceil(document.documentElement.scrollHeight);" +
  "if(h!==last){last=h;parent.postMessage(h,'*')}};addEventListener('load',send);" +
  "new ResizeObserver(send).observe(document.documentElement)})()</script>"

/**
 * Every canvas design of a thread in message order, plus the inline designs the user pinned to the
 * Canvas tab. Only assistant text parts count; repeated pages keep their first position.
 * `scan` lets callers cache fence parsing per part while a reply streams.
 */
export function collectDesigns(
  messages: readonly { id: string; role: string }[],
  parts: Readonly<Record<string, readonly { id: string; type: string; text?: string }[] | undefined>>,
  pinned: readonly string[] = [],
  scan: (part: { id: string; text: string }) => DesignFence[] = (part) => designFences(part.text),
) {
  const keep = new Set(pinned)
  const seen = new Set<string>()
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => parts[message.id] ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? scan({ id: part.id, text: part.text }) : []))
    .flatMap((item): Design[] => {
      if (!item.closed) return []
      const id = designID(item.source)
      if (seen.has(id) || !(item.canvas || keep.has(id))) return []
      seen.add(id)
      return [{ id, title: item.title, source: item.source, canvas: item.canvas }]
    })
}

function cleanTitle(value: string) {
  const title = Array.from(value)
    .filter((char) => char >= " " && char !== "\u007f")
    .join("")
    .trim()
  return title ? title.slice(0, MAX_TITLE) : undefined
}

function closes(line: string, mark: string) {
  const match = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
  return !!match && match[1][0] === mark[0] && match[1].length >= mark.length
}

function dedent(line: string, indent: number) {
  if (!indent) return line
  const strip = line.match(/^[ \t]*/)![0].length
  return line.slice(Math.min(strip, indent))
}
