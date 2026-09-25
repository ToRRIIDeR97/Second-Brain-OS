import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMockIpc, type ProjectRecord } from "../../lib/ipc";
import { ProjectsProvider } from "../../state/projects";
import { WorkspaceProvider } from "../../state/workspace";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectsWorkspace } from "./ProjectsWorkspace";

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
  rootPath: "C:/Brain",
  kind: "brain" as const,
  trustLevel: "trusted" as const,
  canRead: true,
  canWrite: true,
  canUseTerminal: true,
};

const project: ProjectRecord = {
  id: "project_01ABC",
  name: "Control center",
  outcome: "Make the next meaningful action obvious.",
  templateId: null,
  instructions: "Keep changes reviewable.",
  status: "active",
  progressPercent: 20,
  nextMilestone: "Ship the Project list",
  blocker: null,
  tags: ["desktop"],
  location: null,
  createdAt: "2026-08-20T00:00:00Z",
  updatedAt: "2026-08-22T00:00:00Z",
};

test("creates a no-folder Project through the canonical Project command", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_list", success([brain]));
  mock.setResponse("project_list", success([]));
  mock.setResponse("project_create", success(project));

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <CreateProjectDialog
        open={open}
        ipc={mock.client}
        onClose={() => {
          setOpen(false);
        }}
      />
    );
  }

  render(
    <WorkspaceProvider ipc={mock.client}>
      <ProjectsProvider ipc={mock.client}>
        <Harness />
      </ProjectsProvider>
    </WorkspaceProvider>,
  );

  await waitFor(() => {
    expect(mock.calls.some(({ command }) => command === "project_list")).toBe(
      true,
    );
  });

  fireEvent.change(screen.getByLabelText("Project name"), {
    target: { value: "Control center" },
  });
  fireEvent.change(screen.getByLabelText("Outcome"), {
    target: { value: "Make the next meaningful action obvious." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

  await waitFor(() => {
    expect(
      mock.calls.find(({ command }) => command === "project_create"),
    ).toMatchObject({
      args: {
        request: {
          brainWorkspaceId: "ws_brain",
          name: "Control center",
          outcome: "Make the next meaningful action obvious.",
          location: { mode: "none" },
        },
      },
    });
  });
});

test("keeps validation beside required Project fields", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_list", success([brain]));
  mock.setResponse("project_list", success([]));
  render(
    <WorkspaceProvider ipc={mock.client}>
      <ProjectsProvider ipc={mock.client}>
        <CreateProjectDialog open ipc={mock.client} onClose={() => undefined} />
      </ProjectsProvider>
    </WorkspaceProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
  expect(await screen.findByText("Enter a Project name.")).toBeInTheDocument();
  expect(
    screen.getByText("Describe the outcome you want."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText(/Project name/)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("opens a Project and saves its progress and next milestone", async () => {
  const mock = createMockIpc();
  mock.setResponse("workspace_list", success([brain]));
  mock.setResponse("project_list", success([project]));
  mock.setResponse(
    "project_update",
    success({ ...project, progressPercent: 55, nextMilestone: "Finish Home" }),
  );
  render(
    <WorkspaceProvider ipc={mock.client}>
      <ProjectsProvider ipc={mock.client}>
        <ProjectsWorkspace
          view="overview"
          onCreate={() => undefined}
          onNavigate={() => undefined}
          ipc={mock.client}
        />
      </ProjectsProvider>
    </WorkspaceProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "Control center" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Progress"), {
    target: { value: "55" },
  });
  fireEvent.change(screen.getByLabelText("Next milestone"), {
    target: { value: "Finish Home" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save current state" }));
  await waitFor(() => {
    expect(
      mock.calls.find(({ command }) => command === "project_update"),
    ).toEqual({
      command: "project_update",
      args: {
        request: {
          brainWorkspaceId: "ws_brain",
          projectId: "project_01ABC",
          patch: {
            progressPercent: 55,
            nextMilestone: "Finish Home",
            blocker: null,
          },
        },
      },
    });
  });
});
