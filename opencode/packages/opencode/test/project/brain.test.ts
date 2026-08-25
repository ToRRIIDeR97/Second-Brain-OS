import { describe, expect, test } from "bun:test"
import { BrainProject } from "../../src/project/brain"

describe("BrainProject cards", () => {
  test("migrates v1 metadata while preserving unknown fields and the Markdown body", () => {
    const source = `---
version: 1
id: project_01ABC
type: project
title: Ship the desktop app
status: active
workspace_id: workspace_01ABC
workspace_path: C:/Projects/desktop
tags: [desktop]
updated: 2026-08-25T00:00:00.000Z
custom_field: keep-me
---
# Ship the desktop app

Release an installable beta.

## Notes

Keep this body intact.
`
    const card = BrainProject.decode(source)

    expect(card.info.outcome).toBe("Release an installable beta.")
    expect(card.info.location).toEqual({ workspaceId: "workspace_01ABC", displayPath: "C:/Projects/desktop" })

    const encoded = BrainProject.encode(card.info, card.data, card.body)
    expect(encoded).toContain("version: 2")
    expect(encoded).toContain("custom_field: keep-me")
    expect(encoded).not.toContain("workspace_id:")
    expect(encoded).toContain("## Notes\n\nKeep this body intact.")
  })
})
