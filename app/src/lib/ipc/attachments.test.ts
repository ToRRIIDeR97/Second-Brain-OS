import { createMockIpc } from "./mock";

test("attachment calls stay workspace-scoped and typed", async () => {
  const mock = createMockIpc();
  const path = { workspaceId: "workspace-1", relativePath: "assets/image.png" };

  await mock.client.files.createAttachment({
    path,
    bytesBase64: "iVBORw0KGgo=",
  });
  await mock.client.files.readAttachment(path);

  expect(mock.calls).toEqual([
    {
      command: "file_create_attachment",
      args: {
        request: {
          path,
          bytesBase64: "iVBORw0KGgo=",
        },
      },
    },
    { command: "file_read_attachment", args: { path } },
  ]);
});
