import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { File } from "@opencode-ai/core/file"
import { Git } from "@opencode-ai/core/git"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { branch, commit, gitRemote } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Git.node))

describe("Git", () => {
  it.live("clones a remote and reads checkout metadata", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const git = yield* Git.Service
        const target = AbsolutePath.make(path.join(fixture.root, "checkout"))
        const repository = yield* git.repo.clone({ remote: fixture.remote, directory: target })

        expect(yield* git.remote.get(repository)).toBe(fixture.remote)
        expect(yield* git.history.head(repository)).toBeString()
        expect(yield* git.history.branch(repository)).toBe("main")
        expect(yield* git.history.defaultRemoteBranch(repository)).toBe("main")
        expect(repository.worktree).toBe(target)
        expect(repository.gitDirectory).toBe(AbsolutePath.make(path.join(target, ".git")))
        expect(repository.commonDirectory).toBe(repository.gitDirectory)
        expect(yield* read(path.join(target, "README.md"))).toBe("one\n")
      }),
    ),
  )

  it.live("fetches, checks out, and resets remote changes", () =>
    withRemote((fixture) =>
      Effect.gen(function* () {
        const git = yield* Git.Service
        const target = AbsolutePath.make(path.join(fixture.root, "checkout"))
        const repository = yield* git.repo.clone({ remote: fixture.remote, directory: target })

        yield* Effect.promise(() => commit(fixture.source, "two\n", "second"))
        yield* git.sync.fetchRemotes(repository)
        yield* git.sync.resetHard(repository, "origin/main")
        expect(yield* read(path.join(target, "README.md"))).toBe("two\n")

        yield* Effect.promise(() => branch(fixture.source, "feature/docs", "feature\n"))
        yield* git.sync.fetchBranch(repository, { branch: "feature/docs" })
        yield* git.sync.checkoutRemoteBranch(repository, { branch: "feature/docs" })
        yield* git.sync.resetHard(repository, "origin/feature/docs")
        expect(yield* git.history.branch(repository)).toBe("feature/docs")
        expect(yield* read(path.join(target, "README.md"))).toBe("feature\n")
      }),
    ),
  )
})

function withRemote<A, E, R>(body: (fixture: Awaited<ReturnType<typeof gitRemote>>) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(async () => {
      const root = await tmpdir()
      return { root, fixture: await gitRemote(root.path) }
    }),
    (input) => body(input.fixture),
    (input) => Effect.promise(() => input.root[Symbol.asyncDispose]()),
  )
}

function read(file: string) {
  return Effect.promise(() => fs.readFile(file, "utf8")).pipe(Effect.map((content) => content.replace(/\r\n/g, "\n")))
}

async function initRepo(directory: string) {
  await $`git init`.cwd(directory).quiet()
  await $`git config core.fsmonitor false`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await $`git config user.email test@opencode.test`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
  await $`git commit --allow-empty -m root`.cwd(directory).quiet()
}

describe("Git worktrees", () => {
  it.live("creates, lists, and removes linked worktrees", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const directory = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(root.path)))
      const worktree = AbsolutePath.make(`${root.path}-git-worktree`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(worktree, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      const git = yield* Git.Service
      const repo = yield* git.repo.discover(directory)
      if (!repo) throw new Error("Repository not found")

      yield* git.worktree.create({ repository: repo, directory: worktree })

      expect((yield* git.worktree.list(repo)).some((entry) => entry.directory.endsWith("-git-worktree"))).toBe(true)
      const linked = yield* git.repo.discover(worktree)
      expect(linked?.worktree).toBe(AbsolutePath.make(yield* Effect.promise(() => fs.realpath(worktree))))
      expect(linked?.commonDirectory).toBe(repo.commonDirectory)
      expect(linked?.gitDirectory).not.toBe(repo.gitDirectory)
      if (!linked) throw new Error("Linked worktree not found")
      yield* git.worktree.remove({ repository: linked, directory: worktree, force: false })
      expect((yield* git.worktree.list(repo)).some((entry) => entry.directory.endsWith("-git-worktree"))).toBe(false)
    }),
  )
})

describe("Git trees", () => {
  it.live("captures, compares, previews, and restores scoped trees", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await initRepo(root.path)
        await fs.mkdir(path.join(root.path, "scope"))
        await fs.writeFile(path.join(root.path, "scope", "tracked.txt"), "one\n")
        await fs.writeFile(path.join(root.path, "outside.txt"), "outside\n")
        await $`git add .`.cwd(root.path).quiet()
        await $`git commit -m initial`.cwd(root.path).quiet()
      })
      const git = yield* Git.Service
      const source = yield* git.repo.discover(AbsolutePath.make(root.path))
      if (!source) throw new Error("Repository not found")
      const storage = AbsolutePath.make(path.join(root.path, ".snapshot"))
      const repository = yield* git.repo.create({ worktree: source.worktree, gitDirectory: storage, seed: source })
      yield* git.index.refresh({ repository, scope: RelativePath.make("scope") })
      const before = yield* git.tree.write(repository)

      yield* Effect.promise(async () => {
        await fs.writeFile(path.join(root.path, "scope", "tracked.txt"), "two\n")
        await fs.writeFile(path.join(root.path, "scope", "added.txt"), "added\n")
        await fs.writeFile(path.join(root.path, "outside.txt"), "changed outside\n")
      })
      yield* git.index.refresh({ repository, scope: RelativePath.make("scope") })
      const after = yield* git.tree.write(repository)

      expect(yield* git.tree.files({ repository, from: before, to: after })).toEqual([
        RelativePath.make("scope/added.txt"),
        RelativePath.make("scope/tracked.txt"),
      ])
      const diffs = yield* git.tree.diff({ repository, from: before, to: after, context: 1 })
      expect(diffs.map((item) => [item.path, item.status])).toEqual([
        [RelativePath.make("scope/added.txt"), "added"],
        [RelativePath.make("scope/tracked.txt"), "modified"],
      ])

      const files = new Map([[RelativePath.make("scope/tracked.txt"), before]])
      const preview = yield* git.tree.preview({ repository, current: after, files, context: 1 })
      expect(preview).toHaveLength(1)
      expect(preview[0]?.path).toBe(RelativePath.make("scope/tracked.txt"))
      yield* git.tree.restore({ repository, files })
      expect(yield* read(path.join(root.path, "scope", "tracked.txt"))).toBe("one\n")
      expect(yield* read(path.join(root.path, "scope", "added.txt"))).toBe("added\n")
      expect(yield* read(path.join(root.path, "outside.txt"))).toBe("changed outside\n")
    }),
  )

  it.live("diffs many files in one pass with the same result as per-file git diffs", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const write = (file: string, content: string | Uint8Array) => fs.writeFile(path.join(root.path, file), content)
      const tree = async () => {
        await $`git add -A`.cwd(root.path).quiet()
        await $`git commit -m state`.cwd(root.path).quiet()
        return Git.TreeID.make((await $`git rev-parse HEAD^{tree}`.cwd(root.path).text()).trim())
      }
      const [before, after] = yield* Effect.promise(async () => {
        await initRepo(root.path)
        await Promise.all([
          ...Array.from({ length: 5 }, (_, index) => write(`file-${index}.txt`, `line ${index}\n`)),
          write("old-name.txt", "renamed content\nkept\n"),
          write("deleted.txt", "gone\n"),
          write("image.bin", new Uint8Array([0, 1, 2, 3, 0, 255])),
          write("with space.txt", "space\n"),
          write("ünïcode.txt", "accent\n"),
          write("mode.sh", "echo\n"),
          write("unchanged.txt", "same\n"),
          write("link", "was a file\n"),
        ])
        const first = await tree()
        await Promise.all([
          ...Array.from({ length: 5 }, (_, index) => write(`file-${index}.txt`, `line ${index}\nadded ${index}\n`)),
          fs.rename(path.join(root.path, "old-name.txt"), path.join(root.path, "new-name.txt")),
          fs.rm(path.join(root.path, "deleted.txt")),
          write("image.bin", new Uint8Array([0, 9, 9, 9, 0, 255])),
          write("added.txt", "fresh\n"),
          write("with space.txt", "space changed\n"),
          write("ünïcode.txt", "accent changed\n"),
          fs.chmod(path.join(root.path, "mode.sh"), 0o755),
          fs.rm(path.join(root.path, "link")),
        ])
        await fs.symlink("unchanged.txt", path.join(root.path, "link"))
        return [first, await tree()]
      })
      const git = yield* Git.Service
      const repository = yield* git.repo.discover(AbsolutePath.make(root.path))
      if (!repository) throw new Error("Repository not found")
      const files = yield* git.tree.files({ repository, from: before, to: after })
      const changed = yield* Effect.promise(() =>
        $`git diff --name-only --no-renames -z ${before} ${after}`.cwd(root.path).text(),
      )
      const paths = [...changed.split("\0").filter(Boolean), "unchanged.txt"].map((file) => RelativePath.make(file))
      const expected = yield* Effect.promise(() =>
        Promise.all(
          paths.map(async (file) => {
            const status = (
              await $`git diff --name-status --no-renames ${before} ${after} -- ${file}`.cwd(root.path).text()
            ).trim()
            const stats = (
              await $`git diff --numstat --no-renames ${before} ${after} -- ${file}`.cwd(root.path).text()
            ).split("\t")
            const binary = stats[0] === "-" || stats[1] === "-"
            return {
              path: file,
              status: status.startsWith("A") ? "added" : status.startsWith("D") ? "deleted" : "modified",
              additions: binary ? 0 : Number(stats[0] ?? 0),
              deletions: binary ? 0 : Number(stats[1] ?? 0),
              patch: binary
                ? ""
                : await $`git diff --unified=2 --no-renames ${before} ${after} -- ${file}`.cwd(root.path).text(),
            } satisfies File.Diff
          }),
        ),
      )

      const diffs = yield* git.tree.diff({ repository, from: before, to: after, context: 2, paths })
      expect(diffs).toEqual(expected)
      expect(diffs.find((item) => item.path === "new-name.txt")).toMatchObject({ status: "added", additions: 2 })
      expect(diffs.find((item) => item.path === "old-name.txt")).toMatchObject({ status: "deleted", deletions: 2 })
      expect(diffs.find((item) => item.path === "image.bin")).toMatchObject({ additions: 0, deletions: 0, patch: "" })
      expect(diffs.find((item) => item.path === "ünïcode.txt")?.patch).toContain("+accent changed")
      expect(diffs.find((item) => item.path === "link")?.patch).toContain("new file mode 120000")
      expect(diffs.find((item) => item.path === "unchanged.txt")).toEqual({
        path: RelativePath.make("unchanged.txt"),
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: "",
      })
      expect(yield* git.tree.diff({ repository, from: before, to: after, context: 2 })).toEqual(
        expected.filter((item) => files.includes(item.path)),
      )
      expect(yield* git.tree.diff({ repository, from: before, to: after, paths: [] })).toEqual([])
    }),
  )
})
