# Development setup

Use the [root setup guide](../../README.md#setup) for prerequisites,
installation, and the Windows long-path fallback. The active app uses Bun,
Node.js, and Electron. Rust, pnpm, WebView2, and WebKitGTK belonged to the
retired Tauri application and are not this app's setup instructions.

The root [command table](../../README.md#common-commands) is the canonical
entry point for development and checks. See [architecture](../architecture/README.md)
for runtime boundaries and [release operations](../release-operations.md) for
candidate packaging and verification limits.

## Dependency updates

Toolchain versions live in `.node-version` and the root and `opencode/`
package manifests. Workspace dependencies and patches live in
`opencode/package.json`, `opencode/bun.lock`, and `opencode/patches/`.
Update these together and run the relevant checks from the root command table.
The archive's SQL files are reference material, not active migrations.
