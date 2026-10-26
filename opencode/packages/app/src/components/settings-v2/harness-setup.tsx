import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Harness } from "@opencode-ai/schema/harness"
import { useQueryClient } from "@tanstack/solid-query"
import { type Component, For, Show, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Terminal } from "@/components/terminal"
import { harnessSettingsChanged } from "@/components/prompt-input/harness-controller"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { installHarness, listHarnessSetup, removeHarnessApiKey, setHarnessApiKey, signInHarness } from "@/utils/server"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

/**
 * Day-one setup of the built-in external agents (Codex, Claude Code, OpenCode): install each CLI, then
 * sign in with the agent's own login or give it an API key. Custom ACP agents are added in Settings.
 */
export const DialogHarnessSetup: Component<{ directory: string; onClose?: () => void }> = (props) => (
  <SDKProvider directory={props.directory}>
    <HarnessSetup {...props} />
  </SDKProvider>
)

const HarnessSetup: Component<{ directory: string; onClose?: () => void }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const serverSdk = useServerSDK()
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const server = () => ({ server: serverSdk().server.http, fetch: platform.fetch })
  const [statuses, { mutate, refetch }] = createResource(() => listHarnessSetup(server(), props.directory))
  const [state, setState] = createStore({
    busy: undefined as string | undefined,
    keyOpen: undefined as string | undefined,
    keyOption: "",
    keyValue: "",
    terminal: undefined as { harness: string; id: string } | undefined,
  })

  // A sign-in in the browser or a terminal finishes outside this dialog, so check again while it is open.
  const poll = setInterval(() => {
    if (!state.busy) void refetch()
  }, 5_000)
  onCleanup(() => clearInterval(poll))

  const changed = (next: Harness.SetupStatus) => {
    mutate((current) => current?.map((item) => (item.id === next.id ? next : item)))
    harnessSettingsChanged()
    void queryClient.invalidateQueries({ queryKey: ["home", "harnesses"] })
  }

  const run = (id: string, action: () => Promise<unknown>) => {
    if (state.busy) return
    setState("busy", id)
    void action()
      .catch((error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setState("busy", undefined))
  }

  const install = (item: Harness.SetupStatus) =>
    run(item.id, async () => {
      changed(await installHarness(server(), props.directory, item.id))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("harness.setup.installed", { name: item.name }),
      })
    })

  const signIn = (item: Harness.SetupStatus) =>
    item.signIn === "terminal"
      ? openTerminal(item)
      : run(item.id, async () => {
          const result = await signInHarness(server(), props.directory, item.id)
          platform.openExternal(result.url)
          showToast({ title: language.t("harness.setup.browser", { name: item.name }) })
        })

  const legacyPty = async () => (await sdk().protocol) === "v1" || (await sdk().legacyProjectsAndMcp)
  const openTerminal = (item: Harness.SetupStatus) =>
    run(item.id, async () => {
      const [command, ...args] = item.login ?? []
      if (!command) return
      const title = language.t("harness.setup.terminalTitle", { name: item.name })
      // Terminal connects through the legacy routes on servers that still serve them, so create it there too.
      const id = (await legacyPty())
        ? (await sdk().client.pty.create({ command, args, title }, { throwOnError: true })).data.id
        : (await sdk().api.pty.create({ location: { directory: props.directory }, command, args, title })).data.id
      setState("terminal", { harness: item.id, id })
    })

  const closeTerminal = () => {
    const current = state.terminal
    if (!current) return
    setState("terminal", undefined)
    void legacyPty()
      .then(async (legacy) => {
        if (legacy) await sdk().client.pty.remove({ ptyID: current.id })
        else await sdk().api.pty.remove({ ptyID: current.id, location: { directory: props.directory } })
      })
      .catch(() => undefined)
    void refetch()
  }
  onCleanup(closeTerminal)

  const openKey = (item: Harness.SetupStatus) =>
    setState({
      keyOpen: state.keyOpen === item.id ? undefined : item.id,
      keyOption: item.apiKey ?? item.apiKeys[0]?.id ?? "",
      keyValue: "",
    })

  const saveKey = (item: Harness.SetupStatus) =>
    run(item.id, async () => {
      changed(
        await setHarnessApiKey(server(), props.directory, item.id, { option: state.keyOption, key: state.keyValue }),
      )
      setState({ keyOpen: undefined, keyValue: "" })
    })

  const removeKey = (item: Harness.SetupStatus) =>
    run(item.id, async () => changed(await removeHarnessApiKey(server(), props.directory, item.id)))

  const close = () => {
    dialog.close()
    props.onClose?.()
  }

  const statusText = (item: Harness.SetupStatus) => {
    if (!item.installed) return language.t("harness.setup.status.notInstalled")
    if (item.auth === "api-key") return language.t("harness.setup.status.apiKey")
    if (item.auth === "signed-in") return language.t("harness.setup.status.signedIn")
    if (item.auth === "unknown") return language.t("harness.setup.status.unknown")
    return language.t("harness.setup.status.signedOut")
  }

  return (
    <Dialog fit class="settings-v2-server-dialog settings-v2-harness-setup">
      <DialogHeader>
        <DialogTitle>{language.t("harness.setup.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-full min-w-0 flex-col gap-3 px-4 pt-2 pb-2">
        <span class="settings-v2-harness-detail">{language.t("harness.setup.description")}</span>
        <Show when={statuses.error}>
          <span class="settings-v2-harness-detail" role="alert">
            {statuses.error instanceof Error ? statuses.error.message : language.t("harness.probeFailed")}
          </span>
        </Show>
        <Show when={statuses.loading && !statuses.latest}>
          <span class="settings-v2-harness-detail">{language.t("harness.setup.checking")}</span>
        </Show>
        <For each={statuses.latest ?? []}>
          {(item) => (
            <section class="settings-v2-harness-setup-card" data-harness={item.id} data-installed={item.installed}>
              <header class="settings-v2-harness-setup-head">
                <div class="settings-v2-provider-copy">
                  <h3 class="settings-v2-harness-name">{item.name}</h3>
                  <span class="settings-v2-provider-description">
                    {[
                      statusText(item),
                      item.version ? language.t("harness.settings.version", { version: item.version }) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div class="settings-v2-harness-controls">
                  <Show
                    when={item.installed}
                    fallback={
                      <ButtonV2 size="normal" variant="neutral" disabled={!!state.busy} onClick={() => install(item)}>
                        {state.busy === item.id
                          ? language.t("harness.setup.installing")
                          : language.t("harness.setup.install")}
                      </ButtonV2>
                    }
                  >
                    <ButtonV2 size="normal" variant="ghost" disabled={!!state.busy} onClick={() => openKey(item)}>
                      {language.t("harness.setup.apiKey")}
                    </ButtonV2>
                    <ButtonV2 size="normal" variant="neutral" disabled={!!state.busy} onClick={() => signIn(item)}>
                      {item.auth === "signed-in"
                        ? language.t("harness.setup.signInAgain")
                        : language.t("harness.setup.signIn")}
                    </ButtonV2>
                  </Show>
                </div>
              </header>

              <Show when={!item.installed}>
                <span class="settings-v2-harness-detail">
                  {language.t("harness.setup.installHint", { package: item.packageName })}
                </span>
              </Show>
              <Show when={item.installed && item.error}>
                <span class="settings-v2-harness-detail" role="alert">
                  {item.error}
                </span>
              </Show>

              <Show when={state.keyOpen === item.id}>
                <form
                  class="settings-v2-harness-setup-key"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (state.keyValue.trim()) saveKey(item)
                  }}
                >
                  <Show when={item.apiKeys.length > 1}>
                    <SelectV2
                      aria-label={language.t("harness.setup.keyProvider")}
                      options={item.apiKeys.map((option) => option.id)}
                      current={state.keyOption}
                      label={(id) => item.apiKeys.find((option) => option.id === id)?.label ?? id}
                      onSelect={(id) => id && setState("keyOption", id)}
                    />
                  </Show>
                  <TextInputV2
                    type="password"
                    autocomplete="off"
                    aria-label={item.apiKeys.find((option) => option.id === state.keyOption)?.label}
                    placeholder={item.apiKeys.find((option) => option.id === state.keyOption)?.label}
                    value={state.keyValue}
                    onInput={(event) => setState("keyValue", event.currentTarget.value)}
                  />
                  <ButtonV2
                    type="submit"
                    size="normal"
                    variant="neutral"
                    disabled={!!state.busy || !state.keyValue.trim()}
                  >
                    {language.t("harness.setup.saveKey")}
                  </ButtonV2>
                  <Show when={item.auth === "api-key" || (item.id === Harness.Codex && item.auth === "signed-in")}>
                    <ButtonV2
                      type="button"
                      size="normal"
                      variant="ghost"
                      disabled={!!state.busy}
                      onClick={() => removeKey(item)}
                    >
                      {item.id === Harness.Codex
                        ? language.t("harness.setup.signOut")
                        : language.t("harness.setup.removeKey")}
                    </ButtonV2>
                  </Show>
                </form>
              </Show>

              <Show when={state.terminal?.harness === item.id ? state.terminal : undefined} keyed>
                {(terminal) => (
                  <div class="settings-v2-harness-setup-terminal">
                    <span class="settings-v2-harness-detail">{language.t("harness.setup.terminalHint")}</span>
                    <div class="settings-v2-harness-setup-terminal-view">
                      <Terminal
                        pty={{ id: terminal.id, title: item.name, titleNumber: 0 }}
                        autoFocus
                        class="!px-[10px]"
                      />
                    </div>
                    <ButtonV2 size="normal" variant="ghost" onClick={closeTerminal}>
                      {language.t("harness.setup.terminalDone")}
                    </ButtonV2>
                  </div>
                )}
              </Show>
            </section>
          )}
        </For>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 size="normal" variant="neutral" onClick={close}>
          {language.t("harness.setup.done")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
