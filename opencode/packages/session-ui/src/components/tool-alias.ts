// Tools that render with another tool's view. Harness tools arrive under their own names: Codex runs commands as
// `command_execution` and ACP agents as `acp_execute`, which are shell commands; an ACP edit carries a diff the
// edit view can show.
const aliases: Record<string, string> = {
  apply_patch: "patch",
  bash: "shell",
  command_execution: "shell",
  acp_execute: "shell",
  acp_edit: "edit",
}

/** The registered renderer a tool name uses. */
export function toolRendererName(name: string) {
  return aliases[name] ?? name
}
