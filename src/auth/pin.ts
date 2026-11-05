/**
 * Optional PIN that locks a phone left lying around. It protects the screen, not the data on the phone:
 * the account sign-in is what protects the shared store online.
 */
const KEY = 'pinLock'
const ITERATIONS = 100_000

interface Stored {
  salt: string
  hash: string
}

const toHex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    key,
    256,
  )
  return toHex(bits)
}

export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin)

function read(): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

export function hasPin(): boolean {
  return read() !== null
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('The PIN must be 4 to 6 digits.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  localStorage.setItem(KEY, JSON.stringify({ salt: toHex(salt), hash: await derive(pin, salt) } satisfies Stored))
}

export async function verifyPin(pin: string): Promise<boolean> {
  const s = read()
  if (!s) return true
  return (await derive(pin, fromHex(s.salt))) === s.hash
}

export function clearPin(): void {
  localStorage.removeItem(KEY)
}
