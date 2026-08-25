import { useSearchParams } from "@solidjs/router"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createEffect, createMemo, createResource, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import {
  listNotes,
  listProjects,
  readNote,
  SecondBrainRequestError,
  writeNote,
  type NoteDocument,
  type NoteSummary,
} from "@/features/second-brain/client"

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

type State = {
  directory: string
  path: string
  body: string
  baseBody: string
  title: string
  baseTitle: string
  projectIds: string[]
  baseProjectIds: string[]
  tags: string
  baseTags: string
  revision: string
  newTitle: string
  creating: boolean
  saving: boolean
  mode: "write" | "split" | "preview"
  filterProjectId: string
  search: string
  error: string
}

export default function NotesPage() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const [search] = useSearchParams<{ project?: string }>()
  const [state, setState] = createStore<State>({
    directory: "",
    path: "",
    body: "",
    baseBody: "",
    title: "",
    baseTitle: "",
    projectIds: [],
    baseProjectIds: [],
    tags: "",
    baseTags: "",
    revision: "",
    newTitle: "",
    creating: false,
    saving: false,
    mode: "write",
    filterProjectId: search.project ?? "",
    search: "",
    error: "",
  })
  let editor: HTMLTextAreaElement | undefined
  const workspaces = layout.projects.list
  const dirty = createMemo(
    () =>
      state.path !== "" &&
      (state.body !== state.baseBody ||
        state.title !== state.baseTitle ||
        state.projectIds.join("\0") !== state.baseProjectIds.join("\0") ||
        state.tags !== state.baseTags),
  )
  const client = (directory: string) => ({
    server: serverSDK().server,
    fetch: platform.fetch,
    target: { directory },
  })

  createEffect(() => {
    const available = workspaces()
    if (available.some((project) => project.worktree === state.directory)) return
    const preferred = layout.home.selection().directory
    setState(
      "directory",
      available.find((project) => project.worktree === preferred)?.worktree ?? available[0]?.worktree ?? "",
    )
  })

  const [notes, noteActions] = createResource(
    () => state.directory || undefined,
    (directory) => listNotes(client(directory)),
  )
  const [projects] = createResource(
    () => state.directory || undefined,
    (directory) => listProjects(client(directory)),
  )
  const [loadedNote] = createResource(
    () => (state.directory && state.path ? ([state.directory, state.path] as const) : undefined),
    ([directory, path]) => readNote(client(directory), path),
  )
  const visibleNotes = createMemo(() => {
    const query = state.search.trim().toLowerCase()
    return (notes() ?? []).filter(
      (note) =>
        (!state.filterProjectId || note.projectIds.includes(state.filterProjectId)) &&
        (!query ||
          note.title.toLowerCase().includes(query) ||
          note.path.toLowerCase().includes(query) ||
          note.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          note.links.some((link) => link.toLowerCase().includes(query))),
    )
  })
  const currentKeys = createMemo(() => noteKeys({ path: state.path, title: state.title }))
  const backlinks = createMemo(() =>
    (notes() ?? []).filter(
      (note) => note.path !== state.path && note.links.some((link) => currentKeys().has(normalizeWikiTarget(link))),
    ),
  )
  const outgoing = createMemo(() => {
    const targets = new Set(
      (notes() ?? []).find((note) => note.path === state.path)?.links.map(normalizeWikiTarget) ?? [],
    )
    return (notes() ?? []).filter(
      (note) => note.path !== state.path && [...noteKeys(note)].some((key) => targets.has(key)),
    )
  })
  const relatedNotes = createMemo(() => [
    ...new Map([...outgoing(), ...backlinks()].map((note) => [note.path, note] as const)).values(),
  ])

  const applyDocument = (document: NoteDocument) => {
    const projectIds = [...document.info.projectIds]
    const tags = document.info.tags.join(", ")
    setState({
      body: document.body,
      baseBody: document.body,
      title: document.info.title,
      baseTitle: document.info.title,
      projectIds,
      baseProjectIds: projectIds,
      tags,
      baseTags: tags,
      revision: document.revision,
      error: "",
    })
  }

  createEffect(
    on(loadedNote, (document) => {
      if (document) applyDocument(document)
    }),
  )

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty()) return
    event.preventDefault()
    event.returnValue = ""
  }
  window.addEventListener("beforeunload", beforeUnload)
  onCleanup(() => window.removeEventListener("beforeunload", beforeUnload))

  const report = (error: unknown) => {
    setState(
      "error",
      error instanceof SecondBrainRequestError && error.status === 409
        ? language.t("secondBrain.notes.error.conflict")
        : language.t("secondBrain.error.request"),
    )
  }

  const chooseNote = (note: NoteSummary) => {
    if (dirty()) {
      setState("error", language.t("secondBrain.notes.error.unsaved"))
      return
    }
    setState({
      path: note.path,
      body: "",
      baseBody: "",
      title: note.title,
      baseTitle: note.title,
      projectIds: [...note.projectIds],
      baseProjectIds: [...note.projectIds],
      tags: note.tags.join(", "),
      baseTags: note.tags.join(", "),
      revision: "",
      mode: "write",
      error: "",
    })
  }

  const createNote = async () => {
    const title = state.newTitle.trim()
    const slug = slugify(title)
    if (!title || !slug || !state.directory) {
      setState("error", language.t("secondBrain.notes.error.title"))
      return
    }
    const path = `notes/${slug}.md`
    setState({ saving: true, error: "" })
    try {
      const document = await writeNote(client(state.directory), {
        path,
        title,
        body: `# ${title}\n\n`,
        projectIds: state.filterProjectId ? [state.filterProjectId] : [],
        tags: [],
        create: true,
      })
      await noteActions.refetch()
      setState({ path, newTitle: "", creating: false, mode: "write" })
      applyDocument(document)
    } catch (error) {
      report(error)
    } finally {
      setState("saving", false)
    }
  }

  const save = async () => {
    if (!state.directory || !state.path || !dirty()) return
    const title = state.title.trim()
    if (!title) {
      setState("error", language.t("secondBrain.notes.error.title"))
      return
    }
    setState({ saving: true, error: "" })
    try {
      const document = await writeNote(client(state.directory), {
        path: state.path,
        body: state.body,
        title,
        projectIds: state.projectIds,
        tags: state.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        expectedRevision: state.revision,
      })
      applyDocument(document)
      await noteActions.refetch()
    } catch (error) {
      report(error)
    } finally {
      setState("saving", false)
    }
  }

  const discard = () =>
    setState({
      body: state.baseBody,
      title: state.baseTitle,
      projectIds: [...state.baseProjectIds],
      tags: state.baseTags,
      error: "",
    })

  const applyInline = (prefix: string, suffix = prefix, placeholder = language.t("secondBrain.notes.format.text")) => {
    if (!editor) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = state.body.slice(start, end) || placeholder
    const inserted = `${prefix}${selected}${suffix}`
    setState("body", `${state.body.slice(0, start)}${inserted}${state.body.slice(end)}`)
    queueMicrotask(() => {
      editor?.focus()
      editor?.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
    })
  }

  const applyLinePrefix = (prefix: string) => {
    if (!editor) return
    const selectionStart = editor.selectionStart
    const selectionEnd = editor.selectionEnd
    const start = state.body.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1
    setState("body", `${state.body.slice(0, start)}${prefix}${state.body.slice(start)}`)
    queueMicrotask(() => {
      editor?.focus()
      editor?.setSelectionRange(selectionStart + prefix.length, selectionEnd + prefix.length)
    })
  }

  const handleEditorKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return
    const key = event.key.toLowerCase()
    if (key === "s") {
      event.preventDefault()
      void save()
      return
    }
    if (key === "b") {
      event.preventDefault()
      applyInline("**")
      return
    }
    if (key === "i") {
      event.preventDefault()
      applyInline("_")
    }
  }

  return (
    <section class="flex h-full min-h-0 w-full flex-col gap-2 p-2" aria-labelledby="notes-title">
      <header class="flex min-h-12 shrink-0 items-center gap-3 rounded-[10px] bg-v2-background-bg-base px-4 shadow-[var(--v2-elevation-raised)]">
        <div class="min-w-0 flex-1">
          <h1 id="notes-title" class="text-[15px] text-v2-text-text-strong [font-weight:530]">
            {language.t("secondBrain.notes.title")}
          </h1>
          <p class="truncate text-[12px] text-v2-text-text-faint">{language.t("secondBrain.notes.description")}</p>
        </div>
        <Show when={workspaces().length > 0}>
          <label class="flex items-center gap-2 text-[12px] text-v2-text-text-muted">
            <span>{language.t("secondBrain.workspace")}</span>
            <select
              class="h-8 max-w-56 cursor-pointer rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[12px] text-v2-text-text-base outline-none focus-visible:border-v2-border-border-focus"
              value={state.directory}
              disabled={dirty()}
              onChange={(event) => setState({ directory: event.currentTarget.value, path: "", body: "", baseBody: "" })}
            >
              <For each={workspaces()}>
                {(project) => (
                  <option value={project.worktree}>{project.name ?? project.worktree.split(/[\\/]/).pop()}</option>
                )}
              </For>
            </select>
          </label>
        </Show>
      </header>

      <Show
        when={state.directory}
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center rounded-[10px] bg-v2-background-bg-base text-[13px] text-v2-text-text-muted shadow-[var(--v2-elevation-raised)]">
            {language.t("secondBrain.empty.workspace")}
          </div>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
          <aside class="flex max-h-64 w-full shrink-0 flex-col overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)] md:max-h-none md:w-64">
            <div class="flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-weak px-3">
              <span class="min-w-0 flex-1 text-[13px] text-v2-text-text-muted [font-weight:530]">
                {language.t("secondBrain.notes.list")}
              </span>
              <ButtonV2
                size="small"
                variant="ghost-muted"
                icon="plus"
                disabled={dirty()}
                onClick={() => setState({ creating: true, error: "" })}
              >
                {language.t("secondBrain.notes.new")}
              </ButtonV2>
            </div>
            <label class="flex shrink-0 flex-col gap-1.5 border-b border-v2-border-border-weak p-3 text-[11px] text-v2-text-text-faint">
              {language.t("secondBrain.notes.filterProject")}
              <select
                class="h-8 cursor-pointer rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 text-[12px] text-v2-text-text-base outline-none focus-visible:border-v2-border-border-focus"
                value={state.filterProjectId}
                onChange={(event) => setState("filterProjectId", event.currentTarget.value)}
              >
                <option value="">{language.t("secondBrain.notes.allProjects")}</option>
                <For each={projects()}>{(project) => <option value={project.id}>{project.name}</option>}</For>
              </select>
            </label>
            <div class="shrink-0 border-b border-v2-border-border-weak p-3">
              <TextInputV2
                aria-label={language.t("secondBrain.notes.search")}
                placeholder={language.t("secondBrain.notes.search")}
                value={state.search}
                onInput={(event) => setState("search", event.currentTarget.value)}
              />
            </div>
            <Show when={state.creating}>
              <form
                class="flex shrink-0 flex-col gap-2 border-b border-v2-border-border-weak p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void createNote()
                }}
              >
                <label class="text-[12px] text-v2-text-text-muted" for="new-note-title">
                  {language.t("secondBrain.notes.name")}
                </label>
                <TextInputV2
                  id="new-note-title"
                  appearance="large"
                  autofocus
                  value={state.newTitle}
                  onInput={(event) => setState("newTitle", event.currentTarget.value)}
                />
                <div class="flex justify-end gap-2">
                  <ButtonV2 type="button" size="small" variant="ghost" onClick={() => setState("creating", false)}>
                    {language.t("common.cancel")}
                  </ButtonV2>
                  <ButtonV2 type="submit" size="small" variant="contrast" disabled={state.saving}>
                    {language.t("secondBrain.notes.create")}
                  </ButtonV2>
                </div>
              </form>
            </Show>
            <div class="min-h-0 flex-1 overflow-y-auto p-2">
              <Show
                when={!notes.loading}
                fallback={<p class="p-2 text-[12px] text-v2-text-text-faint">{language.t("common.loading")}</p>}
              >
                <Show
                  when={visibleNotes().length > 0}
                  fallback={
                    <p class="p-2 text-[12px] text-v2-text-text-faint">{language.t("secondBrain.notes.empty")}</p>
                  }
                >
                  <For each={visibleNotes()}>
                    {(note) => (
                      <button
                        type="button"
                        data-selected={state.path === note.path ? "" : undefined}
                        class="flex min-h-10 w-full cursor-pointer flex-col justify-center rounded-[6px] px-2 text-left transition-colors duration-[120ms] hover:bg-v2-background-bg-layer-01 data-[selected]:bg-v2-background-bg-layer-03 focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"
                        onClick={() => chooseNote(note)}
                      >
                        <span class="w-full truncate text-[13px] text-v2-text-text-base">{note.title}</span>
                        <Show when={note.projectIds[0]}>
                          {(id) => (
                            <span class="w-full truncate text-[11px] text-v2-text-text-faint">
                              {projects()?.find((project) => project.id === id())?.name ?? id()}
                            </span>
                          )}
                        </Show>
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </aside>

          <article class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
            <Show
              when={state.path}
              fallback={
                <div class="flex flex-1 items-center justify-center text-[13px] text-v2-text-text-faint">
                  {language.t("secondBrain.notes.select")}
                </div>
              }
            >
              <div class="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-v2-border-border-weak px-3 py-2">
                <TextInputV2
                  class="min-w-48 flex-1"
                  aria-label={language.t("secondBrain.notes.name")}
                  value={state.title}
                  onInput={(event) => setState("title", event.currentTarget.value)}
                />
                <div class="flex rounded-[6px] bg-v2-background-bg-layer-02 p-0.5">
                  <ButtonV2
                    size="small"
                    variant={state.mode === "write" ? "outline" : "ghost-muted"}
                    onClick={() => setState("mode", "write")}
                  >
                    {language.t("secondBrain.notes.write")}
                  </ButtonV2>
                  <ButtonV2
                    size="small"
                    variant={state.mode === "split" ? "outline" : "ghost-muted"}
                    onClick={() => setState("mode", "split")}
                  >
                    {language.t("secondBrain.notes.split")}
                  </ButtonV2>
                  <ButtonV2
                    size="small"
                    variant={state.mode === "preview" ? "outline" : "ghost-muted"}
                    onClick={() => setState("mode", "preview")}
                  >
                    {language.t("secondBrain.notes.preview")}
                  </ButtonV2>
                </div>
                <span class="text-[11px] text-v2-text-text-faint">
                  {dirty() ? language.t("secondBrain.notes.unsaved") : language.t("secondBrain.notes.saved")}
                </span>
                <ButtonV2 size="small" variant="ghost" disabled={!dirty() || state.saving} onClick={discard}>
                  {language.t("secondBrain.notes.discard")}
                </ButtonV2>
                <ButtonV2
                  size="small"
                  variant="contrast"
                  disabled={!dirty() || state.saving}
                  onClick={() => void save()}
                >
                  {state.saving ? language.t("secondBrain.saving") : language.t("common.save")}
                </ButtonV2>
              </div>
              <div class="grid shrink-0 gap-2 border-b border-v2-border-border-weak px-3 py-2 sm:grid-cols-2">
                <div
                  class="flex min-w-0 items-start gap-2 text-[11px] text-v2-text-text-faint"
                  role="group"
                  aria-label={language.t("secondBrain.notes.projects")}
                >
                  <span class="mt-1.5 shrink-0">{language.t("secondBrain.notes.projects")}</span>
                  <div class="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-1">
                    <Show
                      when={(projects()?.length ?? 0) > 0}
                      fallback={
                        <span class="px-1 text-v2-text-text-faint">{language.t("secondBrain.notes.noProject")}</span>
                      }
                    >
                      <For each={projects()}>
                        {(project) => (
                          <label class="flex cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-[11px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-02">
                            <input
                              type="checkbox"
                              class="size-3 accent-v2-icon-icon-accent"
                              checked={state.projectIds.includes(project.id)}
                              onChange={(event) =>
                                setState(
                                  "projectIds",
                                  event.currentTarget.checked
                                    ? [...state.projectIds, project.id]
                                    : state.projectIds.filter((id) => id !== project.id),
                                )
                              }
                            />
                            <span class="max-w-36 truncate">{project.name}</span>
                          </label>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
                <label class="flex min-w-0 items-center gap-2 text-[11px] text-v2-text-text-faint">
                  <span class="shrink-0">{language.t("secondBrain.notes.tags")}</span>
                  <TextInputV2
                    class="min-w-0 flex-1"
                    value={state.tags}
                    placeholder={language.t("secondBrain.notes.tagsPlaceholder")}
                    onInput={(event) => setState("tags", event.currentTarget.value)}
                  />
                </label>
              </div>
              <Show when={state.mode !== "preview"}>
                <div
                  class="flex h-9 shrink-0 items-center gap-1 border-b border-v2-border-border-weak px-3"
                  role="toolbar"
                  aria-label={language.t("secondBrain.notes.format.toolbar")}
                >
                  <FormatButton
                    label={language.t("secondBrain.notes.format.heading")}
                    onClick={() => applyLinePrefix("## ")}
                  >
                    H2
                  </FormatButton>
                  <FormatButton label={language.t("secondBrain.notes.format.bold")} onClick={() => applyInline("**")}>
                    <strong>B</strong>
                  </FormatButton>
                  <FormatButton label={language.t("secondBrain.notes.format.italic")} onClick={() => applyInline("_")}>
                    <em>I</em>
                  </FormatButton>
                  <FormatButton
                    label={language.t("secondBrain.notes.format.list")}
                    onClick={() => applyLinePrefix("- ")}
                  >
                    • List
                  </FormatButton>
                  <FormatButton label={language.t("secondBrain.notes.format.code")} onClick={() => applyInline("`")}>
                    Code
                  </FormatButton>
                  <FormatButton
                    label={language.t("secondBrain.notes.format.link")}
                    onClick={() => applyInline("[", "](https://)")}
                  >
                    Link
                  </FormatButton>
                  <span class="ml-auto text-[11px] tabular-nums text-v2-text-text-faint">
                    {language.t("secondBrain.notes.words", {
                      count: state.body.trim() ? state.body.trim().split(/\s+/).length : 0,
                    })}
                  </span>
                </div>
              </Show>
              <Show when={relatedNotes().length > 0}>
                <nav
                  class="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-v2-border-border-weak px-3 py-1"
                  aria-label={language.t("secondBrain.notes.related")}
                >
                  <span class="mr-1 text-[11px] text-v2-text-text-faint">
                    {language.t("secondBrain.notes.related")}
                  </span>
                  <For each={relatedNotes()}>
                    {(note) => (
                      <button
                        type="button"
                        class="max-w-48 truncate rounded-[5px] bg-v2-background-bg-layer-02 px-2 py-1 text-[11px] text-v2-text-text-muted transition-colors duration-120 hover:bg-v2-background-bg-layer-03 hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                        onClick={() => chooseNote(note)}
                      >
                        {note.title}
                      </button>
                    )}
                  </For>
                  <Show when={backlinks().length > 0}>
                    <span class="ml-auto text-[11px] tabular-nums text-v2-text-text-faint">
                      {language.t("secondBrain.notes.backlinks", { count: backlinks().length })}
                    </span>
                  </Show>
                </nav>
              </Show>
              <Show when={state.error}>
                <p
                  role="alert"
                  class="shrink-0 border-b border-v2-border-border-weak px-4 py-2 text-[12px] text-v2-text-text-critical"
                >
                  {state.error}
                </p>
              </Show>
              <Show
                when={!loadedNote.loading}
                fallback={
                  <div class="flex flex-1 items-center justify-center text-[13px] text-v2-text-text-faint">
                    {language.t("common.loading")}
                  </div>
                }
              >
                <div
                  classList={{
                    "grid min-h-0 flex-1": true,
                    "md:grid-cols-2": state.mode === "split",
                  }}
                >
                  <Show when={state.mode !== "preview"}>
                    <TextareaV2
                      ref={editor}
                      class="min-h-0 rounded-none border-0 [&_[data-slot=textarea-v2-textarea]]:h-full [&_[data-slot=textarea-v2-textarea]]:resize-none [&_[data-slot=textarea-v2-textarea]]:rounded-none [&_[data-slot=textarea-v2-textarea]]:border-0 [&_[data-slot=textarea-v2-textarea]]:bg-transparent [&_[data-slot=textarea-v2-textarea]]:px-8 [&_[data-slot=textarea-v2-textarea]]:py-6 [&_[data-slot=textarea-v2-textarea]]:font-mono [&_[data-slot=textarea-v2-textarea]]:text-[14px] [&_[data-slot=textarea-v2-textarea]]:leading-6 [&_[data-slot=textarea-v2-textarea]]:outline-none"
                      classList={{ "border-r border-v2-border-border-weak": state.mode === "split" }}
                      aria-label={language.t("secondBrain.notes.editor")}
                      value={state.body}
                      onInput={(event) => setState("body", event.currentTarget.value)}
                      onKeyDown={handleEditorKeyDown}
                    />
                  </Show>
                  <Show when={state.mode !== "write"}>
                    <div class="min-h-0 overflow-y-auto px-8 py-6">
                      <Markdown text={state.body} class="mx-auto max-w-3xl text-[14px]" />
                    </div>
                  </Show>
                </div>
              </Show>
            </Show>
          </article>
        </div>
      </Show>
    </section>
  )
}

function FormatButton(props: { label: string; onClick: () => void; children: import("solid-js").JSX.Element }) {
  return (
    <button
      type="button"
      class="h-7 rounded-[5px] px-2 text-[11px] text-v2-text-text-muted transition-colors duration-120 hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function normalizeWikiTarget(value: string) {
  return value
    .split("#", 1)[0]!
    .trim()
    .replaceAll("\\", "/")
    .replace(/^notes\//i, "")
    .replace(/\.md$/i, "")
    .toLowerCase()
}

function noteKeys(note: Pick<NoteSummary, "path" | "title">) {
  const path = normalizeWikiTarget(note.path)
  return new Set([normalizeWikiTarget(note.title), path, path.split("/").pop() ?? path])
}
