const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  asm: "asm",
  bash: "shell",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  go: "go",
  h: "cpp",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  lua: "lua",
  md: "markdown",
  mdx: "markdown",
  php: "php",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shell",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  vue: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

export function languageForPath(relativePath: string): string {
  const fileName = relativePath.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  const extension = fileName.includes(".")
    ? fileName.split(".").at(-1)
    : undefined;
  return extension && LANGUAGE_BY_EXTENSION[extension]
    ? LANGUAGE_BY_EXTENSION[extension]
    : "plaintext";
}

export function eolForContent(content: string): "lf" | "crlf" | "mixed" {
  const crlf = (content.match(/\r\n/gu) ?? []).length;
  const lf = (content.match(/(?<!\r)\n/gu) ?? []).length;
  if (crlf > 0 && lf > 0) return "mixed";
  return crlf > 0 ? "crlf" : "lf";
}

export function normalizeEol(content: string, eol: "lf" | "crlf"): string {
  const normalized = content.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  return eol === "crlf" ? normalized.replace(/\n/gu, "\r\n") : normalized;
}
