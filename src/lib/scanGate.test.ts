import { describe, expect, it } from 'vitest'
import { MIN_GAP_MS, acceptScan, createScanGate } from './scanGate'
import { beep, prepareBeep } from './beep'

const DELAY = 2000

describe('scan gate', () => {
  it('accepts the first read of a code', () => {
    expect(acceptScan(createScanGate(), '4006381333931', 10_000, DELAY)).toBe(true)
  })

  it('does not count the same item again while it is held in front of the camera', () => {
    const g = createScanGate()
    let accepted = 0
    // the camera reads it every 150 ms for 10 seconds
    for (let t = 10_000; t < 20_000; t += 150) if (acceptScan(g, 'ABC', t, DELAY)) accepted++
    expect(accepted).toBe(1)
  })

  it('counts it again after the item left the view AND the delay passed', () => {
    const g = createScanGate()
    expect(acceptScan(g, 'ABC', 10_000, DELAY)).toBe(true)
    expect(acceptScan(g, 'ABC', 10_150, DELAY)).toBe(false)
    // item moved away: no reads for a while, then it comes back
    expect(acceptScan(g, 'ABC', 10_000 + DELAY - 100, DELAY)).toBe(false) // back too early
    // it stays in view; once the delay is over it counts as the next item
    expect(acceptScan(g, 'ABC', 10_000 + DELAY + 100, DELAY)).toBe(true)
    // and holding that one still does not add a third
    for (let t = 12_250; t < 18_000; t += 150) expect(acceptScan(g, 'ABC', t, DELAY)).toBe(false)
  })

  it('does not count it again just because the delay passed (item never left)', () => {
    const g = createScanGate()
    acceptScan(g, 'ABC', 10_000, DELAY)
    for (let t = 10_150; t <= 14_000; t += 150) expect(acceptScan(g, 'ABC', t, DELAY)).toBe(false)
  })

  it('a different item is accepted quickly, but not instantly', () => {
    const g = createScanGate()
    expect(acceptScan(g, 'AAA', 10_000, DELAY)).toBe(true)
    expect(acceptScan(g, 'BBB', 10_000 + MIN_GAP_MS - 1, DELAY)).toBe(false)
    expect(acceptScan(g, 'BBB', 10_000 + MIN_GAP_MS + 1, DELAY)).toBe(true)
  })

  it('a short flicker of lost frames is not treated as the item leaving', () => {
    const g = createScanGate()
    acceptScan(g, 'ABC', 10_000, DELAY)
    // the camera misses frames, but never for longer than ABSENT_MS at a time
    for (let t = 10_400; t < 10_000 + DELAY + 1000; t += 400) expect(acceptScan(g, 'ABC', t, DELAY)).toBe(false)
  })
})

describe('beep', () => {
  it('never throws where there is no audio (tests, old browsers)', () => {
    expect(() => {
      prepareBeep()
      beep()
      beep('error')
    }).not.toThrow()
  })
})
