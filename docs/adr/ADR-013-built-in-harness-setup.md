# ADR-013: Set up built-in harnesses from the app on day one

- Status: proposed
- Date: 2026-10-26
- Supersedes: none

## Context

The built-in external harnesses (Codex, Claude Code through `claude-agent-acp`,
and OpenCode through `opencode acp`) only work once their CLI is on `PATH` and
signed in. A new user had to install each CLI and log in from a terminal, and
the app only reported "Could not start …" or "Codex sign-in is required."
Built-in harnesses take no configuration, so an API key couldn't be given to
them either. Custom ACP agents keep their existing Settings flow; this is only
for the harnesses the app ships with.

What each harness offers (checked against Codex 0.164, `claude-agent-acp`
0.95 and OpenCode 1.19):

- **Codex:** the app-server's `account/login/start` returns a browser link for
  ChatGPT sign-in (`type: "chatgpt"`) or stores an API key (`type: "apiKey"`).
  `account/logout` signs out.
- **Claude Code:** the adapter advertises ACP terminal auth methods. They run
  `claude-agent-acp --cli auth login --claudeai` (Claude subscription) or
  `--console`, and need an interactive terminal. It also accepts
  `ANTHROPIC_API_KEY`.
- **OpenCode:** it advertises `opencode auth login`, an interactive terminal
  login, and reads provider keys such as `ANTHROPIC_API_KEY` from its
  environment.

## Options

### S1: Guided setup over a fixed recipe catalog (chosen)

`core/src/harness/setup.ts` holds one recipe per built-in: npm package,
command, sign-in kind, login command, and key options.

- **Install:** the server runs `npm install --global <package>@latest`. The
  package comes from the recipe, never from the caller.
- **Sign in:** Codex returns a browser link from its app-server. Claude Code
  and OpenCode run their own login command in the app's terminal.
- **API key:** Codex stores the key itself. For the others, the key goes into
  `harness-credentials.json` (`0600`) and is passed to that harness's
  environment only.

A dialog shows the state of each harness and these actions. It opens once on
first run, and again from Settings → Harnesses.

- Each harness signs in with its own official mechanism, so the app never
  handles OAuth tokens.
- One dialog covers install, sign-in and keys for all three.
- It needs npm (Node.js 22 or newer) on `PATH` for installs.

### S2: Terminal only

Open a terminal with the install and login commands typed in.

- Smallest change.
- Not guided. There is no state per harness and no way to give a built-in an
  API key.

### S3: Setup assistant

Reuse the Settings setup assistant, an agent chat, to install and sign in.

- No new UI.
- A new user has no working agent yet to run it, and its steps aren't
  deterministic.

## Decision

Use S1. Routes: `GET /api/harness/setup`,
`POST /api/harness/setup/:id/install`, `POST /api/harness/setup/:id/sign-in`,
and `PUT`/`DELETE /api/harness/setup/:id/api-key`. The renderer sends only a
harness ID, plus a key option and key value for the key route.

Sign-in state is read from each CLI's own files, without reading any token:
- Codex: `account/read`.
- Claude Code: `oauthAccount` in `~/.claude.json`.
- OpenCode: a non-empty `auth.json` in its data folder.

## Consequences

- A stored key is plain text in a `0600` file, like the provider keys the app
  already keeps in `auth.json`.
- Keys aren't validated when saved. A wrong key shows on the first reply.
- Harness runtimes are built per Location, so a key change bumps a process-wide
  revision. Every Location reloads its instances before its next turn and
  restarts the open processes of a harness whose environment changed.
- Installing still depends on the user's npm setup. A system Node.js that
  needs `sudo` for global installs fails with npm's own message.
