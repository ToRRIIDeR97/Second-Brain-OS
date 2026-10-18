// Deep links go straight to a renderer that is already listening. Otherwise
// they wait for the next renderer to consume them while it loads. A link that
// was delivered is never queued, so it can't replay in a later window or after
// a reload.
export function createDeepLinkQueue() {
  const pending: string[] = []
  const listening = new Set<number>()

  return {
    emit(urls: string[], target?: { id: number; send: (urls: string[]) => void }) {
      if (urls.length === 0) return
      if (target && listening.has(target.id)) return target.send(urls)
      pending.push(...urls)
    },
    // Called by a renderer once it has subscribed to live deep links.
    consume(id: number) {
      listening.add(id)
      return pending.splice(0)
    },
    // Called when a renderer starts loading again or is destroyed.
    forget(id: number) {
      listening.delete(id)
    },
  }
}
