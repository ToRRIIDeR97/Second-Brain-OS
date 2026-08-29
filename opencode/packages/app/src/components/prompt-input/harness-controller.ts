import { createEffect, createMemo, createResource } from "solid-js"
import { Harness } from "@opencode-ai/schema/harness"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { fallbackHarnesses, listHarnessesForServer } from "@/utils/server"
import type { PromptInputHarnessController } from "./harness-controls"

type HarnessSelection = {
  current: () => Harness.InstanceID
  set: (instanceID: Harness.InstanceID, model?: Harness.ModelSelection) => void
  model: PromptInputHarnessController["model"]
  disabled?: () => boolean
  fallbackUnavailable?: boolean
}

const defaultModel = (instance: Harness.Instance) => {
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

export function createPromptHarnessController(selection: HarnessSelection) {
  const sdk = useSDK()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const [instances, { refetch }] = createResource(
    () => sdk().directory,
    (directory) =>
      listHarnessesForServer({ server: serverSDK().server.http, fetch: platform.fetch }, directory).catch(
        fallbackHarnesses,
      ),
  )
  const instance = createMemo(() => instances()?.find((item) => item.id === selection.current()))

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
    loading: () => instances.loading,
    disabled: selection.disabled,
    refresh: refetch,
    current: selection.current,
    select(instanceID: Harness.InstanceID) {
      const next = instances()?.find((item) => item.id === instanceID)
      selection.set(instanceID, next ? defaultModel(next) : undefined)
      void refetch()
    },
    model: selection.model,
  } satisfies PromptInputHarnessController & {
    instance: () => Harness.Instance | undefined
    driver: () => Harness.DriverKind | undefined
  }
}
