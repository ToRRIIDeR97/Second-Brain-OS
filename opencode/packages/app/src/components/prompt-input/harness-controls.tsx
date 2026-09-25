import { Show, createMemo } from "solid-js"
import { Harness } from "@opencode-ai/schema/harness"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
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
      <TooltipV2
        placement="top"
        value={`${language.t("harness.label")}: ${instance()?.name ?? language.t("harness.checking")}`}
      >
        <SelectV2
          data-control="harness"
          aria-label={language.t("harness.label")}
          class={SELECT_CLASS}
          appearance="inline"
          triggerIcon={<Icon name="status" />}
          options={[...(props.controller.instances() ?? [])]}
          current={instance()}
          value={(item) => item.id}
          label={(item) =>
            `${item.name}${item.status === "unavailable" ? ` - ${language.t("harness.unavailable")}` : ""}`
          }
          optionDisabled={(item) => item.status === "unavailable"}
          placeholder={language.t("harness.checking")}
          disabled={props.controller.loading() || props.controller.disabled?.() || !props.controller.instances()}
          onSelect={(item) => item && props.controller.select(item.id)}
        />
      </TooltipV2>
      <Show when={instance()?.driver !== Harness.OpenCodeDriver && instance()} keyed>
        {(item) => (
          <Show
            when={item.models.length > 0}
            fallback={<span class="px-2 text-[12px] text-v2-text-text-faint">{language.t("harness.models.none")}</span>}
          >
            <TooltipV2
              placement="top"
              value={`${language.t("harness.model")}: ${model()?.name ?? language.t("harness.default")}`}
            >
              <SelectV2
                data-control="harness-model"
                aria-label={language.t("harness.model")}
                class={SELECT_CLASS}
                appearance="inline"
                triggerIcon={<Icon name="monitor" />}
                options={[...item.models]}
                current={model()}
                value={(option) => option.id}
                label={(option) => option.name}
                disabled={props.controller.disabled?.()}
                onSelect={(option) => option && selectModel(option.id)}
              />
            </TooltipV2>
          </Show>
        )}
      </Show>
      <Show when={model()} keyed>
        {(selected) => (
          <>
            <Show when={selected.reasoningEfforts.length > 0}>
              <TooltipV2
                placement="top"
                value={`${language.t("harness.effort")}: ${props.controller.model.current()?.reasoningEffort ?? language.t("harness.default")}`}
              >
                <SelectV2
                  data-control="harness-effort"
                  aria-label={language.t("harness.effort")}
                  class={SELECT_CLASS}
                  appearance="inline"
                  triggerIcon={<Icon name="settings-gear" />}
                  options={["__default__", ...selected.reasoningEfforts]}
                  current={props.controller.model.current()?.reasoningEffort ?? "__default__"}
                  label={(effort) =>
                    `${language.t("harness.effort")}: ${effort === "__default__" ? language.t("harness.default") : effort}`
                  }
                  disabled={props.controller.disabled?.()}
                  onSelect={(effort) => {
                    const current = props.controller.model.current()
                    if (!current) return
                    props.controller.model.set({
                      ...current,
                      reasoningEffort: effort && effort !== "__default__" ? effort : undefined,
                    })
                  }}
                />
              </TooltipV2>
            </Show>
            <Show when={selected.serviceTiers.length > 0}>
              <TooltipV2
                placement="top"
                value={`${language.t("harness.serviceTier")}: ${props.controller.model.current()?.serviceTier ?? language.t("harness.default")}`}
              >
                <SelectV2
                  data-control="harness-service-tier"
                  aria-label={language.t("harness.serviceTier")}
                  class={SELECT_CLASS}
                  appearance="inline"
                  triggerIcon={<Icon name="outline-sliders" />}
                  options={["__default__", ...selected.serviceTiers.map((tier) => tier.id)]}
                  current={props.controller.model.current()?.serviceTier ?? "__default__"}
                  label={(tierID) =>
                    `${language.t("harness.serviceTier")}: ${tierID === "__default__" ? language.t("harness.default") : (selected.serviceTiers.find((tier) => tier.id === tierID)?.name ?? tierID)}`
                  }
                  disabled={props.controller.disabled?.()}
                  onSelect={(tierID) => {
                    const current = props.controller.model.current()
                    if (!current) return
                    props.controller.model.set({
                      ...current,
                      serviceTier: tierID && tierID !== "__default__" ? tierID : undefined,
                    })
                  }}
                />
              </TooltipV2>
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
