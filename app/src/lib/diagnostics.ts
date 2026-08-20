import { ipcClient } from "./ipc/client";
import type { RendererDiagnostic } from "./ipc/types";

const MAX_DIAGNOSTIC_CHARS = 2_048;

function details(
  error: unknown,
): Pick<RendererDiagnostic, "message" | "stack"> {
  if (error instanceof Error) {
    return {
      message: error.message || "Unknown renderer error.",
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return {
    message: typeof error === "string" ? error : "Unknown renderer error.",
  };
}

export function reportRendererDiagnostic(
  source: string,
  error: unknown,
  stack?: string,
): void {
  const errorDetails = details(error);
  const diagnostic: RendererDiagnostic = {
    source: source.slice(0, 64),
    message: errorDetails.message.slice(0, MAX_DIAGNOSTIC_CHARS),
  };
  const errorStack = (stack ?? errorDetails.stack)?.slice(
    0,
    MAX_DIAGNOSTIC_CHARS,
  );
  if (errorStack) diagnostic.stack = errorStack;

  console.error(
    `[${diagnostic.source}] ${diagnostic.message}`,
    diagnostic.stack ?? "",
  );
  void ipcClient.system.log(diagnostic);
}
