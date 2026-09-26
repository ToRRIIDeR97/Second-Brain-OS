import { writeFile } from "node:fs/promises"

export async function saveSessionExport(
  input: { filename: string; json: string },
  choose: (filename: string) => Promise<string | null>,
) {
  if (
    !/^[a-zA-Z0-9_-]{1,240}\.json$/.test(input.filename) ||
    typeof input.json !== "string" ||
    Buffer.byteLength(input.json, "utf8") > 32 * 1024 * 1024
  )
    throw new Error("Invalid session export")
  JSON.parse(input.json)
  const destination = await choose(input.filename)
  if (!destination) return false
  await writeFile(destination, input.json, { encoding: "utf8", mode: 0o600 })
  return true
}
