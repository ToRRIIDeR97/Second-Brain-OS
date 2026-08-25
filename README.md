# Second Brain OS

A local-first desktop IDE for Markdown knowledge, project work, and inspectable
agent workflows. The product now forks OpenCode's desktop application so its
agent, session, terminal, file, and project workflows remain the base product.
Second Brain features are added inside that application.

## Prerequisites

- Bun 1.3.14
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

The previous React/Tauri application remains in `app/` as donor code. It is not
the default desktop host.

## Common commands

| Command                      | Purpose                                      |
| ---------------------------- | -------------------------------------------- |
| `bun run dev`                | Start the OpenCode Electron desktop app      |
| `bun run build`              | Build the Electron renderer and main process |
| `bun run typecheck`          | Type-check the desktop package               |
| `bun run lint`               | Run OpenCode's linter                        |
| `bun run test`               | Run desktop package tests                    |
| `bun run legacy:desktop:dev` | Start the previous Tauri donor app           |

The fork is pinned and documented in
[docs/opencode-upstream.md](docs/opencode-upstream.md).
