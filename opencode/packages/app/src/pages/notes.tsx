import { useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
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
import { NoteEditor } from "@/features/second-brain/note-editor"

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
    filterProjectId: search.project ?? "",
    search: "",
    error: "",
  })
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
      if (!document) return
      applyDocument(document)
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
    const path = state.filterProjectId ? `projects/${state.filterProjectId}/notes/${slug}.md` : `notes/${slug}.md`
    setState({ saving: true, error: "" })
    try {
      const document = await writeNote(client(state.directory), {
        path,
        title,
        body: "",
        projectIds: state.filterProjectId ? [state.filterProjectId] : [],
        tags: [],
        create: true,
      })
      await noteActions.refetch()
      setState({ path, newTitle: "", creating: false })
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

  return (
    <section
      class="flex h-full min-h-0 w-full flex-col bg-v2-background-bg-base"
      aria-label={language.t("secondBrain.notes.title")}
    >
      <Show
        when={state.directory}
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center text-[13px] text-v2-text-text-muted">
            {language.t("secondBrain.empty.workspace")}
          </div>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside class="flex max-h-[188px] w-full shrink-0 flex-col overflow-hidden border-b border-v2-border-border-base bg-v2-background-bg-layer-01 md:max-h-none md:w-[208px] md:border-b-0 md:border-r">
            <div class="flex h-11 shrink-0 items-center gap-2 px-3">
              <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base [font-weight:560]">
                {language.t("secondBrain.notes.title")}
              </span>
              <button
                type="button"
                class="flex size-8 items-center justify-center rounded-[5px] text-v2-icon-icon-muted transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-v2-background-bg-layer-02 hover:text-v2-icon-icon-base active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transform-none motion-reduce:transition-none"
                aria-label={language.t("secondBrain.notes.new")}
                title={language.t("secondBrain.notes.new")}
                disabled={dirty()}
                onClick={() => setState({ creating: true, error: "" })}
              >
                <Icon name="edit" size="small" />
              </button>
            </div>

            <div class="shrink-0 space-y-1.5 px-2 pb-2">
              <label class="relative block">
                <span class="pointer-events-none absolute inset-y-0 left-2 flex items-center text-v2-icon-icon-muted">
                  <Icon name="magnifying-glass" size="small" />
                </span>
                <input
                  class="h-8 w-full rounded-[6px] border border-transparent bg-v2-background-bg-layer-02 pl-8 pr-2 text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint hover:bg-v2-background-bg-layer-03 focus:border-v2-border-border-focus"
                  aria-label={language.t("secondBrain.notes.search")}
                  placeholder={language.t("secondBrain.notes.search")}
                  value={state.search}
                  onInput={(event) => setState("search", event.currentTarget.value)}
                />
              </label>
              <SelectV2
                class="!h-8 !w-full !bg-transparent !shadow-none hover:!bg-v2-background-bg-layer-01"
                aria-label={language.t("secondBrain.notes.filterProject")}
                options={["__all__", ...(projects() ?? []).map((project) => project.id)]}
                current={state.filterProjectId || "__all__"}
                label={(projectID) =>
                  projectID === "__all__"
                    ? language.t("secondBrain.notes.allProjects")
                    : (projects()?.find((project) => project.id === projectID)?.name ?? projectID)
                }
                onSelect={(projectID) =>
                  setState("filterProjectId", projectID === "__all__" ? "" : (projectID ?? ""))
                }
              />
            </div>

            <Show when={state.creating}>
              <form
                class="mx-2 flex shrink-0 flex-col gap-2 rounded-[6px] bg-v2-background-bg-layer-02 p-2"
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

            <nav
              class="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1"
              aria-label={language.t("secondBrain.notes.list")}
            >
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
                        class="grid min-h-8 w-full cursor-pointer grid-cols-[24px_1fr] items-center rounded-[6px] px-1.5 text-left transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-v2-background-bg-layer-01 active:scale-[0.98] data-[selected]:bg-v2-background-bg-layer-03 focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] motion-reduce:transform-none motion-reduce:transition-none"
                        onClick={() => chooseNote(note)}
                      >
                        <span class="flex size-6 items-center justify-center text-v2-icon-icon-muted">
                          <Icon name="edit" size="small" />
                        </span>
                        <span class="w-full truncate text-[13px] text-v2-text-text-base">{note.title}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </Show>
            </nav>

            <Show when={workspaces().length > 0}>
              <label class="shrink-0 border-t border-v2-border-border-base p-2">
                <span class="sr-only">{language.t("secondBrain.workspace")}</span>
                <SelectV2
                  aria-label={language.t("secondBrain.workspace")}
                  class="!h-8 !w-full !bg-transparent !shadow-none hover:!bg-v2-background-bg-layer-01"
                  options={workspaces()}
                  current={workspaces().find((project) => project.worktree === state.directory)}
                  value={(project) => project.worktree}
                  label={(project) => project.name ?? project.worktree.split(/[\\/]/).pop() ?? project.worktree}
                  disabled={dirty()}
                  onSelect={(project) =>
                    project && setState({ directory: project.worktree, path: "", body: "", baseBody: "" })
                  }
                />
              </label>
            </Show>
          </aside>

          <article class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-v2-background-bg-base">
            <Show
              when={state.path}
              fallback={
                <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                  <Icon name="edit" class="size-7 text-v2-icon-icon-muted" />
                  <p class="text-[13px] text-v2-text-text-faint">{language.t("secondBrain.notes.select")}</p>
                  <ButtonV2
                    size="small"
                    variant="ghost-muted"
                    icon="plus"
                    onClick={() => setState({ creating: true, error: "" })}
                  >
                    {language.t("secondBrain.notes.new")}
                  </ButtonV2>
                </div>
              }
            >
              <header class="flex min-h-11 shrink-0 flex-wrap items-center gap-1.5 border-b border-v2-border-border-base px-3 py-1.5 sm:px-4">
                <div class="mr-auto flex min-w-0 items-center gap-2 text-[12px] text-v2-text-text-faint">
                  <span class="shrink-0">{language.t("secondBrain.notes.title")}</span>
                  <span class="hidden sm:inline" aria-hidden="true">
                    /
                  </span>
                  <span class="hidden truncate text-v2-text-text-muted sm:inline">{state.title}</span>
                </div>
                <span class="hidden text-[11px] text-v2-text-text-faint sm:inline">
                  {dirty() ? language.t("secondBrain.notes.unsaved") : language.t("secondBrain.notes.saved")}
                </span>
                <Show when={dirty()}>
                  <ButtonV2 size="small" variant="ghost" disabled={state.saving} onClick={discard}>
                    {language.t("secondBrain.notes.discard")}
                  </ButtonV2>
                </Show>
                <ButtonV2
                  size="small"
                  variant="contrast"
                  disabled={!dirty() || state.saving}
                  onClick={() => void save()}
                >
                  {state.saving ? language.t("secondBrain.saving") : language.t("common.save")}
                </ButtonV2>
              </header>

              <div class="min-h-0 flex-1 overflow-y-auto">
                <div class="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-6 pb-24 pt-8 sm:px-10 sm:pt-16 lg:px-14">
                  <input
                    class="w-full border-0 bg-transparent p-0 text-[34px] leading-[1.18] text-v2-text-text-strong outline-none placeholder:text-v2-text-text-faint sm:text-[38px] [font-weight:660]"
                    aria-label={language.t("secondBrain.notes.name")}
                    value={state.title}
                    onInput={(event) => setState("title", event.currentTarget.value)}
                  />

                  <div class="mt-5 shrink-0 border-b border-v2-border-border-base pb-5 text-[12px]">
                    <div class="grid gap-1 sm:grid-cols-[1fr_1fr_1.25fr] sm:gap-6">
                      <div class="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-start gap-2 sm:block">
                        <div class="flex min-h-6 items-center gap-2 text-v2-text-text-faint">
                          <Icon name="workspace" size="small" />
                          <span>{language.t("secondBrain.notes.projects")}</span>
                        </div>
                        <div
                          class="flex min-h-7 min-w-0 flex-wrap items-center gap-1 sm:mt-1"
                          role="group"
                          aria-label={language.t("secondBrain.notes.projects")}
                        >
                          <Show
                            when={(projects()?.length ?? 0) > 0}
                            fallback={
                              <span class="text-v2-text-text-faint">{language.t("secondBrain.notes.noProject")}</span>
                            }
                          >
                            <For each={projects()}>
                              {(project) => (
                                <label class="flex cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-[12px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-02">
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

                      <label class="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-start gap-2 sm:block">
                        <span class="flex min-h-6 items-center gap-2 text-v2-text-text-faint">
                          <Icon name="status" size="small" />
                          <span>{language.t("secondBrain.notes.tags")}</span>
                        </span>
                        <input
                          class="h-7 min-w-0 rounded-[5px] border border-transparent bg-transparent px-2 text-[12px] text-v2-text-text-muted outline-none placeholder:text-v2-text-text-faint hover:bg-v2-background-bg-layer-01 focus:border-v2-border-border-focus sm:mt-1 sm:w-full"
                          value={state.tags}
                          placeholder={language.t("secondBrain.notes.tagsPlaceholder")}
                          onInput={(event) => setState("tags", event.currentTarget.value)}
                        />
                      </label>

                      <div class="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-start gap-2 sm:block">
                        <div class="flex min-h-6 items-center gap-2 text-v2-text-text-faint">
                          <Icon name="check" size="small" />
                          <span>{language.t("secondBrain.notes.saved")}</span>
                        </div>
                        <div class="flex min-h-7 items-center truncate text-v2-text-text-muted sm:mt-1">
                          <Show when={(notes() ?? []).find((note) => note.path === state.path)?.updatedAt}>
                            {(updatedAt) => new Date(updatedAt()).toLocaleString()}
                          </Show>
                        </div>
                      </div>
                    </div>

                    <Show when={relatedNotes().length > 0}>
                      <div class="mt-3 grid gap-1 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-3">
                        <div class="flex min-h-8 items-center gap-2 text-v2-text-text-faint">
                          <Icon name="branch" size="small" />
                          <span>{language.t("secondBrain.notes.related")}</span>
                        </div>
                        <nav
                          class="flex min-h-8 min-w-0 flex-wrap items-center gap-1"
                          aria-label={language.t("secondBrain.notes.related")}
                        >
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
                            <span class="text-[11px] tabular-nums text-v2-text-text-faint">
                              {language.t("secondBrain.notes.backlinks", { count: backlinks().length })}
                            </span>
                          </Show>
                        </nav>
                      </div>
                    </Show>
                  </div>

                  <Show when={state.error}>
                    <p role="alert" class="mt-4 text-[12px] text-v2-text-text-critical">
                      {state.error}
                    </p>
                  </Show>

                  <div class="mt-5 flex min-h-[360px] flex-1">
                    <NoteEditor
                      value={state.body}
                      loading={loadedNote.loading}
                      onChange={(value) => setState("body", value)}
                      onSave={save}
                      labels={{
                        editor: language.t("secondBrain.notes.editor"),
                        toolbar: language.t("secondBrain.notes.format.toolbar"),
                        write: language.t("secondBrain.notes.write"),
                        split: language.t("secondBrain.notes.split"),
                        preview: language.t("secondBrain.notes.preview"),
                      }}
                    />
                  </div>
                </div>
              </div>
            </Show>
          </article>
        </div>
      </Show>
    </section>
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
