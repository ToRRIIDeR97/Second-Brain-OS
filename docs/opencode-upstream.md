# OpenCode upstream

The `opencode/` directory is imported from `anomalyco/opencode` at commit
`bb72277407798e31e3f7d323c3144807238e0d6e` under the MIT License.

Keep the agent runtime, permission controls, Electron host, workspace access,
and session compatibility needed by Second Brain OS. Add product behavior in
`opencode/packages/app` and native behavior in `opencode/packages/desktop`.
Hosted billing/console, public websites, statistics infrastructure, bots, editor
extensions, and upstream release automation have been removed from this fork.

Internal package names, data-directory identifiers, and protocol names retain
OpenCode compatibility. Display names use Second Brain OS. Automatic updates
are disabled until the fork has its own verified signed release feed.

The import contains ordinary files instead of 60 upstream symbolic links so it
works from Windows workspaces without Developer Mode.
