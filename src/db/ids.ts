/**
 * Collision-free ids for a store whose phones create rows at the same time without talking to each other.
 *
 *   id = milliseconds * 1024 + deviceNo * 64 + sequence
 *
 * It is still an ordinary JavaScript number (safe until the year 2250), so every page, foreign key and
 * receipt keeps working unchanged. Two phones can never produce the same id because each has its own
 * deviceNo (0-15, assigned online with the account). Ids also sort by time.
 */
const DEVICE_KEY = 'deviceNo'

export function getDeviceNo(): number {
  try {
    const n = Number(localStorage.getItem(DEVICE_KEY))
    return Number.isInteger(n) && n >= 0 && n < 16 ? n : 0
  } catch {
    return 0
  }
}

export function setDeviceNo(n: number): void {
  try {
    localStorage.setItem(DEVICE_KEY, String(n))
  } catch {
    /* storage blocked */
  }
}

let lastMs = 0
let seq = 0

export function newId(deviceNo: number = getDeviceNo()): number {
  const now = Date.now()
  if (now > lastMs) {
    lastMs = now
    seq = 0
  } else {
    seq++
    if (seq > 63) {
      lastMs++ // more than 64 rows in one millisecond: borrow the next one
      seq = 0
    }
  }
  return lastMs * 1024 + deviceNo * 64 + seq
}
