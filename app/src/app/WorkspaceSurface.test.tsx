import { fireEvent, render, screen } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, vi } from "vitest";
import { WorkspaceSurface } from "./WorkspaceSurface";
import { createMockIpc } from "../lib/ipc";
import { PreferencesProvider } from "../state/preferences";
import { ThemeProvider } from "../state/theme";
import { useWorkspace, WorkspaceProvider } from "../state/workspace";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const { isTauri } = vi.hoisted(() => ({ isTauri: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri }));

beforeEach(() => {
  isTauri.mockReturnValue(true);
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
          <WorkspaceSurface
            activity="files"
            ipc={mock.client}
            onOpenPalette={() => undefined}
          />
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
  const folderPicker = vi.mocked(open);
  folderPicker.mockResolvedValue("/Users/test/Second Brain");

  render(
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={mock.client}>
          <WorkspaceSurface
            activity="files"
            ipc={mock.client}
            onOpenPalette={() => undefined}
          />
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>,
  );

  fireEvent.click(await screen.findByText("Choose folder…"));

  expect(folderPicker).toHaveBeenCalledWith({
    directory: true,
    multiple: false,
    title: "Select workspace folder",
  });
  expect(
    await screen.findByLabelText("Selected workspace folder"),
  ).toHaveTextContent("/Users/test/Second Brain");
});

test("explains that folder selection needs the desktop app in a browser", async () => {
  const mock = createMockIpc();
  isTauri.mockReturnValue(false);

  render(
    <ThemeProvider>
      <PreferencesProvider>
        <WorkspaceProvider ipc={mock.client}>
          <WorkspaceSurface
            activity="files"
            ipc={mock.client}
            onOpenPalette={() => undefined}
          />
        </WorkspaceProvider>
      </PreferencesProvider>
    </ThemeProvider>,
  );

  fireEvent.click(await screen.findByText("Choose folder…"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "requires the desktop app",
  );
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
          <Harness />
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
