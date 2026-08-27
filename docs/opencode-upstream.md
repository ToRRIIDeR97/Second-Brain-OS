# OpenCode upstream

The `opencode/` directory is imported from `anomalyco/opencode` at commit
`bb72277407798e31e3f7d323c3144807238e0d6e` under the MIT License.

Keep OpenCode's existing UI and functionality intact. Add Second Brain features
through narrow changes in `opencode/packages/app` and native behavior through
`opencode/packages/desktop`. Do not recreate OpenCode screens in the legacy
Tauri application.

The import contains ordinary files instead of 60 upstream symbolic links so it
works from Windows workspaces without Developer Mode.
