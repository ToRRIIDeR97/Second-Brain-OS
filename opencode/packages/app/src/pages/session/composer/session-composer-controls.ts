import { useProjectThreads } from "@/components/sidebar/sidebar-controller"
import { useLanguage } from "@/context/language"
import { createQuery } from "@tanstack/solid-query"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { type Accessor, createMemo } from "solid-js"
import type { PromptInputControls } from "@/components/prompt-input/contracts"
import type { PromptProject, PromptProjectControls } from "@/components/prompt-project-selector"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLayout } from "@/context/layout"
import { useLocal, type ModelSelection } from "@/context/local"
import type { QueryOptionsApi } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { serverName, ServerConnection, useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useDrafts } from "@/context/drafts"
import { useProviders } from "@/hooks/use-providers"
import { pathKey } from "@/utils/path-key"

export function createPromptInputController(input: {
  sessionKey: Accessor<string>
  sessionID: Accessor<string | undefined>
  queryOptions: Pick<QueryOptionsApi, "agents" | "providers">
  model?: ModelSelection
}) {
  const layout = useLayout()
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const providers = useProviders(() => sdk().directory)
  const view = layout.view(input.sessionKey)
  const agentsQuery = createQuery(() => input.queryOptions.agents(pathKey(sdk().directory)))
  const globalProvidersQuery = createQuery(() => input.queryOptions.providers(null))
  const providersQuery = createQuery(() => input.queryOptions.providers(pathKey(sdk().directory)))

  return createMemo<PromptInputControls>(() => {
    return {
      agents: {
        available: sync().data.agent,
        options: local.agent.list().map((agent) => agent.name),
        current: local.agent.current()?.name ?? "",
        loading: agentsQuery.isLoading,
        visible: local.agent.visible(),
        select: local.agent.set,
      },
      model: {
        selection: input.model ?? local.model,
        paid:
          providers.paid().length > 0 ||
          providers.connected().some((provider) => Object.keys(provider.models).length > 0),
        loading:
          (local.agent.visible() && agentsQuery.isLoading) ||
          providersQuery.isLoading ||
          globalProvidersQuery.isLoading,
      },
      session: {
        id: input.sessionID(),
        tabs: layout.tabs(input.sessionKey),
        reviewPanel: view.reviewPanel,
      },
    }
  })
}

export function createPromptProjectControls() {
  const layout = useLayout()
  const server = useServer()
  const serverSDK = useServerSDK()
  const sdk = useSDK()
  const drafts = useDrafts()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const [search] = useSearchParams<{ draftId?: string }>()
  const projectServer = () => serverSDK().server
  const projectServerCtx = createMemo(() => global.ensureServerCtx(projectServer()))
  const language = useLanguage()
  const navigate = useNavigate()
  const projectThreads = useProjectThreads()
  // With one server, the picker lists what the sidebar lists: the workspace's Projects, plus General for
  // threads in the workspace folder itself. Each starts the thread in that Project's thread folder.
  const workspaceProjects = createMemo((): PromptProject[] => {
    const brain = layout.home.workspace()
    if (!brain) return []
    const entries = projectThreads.status === "success" ? projectThreads.data : []
    return [
      { worktree: brain, name: language.t("secondBrain.sidebar.workspaceThreads") },
      ...entries
        .filter((entry) => entry.project.status === "active")
        .map((entry) => ({ worktree: entry.threadDirectory, name: entry.project.name, id: entry.project.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ]
  })
  const projects = createMemo(() => {
    if (server.list.length <= 1) {
      if (layout.home.workspace()) return workspaceProjects()
      return search.draftId ? projectServerCtx().projects.list() : layout.projects.list()
    }
    return server.list.flatMap((conn) => {
      const item = { key: ServerConnection.key(conn), name: serverName(conn) }
      return global
        .ensureServerCtx(conn)
        .projects.list()
        .map((project) => ({ ...project, server: item }))
    })
  })
  const selectProject = (worktree: string, serverKey?: string) => {
    if (!serverKey && layout.home.workspace()) {
      const project = workspaceProjects().find((item) => item.worktree === worktree)
      if (search.draftId)
        drafts.update(search.draftId, { server: server.key, directory: worktree, projectID: project?.id })
      else void drafts.create({ server: server.key, directory: worktree, projectID: project?.id })
      return
    }
    const conn = serverKey ? server.list.find((conn) => ServerConnection.key(conn) === serverKey) : projectServer()
    if (search.draftId) {
      if (!conn) return
      const target = global.ensureServerCtx(conn)
      target.projects.open(worktree)
      target.projects.touch(worktree)
      drafts.update(search.draftId, { server: ServerConnection.key(conn), directory: worktree, projectID: undefined })
      return
    }

    if (!serverKey) {
      layout.projects.open(worktree)
      server.projects.touch(worktree)
      void drafts.create({ server: server.key, directory: worktree })
      return
    }

    if (!conn) return
    const target = global.ensureServerCtx(conn)
    target.projects.open(worktree)
    target.projects.touch(worktree)
    server.setActive(ServerConnection.key(conn))
    void drafts.create({ server: ServerConnection.key(conn), directory: worktree })
  }

  const addProject = (title: string, serverKey?: string) => {
    // Projects are created on the Projects page, as from the sidebar.
    if (server.list.length <= 1 && layout.home.workspace()) return void navigate("/projects")
    const conn = serverKey ? server.list.find((conn) => ServerConnection.key(conn) === serverKey) : projectServer()
    if (!conn) return
    pickDirectory({
      server: conn,
      title,
      onSelect: (result) => {
        const directory = Array.isArray(result) ? result[0] : result
        if (directory) selectProject(directory, serverKey)
      },
    })
  }

  return createMemo<PromptProjectControls>(() => ({
    available: projects(),
    directory: sdk().directory,
    server: server.list.length > 1 ? ServerConnection.key(projectServer()) : undefined,
    select: selectProject,
    add: addProject,
  }))
}
