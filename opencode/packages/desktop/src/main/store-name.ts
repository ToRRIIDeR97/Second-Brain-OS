const rendererStore = /^(?:default|opencode\.(?:global|(?:workspace|window|draft)\.[a-zA-Z0-9._-]+))\.dat$/

export function assertRendererStoreName(name: string) {
  if (!rendererStore.test(name)) throw new Error("Invalid renderer store name")
  return name
}
