/**
 * The short "beep" of a shop scanner, made with the browser's audio (no sound file to download).
 * Phones only allow sound after the person has touched the screen, so prepareBeep() is called from
 * the scanner when it opens and on its first touch.
 */
type AudioCtor = typeof AudioContext

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC: AudioCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
  if (!AC) return null
  try {
    ctx ??= new AC()
  } catch {
    return null
  }
  return ctx
}

/** Wakes the audio up. Safe to call as often as you like. */
export function prepareBeep(): void {
  const c = getContext()
  if (c && c.state === 'suspended') void c.resume().catch(() => {})
}

/** 'ok' = a short high beep. 'error' = a lower double buzz (a code that was refused). */
export function beep(kind: 'ok' | 'error' = 'ok'): void {
  const c = getContext()
  if (!c) return
  if (c.state === 'suspended') void c.resume().catch(() => {})
  try {
    const pulses = kind === 'ok' ? [{ at: 0, hz: 1800, len: 0.12 }] : [{ at: 0, hz: 280, len: 0.12 }, { at: 0.16, hz: 280, len: 0.12 }]
    for (const p of pulses) {
      const start = c.currentTime + p.at
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'square'
      osc.frequency.value = p.hz
      // a tiny fade in and out so it clicks less
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + p.len)
      osc.connect(gain).connect(c.destination)
      osc.start(start)
      osc.stop(start + p.len + 0.02)
    }
  } catch {
    /* sound is a nicety: never let it break scanning */
  }
}
