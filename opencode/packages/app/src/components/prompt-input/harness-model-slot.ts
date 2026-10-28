/** What an external harness's model slot shows: its picker, a neutral loading label, or the empty state. */
export function harnessModelSlot(input: { models: number; checking: boolean }) {
  if (input.models > 0) return "select"
  return input.checking ? "loading" : "none"
}
