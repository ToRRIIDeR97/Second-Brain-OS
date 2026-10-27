import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { PlannerTask } from "./client"

/** Read-only details of an event or task in the Calendar side panel; Edit is a separate step. */
export function CalendarPeek(props: {
  tag: string
  title: string
  when: string
  project?: string
  notes?: string
  task?: PlannerTask
  onToggle: (task: PlannerTask) => Promise<void>
  onEdit: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  return (
    <div class="flex flex-col gap-4 p-4 pl-5">
      <div class="flex items-center gap-1">
        <span class="min-w-0 truncate rounded-full bg-v2-background-bg-base px-2.5 py-1 text-[11px] text-v2-text-text-muted [font-weight:530]">
          {props.tag}
        </span>
        <span class="flex-1" />
        <TooltipV2 value={language.t("common.edit")}>
          <IconButtonV2
            type="button"
            size="small"
            variant="ghost"
            icon={<Icon name="edit" />}
            aria-label={language.t("common.edit")}
            onClick={() => props.onEdit()}
          />
        </TooltipV2>
        <TooltipV2 value={language.t("common.close")}>
          <IconButtonV2
            type="button"
            size="small"
            variant="ghost"
            icon={<Icon name="close" />}
            aria-label={language.t("common.close")}
            onClick={() => props.onClose()}
          />
        </TooltipV2>
      </div>
      <div class="flex items-start gap-3">
        <Show when={props.task}>{(task) => <TaskCheck task={task()} onToggle={props.onToggle} />}</Show>
        <h2 class="min-w-0 break-words text-[20px] leading-[26px] text-v2-text-text-base [font-weight:560]">
          {props.title}
        </h2>
      </div>
      <dl class="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3 gap-y-3.5 text-[13px] text-v2-text-text-base">
        <dt class="pt-0.5 text-v2-icon-icon-muted">
          <Icon name="calendar" size="small" />
        </dt>
        <dd>{props.when}</dd>
        <Show when={props.project}>
          <dt class="pt-0.5 text-v2-icon-icon-muted">
            <Icon name="folder" size="small" />
          </dt>
          <dd>{props.project}</dd>
        </Show>
        <Show when={props.notes}>
          <dt class="pt-0.5 text-v2-icon-icon-muted">
            <Icon name="book" size="small" />
          </dt>
          <dd class="whitespace-pre-wrap leading-5 text-v2-text-text-muted">{props.notes}</dd>
        </Show>
      </dl>
    </div>
  )
}

/** A round completion checkbox; ticking writes at once, Google tasks included. */
export function TaskCheck(props: {
  task: PlannerTask
  onToggle: (task: PlannerTask) => Promise<void>
  small?: boolean
}) {
  const language = useLanguage()
  return (
    <span
      classList={{
        "relative flex shrink-0 items-center justify-center": true,
        "size-5": !props.small,
        "size-4": props.small,
      }}
    >
      <input
        type="checkbox"
        checked={Boolean(props.task.completedAt)}
        aria-label={language.t("secondBrain.tasks.toggle", { title: props.task.title })}
        classList={{
          "peer cursor-pointer appearance-none rounded-full border-[1.5px] border-v2-border-border-base transition-colors duration-150 ease-standard checked:border-transparent checked:bg-v2-icon-icon-accent hover:border-v2-icon-icon-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none": true,
          "size-5": !props.small,
          "size-4": props.small,
        }}
        onChange={() => void props.onToggle(props.task)}
      />
      <Icon
        name="check"
        size="small"
        class="pointer-events-none absolute text-v2-icon-icon-contrast opacity-0 peer-checked:opacity-100"
      />
    </span>
  )
}
