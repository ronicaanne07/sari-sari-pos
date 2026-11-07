/**
 * Decides whether a barcode read should count as a new scan.
 *
 * A camera sees the same label dozens of times a second, so reads are filtered:
 *  - a different code needs MIN_GAP_MS since the last accepted scan (no machine-gun of different codes);
 *  - the SAME code is accepted again only when the camera lost sight of it for ABSENT_MS (the item was
 *    moved away) AND the chosen delay has passed. Holding one item still in front of the camera
 *    therefore never adds it twice.
 */
export const MIN_GAP_MS = 700
export const ABSENT_MS = 500

export interface ScanGate {
  last: string
  lastAt: number // when the last scan was accepted
  lastSeenAt: number // when the last code was most recently seen
  armed: boolean // the same code left the view and came back, so it may count again once the delay is over
}

export function createScanGate(): ScanGate {
  return { last: '', lastAt: 0, lastSeenAt: 0, armed: false }
}

export function acceptScan(g: ScanGate, code: string, now: number, delayMs: number): boolean {
  const same = code === g.last
  if (same && now - g.lastSeenAt > ABSENT_MS) g.armed = true // it went away and came back
  if (same) g.lastSeenAt = now
  if (same ? !(g.armed && now - g.lastAt >= delayMs) : now - g.lastAt < MIN_GAP_MS) return false
  g.last = code
  g.lastAt = now
  g.lastSeenAt = now
  g.armed = false
  return true
}
