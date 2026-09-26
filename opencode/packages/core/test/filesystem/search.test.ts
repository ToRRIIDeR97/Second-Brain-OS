import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { FileSystemSearch } from "@opencode-ai/core/filesystem/search"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Ripgrep.node, FSUtil.node])))

const withTmp = <A, E, R>(f: (directory: AbsolutePath) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(AbsolutePath.make(tmp.path))))

describe("Ripgrep", () => {
  it.live("globs files as an array", () =>
    withTmp((cwd) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(cwd, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "match.ts"), "needle\n"))
        const result = yield* (yield* Ripgrep.Service).glob({ cwd, pattern: "**/*.ts", limit: 10 })
        expect(result.map((item) => item.path)).toEqual([RelativePath.make("src/match.ts")])
      }),
    ),
  )

  it.live("greps files with include filtering", () =>
    withTmp((cwd) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(cwd, "src")))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "match.ts"), "needle\n"))
        yield* Effect.promise(() => fs.writeFile(path.join(cwd, "src", "skip.txt"), "needle\n"))
        const result = yield* (yield* Ripgrep.Service).grep({ cwd, pattern: "needle", include: "*.ts", limit: 10 })
        expect(result).toHaveLength(1)
        expect(result[0]?.entry.path).toBe(RelativePath.make("src/match.ts"))
        expect(result[0]?.submatches[0]?.text).toBe("needle")
      }),
    ),
  )
})

it.live("file search observes additions and deletions after initialization", () =>
  withTmp((cwd) =>
    Effect.gen(function* () {
      const search = yield* FileSystemSearch.Service
      expect(yield* search.find({ query: "fresh", type: "file" })).toEqual([])
      yield* Effect.promise(() => fs.writeFile(path.join(cwd, "fresh.md"), "created after initialization"))
      expect((yield* search.find({ query: "fresh", type: "file" })).map((entry) => entry.path)).toEqual([
        RelativePath.make("fresh.md"),
      ])
      yield* Effect.promise(() => fs.unlink(path.join(cwd, "fresh.md")))
      expect(yield* search.find({ query: "fresh", type: "file" })).toEqual([])
    }).pipe(
      Effect.provide(FileSystemSearch.ripgrepLayer),
      Effect.provideService(Location.Service, { directory: cwd, project: { id: ProjectV2.ID.global, directory: cwd } }),
    ),
  ),
)
