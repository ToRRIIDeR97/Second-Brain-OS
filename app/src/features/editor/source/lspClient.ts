import type { Monaco } from "@monaco-editor/react";
import type { IpcClient, LspServerKind } from "../../../lib/ipc";

export function lspServerForLanguage(
  language: string,
): LspServerKind | undefined {
  if (language === "typescript" || language === "javascript")
    return "type_script";
  if (language === "python") return "python";
  if (language === "rust") return "rust";
  return undefined;
}

type LspConnection = {
  dispose: () => Promise<void>;
};

export async function connectLsp(
  monaco: Monaco,
  ipc: IpcClient,
  workspaceId: string,
  language: string,
): Promise<LspConnection | undefined> {
  const server = lspServerForLanguage(language);
  if (!server) return undefined;
  const started = await ipc.lsp.start(workspaceId, server);
  if (!started.ok) throw new Error(started.error.message);

  let listener: ((message: unknown) => void) | undefined;
  let closed = false;
  const transport = {
    state: {
      value: { state: "open" as const },
      onChange: () => ({ dispose: () => undefined }),
    },
    setListener: (next: ((message: unknown) => void) | undefined) => {
      listener = next;
    },
    send: async (message: unknown) => {
      const result = await ipc.lsp.send(workspaceId, started.data.id, message);
      if (!result.ok) throw new Error(result.error.message);
    },
    toString: () => `${server}:${workspaceId}`,
  };

  try {
    // Monaco's generated LSP type is valid to tsc but not resolved by typescript-eslint.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    new monaco.lsp.MonacoLspClient(
      transport as ConstructorParameters<typeof monaco.lsp.MonacoLspClient>[0],
    );
  } catch (cause) {
    await ipc.lsp.stop(workspaceId, started.data.id);
    throw cause;
  }

  const poll = async () => {
    while (!closed) {
      const result = await ipc.lsp.receive(workspaceId, started.data.id, 100);
      if (!result.ok) throw new Error(result.error.message);
      if (result.data !== null) listener?.(result.data);
    }
  };
  void poll().catch(() => {
    if (!closed) void ipc.lsp.stop(workspaceId, started.data.id);
    closed = true;
  });

  return {
    dispose: async () => {
      if (closed) return;
      closed = true;
      await ipc.lsp.stop(workspaceId, started.data.id);
    },
  };
}
