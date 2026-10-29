import { createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Harness } from "@opencode-ai/schema/harness"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings, withVisibleModels } from "@/context/settings"
import { Persist, persisted } from "@/utils/persist"
import { ServerConnection } from "@/context/server"
import { listHarnessesRemembered, recentHarnessKey, rememberedHarnesses } from "@/utils/server"
import type { PromptInputHarnessController } from "./harness-controls"

type HarnessSelection = {
  current: () => Harness.InstanceID
  set: (instanceID: Harness.InstanceID, model?: Harness.ModelSelection) => void
  model: PromptInputHarnessController["model"]
  disabled?: () => boolean
  fallbackUnavailable?: boolean
}

/** The model a harness starts with: its marked default, else its first model. The built-in loop uses the app's own picker. */
export const defaultModel = (instance: Harness.Instance) => {
  if (instance.driver === Harness.OpenCodeDriver) return
  const model = instance.models.find((item) => item.isDefault) ?? instance.models[0]
  return model
    ? {
        id: model.id,
        reasoningEffort: model.defaultReasoningEffort,
        serviceTier: model.defaultServiceTier,
      }
    : undefined
}

// Background checks run at most this often; each can start every harness CLI on the server.
const REVALIDATE_MS = 60_000
// Listing Claude Code's models takes about 10s, longer on a cold start.
export const MODEL_RETRY_MS = 3_000
export const MODEL_RETRIES = 10

// Bumped by Settings after a harness is added, toggled, or removed, so open prompts refetch the list.
const [settingsVersion, setSettingsVersion] = createSignal(0)
export const harnessSettingsChanged = () => setSettingsVersion((value) => value + 1)

/**
 * Where a server's persisted harness list is stored for a folder. The desktop sidecar gets a new port on
 * every launch, so this uses the connection's stable key (as drafts do), not its URL.
 */
export const persistedHarnessKey = (server: ServerConnection.Any, directory: string) =>
  recentHarnessKey(ServerConnection.key(server), directory)

export function createPromptHarnessController(selection: HarnessSelection) {
  const sdk = useSDK()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  // The last list each server reported per folder, kept across restarts: after a cold start the picker
  // works from it while the server checks every harness CLI again.
  const [stored, setStored] = persisted(
    Persist.global("harness.instances.v1"),
    createStore<Record<string, ReadonlyArray<Harness.Instance>>>({}),
  )
  const storedList = () => stored[persistedHarnessKey(serverSDK().server, sdk().directory)]
  // A list another composer or Home already loaded shows at once; this composer still checks.
  const remembered = rememberedHarnesses(server().server.url, sdk().directory) ?? storedList()
  const [loaded, { refetch }] = createResource(
    () => ({ directory: sdk().directory, version: settingsVersion() }),
    ({ directory }) =>
      listHarnessesRemembered(server(), directory, (list) =>
        setStored(persistedHarnessKey(serverSDK().server, directory), list),
      ),
    // Only a present `initialValue` counts as resolved, so the key is left out when nothing is remembered.
    (remembered ? { initialValue: remembered } : {}) as { initialValue: ReadonlyArray<Harness.Instance> },
  )
  // Never suspend: before the first answer, `latest` reads like `loaded()`, and a suspended read holds
  // the route transition that opened this composer until every harness CLI has answered. `latest`
  // also keeps the last list during a refetch. Desktop storage loads asynchronously, so the persisted list
  // can arrive after the resource started. Models hidden in Settings never reach the picker or the
  // default-model choice.
  const list = () => (loaded.state === "ready" || loaded.state === "refreshing" ? loaded.latest : storedList())
  const instances = createMemo(() =>
    list()?.map((item) =>
      withVisibleModels(item, settings.harnesses.hiddenModels(item.id), settings.harnesses.hiddenProviders(item.id)),
    ),
  )
  // Stale-while-revalidate: the list refreshes when the window regains focus or the picker opens,
  // instead of behind a button. The server reuses recent checks, so most of these are cheap.
  let checked = Date.now()
  const revalidate = () => {
    if (loaded.loading || Date.now() - checked < REVALIDATE_MS) return
    checked = Date.now()
    void refetch()
  }
  window.addEventListener("focus", revalidate)
  onCleanup(() => window.removeEventListener("focus", revalidate))
  const instance = createMemo(() => instances()?.find((item) => item.id === selection.current()))
  // An ACP agent answers before its models are listed (the server reads them in the background),
  // so a harness that is up but has no models yet is asked again a few times.
  const [retry, setRetry] = createStore({ count: 0 })
  const waitingForModels = () => {
    const current = instance()
    return (
      !!current &&
      current.driver !== Harness.OpenCodeDriver &&
      current.status === "available" &&
      current.models.length === 0
    )
  }
  // A newly selected harness gets its own full set of model retries.
  createEffect(on(selection.current, () => setRetry("count", 0), { defer: true }))
  createEffect(() => {
    const current = instance()
    if (!current || current.driver === Harness.OpenCodeDriver || current.status !== "available") return
    if (current.models.length > 0) {
      setRetry("count", 0)
      return
    }
    if (loaded.loading || retry.count >= MODEL_RETRIES) return
    const timer = setTimeout(() => {
      void refetch()
      setRetry("count", (count) => count + 1)
    }, MODEL_RETRY_MS)
    onCleanup(() => clearTimeout(timer))
  })

  createEffect(() => {
    const available = instances()
    if (!available) return
    const current = available.find((item) => item.id === selection.current())
    const selected =
      current?.status === "available"
        ? current
        : selection.fallbackUnavailable === false
          ? undefined
          : available.find((item) => item.status === "available")
    if (!selected) return
    if (selected.id !== selection.current()) {
      selection.set(selected.id, defaultModel(selected))
      return
    }
    if (selected.driver === Harness.OpenCodeDriver) {
      if (selection.model.current()) selection.model.set(undefined)
      return
    }
    const currentModel = selection.model.current()
    if (selected.models.some((model) => model.id === currentModel?.id)) return
    selection.model.set(defaultModel(selected))
  })

  return {
    instances,
    instance,
    driver: () => instance()?.driver,
    // Only the first load blocks the picker; a stale list stays usable while it refreshes.
    loading: () => loaded.loading && !list(),
    // Any fetch in flight, or a harness that is up but whose models are still being asked for.
    checking: () => loaded.loading || (waitingForModels() && retry.count < MODEL_RETRIES),
    disabled: selection.disabled,
    revalidate,
    current: selection.current,
    select(instanceID: Harness.InstanceID) {
      const next = instances()?.find((item) => item.id === instanceID)
      // No refetch here: listing probes every harness CLI once the server's cache expires.
      selection.set(instanceID, next ? defaultModel(next) : undefined)
    },
    model: selection.model,
  } satisfies PromptInputHarnessController & {
    instance: () => Harness.Instance | undefined
    driver: () => Harness.DriverKind | undefined
  }
}
