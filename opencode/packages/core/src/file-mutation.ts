export * as FileMutation from "./file-mutation"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Schedule, Schema } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { randomUUID } from "crypto"
import { basename, dirname, join } from "path"
import { KeyedMutex } from "./effect/keyed-mutex"
import { FSUtil } from "./fs-util"

export interface Target {
  readonly canonical: string
  readonly resource: string
}

export interface WriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
}

export interface TextWriteInput {
  readonly target: Target
  readonly content: string
}

export interface ConditionalWriteInput extends WriteInput {
  readonly expected: Uint8Array
}

export interface RemoveInput {
  readonly target: Target
}

export class StaleContentError extends Schema.TaggedErrorClass<StaleContentError>()("FileMutation.StaleContentError", {
  path: Schema.String,
}) {}

export class TargetExistsError extends Schema.TaggedErrorClass<TargetExistsError>()("FileMutation.TargetExistsError", {
  path: Schema.String,
}) {}

export interface WriteResult {
  readonly operation: "write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface RemoveResult {
  readonly operation: "remove"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface Interface {
  /** Create without replacing an existing target. */
  readonly create: (input: WriteInput) => Effect.Effect<WriteResult, TargetExistsError | FSUtil.Error>
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Write text while retaining an existing UTF-8 BOM and emitting at most one BOM. */
  readonly writeTextPreservingBom: (input: TextWriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Commit only if an existing target still has the expected bytes. */
  readonly writeIfUnchanged: (
    input: ConditionalWriteInput,
  ) => Effect.Effect<WriteResult, StaleContentError | FSUtil.Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<RemoveResult, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileMutation") {}

/**
 * Serialize file changes by canonical target. Conditional writes compare and
 * write under the same process-local lock so cooperating OpenCode mutations do
 * not overwrite changes made from the same stale content. Replacing writes go
 * through a synced sibling temp file and a rename, so a crash leaves either the
 * old or the new content, never a truncated file.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const withTargetLock =
      (target: Target) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        locks.withLock(target.canonical)(Effect.uninterruptible(effect))

    // Returns whether the target existed. A rename swaps in a new inode and
    // ignores the target's own permissions, so a read-only target is refused
    // up front (as an in-place write was) and its permission bits are copied.
    const replace = (path: string, content: string | Uint8Array) =>
      Effect.gen(function* () {
        const existing = yield* fs
          .stat(path)
          .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
        if (existing) yield* fs.access(path, { writable: true })
        if (!existing) yield* fs.ensureDir(dirname(path))
        const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
        const removeTemp = () => fs.remove(temp).pipe(Effect.ignore)
        const staged = yield* (
          typeof content === "string"
            ? fs.writeFileString(temp, content, { flag: "wx" })
            : fs.writeFile(temp, content, { flag: "wx" })
        ).pipe(
          Effect.as(true),
          // A directory that refuses new files can still hold a writable target: write it in place.
          Effect.catchReason("PlatformError", "PermissionDenied", () => Effect.succeed(false)),
          Effect.onError(removeTemp),
        )
        if (!staged) {
          yield* typeof content === "string" ? fs.writeFileString(path, content) : fs.writeFile(path, content)
          return existing !== undefined
        }
        yield* Effect.gen(function* () {
          yield* syncFile(temp)
          if (existing) yield* fs.chmod(temp, existing.mode & 0o7777)
          // Windows refuses a rename while an indexer, antivirus or editor briefly holds the target.
          // Suspended so each retry calls rename again, whatever the filesystem implementation does at call time.
          yield* Effect.suspend(() => fs.rename(temp, path)).pipe(
            Effect.retry({ while: isTransientLock, schedule: Schedule.exponential("25 millis"), times: 4 }),
          )
        }).pipe(Effect.onError(removeTemp))
        return existing !== undefined
      })

    const syncFile = (path: string) =>
      Effect.scoped(fs.open(path, { flag: "r+" }).pipe(Effect.flatMap((file) => file.sync)))

    // Stage the full content in a synced sibling temp file, then publish it without replacing an
    // existing target: a hard link fails if the target exists. Where hard links are unsupported, a
    // rename after an existence check under the target lock is the fallback. Either way a crash or
    // failed write never leaves a partial target.
    const publishNew = (path: string, content: string | Uint8Array) =>
      Effect.gen(function* () {
        yield* fs.ensureDir(dirname(path))
        const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
        yield* Effect.gen(function* () {
          yield* typeof content === "string"
            ? fs.writeFileString(temp, content, { flag: "wx" })
            : fs.writeFile(temp, content, { flag: "wx" })
          yield* syncFile(temp)
          yield* fs.link(temp, path).pipe(
            Effect.catchIf(
              (error) => error.reason._tag !== "AlreadyExists",
              () =>
                Effect.gen(function* () {
                  if (yield* fs.exists(path)) return yield* new TargetExistsError({ path })
                  yield* fs.rename(temp, path)
                }),
            ),
            Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.fail(new TargetExistsError({ path }))),
          )
        }).pipe(Effect.ensuring(fs.remove(temp).pipe(Effect.ignore)))
      })

    const writeResult = (target: Target, existed: boolean): WriteResult => ({
      operation: "write",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const removeResult = (target: Target, existed: boolean): RemoveResult => ({
      operation: "remove",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          return writeResult(input.target, yield* replace(input.target.canonical, input.content))
        }),
      ),
    )

    const writeTextPreservingBom = Effect.fn("FileMutation.writeTextPreservingBom")((input: TextWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const next = splitBom(input.content)
          const current = yield* fs
            .readFile(input.target.canonical)
            .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
          yield* replace(
            input.target.canonical,
            joinBom(next.text, Boolean(current && hasUtf8Bom(current)) || next.bom),
          )
          return writeResult(input.target, current !== undefined)
        }),
      ),
    )

    const create = Effect.fn("FileMutation.create")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          yield* publishNew(input.target.canonical, input.content)
          return writeResult(input.target, false)
        }),
      ),
    )

    const writeIfUnchanged = Effect.fn("FileMutation.writeIfUnchanged")((input: ConditionalWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const current = yield* fs.readFile(input.target.canonical)
          if (!sameBytes(current, input.expected)) {
            return yield* new StaleContentError({ path: input.target.canonical })
          }
          yield* replace(input.target.canonical, input.content)
          return writeResult(input.target, true)
        }),
      ),
    )

    const remove = Effect.fn("FileMutation.remove")((input: RemoveInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* fs.remove(input.target.canonical).pipe(
            Effect.as(true),
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
          )
          return removeResult(input.target, existed)
        }),
      ),
    )

    return Service.of({ create, write, writeTextPreservingBom, writeIfUnchanged, remove })
  }),
)

function isTransientLock(error: PlatformError) {
  return error.reason._tag === "PermissionDenied" || error.reason._tag === "Busy"
}

function splitBom(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

function joinBom(text: string, bom: boolean) {
  const stripped = splitBom(text).text
  return bom ? `\uFEFF${stripped}` : stripped
}

function hasUtf8Bom(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(right)
}

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node] })

/**
 * Deferred until the corresponding V2 integrations exist.
 */
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after V2 snapshot design exists.
// TODO: Notify LSP and collect diagnostics after V2 LSP runtime exists.
// TODO: Design multi-file transactions / rollback if apply_patch needs atomic edits.
// Until then, edits are sequential and report partial application.
// TODO: Define crash recovery and idempotency for side effects between Tool.Called and durable settlement.
