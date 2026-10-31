import { useDialog } from "@opencode-ai/ui/context/dialog"
import { pagePanelClass } from "@/components/page"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Show, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import createPresence from "solid-presence"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import { PromptGitStatus, PromptWorkspaceSelector } from "@/components/prompt-workspace-selector"
import {
  PromptProjectAddButton,
  PromptProjectSelector,
  type PromptProjectController,
} from "@/components/prompt-project-selector"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useProviders } from "@/hooks/use-providers"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { Persist, persisted } from "@/utils/persist"
import type { NewSessionDraftController } from "./new-session-draft-controller"
import type { NewSessionWorkspaceController } from "./new-session-workspace-controller"
import { Harness } from "@opencode-ai/schema/harness"

const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000
// Local, single-user app for now; replace with the signed-in profile name when there is one.
const userName = "Nat"
const greetingPrompts = [1, 2, 3, 4, 5] as const
const greetingInterval = 6000

export function NewSessionView(props: {
  input: NewSessionDraftController["input"]
  harness: NewSessionDraftController["harness"]
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
}) {
  return (
    <div class="@container relative flex flex-col min-h-0 h-full flex-1">
      <div data-component="session-new-design" class={`relative flex-1 min-h-0 overflow-hidden ${pagePanelClass}`}>
        <div class="absolute inset-0 flex items-center justify-center px-6 pb-[12vh]">
          <div class={NEW_SESSION_CONTENT_WIDTH}>
            {/* The composer's own 0.5px border-muted edge vanishes on the dark panel; give it a 1px ring here. */}
            <div class="flex flex-col gap-6 [&_[data-component=prompt-input-v2]]:shadow-[0_0_0_1px_var(--v2-border-border-base),0_8px_24px_-12px_rgb(0_0_0/0.18)]">
              <Greeting />
              <PromptInputV2Composer controller={props.input} harness={props.harness} />
              <Show when={props.project.empty()}>
                <PromptProjectAddButton controller={props.project} />
              </Show>
              <Show when={props.project.selected()}>
                <div class="flex min-h-7 min-w-0 flex-col items-center justify-center gap-0 text-v2-text-text-faint sm:flex-row">
                  <PromptProjectSelector controller={props.project} placement="bottom" />
                  <Show
                    when={props.workspace.bar.visible()}
                    fallback={
                      <PromptGitStatus branch={props.workspace.bar.branch()} noGit={!props.workspace.project.git()} />
                    }
                  >
                    <PromptWorkspaceSelector
                      value={props.workspace.selection.value()}
                      projectRoot={props.workspace.project.root()}
                      branch={props.workspace.bar.branch()}
                      onChange={props.workspace.selection.set}
                      onDone={props.input.restoreFocus}
                    />
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </div>
        <Show when={props.harness.instance()?.driver === Harness.OpenCodeDriver}>
          <ProviderTip />
        </Show>
      </div>
    </div>
  )
}

function Greeting() {
  const language = useLanguage()
  const [index, setIndex] = createSignal(Math.floor(Math.random() * greetingPrompts.length))
  const timer = setInterval(() => setIndex((value) => (value + 1) % greetingPrompts.length), greetingInterval)
  onCleanup(() => clearInterval(timer))

  return (
    <div data-component="new-thread-greeting" class="flex flex-col items-center gap-1 text-center">
      <p class="text-[14px] text-v2-text-text-faint">
        {language.t("secondBrain.newThread.welcome", { name: userName })}
      </p>
      <Show when={greetingPrompts[index()]} keyed>
        {(prompt) => (
          <h1 class="animate-enter text-[28px] leading-9 tracking-[-0.4px] text-v2-text-text-base [font-weight:500]">
            {language.t(`secondBrain.newThread.prompt.${prompt}`)}
          </h1>
        )}
      </Show>
    </div>
  )
}

export function NewSessionStatus(props: { mount: Accessor<HTMLElement | null>; visible: Accessor<boolean> }) {
  const language = useLanguage()

  return (
    <Show when={props.mount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <Show when={props.visible()}>
            <TooltipV2 placement="bottom" value={language.t("status.popover.trigger")}>
              <StatusPopoverV2 />
            </TooltipV2>
          </Show>
        </Portal>
      )}
    </Show>
  )
}

function ProviderTip() {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const providers = useProviders(() => sdk().directory)
  const [persistedState, setPersistedState, , persistedReady] = persisted(
    Persist.global("new-session.provider-tip"),
    createStore({ dismissedAt: 0 }),
  )
  const visible = createMemo(
    () =>
      serverSync().child(sdk().directory)[0].provider_ready &&
      persistedReady() &&
      providers.paid().length === 0 &&
      Date.now() - persistedState.dismissedAt >= providerTipDismissalDuration,
  )
  const [ref, setRef] = createSignal<HTMLDivElement>()
  const presence = createPresence({
    show: visible,
    element: () => ref() ?? null,
  })
  const openProviders = () => {
    void import("@/components/dialog-connect-provider").then(({ DialogConnectProvider }) => {
      void dialog.show(() => <DialogConnectProvider directory={() => sdk().directory} />)
    })
  }

  return (
    <Show when={presence.present()}>
      <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-10">
        <div
          ref={setRef}
          data-component="provider-tip"
          data-visible={visible()}
          class="group/provider-tip pointer-events-auto relative flex h-8 max-w-full items-center"
          classList={{ "animate-enter": visible(), "animate-exit": !visible() }}
        >
          <button
            type="button"
            class="flex h-8 min-w-0 items-center rounded-full pl-3.5 pr-1.5 text-[13px] leading-none tracking-[-0.04px] text-v2-text-text-faint transition-[background-color,color] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
            onClick={openProviders}
          >
            <span class="truncate">{language.t("home.providerTip")}</span>
            <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
              <IconV2 name="chevron-down" size="small" class="-rotate-90" />
            </span>
          </button>
          <TooltipV2
            class="hover-reveal absolute left-full top-0 flex h-8 w-9 items-center justify-end delay-0 duration-0 group-hover/provider-tip:delay-[250ms] group-hover/provider-tip:duration-short group-hover/provider-tip:opacity-100 focus-within:delay-0 focus-within:duration-0 focus-within:opacity-100"
            placement="top"
            openDelay={1000}
            value={language.t("common.dismiss")}
          >
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-full text-v2-icon-icon-muted transition-[background-color,color] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
              aria-label={language.t("common.dismiss")}
              onClick={() => setPersistedState("dismissedAt", Date.now())}
            >
              <IconV2 name="xmark-small" />
            </button>
          </TooltipV2>
        </div>
      </div>
    </Show>
  )
}
