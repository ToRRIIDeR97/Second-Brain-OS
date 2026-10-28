import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { getFilename } from "@opencode-ai/core/util/path"
import { createDirectorySearch } from "@/components/directory-picker-domain"
import { directoryPickerKind } from "@/components/directory-picker-policy"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { ServerConnection } from "@/context/server"
import { linkFolderErrorKey } from "./project-folder-error"

/**
 * Add a folder from anywhere as a Project of the workspace. A modal over the current page: type or paste
 * a path (with folder suggestions from the server), or browse with the system picker where there is one.
 */
export function DialogAddProject(props: { server: ServerConnection.Any; onAdd: (folder: string) => Promise<unknown> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const global = useGlobal()
  const ctx = global.ensureServerCtx(props.server)
  const [state, setState] = createStore({ path: "", busy: false, error: "" })
  const home = () => ctx.sync.data.path.home || ""
  const search = createDirectorySearch({ sdk: ctx.sdk, home, base: () => home() || ctx.sync.data.path.directory })
  // An object source so an empty field still asks: it lists the folders in the home folder.
  const [suggestions] = createResource(
    () => ({ value: state.path.trim() }),
    async (input) => (await search(input.value)).slice(0, 6),
    { initialValue: [] },
  )
  // The system folder picker only sees this computer, so it is offered for a local server on desktop.
  const nativeBrowse = () => directoryPickerKind(platform.platform, props.server) === "native"

  const browse = () => {
    if (platform.platform !== "desktop") return
    void platform
      .openDirectoryPickerDialog({ title: language.t("secondBrain.sidebar.addProject.title") })
      .then((result) => {
        const folder = Array.isArray(result) ? result[0] : result
        if (folder) setState({ path: folder, error: "" })
      })
  }

  const submit = () => {
    const folder = state.path.trim()
    if (!folder || state.busy) return
    setState({ busy: true, error: "" })
    void props
      .onAdd(folder)
      .then(() => dialog.close())
      .catch((cause: unknown) => setState("error", language.t(linkFolderErrorKey(cause))))
      .finally(() => setState("busy", false))
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("secondBrain.sidebar.addProject.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(520px,calc(100vw-32px))] flex-col gap-3 px-4 pb-2">
        <p class="text-[13px] text-v2-text-text-muted">{language.t("secondBrain.sidebar.addProject.description")}</p>
        <form
          class="flex min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div class="min-w-0 flex-1">
            <TextInputV2
              autofocus
              class="!w-full"
              value={state.path}
              spellcheck={false}
              autocomplete="off"
              aria-label={language.t("secondBrain.sidebar.addProject.path")}
              placeholder={language.t("secondBrain.sidebar.addProject.placeholder")}
              invalid={!!state.error}
              onInput={(event) => setState({ path: event.currentTarget.value, error: "" })}
            />
          </div>
          <Show when={nativeBrowse()}>
            <ButtonV2 type="button" variant="neutral" disabled={state.busy} onClick={browse}>
              {language.t("secondBrain.sidebar.addProject.browse")}
            </ButtonV2>
          </Show>
        </form>
        <Show when={suggestions.latest.length > 0}>
          <ul
            class="flex max-h-48 flex-col overflow-auto"
            aria-label={language.t("secondBrain.sidebar.addProject.suggestions")}
          >
            <For each={suggestions.latest}>
              {(folder) => (
                <li>
                  <button
                    type="button"
                    class="flex h-8 w-full min-w-0 items-center gap-2 rounded-[10px] px-2 text-left text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
                    onClick={() => setState({ path: folder, error: "" })}
                  >
                    <Icon name="folder" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <span class="shrink-0 text-v2-text-text-base">{getFilename(folder)}</span>
                    {/* Long paths keep their end visible: the start is what the name already implies. */}
                    <span
                      class="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-v2-text-text-faint [direction:rtl]"
                      title={folder}
                    >
                      <bdi>{folder}</bdi>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={state.error}>
          <p role="alert" class="text-[12px] text-v2-text-text-critical">
            {state.error}
          </p>
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={state.busy || !state.path.trim()} onClick={submit}>
          {language.t("secondBrain.sidebar.addProject.submit")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

/** Confirms taking a Project off the workspace's list. Only the list changes; its folder and files stay on disk. */
export function DialogRemoveProject(props: { name: string; onRemove: () => Promise<unknown> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore({ busy: false })
  const remove = () => {
    setState("busy", true)
    void props
      .onRemove()
      .then(() => dialog.close())
      .finally(() => setState("busy", false))
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("secondBrain.sidebar.removeProject.title", { name: props.name })}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-[min(440px,calc(100vw-32px))] flex-col gap-3 px-4 pb-2">
        <p class="text-[13px] text-v2-text-text-muted">{language.t("secondBrain.sidebar.removeProject.description")}</p>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={state.busy} onClick={remove}>
          {language.t("secondBrain.sidebar.removeProject.confirm")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
