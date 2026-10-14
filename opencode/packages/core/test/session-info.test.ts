import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { fromRow } from "@opencode-ai/core/session/info"
import { SessionTable } from "@opencode-ai/core/session/sql"

const row = (input: Partial<typeof SessionTable.$inferSelect>): typeof SessionTable.$inferSelect => ({
  id: "ses_info" as (typeof SessionTable.$inferSelect)["id"],
  project_id: "project" as (typeof SessionTable.$inferSelect)["project_id"],
  workspace_id: null,
  parent_id: null,
  slug: "info",
  directory: "/tmp/info",
  path: null,
  title: "info",
  version: "local",
  share_url: null,
  summary_additions: null,
  summary_deletions: null,
  summary_files: null,
  summary_diffs: null,
  metadata: null,
  cost: 0,
  tokens_input: 0,
  tokens_output: 0,
  tokens_reasoning: 0,
  tokens_cache_read: 0,
  tokens_cache_write: 0,
  revert: null,
  permission: null,
  agent: null,
  model: null,
  time_created: 1,
  time_updated: 2,
  time_compacting: null,
  time_archived: null,
  ...input,
})

describe("SessionV2 info", () => {
  test("derives time.pinned from metadata.pinned", () => {
    expect(fromRow(row({ metadata: { pinned: 42 } })).time.pinned).toEqual(DateTime.makeUnsafe(42))
    expect(fromRow(row({ metadata: { pinned: true } })).time.pinned).toBeUndefined()
    expect(fromRow(row({})).time.pinned).toBeUndefined()
  })
})
