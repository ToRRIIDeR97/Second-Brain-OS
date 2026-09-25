import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { createMockIpc } from "../../lib/ipc";
import { WorkspaceProvider } from "../../state/workspace";
import { ProjectsProvider } from "../../state/projects";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));

function success<T>(data: T) {
  return {
    contract: "ipc_result" as const,
    version: 1 as const,
    ok: true as const,
    data,
    correlationId: "test-correlation",
  };
}

const brain = {
  id: "ws_brain",
  name: "Brain",
  rootPath: "/Users/test/Brain",
  kind: "brain" as const,
  trustLevel: "trusted" as const,
  canRead: true,
  canWrite: true,
  canUseTerminal: true,
};

const project = {
  id: "ws_project",
  name: "Project",
  kind: "project" as const,
  trustLevel: "trusted_read_only" as const,
  canRead: true,
  canWrite: false,
  canUseTerminal: false,
};

beforeEach(() => {
  window.localStorage.clear();
});

test("keeps Brain as the default and persists a selected workspace", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_list", success([project, brain]));

  render(
    <WorkspaceProvider ipc={mock.client}>
      <ProjectsProvider ipc={mock.client}>
        <WorkspaceSwitcher />
      </ProjectsProvider>
    </WorkspaceProvider>,
  );

  expect(
    await screen.findByRole("button", {
      name: "Switch context, current Brain",
    }),
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(
      window.localStorage.getItem("second-brain-os.active-workspace.v1"),
    ).toBe("ws_brain");
  });

  fireEvent.click(
    screen.getByRole("button", {
      name: "Switch context, current Brain",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Project/ }));

  await waitFor(() => {
    expect(
      window.localStorage.getItem("second-brain-os.active-workspace.v1"),
    ).toBe("ws_project");
  });
});

test("registers a folder with an editable derived name and trust level", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_list", success([]));
  mock.setResponse(
    "workspace_select_root",
    success({
      grantId: "root_grant_test",
      displayPath: "/Users/test/Research Brain",
      suggestedName: "Research Brain",
    }),
  );
  mock.setResponse("workspace_register", success(brain));

  const onWorkspaceOpened = vi.fn();
  render(
    <WorkspaceProvider ipc={mock.client}>
      <ProjectsProvider ipc={mock.client}>
        <WorkspaceSwitcher onWorkspaceOpened={onWorkspaceOpened} />
      </ProjectsProvider>
    </WorkspaceProvider>,
  );

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Switch context, current No workspace",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));
  fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));

  expect(
    mock.calls.some(({ command }) => command === "workspace_select_root"),
  ).toBe(true);
  expect(
    await screen.findByLabelText("Selected workspace folder"),
  ).toHaveTextContent("/Users/test/Research Brain");

  const nameInput = screen.getByLabelText("Workspace name");
  expect(nameInput).toHaveValue("Research Brain");
  fireEvent.change(nameInput, { target: { value: "Research notes" } });
  fireEvent.change(screen.getByLabelText("Trust level"), {
    target: { value: "untrusted" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));

  await waitFor(() => {
    expect(
      mock.calls.find(({ command }) => command === "workspace_register"),
    ).toEqual({
      command: "workspace_register",
      args: {
        registration: {
          name: "Research notes",
          rootPath: "/Users/test/Research Brain",
          rootGrantId: "root_grant_test",
          kind: "brain",
          trustLevel: "untrusted",
        },
      },
    });
  });
  expect(onWorkspaceOpened).toHaveBeenCalledOnce();
});

test("requires a fresh native grant for each new workspace", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_list", success([brain]));

  render(
    <WorkspaceProvider ipc={mock.client}>
      <ProjectsProvider ipc={mock.client}>
        <WorkspaceSwitcher />
      </ProjectsProvider>
    </WorkspaceProvider>,
  );

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Switch context, current Brain",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /New workspace/ }));

  const dialog = screen.getByRole("dialog", { name: "New workspace" });
  expect(dialog.parentElement?.parentElement).toBe(document.body);
  expect(screen.getByLabelText("Selected workspace folder")).toHaveTextContent(
    "No folder selected yet.",
  );
  expect(screen.getByRole("button", { name: "Open workspace" })).toBeDisabled();
});

test("blocks workspace changes when the shell reports dirty tabs", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_list", success([brain, project]));

  render(
    <WorkspaceProvider ipc={mock.client}>
      <ProjectsProvider ipc={mock.client}>
        <WorkspaceSwitcher
          onBeforeWorkspaceChange={() =>
            "Save or discard unsaved changes before switching workspaces."
          }
        />
      </ProjectsProvider>
    </WorkspaceProvider>,
  );

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Switch context, current Brain",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Project/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Save or discard unsaved changes",
  );
  expect(
    window.localStorage.getItem("second-brain-os.active-workspace.v1"),
  ).toBe("ws_brain");
});
