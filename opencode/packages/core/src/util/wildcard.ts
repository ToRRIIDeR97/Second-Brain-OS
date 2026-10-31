export * as Wildcard from "./wildcard"

export function match(input: string, pattern: string) {
  const normalized = input.replaceAll("\\", "/")
  // `[*]` and `[?]` stand for a literal `*` and `?`, as in globs; see `literal`.
  let escaped = pattern
    .replaceAll("\\", "/")
    .split(/(\[\*\]|\[\?\])/)
    .map((part) =>
      part === "[*]"
        ? "\\*"
        : part === "[?]"
          ? "\\?"
          : part
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, "."),
    )
    .join("")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}

/** A pattern that matches `value` only: its `*` and `?` are kept literal, so a saved command can't widen. */
export function literal(value: string) {
  return value.replace(/[*?]/g, (char) => `[${char}]`)
}
