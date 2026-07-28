import { render, screen } from "@testing-library/react";
import { WorkspaceSurface } from "./WorkspaceSurface";
import { createMockIpc } from "../lib/ipc";

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
    <WorkspaceSurface
      activity="files"
      ipc={mock.client}
      onOpenPalette={() => undefined}
    />,
  );

  expect(
    await screen.findByRole("heading", { name: "Workspace files" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: /welcome.md/i }),
  ).toBeInTheDocument();
});
