import { expect, test } from "bun:test"
import type { GoogleTaskProviderTask } from "@/context/platform"
import type { PlannerTask } from "./client"
import { mergeGoogleTasks, providerTask } from "./google-sync"

const remote: GoogleTaskProviderTask = {
  providerId: "real-id",
  taskListId: "list",
  taskListTitle: "List",
  title: "Task",
  updatedAt: "2026-09-08T00:00:00Z",
}
const pending: PlannerTask = {
  ...providerTask({ ...remote, providerId: "pending:local" }),
  syncState: "offline",
  outboxKey: "create-key",
  outboxKind: "create",
  projectId: "project_A",
  scheduledDate: "2026-09-09",
  start: "09:00",
  end: "10:00",
}

test("replaces a queued task identity and preserves its project and schedule across syncs", () => {
  const merged = mergeGoogleTasks(
    [pending],
    [remote],
    [{ idempotencyKey: "create-key", kind: "create", state: "synced", task: remote }],
  )
  expect(merged).toHaveLength(1)
  expect(merged[0]).toMatchObject({
    providerId: "real-id",
    projectId: "project_A",
    scheduledDate: "2026-09-09",
    start: "09:00",
    end: "10:00",
    syncState: "synced",
  })
  expect(merged[0].outboxKey).toBeUndefined()
  expect(mergeGoogleTasks(merged, [remote])).toEqual(merged)
})

test("retains failed edits, removes completed deletes, and keeps local tasks", () => {
  const edited: PlannerTask = { ...pending, providerId: remote.providerId, title: "Unsaved edit", outboxKind: "update" }
  const local: PlannerTask = { ...pending, id: "local", source: "local", syncState: "local" }
  const failed = mergeGoogleTasks(
    [local, edited],
    [remote],
    [{ idempotencyKey: "create-key", kind: "update", state: "conflict", task: remote }],
  )
  expect(failed).toEqual([local, { ...edited, syncState: "conflict" }])
  expect(
    mergeGoogleTasks(
      [local, edited],
      [],
      [{ idempotencyKey: "create-key", kind: "delete", state: "synced", task: null }],
    ),
  ).toEqual([local])
  expect(
    mergeGoogleTasks(
      [pending],
      [],
      [
        {
          idempotencyKey: "create-key",
          kind: "create",
          state: "failed",
          task: { ...remote, providerId: "pending:local" },
        },
      ],
    )[0],
  ).toMatchObject({ ...pending, syncState: "failed" })
})
