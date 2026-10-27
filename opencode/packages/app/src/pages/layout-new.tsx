import { useLocation } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { ViewSwitch } from "@opencode-ai/ui/v2/view-switch"
import { createEffect, createMemo, ErrorBoundary, on, Suspense, untrack, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { PageEmpty, PageFrame } from "@/components/page"
import { DebugBar } from "@/components/debug-bar"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { SecondBrainSidebar } from "@/components/second-brain-sidebar"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { nextPageMotionKey, routeSection, type PageMotionKey } from "./page-motion"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const location = useLocation()
  const [state, setState] = createStore({ debugTools: true })
  // Derived in the same pass as the route outlet, so the fade-through always freezes the outgoing page.
  const pageKey = createMemo<PageMotionKey>((previous) => nextPageMotionKey(previous, location.pathname), {
    section: routeSection(untrack(() => location.pathname)),
    count: 0,
  })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <div class="flex flex-1 min-h-0 min-w-0">
        <SecondBrainSidebar />
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          {/* A failed page request shows a retryable message here and keeps the sidebar usable. */}
          <ErrorBoundary fallback={(error, reset) => <PageError error={error} reset={reset} />}>
            <Suspense>
              <ViewSwitch key={pageKey().count} class="flex min-h-0 min-w-0 w-full flex-1 flex-col items-start">
                {props.children}
              </ViewSwitch>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <ToastRegion v2 />
    </div>
  )
}

function PageError(props: { error: unknown; reset: () => void }) {
  const language = useLanguage()
  const location = useLocation()
  // Navigating to another page leaves the failed one behind.
  createEffect(on(() => location.pathname, props.reset, { defer: true }))
  console.error("[page] render failed", props.error instanceof Error ? props.error.message : props.error)
  return (
    <PageFrame>
      <PageEmpty
        action={
          <ButtonV2 variant="outline" onClick={props.reset}>
            {language.t("secondBrain.error.retry")}
          </ButtonV2>
        }
      >
        {language.t("secondBrain.error.request")}
      </PageEmpty>
    </PageFrame>
  )
}
