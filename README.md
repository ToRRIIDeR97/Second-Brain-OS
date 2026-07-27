# Second Brain OS

A local-first desktop IDE for Markdown knowledge, project work, and inspectable
agent workflows. Canonical content stays in ordinary workspace files.

## Prerequisites

- Node.js 22.22.3
- pnpm 11.9.0
- Rust 1.88.0 with `rustfmt` and `clippy`
- [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)

On macOS, install Xcode Command Line Tools with `xcode-select --install`.

## Setup

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Run the web frontend with `pnpm dev`, or the desktop app with
`pnpm desktop:dev`.

## Common commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the frontend |
| `pnpm desktop:dev` | Start the Tauri desktop app |
| `pnpm build` | Type-check and build the frontend |
| `cargo build --workspace` | Build the backend and MCP sidecar |
| `pnpm test` | Run frontend and Rust tests |
| `pnpm lint` | Run TypeScript and Rust linters |
| `pnpm format` | Check frontend and Rust formatting |
| `pnpm audit` | Run dependency vulnerability checks |
| `pnpm licenses` | Check dependency licenses |

See [docs/development/setup.md](docs/development/setup.md) for platform details.

