import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function pickWorkspaceFolder() {
  if (!isTauri()) {
    throw new Error("Opening a workspace folder requires the desktop app.");
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select workspace folder",
  });

  return typeof selected === "string" && selected ? selected : undefined;
}
