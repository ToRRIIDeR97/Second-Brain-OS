import { Show } from "solid-js"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { getFilename } from "@opencode-ai/core/util/path"
import { useLanguage } from "@/context/language"

/** Worktree on/off. On creates a git worktree for the thread; an existing one picked elsewhere also reads as on. */
export function PromptWorkspaceSelector(props: {
  value: string
  projectRoot: string
  branch?: string
  onChange: (value: string) => void
  onDone: () => void
}) {
  const language = useLanguage()
  const on = () => props.value !== props.projectRoot && props.value !== "main"
  const label = () =>
    on() && props.value !== "create" ? getFilename(props.value) : language.t("secondBrain.composer.worktree")

  return (
    <>
      <span class="hidden select-none opacity-50 sm:inline mx-1">/</span>
      <TooltipV2 placement="top" value={language.t("secondBrain.composer.worktree.description")}>
        <Switch
          size="small"
          checked={on()}
          class="flex h-8 min-w-0 max-w-[220px] items-center gap-2 px-2.5 [&_[data-slot=switch-label]]:truncate"
          onChange={(checked: boolean) => {
            props.onChange(checked ? "create" : "main")
            props.onDone()
          }}
        >
          {label()}
        </Switch>
      </TooltipV2>
      <PromptGitStatus branch={props.branch} />
    </>
  )
}

export function PromptGitStatus(props: { branch?: string; noGit?: boolean }) {
  const language = useLanguage()
  const label = () => {
    if (props.noGit) return language.t("session.new.git.none")
    return props.branch
  }

  return (
    <Show when={label()}>
      {(value) => (
        <>
          <span class="hidden select-none opacity-50 sm:inline mx-1">/</span>
          <TooltipV2
            placement="top"
            value={value()}
            class="min-w-0 max-w-[220px]"
            contentClass="max-w-[calc(100vw-32px)] break-all"
          >
            <div class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px]">
              <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <span class="min-w-0 truncate">{value()}</span>
            </div>
          </TooltipV2>
        </>
      )}
    </Show>
  )
}
