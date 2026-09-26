import { cp, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const src = resolve(import.meta.dir, `../icons/${channel}`)
const dest = resolve(import.meta.dir, "../resources/icons")

await rm(dest, { recursive: true, force: true })
await cp(src, dest, { recursive: true })
console.log(`Copied ${channel} icons from ${src} to ${dest}`)
