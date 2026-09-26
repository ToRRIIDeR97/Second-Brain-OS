# Second Brain OS

A local-first, agent-powered second brain for files, notes, projects, and
planning. The Electron app builds on OpenCode's agent, session, terminal, and
file workflows. Brain home is the starting point; workspace management is
available through its Open workspace actions.

## Prerequisites

- Bun 1.3.14
- Node.js 24 for desktop tests and release tooling
- The platform prerequisites required by Electron

On macOS, install Xcode Command Line Tools with `xcode-select --install`.

## Setup

```sh
cd opencode
bun install --frozen-lockfile
cd ..
bun run dev
```

On Windows, native package installation can exceed the legacy 260-character
limit when this repository lives under a long OneDrive path. Prefer a shorter
checkout path. For this checkout, the verified fallback is:

```powershell
cd opencode
bun install --ignore-scripts
node packages/desktop/node_modules/electron/install.js
cd ..
bun run dev
```

The previous React/Tauri application is retired. Its schemas, recovery source
revision, and migration gaps are recorded in [the archive](docs/archive/tauri/README.md).

## Common commands

| Command                 | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `bun run dev`           | Start the Second Brain OS Electron app                |
| `bun run build`         | Build the Electron renderer and main process          |
| `bun run desktop:build` | Build and package an unsigned Windows candidate       |
| `bun run typecheck`     | Check renderer, desktop, core, and server types       |
| `bun run lint`          | Run OpenCode's linter                                 |
| `bun run test`          | Run desktop, renderer, and Second Brain domain tests  |
| `bun run test:engine`   | Run the full core and server suites                   |
| `bun run test:routes`   | Check Brain home and workspace navigation in Chromium |

The fork is pinned and documented in
[docs/opencode-upstream.md](docs/opencode-upstream.md).
Release artifacts and verification limits are documented in
[release operations](docs/release-operations.md).
