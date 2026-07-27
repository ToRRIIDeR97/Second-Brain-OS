import {
  ipcClient,
  type CommandResult,
  type FileReadResult,
  type FileWriteRequest,
  type FileWriteResult,
  type IpcClient,
  type WorkspacePath,
} from "../../../lib/ipc";

export function readTextFile(
  path: WorkspacePath,
  client: IpcClient = ipcClient,
): Promise<CommandResult<FileReadResult>> {
  return client.files.readText(path);
}

export function writeTextFile(
  request: FileWriteRequest,
  client: IpcClient = ipcClient,
): Promise<CommandResult<FileWriteResult>> {
  return client.files.writeText(request);
}
