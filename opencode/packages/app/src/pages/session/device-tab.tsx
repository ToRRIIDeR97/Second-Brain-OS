import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { For, Show, createMemo, createResource, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform, type DeviceInfo } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import type { ImageAttachmentPart } from "@/context/prompt-state"
import { createBlobReference } from "@/utils/draft-store"
import { uuid } from "@/utils/uuid"

// The screen refreshes this often while the tab is open; adb screencap takes a few hundred ms.
const FRAME_MS = 700

/**
 * The Workbench panel's phone: Android emulators and devices on macOS and Windows, the iOS Simulator on
 * macOS. The screen is polled as PNG frames; a click on it is a tap at that point. Agents use the same
 * devices through the tenon MCP server's device tools.
 */
export function SessionDeviceTab() {
  const language = useLanguage()
  const platform = usePlatform()
  const prompt = usePrompt()
  const device = platform.device
  const [status, { refetch }] = createResource(() => device?.status())
  const [state, setState] = createStore({
    os: "android" as DeviceInfo["platform"],
    selected: "",
    frame: "",
    error: "",
    activity: [] as string[],
  })
  const devices = createMemo(() =>
    state.os === "android" ? (status()?.android.devices ?? []) : (status()?.ios.devices ?? []),
  )
  const running = createMemo(() =>
    devices().filter((item) => (item.platform === "android" ? item.state === "device" : item.state === "Booted")),
  )
  const current = createMemo(() => running().find((item) => item.id === state.selected) ?? running()[0])
  const unavailable = createMemo(() => {
    const value = status()
    if (!device) return language.t("secondBrain.device.desktopOnly")
    if (!value) return
    if (state.os === "ios" && !value.ios.supported) return language.t("secondBrain.device.ios.macOnly")
    if (state.os === "android" && !value.android.sdk) return language.t("secondBrain.device.android.noSdk")
  })

  onMount(() => {
    if (!device) return
    let busy = false
    const timer = setInterval(() => {
      const target = current()
      if (!target || busy || document.hidden) return
      busy = true
      void device
        .screenshot(target.platform, target.id)
        .then(
          (frame) => frame && setState({ frame, error: "" }),
          (cause: unknown) => setState("error", cause instanceof Error ? cause.message : String(cause)),
        )
        .finally(() => (busy = false))
    }, FRAME_MS)
    const off = device.onAgent((event) =>
      setState(
        "activity",
        produce((list) => void list.push(`${new Date().toLocaleTimeString()}  ${event.tool}`)),
      ),
    )
    // Emulators take a while to boot; keep the list current.
    const poll = setInterval(() => void refetch(), 5_000)
    onCleanup(() => {
      clearInterval(timer)
      clearInterval(poll)
      off()
    })
  })

  let image: HTMLImageElement | undefined
  // A click on the shown frame maps to screen pixels on the device.
  const tap = (event: MouseEvent) => {
    const target = current()
    if (!device || !target || !image) return
    const rect = image.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * image.naturalWidth
    const y = ((event.clientY - rect.top) / rect.height) * image.naturalHeight
    void device
      .input(target.platform, target.id, { kind: "tap", x, y })
      .catch((cause: unknown) => setState("error", cause instanceof Error ? cause.message : String(cause)))
  }
  const key = (name: "home" | "back") => {
    const target = current()
    if (target) void device?.input(target.platform, target.id, { kind: "key", key: name })
  }
  const attach = async () => {
    if (!state.frame) return
    const blob = await (await fetch(state.frame)).blob()
    const part: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: `${current()?.name ?? "device"}.png`,
      mime: "image/png",
      blob: await createBlobReference(blob),
    }
    prompt.set([...prompt.current(), part])
  }

  return (
    <div class="flex h-full min-h-0 flex-col gap-2 px-3 pb-3" data-component="device-tab">
      <div class="flex flex-wrap items-center gap-1">
        <div
          class="flex gap-1 rounded-full bg-v2-background-bg-layer-01 p-0.5"
          role="group"
          aria-label={language.t("secondBrain.device.platform")}
        >
          <For each={["android", "ios"] as const}>
            {(os) => (
              <button
                type="button"
                class="h-7 rounded-full px-3 text-12-medium text-v2-text-text-weak aria-pressed:bg-v2-background-bg-base aria-pressed:text-v2-text-text-base"
                aria-pressed={state.os === os}
                data-action={`device-os-${os}`}
                onClick={() => setState({ os, selected: "", frame: "", error: "" })}
              >
                {language.t(os === "android" ? "secondBrain.device.android" : "secondBrain.device.ios")}
              </button>
            )}
          </For>
        </div>
        <Show when={running().length > 1}>
          <select
            class="h-8 rounded-full bg-v2-background-bg-layer-01 px-3 text-12-regular"
            aria-label={language.t("secondBrain.device.select")}
            value={current()?.id}
            onChange={(event) => setState({ selected: event.currentTarget.value, frame: "" })}
          >
            <For each={running()}>{(item) => <option value={item.id}>{item.name}</option>}</For>
          </select>
        </Show>
        <span class="flex-1" />
        <span class="rounded-full bg-v2-background-bg-layer-02 px-2 py-0.5 text-11-medium text-v2-text-text-weak">
          {current() ? current()!.name : language.t("secondBrain.device.none")}
        </span>
      </div>

      <Show
        when={!unavailable()}
        fallback={
          <div
            class="m-auto max-w-80 px-6 text-center text-13-regular leading-6 text-v2-text-text-weak"
            data-slot="device-unavailable"
          >
            {unavailable()}
            <Show when={state.os === "ios" && !status()?.ios.supported && status()?.android.sdk}>
              <div class="pt-3">
                <ButtonV2 size="small" variant="tonal" onClick={() => setState("os", "android")}>
                  {language.t("secondBrain.device.useAndroid")}
                </ButtonV2>
              </div>
            </Show>
          </div>
        }
      >
        <Show
          when={current()}
          fallback={
            <div class="m-auto flex max-w-80 flex-col items-center gap-3 px-6 text-center text-13-regular text-v2-text-text-weak">
              <span>{language.t("secondBrain.device.start")}</span>
              <For each={state.os === "android" ? (status()?.android.avds ?? []) : devices().map((item) => item.id)}>
                {(id) => (
                  <ButtonV2
                    size="small"
                    variant="tonal"
                    onClick={() => void device?.boot(state.os, id).then(() => refetch())}
                  >
                    {state.os === "android" ? id : (devices().find((item) => item.id === id)?.name ?? id)}
                  </ButtonV2>
                )}
              </For>
            </div>
          }
        >
          <div class="flex min-h-0 flex-1 items-center justify-center gap-2">
            <div class="flex h-full max-h-[640px] items-center rounded-[28px] bg-neutral-900 p-2 shadow">
              <Show when={state.frame} fallback={<div class="h-80 w-44 animate-pulse rounded-[22px] bg-neutral-800" />}>
                <img
                  ref={image}
                  src={state.frame}
                  alt={language.t("secondBrain.device.screen", { name: current()!.name })}
                  class="h-full max-h-[620px] cursor-pointer rounded-[22px] object-contain"
                  onClick={tap}
                />
              </Show>
            </div>
            <div class="flex flex-col gap-1" role="toolbar" aria-label={language.t("secondBrain.device.controls")}>
              <ButtonV2 size="small" variant="ghost" onClick={() => key("home")}>
                {language.t("secondBrain.device.home")}
              </ButtonV2>
              <Show when={state.os === "android"}>
                <ButtonV2 size="small" variant="ghost" onClick={() => key("back")}>
                  {language.t("secondBrain.device.back")}
                </ButtonV2>
              </Show>
              <ButtonV2 size="small" variant="ghost" data-action="device-attach" onClick={() => void attach()}>
                {language.t("secondBrain.device.attach")}
              </ButtonV2>
            </div>
          </div>
        </Show>
      </Show>

      <Show when={state.error}>
        <div class="rounded-xl bg-v2-state-bg-danger px-3 py-2 text-12-regular text-v2-state-fg-danger" role="alert">
          {state.error}
        </div>
      </Show>
      <Show when={state.activity.length > 0}>
        <div class="max-h-20 overflow-auto rounded-xl bg-v2-background-bg-layer-01 px-3 py-2 font-mono text-11-regular text-v2-text-text-weak">
          <For each={state.activity.slice(-8)}>{(line) => <div>{line}</div>}</For>
        </div>
      </Show>
    </div>
  )
}
