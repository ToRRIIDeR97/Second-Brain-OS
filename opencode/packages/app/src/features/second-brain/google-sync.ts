import type { GoogleCalendarPlatform, GoogleTaskProviderTask } from "@/context/platform"
import type { PlannerTask } from "./client"

export const providerTask = (task: GoogleTaskProviderTask, local?: PlannerTask): PlannerTask => ({
  id: `google-task:${task.taskListId}:${task.providerId}`,
  title: task.title,
  ...(task.notes ? { notes: task.notes } : {}),
  ...(local?.projectId ? { projectId: local.projectId } : {}),
  ...(task.dueDate ? { dueDate: task.dueDate } : {}),
  ...(local?.scheduledDate ? { scheduledDate: local.scheduledDate } : {}),
  ...(local?.start ? { start: local.start, end: local.end } : {}),
  ...(task.completedAt ? { completedAt: task.completedAt } : {}),
  providerId: task.providerId,
  taskListId: task.taskListId,
  taskListTitle: task.taskListTitle,
  ...(task.etag ? { etag: task.etag } : {}),
  createdAt: local?.createdAt ?? task.updatedAt,
  updatedAt: task.updatedAt,
  source: "google",
  syncState: "synced",
})

export function mergeGoogleTasks(
  current: ReadonlyArray<PlannerTask>,
  remote: GoogleTaskProviderTask[],
  writes: Awaited<ReturnType<GoogleCalendarPlatform["sync"]>>["taskWrites"] = [],
): PlannerTask[] {
  const byKey = new Map(remote.map((task) => [`${task.taskListId}:${task.providerId}`, task]))
  const byWrite = new Map(writes.map((write) => [write.idempotencyKey, write]))
  const merged: PlannerTask[] = []
  for (const task of current) {
    if (task.source === "local") {
      merged.push(task)
      continue
    }
    const write = task.outboxKey ? byWrite.get(task.outboxKey) : undefined
    const provider = write?.state === "synced" && write.task ? write.task : task
    const key = `${provider?.taskListId}:${provider?.providerId}`
    const fetched = byKey.get(key)
    byKey.delete(key)
    if (task.outboxKey && write?.state !== "synced") {
      merged.push({ ...task, syncState: write?.state ?? task.syncState })
      continue
    }
    if (write?.state === "synced" && write.kind === "delete") continue
    const saved = fetched ?? (write?.state === "synced" ? write.task : undefined)
    if (saved) merged.push(providerTask(saved, task))
  }
  return [...merged, ...Array.from(byKey.values(), (task) => providerTask(task))]
}
