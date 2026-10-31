// Config sent to the renderer must not carry credentials. Values under these keys can hold a
// literal key or the result of `{env:}`/`{file:}` substitution, so they are dropped wherever
// they appear. `environment` and `headers` (MCP servers, providers) are dropped whole.
const SECRET_KEY = /^(api[-_]?key|key|token|access[-_]?token|refresh[-_]?token|secret|client[-_]?secret|password|authorization|headers|environment)$/i

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => (SECRET_KEY.test(key) ? [] : [[key, redactSecrets(item)]])),
  ) as T
}
