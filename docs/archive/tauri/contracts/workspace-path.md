# Workspace path contract v1

Filesystem commands receive a workspace ID and a validated relative path:

```ts
type WorkspacePath = {
  workspaceId: string;
  relativePath: string;
};
```

The renderer never supplies an absolute host path. The backend resolves the
registered canonical root, rejects absolute paths, `..` components, NULs,
alternate separators, and percent-encoded separators/dots, then canonicalizes
the nearest existing parent. The resulting path must remain below the
workspace root. A broken symlink is an error; a symlink is followed only when
its canonical target remains inside the workspace and the operation's policy
allows it.

Ignore files are independent controls:

- `.gitignore` is Git tracking metadata and is optional visibility filtering,
  never a security boundary.
- `.brainignore` controls indexing/search.
- `.agentignore` controls agent context and managed-session mounts.
- Application hard denies and workspace `security` policy always take
  precedence over these files.

Normal text responses are bounded to one configured limit (1 MiB by default)
and require valid UTF-8. Binary or oversized content uses a bounded descriptor
and chunk reads. Directory listing is one-directory-at-a-time with a bounded
cursor; it never recursively enumerates the workspace.

`PathPolicy` validation and the subsequent open are intentionally separate
operations so the caller can attach policy and audit metadata. They must be
kept adjacent in the backend. Descriptor-relative no-follow opens should be
added by the platform hardening checkpoint to close the remaining validation vs
open TOCTOU window on Unix, Windows junctions, and macOS aliases.

Stable path errors include invalid path, workspace mismatch, permission denied,
not found, broken symlink, symlink escape, outside workspace, and oversized or
non-UTF-8 content. Renderer responses expose only workspace-relative paths.
