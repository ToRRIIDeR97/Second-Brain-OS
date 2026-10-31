import { useBeforeLeave, useNavigate, useSearchParams } from "@solidjs/router"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Reveal } from "@opencode-ai/ui/v2/reveal"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { debounce } from "@solid-primitives/scheduled"
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { noteKeys, noteLinkLookup, previewNoteLinks, wikiTargetKey } from "@/features/second-brain/note-links"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { focusWhenConnected } from "@/utils/focus-when-connected"
import {
  deleteNote,
  listNotes,
  readNote,
  SecondBrainRequestError,
  writeNote,
  type NoteDocument,
  type NoteSummary,
} from "@/features/second-brain/client"
import { NoteEditor } from "@/features/second-brain/note-editor"
import { noteSlug } from "@/features/second-brain/note-slug"
import { PageEmpty, pageRowClass, pagePanelClass } from "@/components/page"
import { useBrainProjects } from "@/components/sidebar/sidebar-controller"

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
  /** The last save hit a newer revision on disk; offer to reload it. */
  conflict: boolean
}

export default function NotesPage() {
  const language = useLanguage()
  const dialog = useDialog()
  const navigate = useNavigate()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const command = useCommand()
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
    conflict: false,
  })
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

  // Follow the sidebar workspace, but hold the open note's workspace until its edits are saved or discarded.
  createEffect(() => {
    const directory = layout.home.workspace() ?? ""
    if (directory === state.directory) return
    if (dirty()) return setState("error", language.t("secondBrain.notes.error.unsaved"))
    setState({ directory, path: "", body: "", baseBody: "", error: "" })
  })

  const [notes, noteActions] = createResource(
    () => state.directory || undefined,
    (directory) => listNotes(client(directory)),
  )
  const brainProjects = useBrainProjects()
  // The shared Project list follows the sidebar workspace; hide it while an unsaved note holds the previous one.
  const projectList = () => ((layout.home.workspace() ?? "") === state.directory ? brainProjects.list() : undefined)
  // The input stays bound to state.search; the server search keys on a debounced copy so typing does not
  // re-read the note files on every keystroke. Clearing the search applies immediately.
  const [query, setQuery] = createSignal("")
  const scheduleQuery = debounce((value: string) => setQuery(value), 250)
  createEffect(
    on(
      () => state.search.trim(),
      (value) => {
        if (value) return scheduleQuery(value)
        scheduleQuery.clear()
        setQuery("")
      },
    ),
  )
  const [matches, matchActions] = createResource(
    () => (state.directory && query() ? ([state.directory, query()] as const) : undefined),
    ([directory, query]) => listNotes(client(directory), query),
  )
  const [loadedNote, loadedNoteActions] = createResource(
    () => (state.directory && state.path ? ([state.directory, state.path] as const) : undefined),
    ([directory, path]) => readNote(client(directory), path),
  )
  // Reading an errored resource throws, so read through these and show the failure inline instead.
  const noteList = () => (notes.error ? [] : (notes.latest ?? []))
  const listFailed = () => !!(query() ? matches.error : notes.error)
  // The first search shows "Loading" instead of "No matching notes" until it answers.
  const listLoading = () => (query() ? matches.state === "pending" : notes.loading)
  const visibleNotes = createMemo(() =>
    (query() ? (matches.error || matches.state === "pending" ? [] : (matches.latest ?? [])) : noteList()).filter(
      (note) => !state.filterProjectId || note.projectIds.includes(state.filterProjectId),
    ),
  )
  const linkLookup = createMemo(() => noteLinkLookup(noteList()))
  const previewText = createMemo(() => previewNoteLinks(state.body, linkLookup()))
  const currentKeys = createMemo(() => noteKeys({ path: state.path, title: state.title }))
  const backlinks = createMemo(() =>
    noteList().filter(
      (note) => note.path !== state.path && note.links.some((link) => currentKeys().has(wikiTargetKey(link))),
    ),
  )
  const outgoing = createMemo(() => {
    const targets = new Set(
      noteList()
        .find((note) => note.path === state.path)
        ?.links.map(wikiTargetKey) ?? [],
    )
    return noteList().filter((note) => note.path !== state.path && [...noteKeys(note)].some((key) => targets.has(key)))
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
      conflict: false,
    })
  }

  // After a save, the server copy becomes the base. A field edited while the request ran keeps its
  // newer text (and stays unsaved); the others take the server copy, which may be normalized.
  const applySaved = (
    document: NoteDocument,
    sent: { body: string; title: string; projectIds: string; tags: string },
  ) => {
    const projectIds = [...document.info.projectIds]
    const tags = document.info.tags.join(", ")
    setState({
      ...(state.body === sent.body ? { body: document.body } : {}),
      ...(state.title === sent.title ? { title: document.info.title } : {}),
      ...(state.projectIds.join("\0") === sent.projectIds ? { projectIds } : {}),
      ...(state.tags === sent.tags ? { tags } : {}),
      baseBody: document.body,
      baseTitle: document.info.title,
      baseProjectIds: projectIds,
      baseTags: tags,
      revision: document.revision,
      error: "",
      conflict: false,
    })
  }

  createEffect(
    on(
      () => (loadedNote.error ? undefined : loadedNote()),
      (document) => {
        if (!document) return
        applyDocument(document)
      },
    ),
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
    const conflict = error instanceof SecondBrainRequestError && error.status === 409
    setState({
      error: conflict
        ? language.t(state.creating ? "secondBrain.notes.error.exists" : "secondBrain.notes.error.conflict")
        : language.t("secondBrain.error.request"),
      conflict: conflict && !state.creating,
    })
  }

  // Re-read the open note; the `loadedNote` effect then replaces the body and revision.
  const reload = () => {
    setState({ error: "", conflict: false })
    void loadedNoteActions.refetch()
  }

  const chooseNote = (note: NoteSummary) => {
    // Re-selecting the open note would clear its body without a refetch (the resource key is unchanged).
    if (note.path === state.path) return
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
      conflict: false,
    })
  }

  let openedLink: string | undefined
  createEffect(
    on(
      () => [search.note, notes.error ? undefined : notes()] as const,
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

  // Update the loaded list from the write result instead of re-reading every note; same order as the server.
  const storeSummary = (directory: string, info: NoteSummary) => {
    if (state.directory !== directory) return
    noteActions.mutate((items) =>
      items
        ? [...items.filter((item) => item.path !== info.path), info].sort(
            (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title),
          )
        : items,
    )
  }

  const createNote = async () => {
    const title = state.newTitle.trim()
    if (!title || !state.directory) {
      setState("error", language.t("secondBrain.notes.error.title"))
      return
    }
    const slug = noteSlug(title)
    const path = state.filterProjectId
      ? `.tenon/projects/${state.filterProjectId}/notes/${slug}.md`
      : `notes/${slug}.md`
    const directory = state.directory
    setState({ saving: true, error: "" })
    try {
      const document = await writeNote(client(directory), {
        path,
        title,
        body: "",
        projectIds: state.filterProjectId ? [state.filterProjectId] : [],
        tags: [],
        create: true,
      })
      storeSummary(directory, document.info)
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
    const directory = state.directory
    const sent = { body: state.body, title: state.title, projectIds: state.projectIds.join("\0"), tags: state.tags }
    setState({ saving: true, error: "" })
    try {
      const document = await writeNote(client(directory), {
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
      // Skip if the user opened another note while this one was saving.
      if (state.directory === directory && state.path === document.info.path) applySaved(document, sent)
      storeSummary(directory, document.info)
      // Patch the open search results in place instead of re-reading every note file.
      if (state.directory === directory)
        matchActions.mutate((items) => items?.map((item) => (item.path === document.info.path ? document.info : item)))
    } catch (error) {
      report(error)
    } finally {
      setState("saving", false)
    }
  }

  // Deleting sends the revision last read, so a note changed elsewhere is not removed unseen.
  const removeNote = async () => {
    const directory = state.directory
    const path = state.path
    if (!directory || !path || !state.revision) return
    setState({ saving: true, error: "" })
    try {
      await deleteNote(client(directory), { path, expectedRevision: state.revision })
      if (state.directory === directory) {
        noteActions.mutate((items) => items?.filter((item) => item.path !== path))
        matchActions.mutate((items) => items?.filter((item) => item.path !== path))
      }
      if (state.path === path)
        setState({
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
        })
    } catch (error) {
      report(error)
    } finally {
      setState("saving", false)
    }
  }

  const confirmDelete = () =>
    dialog.show(() => (
      <DialogV2 fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("secondBrain.notes.delete.title")}
            description={language.t("secondBrain.notes.delete.confirm", { name: state.title || state.path })}
          />
        </DialogHeader>
        <DialogFooter>
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={() => {
              dialog.close()
              void removeNote()
            }}
          >
            {language.t("secondBrain.notes.delete.button")}
          </ButtonV2>
        </DialogFooter>
      </DialogV2>
    ))

  // Save from anywhere on the page: the preview, the toolbar or fullscreen, not only the textarea.
  command.register("notes", () => [
    {
      id: "notes.save",
      title: language.t("secondBrain.notes.saveCommand"),
      category: language.t("command.category.file"),
      keybind: "mod+s",
      disabled: !dirty() || state.saving,
      onSelect: () => void save(),
    },
  ])

  const saveButton = () => (
    <TooltipV2
      value={
        <>
          {language.t("common.save")}
          <KeybindV2 keys={command.keybindParts("notes.save")} variant="neutral" />
        </>
      }
    >
      <ButtonV2 size="small" variant="contrast" disabled={!dirty() || state.saving} onClick={() => void save()}>
        {state.saving ? language.t("secondBrain.saving") : language.t("common.save")}
      </ButtonV2>
    </TooltipV2>
  )

  const discard = () => {
    // After a conflict the base copy is stale too, so discarding reloads the note from disk.
    if (state.conflict) return reload()
    setState({
      body: state.baseBody,
      title: state.baseTitle,
      projectIds: [...state.baseProjectIds],
      tags: state.baseTags,
      error: "",
    })
  }

  return (
    <section class="flex size-full min-h-0 flex-col p-2 pl-0" aria-label={language.t("secondBrain.notes.title")}>
      <div class={`flex min-h-0 flex-1 flex-col overflow-hidden ${pagePanelClass}`}>
        <Show
          when={state.directory}
          fallback={
            <PageEmpty
              action={
                <ButtonV2 variant="contrast" onClick={() => command.trigger("project.open")}>
                  {language.t("secondBrain.home.openWorkspace")}
                </ButtonV2>
              }
            >
              {language.t("secondBrain.empty.workspace")}
            </PageEmpty>
          }
        >
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
                    class="h-9 w-full rounded-full bg-v2-background-bg-layer-01 pl-9 pr-3 text-[13px] text-v2-text-text-base outline-none transition-[background-color,box-shadow] duration-short ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                    aria-label={language.t("secondBrain.notes.search")}
                    placeholder={language.t("secondBrain.notes.search")}
                    value={state.search}
                    onInput={(event) => setState("search", event.currentTarget.value)}
                  />
                </label>
                <Show when={(projectList()?.length ?? 0) > 0}>
                  <SelectV2
                    class="!h-8 !w-full !bg-transparent !shadow-none hover:!bg-v2-overlay-simple-overlay-hover"
                    aria-label={language.t("secondBrain.notes.filterProject")}
                    options={["__all__", ...(projectList() ?? []).map((project) => project.id)]}
                    current={state.filterProjectId || "__all__"}
                    label={(projectID) =>
                      projectID === "__all__"
                        ? language.t("secondBrain.notes.allProjects")
                        : (projectList()?.find((project) => project.id === projectID)?.name ?? projectID)
                    }
                    onSelect={(projectID) =>
                      setState("filterProjectId", projectID === "__all__" ? "" : (projectID ?? ""))
                    }
                  />
                </Show>
              </div>

              <Reveal open={state.creating} class="shrink-0">
                <form
                  class="mx-3 mb-2 flex shrink-0 flex-col gap-2 rounded-[16px] bg-v2-background-bg-layer-01 p-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void createNote()
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    setState({ creating: false, error: "" })
                  }}
                >
                  <label class="text-[12px] text-v2-text-text-muted" for="new-note-title">
                    {language.t("secondBrain.notes.name")}
                  </label>
                  <TextInputV2
                    id="new-note-title"
                    class="!w-full min-w-0"
                    appearance="large"
                    ref={focusWhenConnected}
                    invalid={!!state.error}
                    aria-describedby={state.error ? "new-note-error" : undefined}
                    value={state.newTitle}
                    onInput={(event) => setState("newTitle", event.currentTarget.value)}
                  />
                  <Show when={state.error}>
                    <p id="new-note-error" role="alert" class="animate-enter text-[12px] text-v2-text-text-critical">
                      {state.error}
                    </p>
                  </Show>
                  <div class="flex justify-end gap-1.5">
                    <ButtonV2
                      type="button"
                      size="small"
                      variant="ghost"
                      onClick={() => setState({ creating: false, error: "" })}
                    >
                      {language.t("common.cancel")}
                    </ButtonV2>
                    <ButtonV2 type="submit" size="small" variant="contrast" disabled={state.saving}>
                      {language.t("secondBrain.notes.create")}
                    </ButtonV2>
                  </div>
                </form>
              </Reveal>

              <nav
                class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3"
                aria-label={language.t("secondBrain.notes.list")}
              >
                <Show
                  when={!listLoading()}
                  fallback={<p class="px-3 py-2 text-[12px] text-v2-text-text-faint">{language.t("common.loading")}</p>}
                >
                  <Show
                    when={!listFailed()}
                    fallback={
                      <PageEmpty
                        class="!px-3"
                        action={
                          <ButtonV2
                            size="small"
                            variant="outline"
                            onClick={() => void (query() ? matchActions.refetch() : noteActions.refetch())}
                          >
                            {language.t("secondBrain.error.retry")}
                          </ButtonV2>
                        }
                      >
                        {language.t("secondBrain.error.request")}
                      </PageEmpty>
                    }
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
                </Show>
              </nav>
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
                    class="h-9 min-w-0 flex-1 truncate rounded-[12px] bg-transparent px-2 text-[17px] text-v2-text-text-base outline-none transition-colors duration-short ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none [font-weight:560]"
                    aria-label={language.t("secondBrain.notes.name")}
                    value={state.title}
                    onInput={(event) => setState("title", event.currentTarget.value)}
                  />
                  <span
                    class="hidden shrink-0 items-center gap-1.5 px-1 text-[11px] text-v2-text-text-faint sm:flex"
                    title={(() => {
                      const updatedAt = noteList().find((note) => note.path === state.path)?.updatedAt
                      return updatedAt ? new Date(updatedAt).toLocaleString() : undefined
                    })()}
                  >
                    <Show when={dirty()}>
                      <span class="size-1.5 animate-enter rounded-full bg-v2-icon-icon-accent" aria-hidden="true" />
                    </Show>
                    {dirty() ? language.t("secondBrain.notes.unsaved") : language.t("secondBrain.notes.saved")}
                  </span>
                  <Show when={dirty()}>
                    <ButtonV2
                      size="small"
                      variant="ghost"
                      class="animate-enter"
                      disabled={state.saving}
                      onClick={discard}
                    >
                      {language.t("secondBrain.notes.discard")}
                    </ButtonV2>
                  </Show>
                  <ButtonV2 size="small" variant="ghost" disabled={state.saving || !state.revision} onClick={confirmDelete}>
                    {language.t("common.delete")}
                  </ButtonV2>
                  {saveButton()}
                </header>

                <div class="min-h-0 flex-1 overflow-y-auto">
                  <div class="mx-auto flex min-h-full w-full max-w-[860px] flex-col gap-3 px-4 pb-6 pt-1 sm:px-6">
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px]">
                      <Show when={(projectList()?.length ?? 0) > 0}>
                        <div
                          class="flex min-w-0 flex-wrap items-center gap-1"
                          role="group"
                          aria-label={language.t("secondBrain.notes.projects")}
                        >
                          <For each={projectList()}>
                            {(project) => (
                              <label class="flex cursor-pointer items-center rounded-full px-2.5 py-1 text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-overlay-simple-overlay-hover has-[:checked]:bg-v2-background-bg-accent-container has-[:checked]:text-v2-text-text-on-accent-container has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-v2-border-border-focus motion-reduce:transition-none">
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
                        class="h-7 min-w-32 flex-1 rounded-full bg-transparent px-2.5 text-[12px] text-v2-text-text-muted outline-none transition-colors duration-short ease-standard placeholder:text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
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
                              class="max-w-48 truncate rounded-full bg-v2-background-bg-layer-01 px-2.5 py-1 text-[11px] text-v2-text-text-muted transition-colors duration-short ease-standard hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
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

                    <Show when={loadedNote.error}>
                      <div class="flex animate-enter flex-wrap items-center gap-2">
                        <p role="alert" class="text-[12px] text-v2-text-text-critical">
                          {language.t("secondBrain.error.request")}
                        </p>
                        <ButtonV2 size="small" variant="outline" onClick={reload}>
                          {language.t("secondBrain.error.retry")}
                        </ButtonV2>
                      </div>
                    </Show>

                    <Show when={state.error}>
                      <div class="flex animate-enter flex-wrap items-center gap-2">
                        <p role="alert" class="text-[12px] text-v2-text-text-critical">
                          {state.error}
                        </p>
                        <Show when={state.conflict}>
                          <ButtonV2 size="small" variant="outline" disabled={loadedNote.loading} onClick={reload}>
                            {language.t("secondBrain.notes.reload")}
                          </ButtonV2>
                        </Show>
                      </div>
                    </Show>

                    <div class="flex min-h-[360px] flex-1">
                      <NoteEditor
                        value={state.body}
                        onOpenNote={(path) =>
                          navigate(
                            `/notes?note=${encodeURIComponent(path)}&project=${encodeURIComponent(state.filterProjectId)}`,
                          )
                        }
                        previewText={previewText()}
                        loading={loadedNote.loading}
                        onChange={(value) => setState("body", value)}
                        onSave={save}
                        commandLabel={(id) => language.t(`secondBrain.notes.command.${id}`)}
                        fullscreenActions={
                          <>
                            <span class="flex items-center gap-1.5 px-1 text-[11px] text-v2-text-text-faint">
                              <Show when={dirty()}>
                                <span
                                  class="size-1.5 animate-enter rounded-full bg-v2-icon-icon-accent"
                                  aria-hidden="true"
                                />
                              </Show>
                              {dirty()
                                ? language.t("secondBrain.notes.unsaved")
                                : language.t("secondBrain.notes.saved")}
                            </span>
                            {saveButton()}
                          </>
                        }
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
