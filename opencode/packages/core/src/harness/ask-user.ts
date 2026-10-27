export * as HarnessAskUser from "./ask-user"

import { Effect, Schema } from "effect"
import { QuestionV2 } from "../question"
import { SessionSchema } from "../session/schema"
import { QuestionTool } from "../tool/question"

/**
 * `ask_user` for external harnesses: their questions go through the same Location-owned
 * QuestionV2 service as the native `question` tool, so the Run's question dock shows them.
 *
 * MCP clients give up on a tool call after a while, so one call waits at most `WAIT_SECONDS`
 * and then reports the question as still open. The question stays pending in the dock for the
 * rest of the harness turn; a repeated call with the same questions in that turn waits on it
 * again instead of asking twice. When the turn ends, however it ends, the question is withdrawn.
 */

/** Below Node fetch's default 300 s wait for response headers, which Node-based MCP clients such as Gemini CLI inherit. */
export const WAIT_SECONDS = 240

export const Input = Schema.Struct({ questions: Schema.Array(QuestionV2.Prompt) })

export type Outcome =
  | { readonly type: "answered"; readonly answers: ReadonlyArray<QuestionV2.Answer> }
  | { readonly type: "declined" }
  | { readonly type: "open" }

/** Asks `questions` in the Run's dock and waits up to `waitSeconds` for the user. */
export type Ask = (questions: ReadonlyArray<QuestionV2.Prompt>, waitSeconds: number) => Promise<Outcome>

export interface Asker {
  readonly ask: Ask
  /**
   * Called when the runtime's harness turn ends, finished, failed or interrupted. Withdraws a
   * question still open in the dock and forgets an answer the agent never collected, so a later
   * turn asking the same questions asks afresh.
   */
  readonly endTurn: Effect.Effect<void>
}

interface Open {
  readonly key: string
  readonly id: QuestionV2.ID
  readonly outcome: Promise<Exclude<Outcome, { type: "open" }>>
  settled: boolean
}

/**
 * One harness runtime's asker. The runtime has at most one open question: asking something
 * different withdraws the previous one, and the end of the turn or closing the scope withdraws
 * whatever is still open, so the dock never keeps a question nobody is waiting for.
 */
export const make = Effect.fn("HarnessAskUser.make")(function* (
  questions: QuestionV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const state: { open?: Open } = {}
  const withdraw = (open: Open | undefined) =>
    open && !open.settled ? questions.reject(open.id).pipe(Effect.ignore) : Effect.void
  yield* Effect.addFinalizer(() => withdraw(state.open))

  const start = (key: string, prompts: ReadonlyArray<QuestionV2.Prompt>) => {
    const id = QuestionV2.ID.ascending()
    const open: Open = {
      key,
      id,
      settled: false,
      outcome: Effect.runPromise(
        questions.ask({ id, sessionID, questions: prompts }).pipe(
          Effect.map((answers) => ({ type: "answered" as const, answers })),
          Effect.catchTag("QuestionV2.RejectedError", () => Effect.succeed({ type: "declined" as const })),
        ),
      ),
    }
    const settle = () => {
      open.settled = true
    }
    void open.outcome.then(settle, settle)
    return open
  }

  const ask: Ask = async (prompts, waitSeconds) => {
    const key = JSON.stringify(prompts)
    const current = state.open
    const open = current?.key === key ? current : start(key, prompts)
    if (open !== current) {
      state.open = open
      await Effect.runPromise(withdraw(current))
    }
    const outcome = await settleWithin(open.outcome, waitSeconds)
    // Once the agent has the answer, the same questions may be asked afresh.
    if (outcome.type !== "open" && state.open === open) state.open = undefined
    return outcome
  }
  const endTurn = Effect.suspend(() => {
    const open = state.open
    state.open = undefined
    return withdraw(open)
  })
  return { ask, endTurn } satisfies Asker
})

/** The tool result the agent reads, in the native `question` tool's wording when answered. */
export function resultText(questions: ReadonlyArray<QuestionV2.Prompt>, outcome: Outcome) {
  if (outcome.type === "answered") return QuestionTool.toModelOutput(questions, outcome.answers)
  if (outcome.type === "declined")
    return "The user declined to answer these questions. Continue with your best judgement, or ask in chat."
  return "The question is still open in Tenon and the user has not answered yet. Call ask_user again with the same questions to keep waiting (the user is not asked twice), or continue without the answer."
}

async function settleWithin<A>(promise: Promise<A>, waitSeconds: number): Promise<A | { readonly type: "open" }> {
  const timer: { id?: ReturnType<typeof setTimeout> } = {}
  const timeout = new Promise<{ readonly type: "open" }>((resolve) => {
    timer.id = setTimeout(() => resolve({ type: "open" }), waitSeconds * 1_000)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer.id))
}
