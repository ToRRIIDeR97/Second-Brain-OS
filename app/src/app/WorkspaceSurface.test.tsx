import { fireEvent, render, screen } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-dialog";
import { vi } from "vitest";
import { WorkspaceSurface } from "./WorkspaceSurface";
import { createMockIpc } from "../lib/ipc";
import { PreferencesProvider } from "../state/preferences";
import { ThemeProvider } from "../state/theme";
import { WorkspaceProvider } from "../state/workspace";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

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
