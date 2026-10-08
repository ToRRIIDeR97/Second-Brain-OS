# Harness setup assistant

## Problem

Adding a harness in Settings → Harnesses meant typing the ID, command, and
arguments yourself. Test only checked the ACP handshake. The user wants an AI
chat on that page to do the setup, and a check that the harness really
answers before it can be saved.

The user decided (2026-10-08):

- **Model:** the user picks the assistant's harness and model in the chat.
- **Autonomy:** the assistant investigates and the app tests, but the user
  clicks Save.
- **"Functional":** handshake, model list, and one real reply.

## Design

ACP agents can't receive Second Brain tools, so the page drives the assistant
instead of the assistant calling Second Brain tools.

1. "Set up with assistant" opens a chat. The harness and model picker is the
   one the prompt uses (`createPromptHarnessController`).
2. The session runs in a folder the server provides
   (`GET /api/harness/assistant-directory`, under the global state
   directory), so it stays out of project lists.
3. The first message carries the task instructions plus the request. ACP
   agents get no Second Brain system prompt.
4. The assistant runs quick checks (`which`, `--help`) and replies with a
   ```` ```harness ```` JSON block.
5. When the reply finishes, the page parses the block and calls
   `POST /api/harness/verify`. That runs the handshake, `session/new`, an
   optional model switch, and the prompt "Reply with exactly: harness ok".
   Tool permissions are refused and the timeout is 120 s.
6. A failed test is sent back to the chat, up to 3 times automatically. A
   no-reply failure lists the models the agent offers.
7. A passed test enables Save. Save stores the entry with the passing model
   first, so the picker defaults to it.

Files:

- Core: `core/src/harness/acp.ts` (`verify`, plus `agent` on sessions),
  `core/src/harness/registry.ts` (`verify`), and `core/src/harness.ts`
  (`verify`, `assistantDirectory`).
- Schema, protocol, and server: `schema/src/harness.ts`
  (`VerifyInput`, `Verification`), `protocol/src/groups/harness.ts`, and
  `server/src/handlers/harness.ts`.
- App: `settings-v2/harness-assistant.tsx`, `harness-assistant-behavior.ts`
  and its test, `harnesses.tsx`, and `utils/server.ts`.

## Verification

All results below are from 2026-10-08. The same agent wrote the code and the
tests, and the tests were written after the code, so there is no
failing-first baseline.

| Check | Result |
|---|---|
| `acceptance/verify.test.ts -t core`, run from `opencode/packages/core` | 4 pass |
| `acceptance/verify.test.ts -t route`, run from `opencode/packages/opencode` | 1 pass |
| `settings-v2/harness-assistant-behavior.test.ts` (app) | 5 pass |
| Settings-page plan tests, core (regression) | 20 pass |
| `bun run typecheck`, `lint`, `test`, `build` | pass. Lint has 0 errors and 4353 warnings, below `main`'s 4356. |
| Live run in the dev app, over CDP | see below |

The live run used the "OpenCode CLI" harness with `glm-5.3-flash` and the
request "add the opencode CLI as opencode-acp-check":

1. The first test failed because the agent has no default model, and the
   result listed the agent's models.
2. The assistant re-proposed with `opencode-go/glm-5.3-flash`, and that test
   passed with the reply "harness ok" and 431 models.
3. Save stored the entry with that model first.
4. The entry was removed afterwards.

The whole run took 17 s. An earlier run, before the instructions limited the
assistant to quick checks, spent minutes writing its own ACP test scripts.

Setup, once per checkout. The link is gitignored:

```sh
cd "Implementations/harness-setup-assistant" && ln -s ../../opencode/packages/opencode/node_modules node_modules
```

## Limitations

- Assistant sessions aren't archived when the dialog closes. They run in the
  assistant folder, so they don't appear in project lists.
- The functional test costs one model call on the proposed agent's
  credentials.
- The assistant can't install CLIs. It tells the user the install command
  instead.
