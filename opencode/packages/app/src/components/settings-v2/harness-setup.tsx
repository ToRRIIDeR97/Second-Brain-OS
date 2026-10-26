import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { DialogBody, DialogHeader, DialogTitle, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Harness } from "@opencode-ai/schema/harness"
import { useQueryClient } from "@tanstack/solid-query"
import { type Component, For, type JSX, Match, Show, Switch, createResource, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Terminal } from "@/components/terminal"
import { filledFieldClass } from "@/components/surface-classes"
import { harnessSettingsChanged } from "@/components/prompt-input/harness-controller"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { installHarness, listHarnessSetup, removeHarnessApiKey, setHarnessApiKey, signInHarness } from "@/utils/server"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

const ICON_SIZE = 16
const harnessIcon = (id: string) =>
  id === Harness.Codex ? "openai" : id === Harness.ClaudeCode ? "anthropic" : "opencode"

/** State and actions shared by every setup layout. Needs an SDKProvider for the sign-in terminal. */
function createHarnessSetup(directory: string) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSdk = useServerSDK()
  const sdk = useSDK()
  const queryClient = useQueryClient()
  const server = () => ({ server: serverSdk().server.http, fetch: platform.fetch })
  const [statuses, { mutate, refetch }] = createResource(() => listHarnessSetup(server(), directory))
  const [state, setState] = createStore({
    busy: undefined as string | undefined,
    keyOption: "",
    keyValue: "",
    terminal: undefined as { harness: string; id: string } | undefined,
  })

  // A sign-in in the browser or a terminal finishes outside the app, so check again while setup is open.
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
    if (state.busy) return Promise.resolve(false)
    setState("busy", id)
    return action()
      .then(() => true)
      .catch((error: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
        return false
      })
      .finally(() => setState("busy", undefined))
  }

  // The Terminal component connects through the legacy PTY routes on servers that still serve them.
  const legacyPty = async () => (await sdk().protocol) === "v1" || (await sdk().legacyProjectsAndMcp)

  const closeTerminal = () => {
    const current = state.terminal
    if (!current) return
    setState("terminal", undefined)
    void legacyPty()
      .then(async (legacy) => {
        if (legacy) await sdk().client.pty.remove({ ptyID: current.id })
        else await sdk().api.pty.remove({ ptyID: current.id, location: { directory } })
      })
      .catch(() => undefined)
    void refetch()
  }
  onCleanup(closeTerminal)

  return {
    statuses,
    state,
    find: (id: string) => statuses.latest?.find((item) => item.id === id),
    install: (item: Harness.SetupStatus) =>
      run(item.id, async () => {
        changed(await installHarness(server(), directory, item.id))
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("harness.setup.installed", { name: item.name }),
        })
      }),
    signInLink: (item: Harness.SetupStatus) =>
      run(item.id, async () => {
        const result = await signInHarness(server(), directory, item.id)
        platform.openExternal(result.url)
        showToast({ title: language.t("harness.setup.browser", { name: item.name }) })
      }),
    openTerminal: (item: Harness.SetupStatus) =>
      run(item.id, async () => {
        closeTerminal()
        const [command, ...args] = item.login ?? []
        if (!command) return
        const title = language.t("harness.setup.terminalTitle", { name: item.name })
        const id = (await legacyPty())
          ? (await sdk().client.pty.create({ command, args, title }, { throwOnError: true })).data.id
          : (await sdk().api.pty.create({ location: { directory }, command, args, title })).data.id
        setState("terminal", { harness: item.id, id })
      }),
    closeTerminal,
    startKey: (item: Harness.SetupStatus) =>
      setState({ keyOption: item.apiKey ?? item.apiKeys[0]?.id ?? "", keyValue: "" }),
    setKeyOption: (option: string) => setState("keyOption", option),
    setKeyValue: (value: string) => setState("keyValue", value),
    saveKey: (item: Harness.SetupStatus) =>
      run(item.id, async () => {
        changed(await setHarnessApiKey(server(), directory, item.id, { option: state.keyOption, key: state.keyValue }))
        setState("keyValue", "")
      }),
    removeKey: (item: Harness.SetupStatus) =>
      run(item.id, async () => changed(await removeHarnessApiKey(server(), directory, item.id))),
  }
}

type Setup = ReturnType<typeof createHarnessSetup>

const ready = (item: Harness.SetupStatus) => item.installed && item.auth !== "signed-out"

function statusText(language: ReturnType<typeof useLanguage>, item: Harness.SetupStatus) {
  if (!item.installed) return language.t("harness.setup.status.notInstalled")
  if (item.auth === "api-key") return language.t("harness.setup.status.apiKey")
  if (item.auth === "signed-in") return language.t("harness.setup.status.signedIn")
  if (item.auth === "unknown") return language.t("harness.setup.status.unknown")
  return language.t("harness.setup.status.signedOut")
}

function description(language: ReturnType<typeof useLanguage>, item: Harness.SetupStatus) {
  if (!item.installed) return language.t("harness.setup.installHint", { package: item.packageName })
  // A ready row already shows its status as a tag.
  if (ready(item)) return item.version ? language.t("harness.settings.version", { version: item.version }) : ""
  return [
    statusText(language, item),
    item.version ? language.t("harness.settings.version", { version: item.version }) : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** One harness, in the row layout of Settings → Providers. */
const SetupRow: Component<{ item: Harness.SetupStatus; action: JSX.Element }> = (props) => {
  const language = useLanguage()
  return (
    <div class="settings-v2-provider-row" data-harness={props.item.id}>
      <div class="settings-v2-provider-lead">
        <ProviderIcon
          id={harnessIcon(props.item.id)}
          width={ICON_SIZE}
          height={ICON_SIZE}
          class="settings-v2-provider-icon shrink-0"
        />
        <div class="settings-v2-provider-copy">
          <div class="settings-v2-provider-main">
            <span class="settings-v2-provider-name">{props.item.name}</span>
            <Show when={ready(props.item)}>
              <Tag>{statusText(language, props.item)}</Tag>
            </Show>
          </div>
          <p class="settings-v2-provider-description">{description(language, props.item)}</p>
        </div>
      </div>
      {props.action}
    </div>
  )
}

/** The primary action for a row: install first, otherwise connect. */
const RowAction: Component<{ setup: Setup; item: Harness.SetupStatus; onConnect: () => void }> = (props) => {
  const language = useLanguage()
  return (
    <Show
      when={props.item.installed}
      fallback={
        <ButtonV2
          size="normal"
          variant="ghost"
          class="settings-v2-tonal"
          icon="download"
          disabled={!!props.setup.state.busy}
          onClick={() => void props.setup.install(props.item)}
        >
          {props.setup.state.busy === props.item.id
            ? language.t("harness.setup.installing")
            : language.t("harness.setup.install")}
        </ButtonV2>
      }
    >
      <Show
        when={ready(props.item)}
        fallback={
          <ButtonV2
            size="normal"
            variant="ghost"
            class="settings-v2-tonal"
            icon="plus"
            disabled={!!props.setup.state.busy}
            onClick={props.onConnect}
          >
            {language.t("common.connect")}
          </ButtonV2>
        }
      >
        <ButtonV2 size="normal" variant="ghost-muted" disabled={!!props.setup.state.busy} onClick={props.onConnect}>
          {language.t("harness.setup.manage")}
        </ButtonV2>
      </Show>
    </Show>
  )
}

/** Grouped like Settings → Providers: agents that are ready, then agents still to set up. */
const SetupList: Component<{ setup: Setup; onConnect: (item: Harness.SetupStatus) => void }> = (props) => {
  const language = useLanguage()
  const all = () => props.setup.statuses.latest ?? []
  const section = (title: string, items: () => Harness.SetupStatus[]) => (
    <Show when={items().length > 0}>
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{title}</h3>
        <SettingsListV2>
          <For each={items()}>
            {(item) => (
              <SetupRow
                item={item}
                action={<RowAction setup={props.setup} item={item} onConnect={() => props.onConnect(item)} />}
              />
            )}
          </For>
        </SettingsListV2>
      </div>
    </Show>
  )
  return (
    <>
      <Show when={props.setup.statuses.error}>
        <p class="settings-v2-provider-description" role="alert">
          {props.setup.statuses.error instanceof Error
            ? props.setup.statuses.error.message
            : language.t("harness.probeFailed")}
        </p>
      </Show>
      <Show when={props.setup.statuses.loading && !props.setup.statuses.latest}>
        <p class="settings-v2-provider-description">{language.t("harness.setup.checking")}</p>
      </Show>
      {section(language.t("harness.setup.section.ready"), () => all().filter(ready))}
      {section(language.t("harness.setup.section.todo"), () => all().filter((item) => !ready(item)))}
    </>
  )
}

/** Sign-in and API-key choices for one harness, laid out like the provider Connect dialog. */
const ConnectView: Component<{ setup: Setup; item: Harness.SetupStatus }> = (props) => {
  const language = useLanguage()
  const [view, setView] = createStore({ method: props.item.auth === "api-key" ? "key" : "sign-in" })
  props.setup.startKey(props.item)
  const terminalOpen = () => props.setup.state.terminal?.harness === props.item.id
  const chip = (id: string, label: string) => (
    <button
      type="button"
      aria-pressed={view.method === id}
      class="settings-v2-harness-setup-chip"
      data-selected={view.method === id}
      onClick={() => setView("method", id)}
    >
      {label}
    </button>
  )
  const signInLabel = () =>
    props.item.id === Harness.Codex
      ? language.t("harness.setup.method.chatgpt")
      : props.item.id === Harness.ClaudeCode
        ? language.t("harness.setup.method.claude")
        : language.t("harness.setup.method.opencode")
  return (
    <div class="settings-v2-harness-setup-connect">
      <div class="settings-v2-harness-setup-connect-title">
        <ProviderIcon id={harnessIcon(props.item.id)} width={ICON_SIZE} height={ICON_SIZE} />
        <span>{language.t("harness.setup.connectTitle", { name: props.item.name })}</span>
      </div>
      <p class="settings-v2-harness-setup-connect-copy">
        {language.t("harness.setup.connectDescription", { name: props.item.name })}
      </p>
      <div role="group" class="settings-v2-harness-setup-chips">
        {chip("sign-in", signInLabel())}
        {chip("key", language.t("harness.setup.method.key"))}
      </div>
      <Switch>
        <Match when={view.method === "sign-in" && props.item.signIn === "link"}>
          <p class="settings-v2-harness-setup-connect-copy">
            {language.t("harness.setup.linkHint", { name: props.item.name })}
          </p>
          <div class="settings-v2-harness-setup-actions">
            <ButtonV2
              variant="contrast"
              disabled={!!props.setup.state.busy}
              onClick={() => void props.setup.signInLink(props.item)}
            >
              {language.t("harness.setup.openSignIn")}
            </ButtonV2>
            <Show when={props.item.auth === "signed-in"}>
              <ButtonV2
                variant="ghost-muted"
                disabled={!!props.setup.state.busy}
                onClick={() => void props.setup.removeKey(props.item)}
              >
                {language.t("harness.setup.signOut")}
              </ButtonV2>
            </Show>
          </div>
        </Match>
        <Match when={view.method === "sign-in"}>
          <Show
            when={terminalOpen()}
            fallback={
              <>
                <p class="settings-v2-harness-setup-connect-copy">
                  {language.t("harness.setup.terminalIntro", { name: props.item.name })}
                </p>
                <div class="settings-v2-harness-setup-actions">
                  <ButtonV2
                    variant="contrast"
                    disabled={!!props.setup.state.busy}
                    onClick={() => void props.setup.openTerminal(props.item)}
                  >
                    {language.t("harness.setup.startSignIn")}
                  </ButtonV2>
                </div>
              </>
            }
          >
            <div class="settings-v2-harness-setup-terminal-view">
              <Terminal
                pty={{ id: props.setup.state.terminal!.id, title: props.item.name, titleNumber: 0 }}
                autoFocus
                class="!px-[10px]"
              />
            </div>
            <div class="settings-v2-harness-setup-actions">
              <ButtonV2 variant="ghost-muted" onClick={props.setup.closeTerminal}>
                {language.t("harness.setup.terminalDone")}
              </ButtonV2>
            </div>
          </Show>
        </Match>
        <Match when={view.method === "key"}>
          <form
            class="settings-v2-harness-setup-key"
            onSubmit={(event) => {
              event.preventDefault()
              if (props.setup.state.keyValue.trim()) void props.setup.saveKey(props.item)
            }}
          >
            <Show when={props.item.apiKeys.length > 1}>
              <div role="group" class="settings-v2-harness-setup-chips">
                <For each={props.item.apiKeys}>
                  {(option) => (
                    <button
                      type="button"
                      class="settings-v2-harness-setup-chip"
                      data-size="small"
                      data-selected={props.setup.state.keyOption === option.id}
                      aria-pressed={props.setup.state.keyOption === option.id}
                      onClick={() => props.setup.setKeyOption(option.id)}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <label class="settings-v2-harness-setup-label">
              {props.item.apiKeys.find((option) => option.id === props.setup.state.keyOption)?.label}
              <TextInputV2
                appearance="large"
                class={filledFieldClass}
                type="password"
                autocomplete="off"
                placeholder={language.t("harness.setup.keyPlaceholder")}
                value={props.setup.state.keyValue}
                onInput={(event) => props.setup.setKeyValue(event.currentTarget.value)}
              />
            </label>
            <div class="settings-v2-harness-setup-actions">
              <ButtonV2
                type="submit"
                variant="contrast"
                disabled={!!props.setup.state.busy || !props.setup.state.keyValue.trim()}
              >
                {language.t("common.continue")}
              </ButtonV2>
              <Show when={props.item.auth === "api-key"}>
                <ButtonV2
                  type="button"
                  variant="ghost-muted"
                  disabled={!!props.setup.state.busy}
                  onClick={() => void props.setup.removeKey(props.item)}
                >
                  {language.t("harness.setup.removeKey")}
                </ButtonV2>
              </Show>
            </div>
          </form>
        </Match>
      </Switch>
    </div>
  )
}

/**
 * Day-one setup of the built-in external agents (Codex, Claude Code, OpenCode): install each CLI, then
 * sign in with the agent's own login or give it an API key. Custom ACP agents are added in Settings.
 */
export const DialogHarnessSetup: Component<{ directory: string; harness?: string; onClose?: () => void }> = (props) => (
  <SDKProvider directory={props.directory}>
    <HarnessSetupDialog {...props} />
  </SDKProvider>
)

const HarnessSetupDialog: Component<{ directory: string; harness?: string; onClose?: () => void }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const setup = createHarnessSetup(props.directory)
  const [view, setView] = createStore({ selected: props.harness })
  onCleanup(() => props.onClose?.())
  // Like the provider Connect dialog: focus starts on the body, not on the close button.
  let focusHost: HTMLDivElement | undefined
  onMount(() => focusHost?.focus({ preventScroll: true }))
  const selected = () => (view.selected ? setup.find(view.selected) : undefined)

  return (
    <DialogV2
      containerClass="!h-[min(calc(100vh_-_16px),560px)] !w-[min(calc(100vw_-_16px),640px)]"
      class="[font-family:var(--v2-font-family-sans)] [&_[data-slot=dialog-header]]:!px-5 [&_[data-slot=dialog-header-title]]:!text-[15px] [&_[data-slot=dialog-header-title]]:!tracking-[-0.13px]"
    >
      <DialogHeader closeLabel={language.t("common.close")}>
        <Show when={selected()} fallback={<DialogTitle>{language.t("harness.setup.title")}</DialogTitle>}>
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            class="-my-1"
            icon={<Icon name="chevron-left" />}
            onClick={() => {
              setup.closeTerminal()
              if (props.harness) return dialog.close()
              setView("selected", undefined)
            }}
            aria-label={language.t("common.goBack")}
          />
        </Show>
      </DialogHeader>
      <DialogBody class="settings-v2-harness-setup-body">
        <div ref={focusHost} tabIndex={-1} class="settings-v2-harness-setup-content">
          <Show
            when={selected()}
            keyed
            fallback={
              <>
                <p class="settings-v2-harness-setup-connect-copy">{language.t("harness.setup.description")}</p>
                <SetupList setup={setup} onConnect={(item) => setView("selected", item.id)} />
              </>
            }
          >
            {(item) => <ConnectView setup={setup} item={item} />}
          </Show>
        </div>
      </DialogBody>
    </DialogV2>
  )
}
