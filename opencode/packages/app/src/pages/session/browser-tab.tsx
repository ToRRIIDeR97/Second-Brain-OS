import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import type { ImageAttachmentPart } from "@/context/prompt-state"
import { createBlobReference } from "@/utils/draft-store"
import { uuid } from "@/utils/uuid"

type Picked = NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof usePlatform>["browser"]>["pick"]>>>
type Point = { x: number; y: number }
type Note = Point & { text: string }

/**
 * The Workbench panel's browser. The page itself is a native view main lays over `stage`; this tab
 * keeps it in place, and draws the annotation layer over a screenshot while annotating. Agents use
 * the same browser through the tenon MCP server; what they do shows here.
 */
export function SessionBrowserTab() {
  const language = useLanguage()
  const platform = usePlatform()
  const prompt = usePrompt()
  const browser = platform.browser
  const [page, setPage] = createStore({ url: "", title: "", loading: false, canGoBack: false, canGoForward: false })
  const [address, setAddress] = createSignal("")
  const [annotate, setAnnotate] = createStore({
    active: false,
    shot: "",
    tool: "pen" as "pen" | "region" | "note",
    strokes: [] as Point[][],
    region: undefined as { x: number; y: number; width: number; height: number } | undefined,
    notes: [] as Note[],
  })
  const [picked, setPicked] = createStore<Picked[]>([])
  const [activity, setActivity] = createStore<string[]>([])
  let stage: HTMLDivElement | undefined
  let canvas: HTMLCanvasElement | undefined

  // The native view sits above the DOM, so it hides while annotating or while a dialog is open.
  const [covered, setCovered] = createSignal(false)
  const place = () => {
    if (!browser || !stage) return
    const rect = stage.getBoundingClientRect()
    const hidden = annotate.active || covered() || rect.width < 2 || rect.height < 2
    void browser.show(hidden ? undefined : { x: rect.left, y: rect.top, width: rect.width, height: rect.height })
  }

  onMount(() => {
    if (!browser || !stage) return
    const resize = new ResizeObserver(place)
    resize.observe(stage)
    const dialogs = new MutationObserver(() => {
      setCovered(!!document.querySelector('[role="dialog"], [data-component="dialog-stack"] [data-expanded]'))
      place()
    })
    dialogs.observe(document.body, { childList: true, subtree: true })
    window.addEventListener("resize", place)
    const offState = browser.onState((state) => {
      setPage(state)
      if (document.activeElement?.id !== "browser-address") setAddress(state.url)
    })
    const offAgent = browser.onAgent((event) =>
      setActivity(produce((list) => void list.push(`${new Date().toLocaleTimeString()}  ${event.tool}`))),
    )
    place()
    onCleanup(() => {
      resize.disconnect()
      dialogs.disconnect()
      window.removeEventListener("resize", place)
      offState()
      offAgent()
      void browser.show(undefined)
    })
  })

  const go = (event: SubmitEvent) => {
    event.preventDefault()
    if (address().trim()) void browser?.navigate(address())
  }

  const pick = async () => {
    const element = await browser?.pick()
    if (element) setPicked(produce((list) => void list.push(element)))
  }

  const startAnnotate = async () => {
    const shot = await browser?.capture()
    if (!shot) return
    setAnnotate({ active: true, shot, strokes: [], region: undefined, notes: [] })
    place()
  }

  const stopAnnotate = () => {
    setAnnotate("active", false)
    place()
  }

  let drawing: Point | undefined
  const point = (event: PointerEvent): Point => {
    const rect = canvas!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const down = (event: PointerEvent) => {
    const at = point(event)
    if (annotate.tool === "note") {
      setAnnotate("notes", (notes) => [...notes, { ...at, text: "" }])
      return
    }
    canvas!.setPointerCapture(event.pointerId)
    drawing = at
    if (annotate.tool === "pen") setAnnotate("strokes", (strokes) => [...strokes, [at]])
  }
  const move = (event: PointerEvent) => {
    if (!drawing) return
    const at = point(event)
    if (annotate.tool === "pen") setAnnotate("strokes", annotate.strokes.length - 1, (stroke) => [...stroke, at])
    if (annotate.tool === "region")
      setAnnotate("region", {
        x: Math.min(at.x, drawing.x),
        y: Math.min(at.y, drawing.y),
        width: Math.abs(at.x - drawing.x),
        height: Math.abs(at.y - drawing.y),
      })
  }
  const up = () => (drawing = undefined)

  // Flattens the screenshot and the drawing (cropped to the region, if any) into one PNG.
  const flatten = async () => {
    const image = new Image()
    image.src = annotate.shot
    await image.decode()
    const shown = canvas!.getBoundingClientRect()
    const scale = image.naturalWidth / shown.width
    const region =
      annotate.region && annotate.region.width > 4
        ? annotate.region
        : { x: 0, y: 0, width: shown.width, height: shown.height }
    const out = document.createElement("canvas")
    out.width = Math.round(region.width * scale)
    out.height = Math.round(region.height * scale)
    const context = out.getContext("2d")!
    context.drawImage(image, -region.x * scale, -region.y * scale)
    context.scale(scale, scale)
    context.translate(-region.x, -region.y)
    context.strokeStyle = "#e5484d"
    context.lineWidth = 3
    context.lineCap = "round"
    annotate.strokes.forEach((stroke) => {
      context.beginPath()
      stroke.forEach((p, index) => (index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)))
      context.stroke()
    })
    context.font = "13px sans-serif"
    annotate.notes.forEach((note, index) => {
      context.fillStyle = "#fff7d6"
      const label = `${index + 1}. ${note.text}`
      context.fillRect(note.x, note.y - 16, context.measureText(label).width + 12, 22)
      context.fillStyle = "#3b3200"
      context.fillText(label, note.x + 6, note.y)
    })
    return new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"))
  }

  const send = async () => {
    const parts = [...prompt.current()]
    if (annotate.active) {
      const blob = await flatten()
      if (blob) {
        const image: ImageAttachmentPart = {
          type: "image",
          id: uuid(),
          filename: "browser-screenshot.png",
          mime: "image/png",
          blob: await createBlobReference(blob),
        }
        parts.push(image)
      }
    }
    const lines = [
      page.url ? language.t("secondBrain.browser.send.page", { url: page.url }) : "",
      ...picked.map((element, index) =>
        language.t("secondBrain.browser.send.element", {
          index: index + 1,
          selector: element.selector,
          text: element.text.slice(0, 80),
          styles: Object.entries(element.styles)
            .map(([key, value]) => `${key}: ${value}`)
            .join("; "),
        }),
      ),
      ...annotate.notes.filter((note) => note.text.trim()).map((note, index) => `${index + 1}. ${note.text.trim()}`),
    ].filter(Boolean)
    const text = lines.join("\n")
    const end = parts.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)
    if (text) parts.push({ type: "text", content: `\n${text}\n`, start: end, end: end + text.length + 2 })
    prompt.set(parts, end + text.length + 2)
    setPicked([])
    stopAnnotate()
  }

  return (
    <Show
      when={browser}
      fallback={<div class="px-6 py-4 text-13-regular text-v2-text-text-weak">{language.t("secondBrain.browser.desktopOnly")}</div>}
    >
      <div class="flex h-full min-h-0 flex-col gap-2 px-3 pb-3" data-component="browser-tab">
        <form class="flex items-center gap-1" onSubmit={go}>
          <IconButtonV2
            icon={<Icon name="arrow-left" />}
            variant="ghost"
            size="small"
            aria-label={language.t("secondBrain.browser.back")}
            disabled={!page.canGoBack}
            onClick={() => void browser!.history("back")}
          />
          <IconButtonV2
            icon={<Icon name="chevron-right" />}
            variant="ghost"
            size="small"
            aria-label={language.t("secondBrain.browser.forward")}
            disabled={!page.canGoForward}
            onClick={() => void browser!.history("forward")}
          />
          <IconButtonV2
            icon={<Icon name="reset" />}
            variant="ghost"
            size="small"
            aria-label={language.t("secondBrain.browser.reload")}
            onClick={() => void browser!.history("reload")}
          />
          <label for="browser-address" class="sr-only">
            {language.t("secondBrain.browser.address")}
          </label>
          <input
            id="browser-address"
            class="h-8 min-w-0 flex-1 rounded-full bg-v2-background-bg-layer-01 px-3 font-mono text-12-regular outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
            placeholder={language.t("secondBrain.browser.address.placeholder")}
            value={address()}
            onInput={(event) => setAddress(event.currentTarget.value)}
            spellcheck={false}
          />
        </form>
        <div class="flex flex-wrap items-center gap-1" role="toolbar" aria-label={language.t("secondBrain.browser.tools")}>
          <ButtonV2
            size="small"
            variant="ghost"
            data-action="browser-select"
            disabled={annotate.active || !page.url}
            onClick={() => void pick()}
          >
            {language.t("secondBrain.browser.select")}
          </ButtonV2>
          <Show
            when={annotate.active}
            fallback={
              <ButtonV2
                size="small"
                variant="ghost"
                data-action="browser-annotate"
                disabled={!page.url}
                onClick={() => void startAnnotate()}
              >
                {language.t("secondBrain.browser.annotate")}
              </ButtonV2>
            }
          >
            <For each={["pen", "region", "note"] as const}>
              {(tool) => (
                <ButtonV2
                  size="small"
                  variant={annotate.tool === tool ? "tonal" : "ghost"}
                  data-action={`browser-tool-${tool}`}
                  aria-pressed={annotate.tool === tool}
                  onClick={() => setAnnotate("tool", tool)}
                >
                  {language.t(`secondBrain.browser.tool.${tool}`)}
                </ButtonV2>
              )}
            </For>
            <ButtonV2 size="small" variant="ghost" onClick={stopAnnotate}>
              {language.t("secondBrain.browser.annotate.cancel")}
            </ButtonV2>
          </Show>
          <span class="flex-1" />
          <span
            class="rounded-full bg-v2-background-bg-layer-02 px-2 py-0.5 text-11-medium text-v2-text-text-weak"
            title={language.t("secondBrain.browser.agentTools.description")}
          >
            {language.t("secondBrain.browser.agentTools")}
          </span>
        </div>
        <div
          ref={stage}
          class="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-v2-border-border-base bg-white"
        >
          <Show when={!page.url && !annotate.active}>
            <div class="absolute inset-0 flex items-center justify-center p-6 text-center text-13-regular text-neutral-500">
              {language.t("secondBrain.browser.empty")}
            </div>
          </Show>
          <Show when={annotate.active}>
            <img
              src={annotate.shot}
              alt=""
              class="pointer-events-none absolute inset-0 h-full w-full object-contain object-left-top"
            />
            <svg class="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              <For each={annotate.strokes}>
                {(stroke) => (
                  <polyline
                    points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="#e5484d"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                )}
              </For>
              <Show when={annotate.region}>
                {(region) => (
                  <rect
                    x={region().x}
                    y={region().y}
                    width={region().width}
                    height={region().height}
                    fill="none"
                    stroke="#3b5cf6"
                    stroke-width="2"
                  />
                )}
              </Show>
            </svg>
            <canvas
              ref={canvas}
              class="absolute inset-0 h-full w-full"
              style={{ cursor: annotate.tool === "note" ? "copy" : "crosshair" }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
            />
            <For each={annotate.notes}>
              {(note, index) => (
                <input
                  class="absolute w-40 rounded-md bg-[#fff7d6] px-2 py-1 text-12-regular text-[#3b3200] shadow"
                  style={{ left: `${note.x}px`, top: `${note.y - 14}px` }}
                  aria-label={language.t("secondBrain.browser.note", { index: index() + 1 })}
                  value={note.text}
                  ref={(el) => queueMicrotask(() => el.focus())}
                  onInput={(event) => setAnnotate("notes", index(), "text", event.currentTarget.value)}
                />
              )}
            </For>
          </Show>
        </div>
        <Show when={picked.length > 0 || annotate.active}>
          <div class="flex flex-wrap items-center gap-2 rounded-xl bg-v2-background-bg-layer-01 px-3 py-2 text-12-regular text-v2-text-text-weak">
            <span class="min-w-0 flex-1 truncate">
              {language.t("secondBrain.browser.tray", { elements: picked.length, notes: annotate.notes.length })}
            </span>
            <ButtonV2 size="small" variant="tonal" data-action="browser-send" onClick={() => void send()}>
              {language.t("secondBrain.browser.send")}
            </ButtonV2>
          </div>
        </Show>
        <Show when={activity.length > 0}>
          <div
            class="max-h-20 overflow-auto rounded-xl bg-v2-background-bg-layer-01 px-3 py-2 font-mono text-11-regular text-v2-text-text-weak"
            aria-label={language.t("secondBrain.browser.activity")}
          >
            <For each={activity.slice(-8)}>{(line) => <div>{line}</div>}</For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
