import { ProviderAuth } from "@/provider/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"

import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError } from "../groups/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

const listEtagBoot = crypto.randomUUID()
const encodeListResult = Schema.encodeSync(Provider.ListResult)
const encodeInfo = Schema.encodeSync(Provider.Info)
// Encoded models.dev entries, keyed by the shared (read-only) Provider.fromModelsDev entry they came from.
const encodedShared = new WeakMap<Provider.Info, unknown>()
function encodeShared(info: Provider.Info) {
  const cached = encodedShared.get(info)
  if (cached) return cached
  const encoded = encodeInfo(info)
  encodedShared.set(info, encoded)
  return encoded
}

function matchesEtag(header: string | undefined, etag: string) {
  if (!header) return false
  return header.split(",").some((value) => value.trim() === "*" || value.trim() === etag)
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const authStore = yield* Auth.Service

    // The projection is rebuilt only when one of its inputs changes. models.dev data, config and
    // provider state are replaced (not mutated) on refresh, so object identity tracks their versions.
    let cached:
      | {
          readonly all: unknown
          readonly config: unknown
          readonly connected: unknown
          readonly credentials: string
          readonly etag: string
          readonly body: string
        }
      | undefined
    let version = 0

    const listRaw = Effect.fn("ProviderHttpApi.list")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const connected = yield* provider.list()
      const credentials = yield* authStore.all().pipe(Effect.orDie)
      const credentialIDs = Object.keys(credentials).sort().join(",")
      if (
        cached?.all !== all ||
        cached.config !== config ||
        cached.connected !== connected ||
        cached.credentials !== credentialIDs
      ) {
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
        // The models.dev projection is directory-independent and shared with Provider state.
        const shared = Provider.fromModelsDev(all)
        const filtered: Record<string, Provider.Info> = {}
        for (const [key, value] of Object.entries(shared.catalog)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
        }
        const providers: Record<string, Provider.Info> = Object.assign(filtered, connected)
        const head = encodeListResult({
          all: [],
          default: Provider.defaultModelIDs(providers),
          connected: Object.keys(providers).filter((id) => id in connected || credentials[id]),
        })
        const result = {
          all: Object.entries(providers).map(([id, item]) =>
            id in connected ? encodeInfo(Provider.toRendererInfo(item)) : encodeShared(shared.database[id]),
          ),
          default: head.default,
          connected: head.connected,
        }
        version += 1
        cached = {
          all,
          config,
          connected,
          credentials: credentialIDs,
          // The boot token keeps ETags from a previous server process from matching.
          etag: `W/"${listEtagBoot}-${version}"`,
          body: JSON.stringify(result),
        }
      }
      const headers = { etag: cached.etag }
      if (matchesEtag(ctx.request.headers["if-none-match"], cached.etag))
        return HttpServerResponse.empty({ status: 304, headers })
      return HttpServerResponse.text(cached.body, { contentType: "application/json", headers })
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      return true
    })

    return handlers
      .handleRaw("list", listRaw)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
)
