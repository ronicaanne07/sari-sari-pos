import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

import { canOpen, tabsFor } from './permissions'
import { clearPin, hasPin, isValidPin, setPin, verifyPin } from './pin'

beforeEach(() => store.clear())

describe('who can open what', () => {
  it('lets the owner open everything', () => {
    expect(tabsFor('owner')).toEqual(['sell', 'products', 'wallet', 'utang', 'summary'])
  })

  it('keeps cashiers to the screens that record transactions', () => {
    expect(tabsFor('cashier')).toEqual(['sell', 'wallet', 'utang'])
    expect(canOpen('cashier', 'products')).toBe(false)
    expect(canOpen('cashier', 'summary')).toBe(false)
    expect(canOpen('cashier', 'sell')).toBe(true)
  })
})

describe('PIN lock', () => {
  it('accepts only 4 to 6 digits', () => {
    expect(isValidPin('1234')).toBe(true)
    expect(isValidPin('123456')).toBe(true)
    for (const bad of ['', '123', '1234567', '12a4', ' 1234', '12 34']) expect(isValidPin(bad)).toBe(false)
    return expect(setPin('12')).rejects.toThrow(/4 to 6 digits/)
  })

  it('stores a salted hash, never the PIN, and checks it', async () => {
    expect(hasPin()).toBe(false)
    await setPin('2468')
    expect(hasPin()).toBe(true)
    expect(store.get('pinLock')).not.toContain('2468')
    expect(await verifyPin('2468')).toBe(true)
    expect(await verifyPin('2469')).toBe(false)
  })

  it('uses a different salt each time, and clears', async () => {
    await setPin('1111')
    const first = store.get('pinLock')
    await setPin('1111')
    expect(store.get('pinLock')).not.toBe(first)
    clearPin()
    expect(hasPin()).toBe(false)
    expect(await verifyPin('anything')).toBe(true) // no PIN set: nothing to check
  })
})
