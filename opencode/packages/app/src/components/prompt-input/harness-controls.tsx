import { Show, createMemo } from "solid-js"
import { Harness } from "@opencode-ai/schema/harness"
import { PromptInputV2Select } from "@opencode-ai/session-ui/v2/prompt-input"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"

export type PromptInputHarnessController = {
  instances: () => ReadonlyArray<Harness.Instance> | undefined
  loading: () => boolean
  disabled?: () => boolean
  refresh: () => unknown
  current: () => Harness.InstanceID
  select: (instanceID: Harness.InstanceID) => void
  model: {
    current: () => Harness.ModelSelection | undefined
    set: (model: Harness.ModelSelection | undefined) => void
  }
}

const SELECT_CLASS =
  "prompt-input-responsive-select !h-7 !w-auto min-w-0 max-w-[220px] !bg-transparent !shadow-none hover:!bg-v2-overlay-simple-overlay-hover"

export function PromptInputHarnessControls(props: { controller: PromptInputHarnessController }) {
  const language = useLanguage()
  const instance = createMemo(() =>
    props.controller.instances()?.find((item) => item.id === props.controller.current()),
  )
  const model = createMemo(() => {
    const selection = props.controller.model.current()
    return instance()?.models.find((item) => item.id === selection?.id)
  })
  const selectModel = (id: string) => {
    const selected = instance()?.models.find((item) => item.id === id)
    if (!selected) return
    props.controller.model.set({
      id: selected.id,
      reasoningEffort: selected.defaultReasoningEffort,
      serviceTier: selected.defaultServiceTier,
    })
  }

  return (
    <>
      <PromptInputV2Select
        title={language.t("harness.label")}
        options={
          props.controller.instances()?.map((item) => ({
            id: item.id,
            label: item.name + (item.status === "unavailable" ? ` - ${language.t("harness.unavailable")}` : ""),
            disabled: item.status === "unavailable",
            title: item.error,
          })) ?? [{ id: props.controller.current(), label: language.t("harness.checking") }]
        }
        current={props.controller.current()}
        control="harness"
        currentIcon={<Icon name="status" />}
        class={SELECT_CLASS}
        disabled={props.controller.loading() || props.controller.disabled?.() || !props.controller.instances()}
        onSelect={(id) => props.controller.select(Harness.InstanceID.make(id))}
      />
      <Show when={instance()?.driver !== Harness.OpenCodeDriver && instance()} keyed>
        {(item) => (
          <Show
            when={item.models.length > 0}
            fallback={<span class="px-2 text-[12px] text-v2-text-text-faint">{language.t("harness.models.none")}</span>}
          >
            <PromptInputV2Select
              title={language.t("harness.model")}
              options={item.models.map((option) => ({ id: option.id, label: option.name }))}
              current={props.controller.model.current()?.id ?? item.models[0]?.id ?? ""}
              control="harness-model"
              currentIcon={<Icon name="monitor" />}
              class={SELECT_CLASS}
              capitalize={false}
              disabled={props.controller.disabled?.()}
              onSelect={selectModel}
            />
          </Show>
        )}
      </Show>
      <Show when={model()} keyed>
        {(selected) => (
          <>
            <Show when={selected.reasoningEfforts.length > 0}>
              <PromptInputV2Select
                title={language.t("harness.effort")}
                options={[
                  { id: "", label: language.t("harness.default") },
                  ...selected.reasoningEfforts.map((effort) => ({ id: effort, label: effort })),
                ]}
                current={props.controller.model.current()?.reasoningEffort ?? ""}
                control="harness-effort"
                currentIcon={<Icon name="settings-gear" />}
                class={SELECT_CLASS}
                capitalize={false}
                disabled={props.controller.disabled?.()}
                onSelect={(reasoningEffort) => {
                  const current = props.controller.model.current()
                  if (!current) return
                  props.controller.model.set({ ...current, reasoningEffort: reasoningEffort || undefined })
                }}
              />
            </Show>
            <Show when={selected.serviceTiers.length > 0}>
              <PromptInputV2Select
                title={language.t("harness.effort")}
                options={[
                  { id: "", label: language.t("harness.default") },
                  ...selected.reasoningEfforts.map((effort) => ({ id: effort, label: effort })),
                ]}
                current={props.controller.model.current()?.reasoningEffort ?? ""}
                control="harness-effort"
                capitalize={false}
                disabled={props.controller.disabled?.()}
                onSelect={(reasoningEffort) => {
                  const current = props.controller.model.current()
                  if (!current) return
                  props.controller.model.set({ ...current, reasoningEffort: reasoningEffort || undefined })
                }}
              />
            </Show>
            <Show when={selected.serviceTiers.length > 0}>
              <PromptInputV2Select
                title={language.t("harness.serviceTier")}
                options={[
                  { id: "", label: language.t("harness.default") },
                  ...selected.serviceTiers.map((tier) => ({ id: tier.id, label: tier.name })),
                ]}
                current={props.controller.model.current()?.serviceTier ?? ""}
                control="harness-service-tier"
                currentIcon={<Icon name="outline-sliders" />}
                class={SELECT_CLASS}
                capitalize={false}
                disabled={props.controller.disabled?.()}
                onSelect={(serviceTier) => {
                  const current = props.controller.model.current()
                  if (!current) return
                  props.controller.model.set({ ...current, serviceTier: serviceTier || undefined })
                }}
              />
            </Show>
          </>
        )}
      </Show>
      <TooltipV2
        placement="top"
        value={`${language.t("harness.refreshModels")}${instance()?.version ? ` (${instance()!.version})` : ""}`}
      >
        <IconButtonV2
          data-action="harness-refresh"
          variant="ghost-muted"
          size="normal"
          icon={<Icon name="reset" />}
          aria-label={language.t("harness.refreshModels")}
          disabled={props.controller.loading() || props.controller.disabled?.()}
          onClick={() => void props.controller.refresh()}
        />
      </TooltipV2>
    </>
  )
}
