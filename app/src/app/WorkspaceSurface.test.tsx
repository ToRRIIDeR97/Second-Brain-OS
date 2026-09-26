import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { WorkspaceSurface } from "./WorkspaceSurface";
import { createMockIpc } from "../lib/ipc";
import { PreferencesProvider } from "../state/preferences";
import { ThemeProvider } from "../state/theme";
import { useWorkspace, WorkspaceProvider } from "../state/workspace";
import { ProjectsProvider } from "../state/projects";

beforeEach(() => {
  window.localStorage.clear();
});

vi.mock("../features/editor/source", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/editor/source")>();
  return {
    ...actual,
    SourceEditor: ({
      tab,
      onChange,
    }: {
      tab: { content: string; relativePath: string };
      onChange: (content: string) => void;
    }) => (
      <textarea
        aria-label={`Source editor for ${tab.relativePath}`}
        value={tab.content}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    ),
  };
});

function success<T>(data: T) {
  return {
    contract: "ipc_result" as const,
    version: 1 as const,
    ok: true as const,
    data,
    correlationId: "test-correlation",
  };
}

test("mounts the file browser against a registered workspace", async () => {
  const mock = createMockIpc();
  mock.setResponse(
    "workspace_list",
    success([
      {
        id: "ws_test",
        name: "Test Brain",
        kind: "brain",
        trustLevel: "trusted",
        canRead: true,
        canWrite: true,
        canUseTerminal: true,
      },
    ]),
  );
  mock.setResponse(
    "workspace_list_directory",
    success({
      entries: [
        {
          name: "welcome.md",
          relativePath: "notes/welcome.md",
          kind: "file",
          sizeBytes: 12,
          ignored: false,
        },
      ],
    }),
  );

  render(
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={mock.client}>
          <ProjectsProvider ipc={mock.client}>
            <WorkspaceSurface
              activity="files"
              ipc={mock.client}
              onOpenPalette={() => undefined}
            />
          </ProjectsProvider>
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "Workspace files" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: /welcome.md/i }),
  ).toBeInTheDocument();
});

test("opens a native folder picker for workspace registration", async () => {
  const mock = createMockIpc();
  mock.setResponse(
    "workspace_select_root",
    success({
      grantId: "root_grant_test",
      displayPath: "/Users/test/Second Brain",
      suggestedName: "Second Brain",
    }),
  );

  render(
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={mock.client}>
          <ProjectsProvider ipc={mock.client}>
            <WorkspaceSurface
              activity="files"
              ipc={mock.client}
              onOpenPalette={() => undefined}
            />
          </ProjectsProvider>
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>,
  );

  fireEvent.click(await screen.findByText("Choose folder…"));

  expect(
    mock.calls.some(({ command }) => command === "workspace_select_root"),
  ).toBe(true);
  expect(
    await screen.findByLabelText("Selected workspace folder"),
  ).toHaveTextContent("/Users/test/Second Brain");
});

test("explains that folder selection needs the desktop app in a browser", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_select_root", {
    contract: "ipc_result",
    version: 1,
    ok: false,
    error: {
      code: "IPC_UNAVAILABLE",
      message: "Folder selection requires the desktop app.",
      retryable: true,
    },
    correlationId: "test-correlation",
  });

  render(
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={mock.client}>
          <ProjectsProvider ipc={mock.client}>
            <WorkspaceSurface
              activity="files"
              ipc={mock.client}
              onOpenPalette={() => undefined}
            />
          </ProjectsProvider>
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>,
  );

  fireEvent.click(await screen.findByText("Choose folder…"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "requires the desktop app",
  );
});

test("opens Knowledge after registering an onboarding workspace", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_list", success([]));
  mock.setResponse(
    "workspace_select_root",
    success({
      grantId: "root_grant_test",
      displayPath: "C:\\Users\\test\\Brain",
      suggestedName: "Brain",
    }),
  );
  mock.setResponse(
    "workspace_register",
    success({
      id: "ws_test",
      name: "Brain",
      kind: "brain",
      trustLevel: "trusted",
      canRead: true,
      canWrite: true,
      canUseTerminal: true,
    }),
  );
  mock.setResponse("workspace_list_directory", success({ entries: [] }));
  const onNavigate = vi.fn();

  render(
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={mock.client}>
          <ProjectsProvider ipc={mock.client}>
            <WorkspaceSurface
              activity="home"
              ipc={mock.client}
              onOpenPalette={() => undefined}
              onNavigate={onNavigate}
            />
          </ProjectsProvider>
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>,
  );

  fireEvent.click(await screen.findByText("Choose folder…"));
  await screen.findByLabelText("Selected workspace folder");
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

  await waitFor(() => {
    expect(onNavigate).toHaveBeenCalledWith("knowledge");
  });
});

test("keeps an unsaved editor buffer when switching workspaces", async () => {
  const mock = createMockIpc();
  const workspaces = [
    {
      id: "ws_one",
      name: "One",
      kind: "brain" as const,
      trustLevel: "trusted" as const,
      canRead: true,
      canWrite: true,
      canUseTerminal: true,
    },
    {
      id: "ws_two",
      name: "Two",
      kind: "brain" as const,
      trustLevel: "trusted" as const,
      canRead: true,
      canWrite: true,
      canUseTerminal: true,
    },
  ];
  mock.setResponse("workspace_list", success(workspaces));
  mock.setResponse(
    "workspace_list_directory",
    success({
      entries: [
        {
          name: "main.ts",
          relativePath: "src/main.ts",
          kind: "file",
          sizeBytes: 18,
          ignored: false,
        },
      ],
    }),
  );
  mock.setResponse(
    "file_read_text",
    success({
      content: "export const one = 1;",
      contentHash: "hash-one",
      revisionId: "rev-one",
      encoding: "utf8",
      eol: "lf",
      sizeBytes: 21,
    }),
  );

  function Harness() {
    const { selectWorkspace } = useWorkspace();
    return (
      <>
        <button
          type="button"
          onClick={() => {
            selectWorkspace("ws_one");
          }}
        >
          Workspace one
        </button>
        <button
          type="button"
          onClick={() => {
            selectWorkspace("ws_two");
          }}
        >
          Workspace two
        </button>
        <WorkspaceSurface
          activity="files"
          ipc={mock.client}
          onOpenPalette={() => undefined}
        />
      </>
    );
  }

  render(
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={mock.client}>
          <ProjectsProvider ipc={mock.client}>
            <Harness />
          </ProjectsProvider>
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>,
  );

  fireEvent.click(await screen.findByRole("button", { name: /main.ts/i }));
  const editor = await screen.findByRole("textbox", {
    name: "Source editor for src/main.ts",
  });
  fireEvent.change(editor, { target: { value: "export const one = 2;" } });
  fireEvent.click(screen.getByRole("button", { name: "Workspace two" }));
  fireEvent.click(screen.getByRole("button", { name: "Workspace one" }));

  expect(
    await screen.findByRole("textbox", {
      name: "Source editor for src/main.ts",
    }),
  ).toHaveValue("export const one = 2;");
});

test("configures Google and Codex integrations from Settings", async () => {
  const mock = createMockIpc();
  const onOpenTerminal = vi.fn();
  mock.setResponse(
    "workspace_list",
    success([
      {
        id: "ws_test",
        name: "Test Brain",
        kind: "brain",
        trustLevel: "trusted",
        canRead: true,
        canWrite: true,
        canUseTerminal: true,
      },
    ]),
  );
  mock.setResponse(
    "integration_settings_get",
    success({
      version: 1,
      google: {
        oauthClientId: "old.apps.googleusercontent.com",
        consentMode: "read_only",
        calendarEnabled: true,
        tasksEnabled: false,
      },
      codex: { defaultSandbox: "read_only" },
    }),
  );
  mock.setResponse(
    "integration_settings_save",
    success({
      version: 1,
      google: {
        oauthClientId: "new.apps.googleusercontent.com",
        consentMode: "read_write",
        calendarEnabled: true,
        tasksEnabled: true,
      },
      codex: { defaultSandbox: "workspace_write" },
    }),
  );
  mock.setResponse(
    "agent_provider_probe",
    success({
      provider: "codex",
      status: "available",
      version: "codex-cli 0.139.0",
    }),
  );
  mock.setResponse(
    "google_connection_status_get",
    success({
      state: "disconnected",
      connected: false,
      clientSecretConfigured: true,
      consentMode: "read_only",
      calendarEnabled: true,
      tasksEnabled: false,
      lastSyncedAt: null,
      message:
        "OAuth is configured. Connect your Google account to start syncing.",
    }),
  );
  mock.setResponse(
    "google_connect",
    success({
      calendarItems: 4,
      taskItems: 2,
      taskLists: 1,
      lastSyncedAt: "2026-08-22T02:00:00Z",
    }),
  );

  render(
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={mock.client}>
          <ProjectsProvider ipc={mock.client}>
            <WorkspaceSurface
              activity="settings"
              ipc={mock.client}
              onOpenPalette={() => undefined}
              onOpenTerminal={onOpenTerminal}
            />
          </ProjectsProvider>
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>,
  );

  const clientId = await screen.findByDisplayValue(
    "old.apps.googleusercontent.com",
  );
  fireEvent.change(clientId, {
    target: { value: "new.apps.googleusercontent.com" },
  });
  fireEvent.change(screen.getByLabelText(/^OAuth client secret/), {
    target: { value: "new-client-secret" },
  });
  fireEvent.change(screen.getByLabelText(/^Google access/), {
    target: { value: "read_write" },
  });
  fireEvent.click(screen.getByLabelText(/^Google Tasks/));
  fireEvent.change(screen.getByLabelText(/^Default agent access/), {
    target: { value: "workspace_write" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open Codex setup" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Save integration settings" }),
  );

  expect(onOpenTerminal).toHaveBeenCalledWith({
    workspaceId: "ws_test",
    relativePath: "",
    preset: "codex",
  });
  await waitFor(() => {
    expect(
      mock.calls.some(
        ({ command, args }) =>
          command === "integration_settings_save" &&
          JSON.stringify(args?.update) ===
            JSON.stringify({
              google: {
                oauthClientId: "new.apps.googleusercontent.com",
                consentMode: "read_write",
                calendarEnabled: true,
                tasksEnabled: true,
                oauthClientSecret: "new-client-secret",
              },
              codex: { defaultSandbox: "workspace_write" },
            }),
      ),
    ).toBe(true);
  });
  expect(await screen.findByText("Integration settings saved.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Connect Google" }));
  expect(
    await screen.findByText(
      "Google connected. Synced 4 calendar items and 2 tasks.",
    ),
  ).toBeVisible();
  expect(mock.calls.some(({ command }) => command === "google_connect")).toBe(
    true,
  );
});
