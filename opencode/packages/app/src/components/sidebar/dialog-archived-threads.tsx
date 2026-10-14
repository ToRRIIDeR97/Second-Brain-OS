import type { Session } from "@opencode-ai/sdk/v2/client"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { createResource, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { SidebarController, SidebarProjectItem } from "@/components/sidebar/sidebar-controller"
import { sessionTitle } from "@/utils/session-title"
import { showToast } from "@/utils/toast"
import { errorMessage } from "@/pages/layout/helpers"

export function DialogArchivedThreads(props: { ctrl: SidebarController; project: SidebarProjectItem }) {
  const language = useLanguage()
  const [threads, { mutate }] = createResource(() => props.ctrl.listArchivedThreads(props.project))

  const unarchive = (session: Session) =>
    props.ctrl
      .unarchiveThread(session)
      .then(() => mutate((items) => items?.filter((item) => item.id !== session.id)))
      .catch((cause: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        }),
      )

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("secondBrain.sidebar.archivedThreads")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex max-h-[min(480px,calc(100vh-160px))] w-[min(440px,calc(100vw-32px))] flex-col gap-1 overflow-y-auto px-4 pb-4">
        <Show when={threads.error}>
          <p class="py-2 text-[13px] text-v2-text-text-faint">{language.t("common.requestFailed")}</p>
        </Show>
        <Show when={threads.state === "ready" && threads()?.length === 0}>
          <p class="py-2 text-[13px] text-v2-text-text-faint">{language.t("secondBrain.sidebar.noArchivedThreads")}</p>
        </Show>
        <For each={threads.state === "ready" ? threads() : []}>
          {(session) => (
            <div
              data-archived-thread={session.id}
              class="flex h-11 min-w-0 items-center gap-2 rounded-full pl-3 pr-1 transition-colors duration-150 ease-standard hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none"
            >
              <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base">
                {sessionTitle(session.title) || session.id}
              </span>
              <ButtonV2 type="button" variant="neutral" size="small" onClick={() => void unarchive(session)}>
                {language.t("secondBrain.sidebar.unarchive")}
              </ButtonV2>
            </div>
          )}
        </For>
      </DialogBody>
    </Dialog>
  )
}
