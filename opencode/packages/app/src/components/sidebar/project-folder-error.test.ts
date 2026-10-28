import { describe, expect, test } from "bun:test"
import { SecondBrainRequestError } from "@/features/second-brain/client"
import { linkFolderErrorKey } from "./project-folder-error"

describe("linkFolderErrorKey", () => {
  test("explains each reason the server gives for refusing a folder", () => {
    expect(linkFolderErrorKey(new SecondBrainRequestError(400, "invalid_folder"))).toBe(
      "secondBrain.sidebar.addProject.error.invalidFolder",
    )
    expect(linkFolderErrorKey(new SecondBrainRequestError(400, "overlaps_workspace"))).toBe(
      "secondBrain.sidebar.addProject.error.overlapsWorkspace",
    )
    expect(linkFolderErrorKey(new SecondBrainRequestError(400, "protected_folder"))).toBe(
      "secondBrain.sidebar.addProject.error.protectedFolder",
    )
  })

  test("falls back to the generic failure for anything else", () => {
    expect(linkFolderErrorKey(new SecondBrainRequestError(400, "toString"))).toBe("common.requestFailed")
    expect(linkFolderErrorKey(new SecondBrainRequestError(500))).toBe("common.requestFailed")
    expect(linkFolderErrorKey(new Error("offline"))).toBe("common.requestFailed")
  })
})
