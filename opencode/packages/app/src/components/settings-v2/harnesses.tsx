import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Harness } from "@opencode-ai/schema/harness"
import { useQueryClient } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { type Accessor, type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { modelProvider, useSettings } from "@/context/settings"
import { harnessSettingsChanged } from "@/components/prompt-input/harness-controller"
import {
  addHarness,
  discoverHarness,
  harnessAssistantDirectory,
  listHarnessSettings,
  listHarnessUpdates,
  listHarnessesForServer,
  refreshHarnesses,
  removeHarness,
  setHarnessEnabled,
  upgradeHarness,
} from "@/utils/server"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { DialogHarnessAssistant } from "./harness-assistant"
import { DialogHarnessSetup } from "./harness-setup"
import "./settings-v2.css"

// Splits an arguments field on whitespace; quoted arguments with spaces aren't supported here.
const splitArgs = (value: string) => value.split(/\s+/).filter(Boolean)

export const SettingsHarnessesV2: Component<{
  directory: Accessor<string | undefined>
  // The add dialog replaces Settings in the dialog stack; this reopens Settings on this tab.
  onBack: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const queryClient = useQueryClient()
  const layout = useLayout()
  // Harness settings are global; the routes only need some valid location, so fall back from the
  // current tab to the home selection, any known project, then the home directory.
  const directory = createMemo(
    () =>
      props.directory() ||
      layout.home.selection().directory ||
      layout.projects.list()[0]?.worktree ||
      serverSync().data.path.home ||
      undefined,
  )
  const server = () => ({ server: serverSdk().server.http, fetch: platform.fetch })
  const [entries, { refetch }] = createResource(directory, (dir) => listHarnessSettings(server(), dir))
  // Live models and CLI versions; a failed check just leaves those details out.
  const [instances, { mutate: setInstances }] = createResource(directory, (dir) =>
    listHarnessesForServer(server(), dir).catch(() => []),
  )
  const [updates, { mutate: setUpdates }] = createResource(directory, (dir) =>
    listHarnessUpdates(server(), dir).catch(() => []),
  )
  const [state, setState] = createStore({
    selected: undefined as string | undefined,
    busy: undefined as string | undefined,
    confirming: undefined as string | undefined,
  })

  const builtIn = createMemo(() => (entries.latest ?? []).filter((entry) => entry.source !== "registry"))
  const registered = createMemo(() => (entries.latest ?? []).filter((entry) => entry.source === "registry"))

  const changed = () => {
    void refetch()
    harnessSettingsChanged()
    void queryClient.invalidateQueries({ queryKey: ["home", "harnesses"] })
  }

  const failed = (error: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })

  const run = (id: string, action: () => Promise<unknown>) => {
    const dir = directory()
    if (!dir || state.busy) return
    setState("busy", id)
    void action()
      .then(changed, failed)
      .finally(() => setState({ busy: undefined, confirming: undefined }))
  }

  const openAdd = () => {
    const dir = directory()
    if (!dir) return
    void dialog.show(() => (
      <DialogAddHarness directory={dir} server={server()} onClose={props.onBack} onSaved={saved} />
    ))
  }

  const saved = (entry: Harness.SettingsEntry) => {
    changed()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("harness.settings.added", { name: entry.name }),
    })
  }

  // The assistant chat runs in a server-provided non-project folder so its session stays out of project lists.
  const openAssistant = () => {
    const dir = directory()
    if (!dir) return
    void harnessAssistantDirectory(server(), dir).then(
      (assistantDir) =>
        dialog.show(() => <DialogHarnessAssistant directory={assistantDir} onClose={props.onBack} onSaved={saved} />),
      failed,
    )
  }

  const openSetup = () => {
    const dir = directory()
    if (!dir) return
    void dialog.show(() => (
      <DialogHarnessSetup
        directory={dir}
        onClose={() => {
          changed()
          props.onBack()
        }}
      />
    ))
  }

  const refreshModels = (id: string) =>
    run(id, () => refreshHarnesses(server(), directory()!, id).then((next) => setInstances(next)))

  const upgrade = (entry: Harness.SettingsEntry) =>
    run(entry.id, async () => {
      const result = await upgradeHarness(server(), directory()!, entry.id)
      setUpdates((current) => current?.map((item) => (item.id === result.id ? result : item)))
      setInstances(await refreshHarnesses(server(), directory()!, entry.id))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("harness.settings.updated", { name: result.name, version: result.version ?? "" }),
      })
    })

  const entryList = createMemo(() => [...builtIn(), ...registered()])
  // The first harness stays selected until the user picks another, or the selected one is removed.
  const selected = createMemo(() => entryList().find((entry) => entry.id === state.selected) ?? entryList()[0])
  const instance = (id: string) => instances.latest?.find((item) => item.id === id)
  const update = (id: string) => updates.latest?.find((item) => item.id === id)

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("harness.settings.title")}</h2>
      </div>

      <div class="settings-v2-tab-body" data-component="harness-settings">
        <Show when={!directory()}>
          <div class="settings-v2-provider-empty" role="alert">
            {language.t("harness.settings.noLocation")}
          </div>
        </Show>
        <Show when={entries.error}>
          <div class="settings-v2-provider-empty" role="alert">
            {entries.error instanceof Error ? entries.error.message : language.t("harness.probeFailed")}
          </div>
        </Show>

        <div class="settings-v2-harness-layout">
          <nav class="settings-v2-harness-nav" aria-label={language.t("harness.settings.title")}>
            <For each={entryList()}>
              {(entry) => (
                <button
                  type="button"
                  class="settings-v2-harness-nav-item"
                  data-harness={entry.id}
                  aria-current={selected()?.id === entry.id}
                  onClick={() => setState({ selected: entry.id, confirming: undefined })}
                >
                  <span class="settings-v2-harness-dot" data-state={harnessState(entry, instance(entry.id))} />
                  <span class="min-w-0 flex-1 truncate">{entry.name}</span>
                  <Show when={update(entry.id)?.updateAvailable}>
                    <span
                      class="settings-v2-harness-update-dot"
                      title={language.t("harness.settings.updateAvailable", { latest: update(entry.id)?.latest ?? "" })}
                    />
                  </Show>
                </button>
              )}
            </For>
            <div class="settings-v2-harness-nav-actions">
              <ButtonV2 size="normal" variant="ghost" icon="download" disabled={!directory()} onClick={openSetup}>
                {language.t("harness.settings.setup")}
              </ButtonV2>
              <ButtonV2 size="normal" variant="ghost" icon="plus" disabled={!directory()} onClick={openAssistant}>
                {language.t("harness.settings.assistant")}
              </ButtonV2>
              <ButtonV2 size="normal" variant="ghost" disabled={!directory()} onClick={openAdd}>
                {language.t("harness.settings.addManually")}
              </ButtonV2>
            </div>
          </nav>

          <Show
            when={selected()}
            keyed
            fallback={<div class="settings-v2-provider-empty">{language.t("harness.settings.empty")}</div>}
          >
            {(entry) => (
              <HarnessDetails
                entry={entry}
                instance={instance(entry.id)}
                update={update(entry.id)}
                busy={state.busy === entry.id}
                confirming={state.confirming === entry.id}
                onToggle={(checked) =>
                  run(entry.id, () => setHarnessEnabled(server(), directory()!, entry.id, checked))
                }
                onRemove={() =>
                  state.confirming === entry.id
                    ? run(entry.id, () => removeHarness(server(), directory()!, entry.id))
                    : setState("confirming", entry.id)
                }
                onRefresh={() => refreshModels(entry.id)}
                onUpgrade={() => upgrade(entry)}
              />
            )}
          </Show>
        </div>
      </div>
    </>
  )
}

const harnessState = (entry: Harness.SettingsEntry, instance?: Harness.Instance) => {
  if (!entry.enabled) return "off"
  if (instance?.status === "unavailable") return "error"
  return "on"
}

// Header, update, and model visibility for one harness. The in-process loop has no CLI or model list.
const HarnessDetails: Component<{
  entry: Harness.SettingsEntry
  instance?: Harness.Instance
  update?: Harness.UpdateStatus
  busy: boolean
  confirming: boolean
  onToggle: (enabled: boolean) => void
  onRemove: () => void
  onRefresh: () => void
  onUpgrade: () => void
}> = (props) => {
  const language = useLanguage()
  const editable = () => props.entry.source === "registry"
  const host = () => props.entry.driver === Harness.OpenCodeDriver
  const version = () => props.update?.version ?? props.instance?.version
  const meta = () =>
    [
      editable()
        ? undefined
        : props.entry.source === "built-in"
          ? language.t("harness.settings.source.builtIn")
          : language.t("harness.settings.source.config"),
      version() ? language.t("harness.settings.version", { version: version()! }) : undefined,
      props.entry.enabled ? undefined : language.t("harness.settings.disabled"),
    ]
      .filter(Boolean)
      .join(" · ")

  return (
    <section class="settings-v2-harness-detail-pane" data-component="harness-details" data-harness={props.entry.id}>
      <header class="settings-v2-harness-head">
        <div class="settings-v2-provider-copy">
          <h3 class="settings-v2-harness-name">{props.entry.name}</h3>
          <Show when={meta()}>
            <span class="settings-v2-provider-description">{meta()}</span>
          </Show>
        </div>
        <div class="settings-v2-harness-controls">
          <Show when={props.entry.enabled && !host()}>
            <ButtonV2 size="normal" variant="ghost" icon="reset" disabled={props.busy} onClick={props.onRefresh}>
              {language.t("harness.settings.models.refresh")}
            </ButtonV2>
          </Show>
          <Show when={editable()}>
            <Switch checked={props.entry.enabled} disabled={props.busy} hideLabel onChange={props.onToggle}>
              {language.t("harness.settings.enabled")}
            </Switch>
          </Show>
        </div>
      </header>

      <Show when={editable()}>
        <span class="settings-v2-harness-command">{[props.entry.command, ...(props.entry.args ?? [])].join(" ")}</span>
      </Show>
      <Show when={props.entry.enabled && props.instance?.status === "unavailable"}>
        <span class="settings-v2-harness-detail" role="alert">
          {props.instance?.error ?? language.t("harness.unavailable")}
        </span>
      </Show>

      <Show when={props.update?.updateAvailable}>
        <div class="settings-v2-harness-banner">
          <span class="min-w-0 flex-1">
            {language.t("harness.settings.updateAvailable", { latest: props.update?.latest ?? "" })}
            {" · "}
            {props.update?.method
              ? language.t("harness.settings.updateRestart")
              : language.t("harness.settings.updateManual")}
          </span>
          <Show when={props.update?.method}>
            <ButtonV2 size="normal" variant="neutral" disabled={props.busy} onClick={props.onUpgrade}>
              {props.busy ? language.t("harness.settings.updating") : language.t("harness.settings.update")}
            </ButtonV2>
          </Show>
        </div>
      </Show>

      <Show when={host()}>
        <span class="settings-v2-harness-detail">{language.t("harness.settings.hostModels")}</span>
      </Show>
      <Show when={props.entry.enabled && !host()}>
        <HarnessModels entry={props.entry} models={props.instance?.models ?? []} />
      </Show>

      <Show when={editable()}>
        <div class="settings-v2-harness-footer">
          <ButtonV2
            size="normal"
            variant={props.confirming ? "danger" : "ghost"}
            class={props.confirming ? undefined : "settings-v2-danger-text"}
            disabled={props.busy}
            onClick={props.onRemove}
          >
            {props.confirming ? language.t("harness.settings.removeConfirm") : language.t("harness.settings.remove")}
          </ButtonV2>
        </div>
      </Show>
    </section>
  )
}

// Models grouped by their provider prefix, so a whole provider (for example OpenRouter) can be hidden at once.
const HarnessModels: Component<{ entry: Harness.SettingsEntry; models: ReadonlyArray<Harness.Model> }> = (props) => {
  const language = useLanguage()
  const settings = useSettings()
  const [state, setState] = createStore({ query: "", open: undefined as string | undefined })
  const hidden = createMemo(() => new Set(settings.harnesses.hiddenModels(props.entry.id)))
  const hiddenProviders = createMemo(() => new Set(settings.harnesses.hiddenProviders(props.entry.id)))
  const visible = (model: Harness.Model) =>
    !hidden().has(model.id) && !hiddenProviders().has(modelProvider(model.id) ?? "")
  const groups = createMemo(() =>
    Object.entries(Object.groupBy(props.models, (model) => modelProvider(model.id) ?? "")).map(([id, models]) => ({
      id,
      // OpenCode names its models "Provider/Model"; the prefix is the readable provider name.
      name: models?.[0]?.name.includes("/") ? models[0].name.split("/")[0] : id,
      models: models ?? [],
    })),
  )
  const grouped = () => groups().some((group) => group.id)
  const matches = createMemo(() => {
    const query = state.query.trim().toLowerCase()
    if (!query) return []
    return props.models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(query))
  })

  // Inside a provider group the "Provider/" name prefix repeats the group, so it is dropped there.
  const modelSwitch = (model: Harness.Model, inGroup = false) => (
    <Switch
      size="small"
      checked={!hidden().has(model.id)}
      disabled={hiddenProviders().has(modelProvider(model.id) ?? "")}
      onChange={(checked) => settings.harnesses.setModelHidden(props.entry.id, model.id, !checked)}
    >
      <span title={model.description}>{inGroup ? model.name.slice(model.name.indexOf("/") + 1) : model.name}</span>
    </Switch>
  )

  return (
    <div class="settings-v2-section">
      <div class="flex items-center justify-between gap-3">
        <h4 class="settings-v2-section-title">
          {language.t("harness.settings.models", {
            shown: props.models.filter(visible).length,
            total: props.models.length,
          })}
        </h4>
        <Show when={props.models.length > 8}>
          <TextInputV2
            type="search"
            class="settings-v2-harness-search"
            value={state.query}
            placeholder={language.t("harness.settings.models.search")}
            aria-label={language.t("harness.settings.models.search")}
            onInput={(event) => setState("query", event.currentTarget.value)}
          />
        </Show>
      </div>
      <Show
        when={props.models.length > 0}
        fallback={<span class="settings-v2-harness-detail">{language.t("harness.settings.models.empty")}</span>}
      >
        <Show
          when={!state.query.trim()}
          fallback={
            <Show
              when={matches().length > 0}
              fallback={<span class="settings-v2-harness-detail">{language.t("harness.settings.models.noMatch")}</span>}
            >
              <div class="settings-v2-harness-models">
                <For each={matches()}>{(model) => modelSwitch(model)}</For>
              </div>
            </Show>
          }
        >
          <Show
            when={grouped()}
            fallback={
              <div class="settings-v2-harness-models">
                <For each={props.models}>{(model) => modelSwitch(model)}</For>
              </div>
            }
          >
            <SettingsListV2>
              <For each={groups()}>
                {(group) => (
                  <div class="settings-v2-harness-group" data-provider={group.id}>
                    <div class="settings-v2-harness-group-row">
                      <button
                        type="button"
                        class="settings-v2-harness-group-toggle"
                        aria-expanded={state.open === group.id}
                        onClick={() => setState("open", state.open === group.id ? undefined : group.id)}
                      >
                        <Icon name={state.open === group.id ? "chevron-down" : "chevron-right"} />
                        <span class="settings-v2-provider-name truncate">{group.name || group.id}</span>
                        <span class="settings-v2-provider-description">
                          {language.t("harness.settings.models.count", {
                            shown: group.models.filter(visible).length,
                            total: group.models.length,
                          })}
                        </span>
                      </button>
                      <Show when={group.id}>
                        <Switch
                          checked={!hiddenProviders().has(group.id)}
                          hideLabel
                          onChange={(checked) =>
                            settings.harnesses.setProviderHidden(props.entry.id, group.id, !checked)
                          }
                        >
                          {group.name}
                        </Switch>
                      </Show>
                    </div>
                    <Show when={state.open === group.id}>
                      <div class="settings-v2-harness-models settings-v2-harness-group-models">
                        <For each={group.models}>{(model) => modelSwitch(model, true)}</For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </SettingsListV2>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

const DialogAddHarness: Component<{
  directory: string
  server: Parameters<typeof addHarness>[0]
  onSaved: (entry: Harness.SettingsEntry) => void
  onClose: () => void
}> = (props) => {
  const language = useLanguage()
  const [id, setID] = createSignal("")
  const [name, setName] = createSignal("")
  const [command, setCommand] = createSignal("")
  const [args, setArgs] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [tested, setTested] = createSignal<{ key: string; discovery: Harness.Discovery }>()
  // Save is allowed only for the exact command and arguments that passed Test.
  const key = () => JSON.stringify([command().trim(), splitArgs(args())])
  const discovery = () => (tested()?.key === key() ? tested()?.discovery : undefined)

  const test = () => {
    if (!command().trim() || busy()) return
    setBusy(true)
    setError(undefined)
    const current = key()
    void discoverHarness(props.server, props.directory, { command: command().trim(), args: splitArgs(args()) })
      .then((result) => setTested({ key: current, discovery: result }))
      .catch((err: unknown) => {
        setTested(undefined)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  const save = () => {
    const result = discovery()
    if (!result || !id().trim() || busy()) return
    setBusy(true)
    setError(undefined)
    void addHarness(props.server, props.directory, {
      id: id().trim(),
      name: name().trim() || undefined,
      command: result.command,
      args: [...result.args],
    })
      .then((entry) => {
        props.onSaved(entry)
        props.onClose()
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  const field = (
    label: string,
    fieldID: string,
    value: Accessor<string>,
    set: (value: string) => void,
    hint?: string,
  ) => (
    <div class="flex w-full min-w-0 flex-col gap-2">
      <label class="settings-v2-server-dialog-label" for={fieldID}>
        {label}
      </label>
      <TextInputV2
        type="text"
        appearance="large"
        class="!w-full self-stretch"
        id={fieldID}
        value={value()}
        placeholder={hint}
        disabled={busy()}
        onInput={(event) => set(event.currentTarget.value)}
      />
    </div>
  )

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("harness.settings.add.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-4">
          {field(language.t("harness.settings.add.id"), "harness-id", id, setID, "opencode-cli")}
          {field(language.t("harness.settings.add.name"), "harness-name", name, setName, "OpenCode CLI")}
          {field(language.t("harness.settings.add.command"), "harness-command", command, setCommand, "opencode")}
          {field(language.t("harness.settings.add.args"), "harness-args", args, setArgs, "acp")}
          <Show when={discovery()}>
            {(result) => (
              <div class="settings-v2-harness-detail" data-component="harness-discovery">
                {language.t("harness.settings.add.found", {
                  agent: [result().agentName, result().version].filter(Boolean).join(" ") || result().command,
                  count: result().models.length,
                })}
                <Show when={result().models.length > 0}>
                  <div class="truncate">
                    {result()
                      .models.map((model) => model.id)
                      .join(", ")}
                  </div>
                </Show>
              </div>
            )}
          </Show>
          <Show when={error()}>
            <span role="alert" class="settings-v2-server-dialog-error">
              {error()}
            </span>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={props.onClose}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="neutral" disabled={busy() || !command().trim()} onClick={test}>
          {busy() && !discovery()
            ? language.t("harness.settings.add.testing")
            : language.t("harness.settings.add.test")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={busy() || !discovery() || !id().trim()} onClick={save}>
          {language.t("common.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
