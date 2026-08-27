import { Markdown } from "@opencode-ai/session-ui/markdown"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import {
  applyNoteEditorCommand,
  applySlashCommand,
  findSlashCommand,
  noteEditorCommands,
  type NoteEditorCommand,
  type SlashCommandRange,
  type TextEdit,
} from "./note-editor-commands"

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
}>

export type NoteEditorProps = {
  value: string
  onChange: (value: string) => void
  onSave: () => void | Promise<void>
  loading?: boolean
  labels?: NoteEditorLabels
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
  placeholder: "Write Markdown, or type / at the start of a line for commands...",
}

const controlClass =
  "h-7 shrink-0 rounded-[5px] px-2 text-[11px] text-v2-text-text-muted transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none"
const iconControlClass = `${controlClass} flex size-7 items-center justify-center px-0`
const toolbarCommands = noteEditorCommands.filter((command) =>
  ["h1", "h2", "h3", "bold", "italic", "strike", "bullet", "ordered", "task", "quote", "inline-code", "link"].includes(
    command.id,
  ),
)
const insertCommands = noteEditorCommands.filter((command) => !toolbarCommands.includes(command))

export function NoteEditor(props: NoteEditorProps) {
  const label = <K extends keyof Required<NoteEditorLabels>>(key: K) => props.labels?.[key] ?? defaults[key]
  const [mode, setMode] = createSignal<EditorMode>(props.value.trim() ? "preview" : "write")
  const [orientation, setOrientation] = createSignal<SplitOrientation>("side-by-side")
  const [split, setSplit] = createSignal(50)
  const [fullscreen, setFullscreen] = createSignal(false)
  const [insertOpen, setInsertOpen] = createSignal(false)
  const [slash, setSlash] = createSignal<SlashCommandRange>()
  const [activeCommand, setActiveCommand] = createSignal(0)
  let editor: HTMLTextAreaElement | undefined
  let panes: HTMLDivElement | undefined
  let internalValue: string | undefined
  let previousValue = props.value

  const commands = createMemo(() => {
    const query = slash()?.query.trim().toLowerCase() ?? ""
    if (!query) return noteEditorCommands
    return noteEditorCommands.filter((command) =>
      `${command.label} ${command.keywords} ${command.id}`.toLowerCase().includes(query),
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

  return (
    <section
      classList={{
        "flex min-h-[280px] min-w-0 flex-1 flex-col overflow-hidden bg-v2-background-bg-base": true,
        relative: !fullscreen(),
        "fixed inset-3 z-50 rounded-[8px] border border-v2-border-border-base shadow-2xl": fullscreen(),
      }}
      aria-label={label("editor")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        setSlash(undefined)
        setInsertOpen(false)
        setFullscreen(false)
      }}
    >
      <div class="flex min-h-10 shrink-0 items-center gap-1 border-b border-v2-border-border-base px-2">
        <div class="flex rounded-[6px] bg-v2-background-bg-layer-02 p-0.5">
          <ModeButton active={mode() === "write"} label={label("write")} onClick={() => setMode("write")} />
          <ModeButton active={mode() === "split"} label={label("split")} onClick={() => setMode("split")} />
          <ModeButton active={mode() === "preview"} label={label("preview")} onClick={() => setMode("preview")} />
        </div>
        <Show when={mode() === "split"}>
          <button
            type="button"
            class={iconControlClass}
            aria-label={orientation() === "side-by-side" ? label("stacked") : label("sideBySide")}
            aria-pressed={orientation() === "stacked"}
            onClick={() => setOrientation((value) => (value === "side-by-side" ? "stacked" : "side-by-side"))}
          >
            <Icon name={orientation() === "side-by-side" ? "layout-bottom" : "layout-left"} size="small" />
          </button>
        </Show>
        <span class="ml-auto hidden text-[11px] tabular-nums text-v2-text-text-faint sm:inline">
          {props.value.trim() ? props.value.trim().split(/\s+/).length : 0} words
        </span>
        <button
          type="button"
          class={iconControlClass}
          aria-label={fullscreen() ? label("exitFullscreen") : label("fullscreen")}
          aria-pressed={fullscreen()}
          onClick={() => setFullscreen((value) => !value)}
        >
          <Icon name={fullscreen() ? "collapse" : "expand"} size="small" />
        </button>
      </div>

      <Show when={mode() !== "preview"}>
        <div
          class="relative flex h-9 shrink-0 items-center gap-0.5 border-b border-v2-border-border-base px-2"
          role="toolbar"
          aria-label={label("toolbar")}
        >
          <For each={toolbarCommands}>
            {(command) => (
              <button
                type="button"
                class={controlClass}
                aria-label={command.label}
                title={command.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(command.id)}
              >
                {command.shortLabel}
              </button>
            )}
          </For>
          <span class="mx-1 h-4 w-px shrink-0 bg-v2-border-border-base" aria-hidden="true" />
          <button
            type="button"
            class={controlClass}
            aria-expanded={insertOpen()}
            aria-haspopup="menu"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setInsertOpen((value) => !value)}
          >
            Insert
          </button>
          <Show when={insertOpen()}>
            <div
              role="menu"
              class="absolute right-2 top-8 z-30 w-52 rounded-[7px] border border-v2-border-border-base bg-v2-background-bg-layer-02 p-1 shadow-lg"
            >
              <For each={insertCommands}>
                {(command) => (
                  <button
                    type="button"
                    role="menuitem"
                    class="flex h-8 w-full items-center justify-between rounded-[5px] px-2 text-left text-[12px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-03 hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(command.id)}
                  >
                    <span>{command.label}</span>
                    <span class="text-[10px] text-v2-text-text-faint">{command.shortLabel}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show
        when={!props.loading}
        fallback={
          <div class="flex flex-1 items-center justify-center text-[13px] text-v2-text-text-faint">Loading...</div>
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
              <Show when={slash()}>
                <div
                  id="note-editor-slash-menu"
                  role="listbox"
                  aria-label={label("slashMenu")}
                  class="absolute left-5 top-12 z-20 max-h-64 w-64 overflow-y-auto rounded-[7px] border border-v2-border-border-base bg-v2-background-bg-layer-02 p-1 shadow-lg"
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
                          class="flex h-8 w-full items-center justify-between rounded-[5px] px-2 text-left text-[12px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-03 hover:text-v2-text-text-base aria-selected:bg-v2-background-bg-layer-03 aria-selected:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus"
                          onMouseEnter={() => setActiveCommand(index())}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => run(command.id, slash())}
                        >
                          <span>{command.label}</span>
                          <span class="text-[10px] text-v2-text-text-faint">{command.shortLabel}</span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
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
              classList={{
                "min-h-0 min-w-0 overflow-auto px-5 py-4": true,
                "flex-1": mode() !== "split",
              }}
              style={{ "flex-basis": mode() === "split" ? `${100 - split()}%` : "100%" }}
              role="region"
              aria-label={label("previewRegion")}
            >
              <Markdown text={props.value} class="max-w-none text-[15px] leading-7 [&_h1:first-child]:hidden" />
            </div>
          </Show>
        </div>
      </Show>
    </section>
  )
}

function ModeButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class={`${controlClass} ${props.active ? "bg-v2-background-bg-base text-v2-text-text-base" : ""}`}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}
