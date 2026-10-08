import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { Harness } from "@opencode-ai/schema/harness"
import { useQueryClient } from "@tanstack/solid-query"
import { type Accessor, type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { harnessSettingsChanged } from "@/components/prompt-input/harness-controller"
import {
  addHarness,
  discoverHarness,
  harnessAssistantDirectory,
  listHarnessSettings,
  removeHarness,
  setHarnessEnabled,
} from "@/utils/server"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { DialogHarnessAssistant } from "./harness-assistant"
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
  const [confirming, setConfirming] = createSignal<string>()
  const [busy, setBusy] = createSignal<string>()

  const builtIn = createMemo(() => (entries() ?? []).filter((entry) => entry.source !== "registry"))
  const registered = createMemo(() => (entries() ?? []).filter((entry) => entry.source === "registry"))

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
    if (!dir || busy()) return
    setBusy(id)
    void action()
      .then(changed, failed)
      .finally(() => {
        setBusy(undefined)
        setConfirming(undefined)
      })
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

  const sourceLabel = (entry: Harness.SettingsEntry) =>
    entry.source === "built-in"
      ? language.t("harness.settings.source.builtIn")
      : language.t("harness.settings.source.config")

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("harness.settings.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-providers" data-component="harness-settings">
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

        <div class="settings-v2-section">
          <div class="flex items-center justify-between">
            <h3 class="settings-v2-section-title">{language.t("harness.settings.section.added")}</h3>
            <div class="flex items-center gap-2">
              <ButtonV2 size="normal" variant="ghost-muted" disabled={!directory()} onClick={openAdd}>
                {language.t("harness.settings.addManually")}
              </ButtonV2>
              <ButtonV2 size="normal" variant="neutral" icon="plus" disabled={!directory()} onClick={openAssistant}>
                {language.t("harness.settings.assistant")}
              </ButtonV2>
            </div>
          </div>
          <SettingsListV2>
            <Show
              when={registered().length > 0}
              fallback={<div class="settings-v2-provider-empty">{language.t("harness.settings.empty")}</div>}
            >
              <For each={registered()}>
                {(entry) => (
                  <div class="settings-v2-provider-row" data-harness={entry.id}>
                    <div class="settings-v2-provider-lead">
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name truncate">{entry.name}</span>
                        <span class="settings-v2-harness-detail">
                          {[entry.command, ...(entry.args ?? [])].join(" ")}
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Switch
                        checked={entry.enabled}
                        disabled={busy() === entry.id}
                        onChange={(checked) =>
                          run(entry.id, () => setHarnessEnabled(server(), directory()!, entry.id, checked))
                        }
                        hideLabel
                      >
                        {language.t("harness.settings.enabled")}
                      </Switch>
                      <Show
                        when={confirming() === entry.id}
                        fallback={
                          <ButtonV2
                            size="normal"
                            variant="ghost-muted"
                            disabled={busy() === entry.id}
                            onClick={() => setConfirming(entry.id)}
                          >
                            {language.t("harness.settings.remove")}
                          </ButtonV2>
                        }
                      >
                        <ButtonV2
                          size="normal"
                          variant="neutral"
                          disabled={busy() === entry.id}
                          onClick={() => run(entry.id, () => removeHarness(server(), directory()!, entry.id))}
                        >
                          {language.t("harness.settings.removeConfirm")}
                        </ButtonV2>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("harness.settings.section.readOnly")}</h3>
          <SettingsListV2>
            <For each={builtIn()}>
              {(entry) => (
                <div class="settings-v2-provider-row" data-harness={entry.id}>
                  <div class="settings-v2-provider-lead">
                    <div class="settings-v2-provider-main">
                      <span class="settings-v2-provider-name truncate">{entry.name}</span>
                      <Tag>{sourceLabel(entry)}</Tag>
                    </div>
                  </div>
                  <Show when={!entry.enabled}>
                    <span class="settings-v2-harness-detail">{language.t("harness.settings.disabled")}</span>
                  </Show>
                </div>
              )}
            </For>
          </SettingsListV2>
        </div>
      </div>
    </>
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
      // The picker lists a saved harness's models from its entry, so keep what Test discovered.
      models: result.models.map((model) => model.id),
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
