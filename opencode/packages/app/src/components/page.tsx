import { Show, type JSX, type ParentProps } from "solid-js"

/** The rounded surface every page sits on, next to the nav rail and projects panel. */
export const pagePanelClass =
  "rounded-[24px] bg-v2-background-bg-base shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]"

/** Full-height page: one rounded panel that scrolls. Pages with their own layout use `pagePanelClass`. */
export function PageFrame(props: ParentProps<{ labelledBy?: string; class?: string }>) {
  return (
    <section class="flex size-full min-h-0 flex-col p-2 pl-0" aria-labelledby={props.labelledBy}>
      <div class={`min-h-0 flex-1 overflow-y-auto ${pagePanelClass} ${props.class ?? ""}`}>{props.children}</div>
    </section>
  )
}

/** Page title with optional trailing actions. Pages carry no subtitle: the title names the page. */
export function PageHeader(props: { id?: string; title: string; actions?: JSX.Element }) {
  return (
    <header class="flex min-h-14 shrink-0 flex-wrap items-center gap-2 px-6 pt-3">
      <h1
        id={props.id}
        class="max-w-full flex-1 shrink-0 truncate text-[17px] text-v2-text-text-base [font-weight:560]"
      >
        {props.title}
      </h1>
      <Show when={props.actions}>
        <div class="flex flex-wrap items-center gap-1.5">{props.actions}</div>
      </Show>
    </header>
  )
}

/** A titled group of rows. A title with `onTitle` doubles as the link to the full view. */
export function PageSection(
  props: ParentProps<{ id?: string; title: string; onTitle?: () => void; actions?: JSX.Element; class?: string }>,
) {
  return (
    <section class={`flex flex-col gap-1 ${props.class ?? ""}`} aria-labelledby={props.id}>
      <div class="flex h-8 items-center gap-1 pl-3">
        <h2 id={props.id} class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted [font-weight:530]">
          <Show when={props.onTitle} fallback={props.title}>
            <button
              type="button"
              class="rounded-full text-left transition-colors duration-150 ease-standard hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
              onClick={() => props.onTitle?.()}
            >
              {props.title}
            </button>
          </Show>
        </h2>
        {props.actions}
      </div>
      {props.children}
    </section>
  )
}

/** Empty list or view: a centred message in the space the list would fill, with an optional action. */
export function PageEmpty(props: ParentProps<{ action?: JSX.Element; class?: string }>) {
  return (
    <div
      class={`flex min-h-40 flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center ${props.class ?? ""}`}
    >
      <p class="max-w-sm text-[14px] leading-5 text-v2-text-text-muted">{props.children}</p>
      {props.action}
    </div>
  )
}

/** Shared list-row look: a pill-shaped hover target. */
export const pageRowClass =
  "flex w-full min-w-0 items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-[background-color,border-radius] duration-200 ease-standard hover:bg-v2-overlay-simple-overlay-hover active:rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
