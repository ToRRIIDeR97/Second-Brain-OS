// Shared Material 3 classes for dialogs, popovers and composer menus.
// Floating surfaces sit on bg-layer-01 like DialogV2 and MenuV2; fills inside them use bg-layer-02.
// v2 component CSS is unlayered, so overrides of it need Tailwind's `!` modifier.

/** Floating popover surface: 24px corners. */
export const popoverSurfaceClass =
  "rounded-[24px] bg-v2-background-bg-layer-01 p-2 text-v2-text-text-base shadow-[var(--v2-elevation-floating)]"

/** MenuV2 items: 36px tall, 12px corners, accent container when checked. */
export const menuItemsClass =
  "[&_[data-component=menu-v2-item]]:!h-9 [&_[data-component=menu-v2-item]]:!rounded-[12px] [&_[data-component=menu-v2-item][data-checked]]:!bg-v2-background-bg-accent-container [&_[data-component=menu-v2-item][data-checked]]:![--menu-v2-accent:var(--v2-text-text-on-accent-container)] [&_[data-slot=menu-v2-separator]]:!mx-2 [&_[data-slot=menu-v2-separator]]:!my-1 [&_[data-slot=menu-v2-separator]]:!w-auto"

/** MenuV2.Content surface: 16px corners with 12px items. */
export const menuSurfaceClass = `!rounded-[16px] !p-1.5 ${menuItemsClass}`

/** Keyboard-active row highlight that layers over any background, including the accent container. */
export const activeOverlayClass =
  "![background-image:linear-gradient(var(--v2-overlay-simple-overlay-hover),var(--v2-overlay-simple-overlay-hover))]"

/** Pill search field; pair with a leading search icon positioned at `left-3`. */
export const searchFieldClass =
  "h-9 w-full min-w-0 rounded-full border-0 bg-v2-background-bg-layer-02 pl-9 pr-3 text-[13px] text-v2-text-text-base outline-none transition-shadow duration-short ease-standard placeholder:text-v2-text-text-faint focus-visible:shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] motion-reduce:transition-none"

/** Filled TextInputV2: 40px, 12px corners (from TextInputV2), focus ring from TextInputV2's outline. */
export const filledFieldClass = "!h-10 !w-full !bg-v2-background-bg-layer-02 !shadow-none"

/** Selectable list row: 16px corners, accent container when selected. */
export const listRowClass =
  "flex w-full min-w-0 items-center gap-3 rounded-[16px] px-3 py-2 text-left text-[13px] text-v2-text-text-base transition-[background-color,border-radius] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus aria-selected:bg-v2-background-bg-accent-container aria-selected:text-v2-text-text-on-accent-container motion-reduce:transition-none"

/** Restyles the legacy fuzzy-search `List` (no v2 equivalent): pill search, 16px rows, accent active row. */
export const listV2Class =
  "[&_[data-slot=list-search-wrapper]]:!pb-1 [&_[data-slot=list-search]]:!h-9 [&_[data-slot=list-search]]:!rounded-full [&_[data-slot=list-search]]:!bg-v2-background-bg-layer-02 [&_[data-slot=list-search]]:!px-3 [&_[data-slot=list-search]:focus-within]:!shadow-[inset_0_0_0_2px_var(--v2-border-border-focus)] [&_[data-slot=list-search]]:!text-[13px] [&_[data-slot=list-search]]:!text-v2-text-text-base [&_[data-slot=list-header]]:!bg-v2-background-bg-layer-01 [&_[data-slot=list-header]]:!text-[12px] [&_[data-slot=list-header]]:!text-v2-text-text-faint [&_[data-slot=list-header]]:![font-weight:530] [&_[data-slot=list-header]::after]:!hidden [&_[data-slot=list-message]]:!text-[13px] [&_[data-slot=list-message]]:!text-v2-text-text-muted [&_[data-slot=list-items]]:!gap-0.5 [&_[data-slot=list-item]]:!min-h-10 [&_[data-slot=list-item]]:!rounded-[16px] [&_[data-slot=list-item]]:!px-3 [&_[data-slot=list-item]]:!text-[13px] [&_[data-slot=list-item]]:![font-weight:440] [&_[data-slot=list-item]]:!text-v2-text-text-base [&_[data-slot=list-item]]:transition-[background-color,border-radius] [&_[data-slot=list-item]]:duration-short [&_[data-slot=list-item]]:ease-standard [&_[data-slot=list-item]:active]:!rounded-[12px] [&_[data-slot=list-item][data-active=true]]:!bg-v2-background-bg-accent-container [&_[data-slot=list-item][data-active=true]]:!text-v2-text-text-on-accent-container [&_[data-slot=list-item-divider]]:!hidden motion-reduce:[&_[data-slot=list-item]]:transition-none"

/** Turns a SwitchV2 into a hoverable row whose label (dot, name, sub-line) fills the space before the switch. */
export const switchRowClass =
  "!cursor-pointer transition-[background-color,border-radius] duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover active:rounded-[12px] motion-reduce:transition-none [&_[data-slot=switch-label]]:flex [&_[data-slot=switch-label]]:min-w-0 [&_[data-slot=switch-label]]:flex-1 [&_[data-slot=switch-label]]:cursor-pointer [&_[data-slot=switch-label]]:items-center [&_[data-slot=switch-label]]:gap-2.5"

/** Status dot colour for MCP, LSP and plugin rows. */
export function statusDotClass(status: string | undefined) {
  if (status === "connected") return "bg-v2-state-fg-success"
  if (status === "failed" || status === "error") return "bg-v2-state-fg-danger"
  if (status === "needs_auth" || status === "needs_client_registration") return "bg-v2-state-fg-warning"
  return "bg-v2-border-border-strong"
}
