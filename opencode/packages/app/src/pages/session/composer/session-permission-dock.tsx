import { For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  return (
    <section
      data-component="dock-prompt"
      data-kind="permission"
      aria-labelledby="permission-dock-title"
      class="mb-2 rounded-[24px] bg-v2-background-bg-base px-4 pt-4 pb-3 shadow-[0_0_0_0.5px_var(--v2-border-border-muted),0_8px_24px_-12px_rgb(0_0_0/0.18)] animate-in fade-in slide-in-from-bottom-1 duration-300 ease-emphasized motion-reduce:animate-none"
    >
      <div class="flex items-center gap-2.5">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-warning-weak text-icon-warning-base">
          <Icon name="warning" size="normal" />
        </span>
        <h2 id="permission-dock-title" class="min-w-0 text-[14px] leading-5 text-v2-text-text-base [font-weight:530]">
          {language.t("notification.permission.title")}
        </h2>
      </div>

      <Show when={toolDescription()}>
        <p class="mt-1 pl-[42px] text-[13px] leading-5 text-v2-text-text-muted">{toolDescription()}</p>
      </Show>

      <Show when={props.request.patterns.length > 0}>
        <div class="mt-3 ml-[42px] flex max-h-40 flex-col gap-1 overflow-y-auto rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2 no-scrollbar">
          <For each={props.request.patterns}>
            {(pattern) => <code class="text-12-regular text-v2-text-text-base break-all">{pattern}</code>}
          </For>
        </div>
      </Show>

      <div data-slot="permission-footer-actions" class="mt-4 justify-end">
        <ButtonV2 variant="ghost" onClick={() => props.onDecide("reject")} disabled={props.responding}>
          {language.t("ui.permission.deny")}
        </ButtonV2>
        <ButtonV2 variant="neutral" onClick={() => props.onDecide("always")} disabled={props.responding}>
          {language.t("ui.permission.allowAlways")}
        </ButtonV2>
        <ButtonV2 variant="contrast" onClick={() => props.onDecide("once")} disabled={props.responding}>
          {language.t("ui.permission.allowOnce")}
        </ButtonV2>
      </div>
    </section>
  )
}
