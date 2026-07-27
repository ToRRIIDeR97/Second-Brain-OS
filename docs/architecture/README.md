# Architecture

Second Brain OS is a modular monolith: one React/Tauri desktop application, one
Rust backend, one SQLite database, and one capability-free MCP sidecar shell.

The renderer owns presentation only. The Rust backend owns policy, persistence,
filesystem access, native processes, credentials, and provider integrations.

