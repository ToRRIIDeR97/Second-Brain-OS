import { sanitizeMarkdown } from "@opencode-ai/session-ui/markdown-cache"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { For, Match, Show, Switch, createMemo, createResource, createSignal, onMount, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

/** File types the Workbench panel renders instead of showing their source or bytes. */
export type ViewerKind = "markdown" | "csv" | "json" | "pdf" | "video" | "sheet" | "doc"

const kinds: Record<string, ViewerKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  csv: "csv",
  tsv: "csv",
  json: "json",
  pdf: "pdf",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",
  xlsx: "sheet",
  xls: "sheet",
  ods: "sheet",
  docx: "doc",
}

export function viewerKind(path: string | undefined): ViewerKind | undefined {
  const ext = path?.split(".").pop()?.toLowerCase()
  return ext ? kinds[ext] : undefined
}

// Tables stop here; the source view still has every row.
const MAX_ROWS = 500

/**
 * Renders markdown, tables, JSON, PDF, video, spreadsheets and Word documents in the file tab.
 * `source` shows the file as text (the regular viewer), for kinds that have a rendered/source switch.
 */
export function FileViewer(props: {
  kind: ViewerKind
  directory: string
  path: string
  /** The file as the server read it: text, or base64 for binary files. */
  content?: { content: string; encoding?: string; mimeType?: string }
  source: () => JSX.Element
  onReady?: () => void
}) {
  onMount(() => props.onReady?.())
  const language = useLanguage()
  const platform = usePlatform()
  const [mode, setMode] = createSignal<"rendered" | "source">("rendered")
  const textKind = () => props.kind === "markdown" || props.kind === "csv" || props.kind === "json"
  // Large binaries come through the desktop's tenon-file:// URL; elsewhere, the base64 the server read.
  const [url] = createResource(
    () => (textKind() ? undefined : { directory: props.directory, path: props.path }),
    async (input) =>
      (await platform.fileViewerURL?.(input.directory, input.path).catch(() => undefined)) ??
      (props.content?.encoding === "base64"
        ? `data:${props.content.mimeType ?? ""};base64,${props.content.content}`
        : undefined),
  )
  const text = () => (props.content?.encoding === "base64" ? "" : (props.content?.content ?? ""))

  return (
    <div class="flex h-full min-h-0 flex-col" data-component="file-viewer" data-kind={props.kind}>
      <Show when={textKind()}>
        <div class="flex items-center gap-1 px-4 pb-2" role="group" aria-label={language.t("secondBrain.fileViewer.view")}>
          <For each={["rendered", "source"] as const}>
            {(value) => (
              <button
                type="button"
                class="h-7 rounded-full px-3 text-12-medium text-v2-text-text-weak aria-pressed:bg-v2-background-bg-layer-02 aria-pressed:text-v2-text-text-base"
                aria-pressed={mode() === value}
                data-action={`file-viewer-${value}`}
                onClick={() => setMode(value)}
              >
                {language.t(value === "rendered" ? "secondBrain.fileViewer.rendered" : "secondBrain.fileViewer.source")}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={!(textKind() && mode() === "source")} fallback={props.source()}>
        <Switch>
          <Match when={props.kind === "markdown"}>
            <div class="px-6 pb-40">
              <Markdown text={text()} class="max-w-none text-[14px] leading-6" />
            </div>
          </Match>
          <Match when={props.kind === "csv"}>
            <Table rows={parseDelimited(text(), props.path.toLowerCase().endsWith(".tsv") ? "\t" : ",")} />
          </Match>
          <Match when={props.kind === "json"}>
            <JsonView text={text()} fallback={props.source} />
          </Match>
          <Match when={props.kind === "pdf" && url()}>
            {/* Chromium's PDF viewer: pages, zoom, search and text selection. */}
            <iframe class="min-h-[70vh] w-full flex-1 border-0" src={url()} title={props.path} />
          </Match>
          <Match when={props.kind === "video" && url()}>
            <div class="flex justify-center px-4 pb-40">
              <video class="max-h-[70vh] max-w-full rounded-xl bg-black" src={url()} controls preload="metadata" />
            </div>
          </Match>
          <Match when={props.kind === "sheet" && url()}>
            <Sheet url={url()!} />
          </Match>
          <Match when={props.kind === "doc" && url()}>
            <Doc url={url()!} />
          </Match>
          <Match when={!url.loading && !url()}>
            <div class="px-6 py-4 text-13-regular text-v2-text-text-weak">{language.t("secondBrain.fileViewer.unavailable")}</div>
          </Match>
        </Switch>
      </Show>
    </div>
  )
}

function Table(props: { rows: string[][]; header?: boolean }) {
  const language = useLanguage()
  const head = () => props.rows[0] ?? []
  const body = () => props.rows.slice(1, MAX_ROWS + 1)
  return (
    <div class="px-4 pb-40">
      <div class="overflow-auto rounded-xl border border-v2-border-border-base">
        <table class="min-w-full border-collapse text-12-regular tabular-nums">
          <thead>
            <tr>
              <For each={head()}>
                {(cell) => (
                  <th class="sticky top-0 border-b border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-1.5 text-left text-12-medium">
                    {cell}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={body()}>
              {(row) => (
                <tr class="border-b border-v2-border-border-weak last:border-b-0">
                  <For each={row}>{(cell) => <td class="whitespace-nowrap px-3 py-1">{cell}</td>}</For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={props.rows.length - 1 > MAX_ROWS}>
        <p class="px-1 pt-2 text-12-regular text-v2-text-text-weak">
          {language.t("secondBrain.fileViewer.rowsShown", { shown: MAX_ROWS, total: props.rows.length - 1 })}
        </p>
      </Show>
    </div>
  )
}

/** Splits CSV/TSV text, honouring quoted fields with embedded delimiters, quotes and newlines. */
export function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index++
        continue
      }
      if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"' && cell === "") quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += char
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function JsonView(props: { text: string; fallback: () => JSX.Element }) {
  const parsed = createMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(props.text) as unknown }
    } catch {
      return { ok: false as const }
    }
  })
  return (
    <Show when={parsed().ok} fallback={props.fallback()}>
      <div class="px-6 pb-40 font-mono text-12-regular leading-5">
        <JsonNode value={(parsed() as { value: unknown }).value} depth={0} />
      </div>
    </Show>
  )
}

function JsonNode(props: { name?: string; value: unknown; depth: number }): JSX.Element {
  const label = () => (props.name === undefined ? "" : `${JSON.stringify(props.name)}: `)
  const entries = () =>
    Array.isArray(props.value)
      ? props.value.map((value, index) => [String(index), value] as const)
      : Object.entries(props.value as Record<string, unknown>)
  const branch = () => props.value !== null && typeof props.value === "object"
  return (
    <Show
      when={branch()}
      fallback={
        <div>
          <span class="text-v2-text-text-weak">{label()}</span>
          <span class={typeof props.value === "string" ? "text-v2-state-fg-success" : "text-v2-text-text-base"}>
            {JSON.stringify(props.value)}
          </span>
        </div>
      }
    >
      <details open={props.depth < 2} class="pl-3">
        <summary class="-ml-3 cursor-pointer select-none">
          <span class="text-v2-text-text-weak">{label()}</span>
          {Array.isArray(props.value) ? `[ ${entries().length} ]` : `{ ${entries().length} }`}
        </summary>
        <For each={entries()}>{([name, value]) => <JsonNode name={name} value={value} depth={props.depth + 1} />}</For>
      </details>
    </Show>
  )
}

// A file that can't be read or parsed shows the viewer's "can't be shown" text, never an app error.
async function bytesOf(url: string) {
  const response = await fetch(url).catch(() => undefined)
  if (!response?.ok) return
  return new Uint8Array(await response.arrayBuffer())
}

function Sheet(props: { url: string }) {
  const language = useLanguage()
  const [book] = createResource(
    () => props.url,
    async (url) => {
      const { read, utils } = await import("xlsx")
      const bytes = await bytesOf(url)
      if (!bytes) return []
      const workbook = (() => {
        try {
          return read(bytes, { type: "array" })
        } catch {
          return undefined
        }
      })()
      if (!workbook) return []
      return workbook.SheetNames.map((name) => ({
        name,
        rows: utils
          .sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, blankrows: false, defval: "" })
          .map((row) => row.map((cell) => String(cell ?? ""))),
      }))
    },
  )
  const [active, setActive] = createSignal(0)
  return (
    <Show when={book()} fallback={<div class="px-6 py-4 text-13-regular">{language.t("common.loading")}</div>}>
      {(sheets) => (
        <Show
          when={sheets().length > 0}
          fallback={
            <div class="px-6 py-4 text-13-regular text-v2-text-text-weak">{language.t("secondBrain.fileViewer.unavailable")}</div>
          }
        >
          <div class="flex min-h-0 flex-col">
            <Table rows={sheets()[active()]?.rows ?? []} />
            <div class="flex flex-wrap gap-1 px-4 pb-4" role="tablist" aria-label={language.t("secondBrain.fileViewer.sheets")}>
              <For each={sheets()}>
                {(sheet, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={index() === active()}
                    class="h-7 rounded-full px-3 text-12-medium text-v2-text-text-weak aria-selected:bg-v2-background-bg-layer-02 aria-selected:text-v2-text-text-base"
                    onClick={() => setActive(index())}
                  >
                    {sheet.name}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      )}
    </Show>
  )
}

function Doc(props: { url: string }) {
  const language = useLanguage()
  const [html] = createResource(
    () => props.url,
    async (url) => {
      const mammoth = await import("mammoth")
      const bytes = await bytesOf(url)
      if (!bytes) return ""
      const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer as ArrayBuffer }).catch(() => undefined)
      if (!result) return ""
      // Workspace content is untrusted: scripts and remote loads are stripped before it reaches the page.
      return sanitizeMarkdown(result.value)
    },
  )
  return (
    <Show
      when={html() !== undefined}
      fallback={<div class="px-6 py-4 text-13-regular">{language.t("common.loading")}</div>}
    >
      <Show
        when={html()}
        fallback={
          <div class="px-6 py-4 text-13-regular text-v2-text-text-weak">{language.t("secondBrain.fileViewer.unavailable")}</div>
        }
      >
        <div class="px-4 pb-40">
          <article
            class="prose mx-auto max-w-[720px] rounded-xl bg-white px-10 py-8 text-[13px] leading-6 text-neutral-900 shadow-sm"
            innerHTML={html()}
          />
        </div>
      </Show>
    </Show>
  )
}
