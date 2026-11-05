import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllData } from './backup'

vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

type Call = { url: string; init?: RequestInit }
let calls: Call[]
let remote: string | undefined
const json = (b: unknown, ok = true) => ({ ok, status: ok ? 200 : 401, json: async () => b, text: async () => JSON.stringify(b) })

beforeEach(async () => {
  await resetAllData()
  store.clear()
  calls = []
  remote = undefined
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/auth/v1/token?grant_type=password')) return json({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email: 'me@x.com' } })
    if (url.includes('select=updated_at')) return json(remote ? [{ updated_at: remote }] : [])
    if (url.includes('select=id')) return json([{ id: 1 }, { id: 2 }])
    return json({})
  }))
})

describe('cloud backup', () => {
  it('signs in and sends the user token, never the anon key, as the bearer', async () => {
    const c = await import('./cloud')
    await expect(c.uploadCloudBackup()).rejects.toThrow(/Sign in/)
    await c.cloudSignIn('me@x.com', 'pw')
    await c.uploadCloudBackup()
    const post = calls.find((x) => x.url.includes('pos_snapshots?on_conflict'))!
    expect((post.init!.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(calls.some((x) => x.url.includes('pos_snapshot_history') && x.init?.method === 'POST')).toBe(true)
    expect(calls.some((x) => x.init?.method === 'DELETE' && x.url.includes('id=in.(1,2)'))).toBe(true)
  })

  it('refuses to overwrite a newer cloud copy from another device unless forced', async () => {
    const c = await import('./cloud')
    await c.cloudSignIn('me@x.com', 'pw')
    remote = '2026-01-01T00:00:00.000Z'
    await expect(c.uploadCloudBackup()).rejects.toThrow(/another device/)
    expect(calls.some((x) => x.url.includes('on_conflict'))).toBe(false)
    await c.uploadCloudBackup(true)
    expect(calls.some((x) => x.url.includes('on_conflict'))).toBe(true)
  })
})
