import { useBeforeLeave, useNavigate, useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createEffect, createMemo, createResource, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { noteKeys, normalizeWikiTarget, previewNoteLinks } from "@/features/second-brain/note-links"
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
import { PageEmpty, pageRowClass, pagePanelClass } from "@/components/page"

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
  const navigate = useNavigate()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const [search] = useSearchParams<{ project?: string; note?: string }>()
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
  const [matches, matchActions] = createResource(
    () => (state.directory && state.search.trim() ? ([state.directory, state.search.trim()] as const) : undefined),
    ([directory, query]) => listNotes(client(directory), query),
  )
  const [loadedNote] = createResource(
    () => (state.directory && state.path ? ([state.directory, state.path] as const) : undefined),
    ([directory, path]) => readNote(client(directory), path),
  )
  const visibleNotes = createMemo(() => {
    return (state.search.trim() ? (matches() ?? []) : (notes() ?? [])).filter(
      (note) => !state.filterProjectId || note.projectIds.includes(state.filterProjectId),
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
  useBeforeLeave((event) => {
    if (!dirty()) return
    event.preventDefault()
    setState("error", language.t("secondBrain.notes.error.unsaved"))
  })
  window.addEventListener("beforeunload", beforeUnload)
  onCleanup(() => window.removeEventListener("beforeunload", beforeUnload))

  const report = (error: unknown) => {
    setState(
      "error",
      error instanceof SecondBrainRequestError && error.status === 409
        ? language.t(state.creating ? "secondBrain.notes.error.exists" : "secondBrain.notes.error.conflict")
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

  let openedLink: string | undefined
  createEffect(
    on(
      () => [search.note, notes()] as const,
      ([path, items]) => {
        if (!path) openedLink = undefined
        const note = items?.find((item) => item.path === path)
        if (note && openedLink !== path && !dirty()) {
          openedLink = path
          chooseNote(note)
        }
      },
    ),
  )

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
      if (state.search.trim()) await matchActions.refetch()
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
      if (state.search.trim()) await matchActions.refetch()
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
    <section class="flex size-full min-h-0 flex-col p-2 pl-0" aria-label={language.t("secondBrain.notes.title")}>
      <div class={`flex min-h-0 flex-1 flex-col overflow-hidden ${pagePanelClass}`}>
        <Show when={state.directory} fallback={<PageEmpty>{language.t("secondBrain.empty.workspace")}</PageEmpty>}>
          <div class="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
            <aside class="flex max-h-[240px] w-full shrink-0 flex-col overflow-hidden md:max-h-none md:w-[248px]">
              <div class="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3 pt-1">
                <h1 class="min-w-0 flex-1 truncate text-[17px] text-v2-text-text-base [font-weight:560]">
                  {language.t("secondBrain.notes.title")}
                </h1>
                <TooltipV2 value={language.t("secondBrain.notes.new")}>
                  <IconButtonV2
                    type="button"
                    variant="ghost-muted"
                    class="!size-8"
                    aria-label={language.t("secondBrain.notes.new")}
                    icon={<Icon name="plus" size="small" />}
                    disabled={dirty()}
                    onClick={() => setState({ creating: true, error: "" })}
                  />
                </TooltipV2>
              </div>

              <div class="flex shrink-0 flex-col gap-1.5 px-3 pb-2">
                <label class="relative block">
                  <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-v2-icon-icon-muted">
                    <Icon name="magnifying-glass" size="small" />
                  </span>
                  <input
                    class="h-9 w-full rounded-full bg-v2-background-bg-layer-01 pl-9 pr-3 text-[13px] text-v2-text-text-base outline-none transition-[background-color,box-shadow] duration-150 ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                    aria-label={language.t("secondBrain.notes.search")}
                    placeholder={language.t("secondBrain.notes.search")}
                    value={state.search}
                    onInput={(event) => setState("search", event.currentTarget.value)}
                  />
                </label>
                <Show when={(projects()?.length ?? 0) > 0}>
                  <SelectV2
                    class="!h-8 !w-full !bg-transparent !shadow-none hover:!bg-v2-overlay-simple-overlay-hover"
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
                </Show>
              </div>

              <Show when={state.creating}>
                <form
                  class="mx-3 mb-2 flex shrink-0 flex-col gap-2 rounded-[16px] bg-v2-background-bg-layer-01 p-3"
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
                    class="!w-full min-w-0"
                    appearance="large"
                    autofocus
                    value={state.newTitle}
                    onInput={(event) => setState("newTitle", event.currentTarget.value)}
                  />
                  <Show when={state.error}>
                    <p role="alert" class="text-[12px] text-v2-text-text-critical">
                      {state.error}
                    </p>
                  </Show>
                  <div class="flex justify-end gap-1.5">
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
                class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3"
                aria-label={language.t("secondBrain.notes.list")}
              >
                <Show
                  when={!notes.loading}
                  fallback={<p class="px-3 py-2 text-[12px] text-v2-text-text-faint">{language.t("common.loading")}</p>}
                >
                  <Show
                    when={visibleNotes().length > 0}
                    fallback={
                      <PageEmpty class="!px-3">
                        {language.t(state.search.trim() ? "secondBrain.notes.noMatches" : "secondBrain.notes.empty")}
                      </PageEmpty>
                    }
                  >
                    <For each={visibleNotes()}>
                      {(note) => (
                        <button
                          type="button"
                          data-selected={state.path === note.path ? "" : undefined}
                          class={`${pageRowClass} !py-2 text-[13px] text-v2-text-text-base data-[selected]:bg-v2-background-bg-accent-container data-[selected]:text-v2-text-text-on-accent-container`}
                          onClick={() => chooseNote(note)}
                        >
                          <span class="min-w-0 flex-1 truncate">{note.title}</span>
                        </button>
                      )}
                    </For>
                  </Show>
                </Show>
              </nav>

              <Show when={workspaces().length > 1}>
                <div class="shrink-0 px-3 pb-3">
                  <SelectV2
                    aria-label={language.t("secondBrain.workspace")}
                    class="!h-8 !w-full !bg-transparent !shadow-none hover:!bg-v2-overlay-simple-overlay-hover"
                    options={workspaces()}
                    current={workspaces().find((project) => project.worktree === state.directory)}
                    value={(project) => project.worktree}
                    label={(project) => project.name ?? project.worktree.split(/[\\/]/).pop() ?? project.worktree}
                    disabled={dirty()}
                    onSelect={(project) =>
                      project && setState({ directory: project.worktree, path: "", body: "", baseBody: "" })
                    }
                  />
                </div>
              </Show>
            </aside>

            <article class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Show
                when={state.path}
                fallback={
                  <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
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
                <header class="flex h-14 shrink-0 items-center gap-2 pl-4 pr-3 pt-1 sm:pl-6">
                  <input
                    class="h-9 min-w-0 flex-1 truncate rounded-[12px] bg-transparent px-2 text-[17px] text-v2-text-text-base outline-none transition-colors duration-150 ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none [font-weight:560]"
                    aria-label={language.t("secondBrain.notes.name")}
                    value={state.title}
                    onInput={(event) => setState("title", event.currentTarget.value)}
                  />
                  <span
                    class="hidden shrink-0 items-center gap-1.5 px-1 text-[11px] text-v2-text-text-faint sm:flex"
                    title={(() => {
                      const updatedAt = (notes() ?? []).find((note) => note.path === state.path)?.updatedAt
                      return updatedAt ? new Date(updatedAt).toLocaleString() : undefined
                    })()}
                  >
                    <Show when={dirty()}>
                      <span class="size-1.5 rounded-full bg-v2-icon-icon-accent" aria-hidden="true" />
                    </Show>
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
                  <div class="mx-auto flex min-h-full w-full max-w-[860px] flex-col gap-3 px-4 pb-6 pt-1 sm:px-6">
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px]">
                      <Show when={(projects()?.length ?? 0) > 0}>
                        <div
                          class="flex min-w-0 flex-wrap items-center gap-1"
                          role="group"
                          aria-label={language.t("secondBrain.notes.projects")}
                        >
                          <For each={projects()}>
                            {(project) => (
                              <label class="flex cursor-pointer items-center rounded-full px-2.5 py-1 text-v2-text-text-muted transition-colors duration-150 ease-standard hover:bg-v2-overlay-simple-overlay-hover has-[:checked]:bg-v2-background-bg-accent-container has-[:checked]:text-v2-text-text-on-accent-container has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v2-border-border-focus motion-reduce:transition-none">
                                <input
                                  type="checkbox"
                                  class="sr-only"
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
                        </div>
                      </Show>
                      <input
                        class="h-7 min-w-32 flex-1 rounded-full bg-transparent px-2.5 text-[12px] text-v2-text-text-muted outline-none transition-colors duration-150 ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                        aria-label={language.t("secondBrain.notes.tags")}
                        value={state.tags}
                        placeholder={language.t("secondBrain.notes.tagsPlaceholder")}
                        onInput={(event) => setState("tags", event.currentTarget.value)}
                      />
                    </div>

                    <Show when={relatedNotes().length > 0}>
                      <nav
                        class="flex min-w-0 flex-wrap items-center gap-1"
                        aria-label={language.t("secondBrain.notes.related")}
                      >
                        <Icon name="branch" size="small" class="mr-1 text-v2-icon-icon-muted" />
                        <For each={relatedNotes()}>
                          {(note) => (
                            <button
                              type="button"
                              class="max-w-48 truncate rounded-full bg-v2-background-bg-layer-01 px-2.5 py-1 text-[11px] text-v2-text-text-muted transition-colors duration-150 ease-standard hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                              onClick={() => chooseNote(note)}
                            >
                              {note.title}
                            </button>
                          )}
                        </For>
                        <Show when={backlinks().length > 0}>
                          <span class="px-1 text-[11px] tabular-nums text-v2-text-text-faint">
                            {language.t("secondBrain.notes.backlinks", { count: backlinks().length })}
                          </span>
                        </Show>
                      </nav>
                    </Show>

                    <Show when={state.error}>
                      <p role="alert" class="text-[12px] text-v2-text-text-critical">
                        {state.error}
                      </p>
                    </Show>

                    <div class="flex min-h-[360px] flex-1">
                      <NoteEditor
                        value={state.body}
                        onOpenNote={(path) =>
                          navigate(
                            `/notes?note=${encodeURIComponent(path)}&project=${encodeURIComponent(state.filterProjectId)}`,
                          )
                        }
                        previewText={previewNoteLinks(state.body, notes() ?? [])}
                        loading={loadedNote.loading}
                        onChange={(value) => setState("body", value)}
                        onSave={save}
                        commandLabel={(id) => language.t(`secondBrain.notes.command.${id}`)}
                        labels={{
                          words: (count) => language.t("secondBrain.notes.words", { count }),
                          previewRegion: language.t("secondBrain.notes.previewRegion"),
                          fullscreen: language.t("secondBrain.notes.fullscreen"),
                          exitFullscreen: language.t("secondBrain.notes.exitFullscreen"),
                          sideBySide: language.t("secondBrain.notes.sideBySide"),
                          stacked: language.t("secondBrain.notes.stacked"),
                          resize: language.t("secondBrain.notes.resize"),
                          slashMenu: language.t("secondBrain.notes.slashMenu"),
                          slashEmpty: language.t("secondBrain.notes.slashEmpty"),
                          placeholder: language.t("secondBrain.notes.placeholder"),
                          insert: language.t("secondBrain.notes.insert"),
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
      </div>
    </section>
  )
}
