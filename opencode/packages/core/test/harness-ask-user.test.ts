import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { HarnessAskUser } from "@opencode-ai/core/harness/ask-user"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([EventV2.node, QuestionV2.node])))

const sessionID = SessionV2.ID.make("ses_ask_user_test")
const pick: QuestionV2.Prompt = {
  question: "Which database?",
  header: "Database",
  options: [
    { label: "SQLite", description: "Embedded" },
    { label: "Postgres", description: "Server" },
  ],
}
const other: QuestionV2.Prompt = { question: "Which port?", header: "Port", options: [] }

const rejected = Effect.fn("HarnessAskUserTest.rejected")(function* () {
  const events = yield* EventV2.Service
  const ids: string[] = []
  const unsubscribe = yield* events.listen((event) =>
    Effect.sync(() => {
      if (event.type === QuestionV2.Event.Rejected.type) ids.push((event.data as { requestID: string }).requestID)
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return ids
})

describe("HarnessAskUser", () => {
  it.live("returns the answer in the native question tool's wording", () =>
    Effect.gen(function* () {
      const questions = yield* QuestionV2.Service
      const ask = yield* HarnessAskUser.make(questions, sessionID)
      const pending = ask([pick], 5)
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
      const [request] = yield* questions.list()
      expect(request).toMatchObject({ sessionID, questions: [pick] })
      yield* questions.reply({ requestID: request.id, answers: [["Postgres"]] })
      const outcome = yield* Effect.promise(() => pending)
      expect(outcome).toEqual({ type: "answered", answers: [["Postgres"]] })
      expect(HarnessAskUser.resultText([pick], outcome)).toBe(
        'User has answered your questions: "Which database?"="Postgres". You can now continue with the user\'s answers in mind.',
      )
    }),
  )

  it.live("keeps an unanswered question open and reuses it on a repeated call", () =>
    Effect.gen(function* () {
      const questions = yield* QuestionV2.Service
      const ask = yield* HarnessAskUser.make(questions, sessionID)
      expect(yield* Effect.promise(() => ask([pick], 0))).toEqual({ type: "open" })
      expect(HarnessAskUser.resultText([pick], { type: "open" })).toContain("still open in Tenon")
      const [request] = yield* questions.list()
      expect(yield* Effect.promise(() => ask([pick], 0))).toEqual({ type: "open" })
      expect((yield* questions.list()).map((item) => item.id)).toEqual([request.id])

      // Answered between calls: the next call collects it at once, and a later one asks afresh.
      yield* questions.reply({ requestID: request.id, answers: [["SQLite"]] })
      expect(yield* Effect.promise(() => ask([pick], 0))).toEqual({ type: "answered", answers: [["SQLite"]] })
      expect(yield* Effect.promise(() => ask([pick], 0))).toEqual({ type: "open" })
      expect((yield* questions.list()).map((item) => item.id)).not.toContain(request.id)
    }),
  )

  it.live("reports a dismissed question as declined", () =>
    Effect.gen(function* () {
      const questions = yield* QuestionV2.Service
      const ask = yield* HarnessAskUser.make(questions, sessionID)
      yield* Effect.promise(() => ask([pick], 0))
      const [request] = yield* questions.list()
      yield* questions.reject(request.id)
      const outcome = yield* Effect.promise(() => ask([pick], 0))
      expect(outcome).toEqual({ type: "declined" })
      expect(HarnessAskUser.resultText([pick], outcome)).toContain("declined to answer")
    }),
  )

  it.live("withdraws the open question when asked something else or when the runtime closes", () =>
    Effect.gen(function* () {
      const questions = yield* QuestionV2.Service
      const withdrawn = yield* rejected()
      const scope = yield* Scope.make()
      const ask = yield* HarnessAskUser.make(questions, sessionID).pipe(Scope.provide(scope))
      yield* Effect.promise(() => ask([pick], 0))
      const [first] = yield* questions.list()
      yield* Effect.promise(() => ask([other], 0))
      const [second] = yield* questions.list()
      expect(second).toMatchObject({ questions: [other] })
      expect(withdrawn).toEqual([first.id])

      yield* Scope.close(scope, Exit.void)
      expect(yield* questions.list()).toEqual([])
      expect(withdrawn).toEqual([first.id, second.id])
    }),
  )
})
