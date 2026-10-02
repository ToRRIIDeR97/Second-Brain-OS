# Documentation

Start with the root [README](../README.md) for setup and commands, and
[AGENTS.md](../AGENTS.md) for repository rules.

| Path | Contents |
| --- | --- |
| [architecture/](architecture/README.md) | Active Electron/OpenCode components and boundaries |
| [security/](security/threat-model.md) | Threat model, data classification, approval risk classes, Google planner |
| [product/](product/PRODUCT-BRIEF-V1.md) | Product brief, navigation map, and active feature plans |
| [adr/](adr/) | Architecture decision records; ADR-010 sets the OpenCode Electron base |
| [development/setup.md](development/setup.md) | Development setup pointers and dependency updates |
| [release-operations.md](release-operations.md) | Electron candidate packaging and verification limits |
| [opencode-upstream.md](opencode-upstream.md) | Pinned OpenCode fork revision and change policy |
| [records/](records/) | Dated cleanup and audit records for the Electron app |
| [archive/tauri/](archive/tauri/README.md) | Retired Tauri app: plans, checkpoints, handovers, contracts, and evidence |

ADR-004, ADR-005, ADR-006, and ADR-009 and some security policies still use
Tauri-era wording. Where they disagree with the architecture document or threat
model, those documents win. The latest scope audit is
[records/scope-audit-2026-10-02.md](records/scope-audit-2026-10-02.md).
