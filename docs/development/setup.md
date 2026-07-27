# Development setup

The pinned versions live in `.node-version`, `package.json`, and
`rust-toolchain.toml`.

## macOS

1. Install Xcode Command Line Tools.
2. Install the pinned Node.js and pnpm versions.
3. Install Rust through rustup; the repository selects Rust 1.88.0.
4. Run `pnpm install --frozen-lockfile`.

## Windows

Install Microsoft C++ Build Tools and WebView2, then the pinned Node.js, pnpm,
and Rust versions.

## Linux

Install the WebKitGTK and native build packages listed in the current Tauri 2
prerequisites, then the pinned Node.js, pnpm, and Rust versions.

## Dependency updates

Runtime and toolchain versions are exact by default. Update them in one change,
regenerate both lockfiles, run `pnpm check`, and record compatibility-impacting
updates in `docs/compatibility.md`.

