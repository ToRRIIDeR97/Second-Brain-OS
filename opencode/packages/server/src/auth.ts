export * as ServerAuth from "./auth"

import { timingSafeEqual } from "node:crypto"
import { Config as EffectConfig, Context, Effect, Layer, Option, Redacted } from "effect"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
}

export class Config extends Context.Service<Config, Info>()("@opencode/ServerAuthConfig") {
  static configLayer(input: Info) {
    return Layer.succeed(this, this.of(input))
  }

  static get layer() {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        return Config.of(
          yield* EffectConfig.all({
            password: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
            username: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("opencode")),
          }),
        )
      }),
    )
  }
}

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  if (Option.isNone(config.password)) return false
  // Compare both fields so a wrong username takes as long to reject as a wrong password.
  const username = safeEqual(credentials.username, config.username)
  const password = safeEqual(Redacted.value(credentials.password), config.password.value)
  return username && password
}

// Constant-time string comparison. timingSafeEqual throws on a length mismatch, so a
// mismatched input is compared against the expected value itself and then rejected.
function safeEqual(input: string, expected: string) {
  const actual = Buffer.from(input)
  const wanted = Buffer.from(expected)
  const sameLength = actual.length === wanted.length
  return timingSafeEqual(sameLength ? actual : wanted, wanted) && sameLength
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined

  return `Basic ${Buffer.from(`${credentials?.username ?? process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
