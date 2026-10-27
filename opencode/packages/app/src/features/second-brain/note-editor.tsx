import { Markdown } from "@opencode-ai/session-ui/markdown"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { Presence } from "@opencode-ai/ui/v2/presence"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js"
import {
  applyNoteEditorCommand,
  applySlashCommand,
  findSlashCommand,
  noteEditorCommands,
  type NoteEditorCommand,
  type SlashCommandRange,
  type TextEdit,
} from "./note-editor-commands"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { replayAnimation } from "@/utils/replay-animation"

type EditorMode = "write" | "split" | "preview"
type SplitOrientation = "side-by-side" | "stacked"

export type NoteEditorLabels = Partial<{
  editor: string
  previewRegion: string
  toolbar: string
  write: string
  split: string
  preview: string
  fullscreen: string
  exitFullscreen: string
  sideBySide: string
  stacked: string
  resize: string
  slashMenu: string
  slashEmpty: string
  placeholder: string
  insert: string
  words: (count: number) => string
}>

export type NoteEditorProps = {
  value: string
  onOpenNote?: (path: string) => void
  previewText?: string
  onChange: (value: string) => void
  onSave: () => void | Promise<void>
  loading?: boolean
  commandLabel?: (id: NoteEditorCommand) => string
  labels?: NoteEditorLabels
  /** Shown in the toolbar while fullscreen, e.g. the saved state and Save, which the page header covers otherwise. */
  fullscreenActions?: JSX.Element
}

const defaults: Required<NoteEditorLabels> = {
  editor: "Note editor",
  previewRegion: "Markdown preview",
  toolbar: "Markdown formatting",
  write: "Write",
  split: "Split",
  preview: "Preview",
  fullscreen: "Enter fullscreen",
  exitFullscreen: "Exit fullscreen",
  sideBySide: "Use side-by-side split",
  stacked: "Use stacked split",
  resize: "Resize editor and preview",
  slashMenu: "Insert block",
  slashEmpty: "No matching commands",
  insert: "Insert",
  words: (count) => `${count} words`,
  placeholder: "Write Markdown, or type / at the start of a line for commands...",
}

// Compact glyphs for the circular formatting buttons; the tooltip and aria-label carry the full name.
const glyph: Partial<Record<NoteEditorCommand, string>> = {
  h1: "H1",
  h2: "H2",
  h3: "H3",
  bold: "B",
  italic: "I",
  strike: "S",
  bullet: "•",
  ordered: "1.",
  task: "☐",
  quote: "“",
  "inline-code": "</>",
  link: "↗",
}
const glyphClass: Partial<Record<NoteEditorCommand, string>> = {
  bold: "[font-weight:700]",
  italic: "italic",
  strike: "line-through",
  "inline-code": "font-mono text-[10px]",
}
const toolbarCommands = noteEditorCommands.filter((command) =>
  ["h1", "h2", "h3", "bold", "italic", "strike", "bullet", "ordered", "task", "quote", "inline-code", "link"].includes(
    command.id,
  ),
)
const insertCommands = noteEditorCommands.filter((command) => !toolbarCommands.includes(command))

// Formatting shortcuts, registered as commands so they win over global ones (mod+b toggles the sidebar elsewhere).
const shortcuts: Partial<Record<NoteEditorCommand, string>> = { bold: "mod+b", italic: "mod+i" }

export function NoteEditor(props: NoteEditorProps) {
  const language = useLanguage()
  const command = useCommand()
  const label = <K extends keyof Required<NoteEditorLabels>>(key: K) => props.labels?.[key] ?? defaults[key]
  const commandLabel = (command: (typeof noteEditorCommands)[number]) =>
    props.commandLabel?.(command.id) ?? command.label
  const [mode, setMode] = createSignal<EditorMode>(props.value.trim() ? "preview" : "write")
  const [orientation, setOrientation] = createSignal<SplitOrientation>("side-by-side")
  const [split, setSplit] = createSignal(50)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [insertOpen, setInsertOpen] = createSignal(false)
  const [slash, setSlash] = createSignal<SlashCommandRange>()
  // The slash menu keeps its last query while it fades out.
  const menuSlash = createMemo<SlashCommandRange | undefined>((previous) => slash() ?? previous)
  const [activeCommand, setActiveCommand] = createSignal(0)
  let editor: HTMLTextAreaElement | undefined
  let panes: HTMLDivElement | undefined
  let internalValue: string | undefined
  let previousValue = props.value

  const commands = createMemo(() => {
    const query = menuSlash()?.query.trim().toLowerCase() ?? ""
    if (!query) return noteEditorCommands
    return noteEditorCommands.filter((command) =>
      `${commandLabel(command)} ${command.keywords} ${command.id}`.toLowerCase().includes(query),
    )
  })

  createEffect(() => {
    const value = props.value
    if (value === internalValue) {
      internalValue = undefined
      previousValue = value
      return
    }
    if (value === previousValue) return
    previousValue = value
    setMode(value.trim() ? "preview" : "write")
    setSlash(undefined)
  })

  createEffect(() => {
    slash()?.query
    setActiveCommand(0)
  })

  const commit = (edit: TextEdit) => {
    internalValue = edit.value
    previousValue = edit.value
    props.onChange(edit.value)
    setSlash(undefined)
    setInsertOpen(false)
    if (mode() === "preview") setMode("write")
    queueMicrotask(() => {
      editor?.focus()
      editor?.setSelectionRange(edit.selection.start, edit.selection.end)
    })
  }

  const selection = () => ({
    start: editor?.selectionStart ?? props.value.length,
    end: editor?.selectionEnd ?? props.value.length,
  })

  const run = (command: NoteEditorCommand, slashRange?: SlashCommandRange) => {
    const edit = slashRange
      ? applySlashCommand(command, props.value, slashRange)
      : applyNoteEditorCommand(command, props.value, selection())
    commit(edit)
  }

  command.register("note-editor", () =>
    toolbarCommands.flatMap((item) => {
      const keybind = shortcuts[item.id]
      if (!keybind) return []
      return [
        {
          id: `note-editor.${item.id}`,
          title: commandLabel(item),
          keybind,
          hidden: true,
          // Only while typing in this editor; elsewhere the key keeps its global meaning.
          when: (event: KeyboardEvent) => !!editor && event.target === editor,
          onSelect: () => run(item.id),
        },
      ]
    }),
  )

  // A pane or the toolbar that a mode change shows fades in; one shown by loading a note does not.
  const switching = { current: false }
  const enterOnSwitch = (element: HTMLElement) => {
    if (switching.current) replayAnimation(element)
  }

  const changeMode = (value: EditorMode) => {
    switching.current = true
    setMode(value)
    switching.current = false
    if (value !== "preview") queueMicrotask(() => editor?.focus())
  }

  const onInput = (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const value = event.currentTarget.value
    internalValue = value
    previousValue = value
    props.onChange(value)
    setSlash(findSlashCommand(value, event.currentTarget.selectionStart))
  }

  const onEditorKeyDown = (event: KeyboardEvent) => {
    const menu = slash()
    if (menu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const count = commands().length
        if (count) setActiveCommand((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + count) % count)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const command = commands()[activeCommand()]
        if (command) {
          event.preventDefault()
          run(command.id, menu)
        }
        return
      }
    }

    if (event.key === "Escape") {
      if (menu || insertOpen() || fullscreen()) event.preventDefault()
      setSlash(undefined)
      setInsertOpen(false)
      setFullscreen(false)
      return
    }
    if (!(event.metaKey || event.ctrlKey)) return
    const key = event.key.toLowerCase()
    if (key === "s") {
      event.preventDefault()
      void props.onSave()
    }
    if (key === "b" || key === "i") {
      event.preventDefault()
      run(key === "b" ? "bold" : "italic")
    }
  }

  const commandKeys = (id: NoteEditorCommand) => command.keybindParts(`note-editor.${id}`)

  const resize = (event: PointerEvent) => {
    if (!panes) return
    const rect = panes.getBoundingClientRect()
    const percent =
      orientation() === "side-by-side"
        ? ((event.clientX - rect.left) / rect.width) * 100
        : ((event.clientY - rect.top) / rect.height) * 100
    setSplit(Math.max(20, Math.min(80, percent)))
  }

  const onResizeKeyDown = (event: KeyboardEvent) => {
    const direction =
      orientation() === "side-by-side"
        ? event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowRight"
            ? 1
            : 0
        : event.key === "ArrowUp"
          ? -1
          : event.key === "ArrowDown"
            ? 1
            : 0
    if (!direction) return
    event.preventDefault()
    setSplit((value) => Math.max(20, Math.min(80, value + direction * 5)))
  }

  let surface: HTMLElement | undefined
  // Entering and leaving fullscreen fades the editor in at its new size.
  createEffect(on(fullscreen, () => replayAnimation(surface), { defer: true }))

  return (
    <section
      ref={surface}
      classList={{
        "flex min-h-[280px] min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] bg-v2-background-bg-base shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]": true,
        relative: !fullscreen(),
        "fixed inset-3 z-50 !rounded-[24px] shadow-2xl": fullscreen(),
      }}
      aria-label={label("editor")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        setSlash(undefined)
        setInsertOpen(false)
        setFullscreen(false)
      }}
    >
      <div class="relative flex min-h-12 shrink-0 flex-wrap items-center gap-1 px-2 py-1.5">
        <SegmentedControlV2
          class="!w-auto"
          value={mode()}
          onChange={(value) => value && changeMode(value as EditorMode)}
        >
          <SegmentedControlItemV2 value="write">{label("write")}</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="split">{label("split")}</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="preview">{label("preview")}</SegmentedControlItemV2>
        </SegmentedControlV2>
        <Show when={mode() !== "preview"}>
          <div
            ref={enterOnSwitch}
            class="flex min-w-0 flex-wrap items-center gap-0.5 pl-1"
            role="toolbar"
            aria-label={label("toolbar")}
          >
            <For each={toolbarCommands}>
              {(command) => (
                <TooltipV2
                  value={
                    <>
                      {commandLabel(command)}
                      <Show when={shortcuts[command.id]}>
                        <KeybindV2 keys={commandKeys(command.id)} variant="neutral" />
                      </Show>
                    </>
                  }
                >
                  <IconButtonV2
                    type="button"
                    variant="ghost-muted"
                    size="large"
                    aria-label={commandLabel(command)}
                    icon={
                      <span class={`text-[12px] leading-none ${glyphClass[command.id] ?? ""}`}>
                        {glyph[command.id]}
                      </span>
                    }
                    onMouseDown={(event: MouseEvent) => event.preventDefault()}
                    onClick={() => run(command.id)}
                  />
                </TooltipV2>
              )}
            </For>
            <TooltipV2 value={label("insert")}>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="large"
                aria-label={label("insert")}
                aria-expanded={insertOpen()}
                aria-haspopup="menu"
                icon={<Icon name="plus" size="small" />}
                onMouseDown={(event: MouseEvent) => event.preventDefault()}
                onClick={() => setInsertOpen((value) => !value)}
              />
            </TooltipV2>
          </div>
        </Show>
        <div class="ml-auto flex items-center gap-1">
          <Show when={fullscreen()}>{props.fullscreenActions}</Show>
          <Show when={props.value.trim()}>
            <span class="hidden px-1 text-[11px] tabular-nums text-v2-text-text-faint sm:inline">
              {label("words")(props.value.trim().split(/\s+/).length)}
            </span>
          </Show>
          <Show when={mode() === "split"}>
            <TooltipV2 value={orientation() === "side-by-side" ? label("stacked") : label("sideBySide")}>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="large"
                aria-label={orientation() === "side-by-side" ? label("stacked") : label("sideBySide")}
                aria-pressed={orientation() === "stacked"}
                icon={<Icon name={orientation() === "side-by-side" ? "unified" : "split"} size="small" />}
                onClick={() => setOrientation((value) => (value === "side-by-side" ? "stacked" : "side-by-side"))}
              />
            </TooltipV2>
          </Show>
          <TooltipV2 value={fullscreen() ? label("exitFullscreen") : label("fullscreen")}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="large"
              aria-label={fullscreen() ? label("exitFullscreen") : label("fullscreen")}
              aria-pressed={fullscreen()}
              icon={<Icon name={fullscreen() ? "collapse" : "expand"} size="small" />}
              onClick={() => setFullscreen((value) => !value)}
            />
          </TooltipV2>
        </div>
        <Presence
          when={insertOpen() && mode() !== "preview"}
          class="absolute right-2 top-11 z-30 origin-top-right"
          enterClass="animate-menu-enter"
          exitClass="animate-menu-exit"
        >
          <div
            role="menu"
            class="w-56 rounded-[16px] bg-v2-background-bg-layer-02 p-1.5 shadow-[var(--v2-elevation-raised)]"
          >
            <For each={insertCommands}>
              {(command) => (
                <button
                  type="button"
                  role="menuitem"
                  class="flex h-9 w-full items-center justify-between rounded-[12px] px-3 text-left text-[12px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(command.id)}
                >
                  <span>{commandLabel(command)}</span>
                  <span class="text-[10px] text-v2-text-text-faint">{command.shortLabel}</span>
                </button>
              )}
            </For>
          </div>
        </Presence>
      </div>

      <Show
        when={!props.loading}
        fallback={
          <div class="flex flex-1 items-center justify-center text-[13px] text-v2-text-text-faint">
            {language.t("common.loading")}
            {language.t("common.loading.ellipsis")}
          </div>
        }
      >
        <div
          ref={panes}
          classList={{
            "relative flex min-h-0 flex-1": true,
            "flex-col": mode() === "split" && orientation() === "stacked",
          }}
        >
          <Show when={mode() !== "preview"}>
            <div
              ref={enterOnSwitch}
              classList={{
                "relative min-h-0 min-w-0": true,
                "flex-1": mode() !== "split",
              }}
              style={{ "flex-basis": mode() === "split" ? `${split()}%` : "100%" }}
            >
              <textarea
                ref={editor}
                class="h-full min-h-[280px] w-full resize-none border-0 bg-transparent px-5 py-4 font-sans text-[15px] leading-7 text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint focus-visible:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)]"
                aria-label={label("editor")}
                aria-controls={slash() ? "note-editor-slash-menu" : undefined}
                aria-expanded={Boolean(slash())}
                aria-activedescendant={
                  slash() && commands().length ? `note-editor-command-${activeCommand()}` : undefined
                }
                placeholder={label("placeholder")}
                value={props.value}
                onInput={onInput}
                onClick={(event) => setSlash(findSlashCommand(props.value, event.currentTarget.selectionStart))}
                onKeyUp={(event) => {
                  if (["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) return
                  setSlash(findSlashCommand(props.value, event.currentTarget.selectionStart))
                }}
                onKeyDown={onEditorKeyDown}
              />
              <Presence
                when={Boolean(slash())}
                class="absolute left-5 top-12 z-20 origin-top-left"
                enterClass="animate-menu-enter"
                exitClass="animate-menu-exit"
              >
                <div
                  id="note-editor-slash-menu"
                  role="listbox"
                  aria-label={label("slashMenu")}
                  class="max-h-64 w-64 overflow-y-auto rounded-[16px] bg-v2-background-bg-layer-02 p-1.5 shadow-[var(--v2-elevation-raised)]"
                >
                  <Show
                    when={commands().length}
                    fallback={<p class="px-2 py-1.5 text-[12px] text-v2-text-text-faint">{label("slashEmpty")}</p>}
                  >
                    <For each={commands()}>
                      {(command, index) => (
                        <button
                          id={`note-editor-command-${index()}`}
                          type="button"
                          role="option"
                          aria-selected={activeCommand() === index()}
                          class="flex h-9 w-full items-center justify-between rounded-[12px] px-3 text-left text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base aria-selected:bg-v2-background-bg-accent-container aria-selected:text-v2-text-text-on-accent-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                          onMouseEnter={() => setActiveCommand(index())}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            const range = slash()
                            if (range) run(command.id, range)
                          }}
                        >
                          <span>{commandLabel(command)}</span>
                          <span class="text-[10px] text-v2-text-text-faint">{command.shortLabel}</span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </Presence>
            </div>
          </Show>

          <Show when={mode() === "split"}>
            <div
              role="separator"
              tabindex="0"
              aria-label={label("resize")}
              aria-orientation={orientation() === "side-by-side" ? "vertical" : "horizontal"}
              aria-valuemin="20"
              aria-valuemax="80"
              aria-valuenow={Math.round(split())}
              classList={{
                "z-10 shrink-0 bg-v2-border-border-base transition-colors hover:bg-v2-border-border-focus focus-visible:bg-v2-border-border-focus focus-visible:outline-none motion-reduce:transition-none": true,
                "w-1 cursor-col-resize": orientation() === "side-by-side",
                "h-1 cursor-row-resize": orientation() === "stacked",
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                resize(event)
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event)
              }}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              onKeyDown={onResizeKeyDown}
            />
          </Show>

          <Show when={mode() !== "write"}>
            <div
              ref={enterOnSwitch}
              classList={{
                "min-h-0 min-w-0 overflow-auto px-5 py-4": true,
                "flex-1": mode() !== "split",
              }}
              style={{ "flex-basis": mode() === "split" ? `${100 - split()}%` : "100%" }}
              role="region"
              aria-label={label("previewRegion")}
              on:click={(event) => {
                const link = event.target instanceof Element ? event.target.closest("a") : null
                if (!props.onOpenNote || !link) return
                const url = new URL(link.href)
                if (url.origin !== window.location.origin || url.pathname !== "/notes") return
                const path = url.searchParams.get("note")
                if (!path) return
                event.preventDefault()
                event.stopPropagation()
                props.onOpenNote(path)
              }}
            >
              <Markdown text={props.previewText ?? props.value} class="max-w-none text-[15px] leading-7" />
            </div>
          </Show>
        </div>
      </Show>
    </section>
  )
}
