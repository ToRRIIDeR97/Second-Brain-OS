import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { TaskCheck } from "./calendar-peek"
import type { CalendarEvent, PlannerTask } from "./client"

export type CalendarGridDay = {
  date: string
  today: boolean
  day: number
  weekday: string
  /** Events with a start and end inside this day. */
  timed: CalendarEvent[]
  /** All-day and multi-day events shown in the strip above the hours. */
  allDay: CalendarEvent[]
  tasks: PlannerTask[]
}

const HOUR = 48

/** Day and Week views: an hour grid with all-day events and tasks in a strip above it. */
export function CalendarGrid(props: {
  days: CalendarGridDay[]
  selected: string
  onOpenEvent: (event: CalendarEvent) => void
  onOpenTask: (task: PlannerTask) => void
  onToggle: (task: PlannerTask) => Promise<void>
  onOpenDay: (date: string) => void
}) {
  const language = useLanguage()
  // Office hours by default, widened to fit the earliest and latest event shown.
  const hours = createMemo(() => {
    const timed = props.days.flatMap((day) => day.timed)
    const first = Math.min(7, ...timed.map((event) => Math.floor(minutes(event.start!) / 60)))
    const last = Math.max(22, ...timed.map((event) => Math.ceil(minutes(event.end!) / 60)))
    return Array.from({ length: Math.min(last, 24) - first }, (_, index) => first + index)
  })
  const columns = () => `56px repeat(${props.days.length}, minmax(0, 1fr))`
  const blocks = (day: CalendarGridDay) => {
    const start = hours()[0] * 60
    const lanes: number[] = []
    const placed = [...day.timed]
      .sort((left, right) => minutes(left.start!) - minutes(right.start!))
      .map((event) => {
        const from = minutes(event.start!)
        const to = Math.max(minutes(event.end!), from + 15)
        const free = lanes.findIndex((end) => end <= from)
        const lane = free === -1 ? lanes.length : free
        lanes[lane] = to
        return { event, from, to, lane }
      })
    return placed.map((item) => ({
      ...item,
      style: {
        top: `${((item.from - start) / 60) * HOUR + 1}px`,
        height: `${Math.max(((item.to - item.from) / 60) * HOUR - 3, 22)}px`,
        left: `calc(${(item.lane / lanes.length) * 100}% + 2px)`,
        width: `calc(${100 / lanes.length}% - 6px)`,
      },
    }))
  }

  return (
    <div class="flex flex-col pb-4">
      <div
        class="sticky top-0 z-10 grid bg-v2-background-bg-base shadow-[inset_0_-0.5px_0_var(--v2-border-border-muted)]"
        style={{ "grid-template-columns": columns() }}
      >
        <span />
        <For each={props.days}>
          {(day) => (
            <button
              type="button"
              class="flex cursor-pointer flex-col items-center gap-0.5 rounded-[12px] py-1.5 transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
              aria-current={day.today ? "date" : undefined}
              onClick={() => props.onOpenDay(day.date)}
            >
              <span class="text-[11px] uppercase tracking-[0.04em] text-v2-text-text-muted [font-weight:560]">
                {day.weekday}
              </span>
              <span
                classList={{
                  "flex size-8 items-center justify-center rounded-full text-[15px]": true,
                  "bg-v2-icon-icon-accent text-v2-icon-icon-contrast [font-weight:600]": day.today,
                  "text-v2-text-text-base [font-weight:500]": !day.today,
                }}
              >
                {day.day}
              </span>
            </button>
          )}
        </For>
        <Show when={props.days.some((day) => day.allDay.length > 0 || day.tasks.length > 0)}>
          <span class="pt-2 text-[11px] text-v2-text-text-faint">{language.t("secondBrain.calendar.allDay")}</span>
          <For each={props.days}>
            {(day) => (
              <div class="flex min-w-0 flex-col gap-1 px-0.5 pb-2 pt-1">
                <For each={day.allDay}>
                  {(event) => (
                    <button
                      type="button"
                      classList={{
                        "h-6 min-w-0 shrink-0 cursor-pointer truncate rounded-[8px] px-2 text-left text-[11.5px] [font-weight:500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus": true,
                        "bg-v2-icon-icon-accent text-v2-icon-icon-contrast": props.selected === event.id,
                        "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container hover:brightness-95":
                          props.selected !== event.id,
                      }}
                      title={event.title}
                      onClick={() => props.onOpenEvent(event)}
                    >
                      {event.title}
                    </button>
                  )}
                </For>
                <For each={day.tasks}>
                  {(task) => (
                    <div
                      classList={{
                        "flex h-7 min-w-0 items-center gap-1.5 rounded-full pl-1.5 pr-2.5": true,
                        "bg-v2-background-bg-accent-container": props.selected === `task:${task.id}`,
                        "bg-v2-background-bg-layer-01": props.selected !== `task:${task.id}`,
                      }}
                    >
                      <TaskCheck task={task} onToggle={props.onToggle} small />
                      <button
                        type="button"
                        class="min-w-0 flex-1 cursor-pointer truncate rounded-[8px] text-left text-[12px] text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                        title={task.title}
                        onClick={() => props.onOpenTask(task)}
                      >
                        {task.title}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="relative mt-2 grid" style={{ "grid-template-columns": columns() }}>
        <div class="relative" style={{ height: `${hours().length * HOUR}px` }}>
          <For each={hours()}>
            {(hour, index) => (
              <span
                class="absolute left-0 w-12 -translate-y-2 text-[11px] tabular-nums text-v2-text-text-faint"
                style={{ top: `${index() * HOUR}px` }}
              >
                {`${String(hour).padStart(2, "0")}:00`}
              </span>
            )}
          </For>
        </div>
        <For each={props.days}>
          {(day) => (
            <div
              classList={{
                "relative shadow-[inset_0.5px_0_0_var(--v2-border-border-muted)]": true,
                "bg-[color-mix(in_srgb,var(--v2-background-bg-accent-container)_35%,transparent)]": day.today,
              }}
              style={{
                height: `${hours().length * HOUR}px`,
                "background-image": `repeating-linear-gradient(to bottom, var(--v2-border-border-muted) 0 0.5px, transparent 0.5px ${HOUR}px)`,
              }}
            >
              <For each={blocks(day)}>
                {(block) => (
                  <button
                    type="button"
                    classList={{
                      "absolute flex cursor-pointer flex-col gap-px overflow-hidden rounded-[8px] px-2 py-1 text-left text-[12px] leading-4 transition-[filter] duration-short ease-standard hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none": true,
                      "bg-v2-icon-icon-accent text-v2-icon-icon-contrast": props.selected === block.event.id,
                      "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container":
                        props.selected !== block.event.id,
                    }}
                    style={block.style}
                    title={block.event.title}
                    onClick={() => props.onOpenEvent(block.event)}
                  >
                    <span class="truncate [font-weight:560]">{block.event.title}</span>
                    <span class="truncate opacity-85">{`${block.event.start} – ${block.event.end}`}</span>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function minutes(value: string) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}
