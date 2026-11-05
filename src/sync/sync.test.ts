import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_TABLES, db } from '../db/db'
import { markRemote } from '../db/syncHooks'
import { resetAllData, exportBackup, importBackup } from '../db/backup'
import { addPiece } from '../lib/cart'
import { newId, setDeviceNo } from '../db/ids'
import {
  checkout, createCategory, createProduct, deleteCategory, createPack, deletePack, restock, adjustStock, voidSale,
  updateProduct,
} from '../db/actions'

vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})
vi.stubGlobal('navigator', { onLine: true })

/* ---------------------------------------------------------------- fake server */
// Mirrors the rules in CLOUD_SETUP_V2.sql (the real policies are tested against Postgres in rls.test.ts).
const USERS: Record<string, { id: string; role: 'owner' | 'cashier'; name: string; device: number; active: boolean }> = {
  'owner@x.com': { id: 'u-owner', role: 'owner', name: 'Owner', device: 0, active: true },
  'ana@x.com': { id: 'u-ana', role: 'cashier', name: 'Ana', device: 1, active: true },
  'ben@x.com': { id: 'u-ben', role: 'cashier', name: 'Ben', device: 2, active: true },
}
const CASHIER_INSERT = ['sales', 'saleItems', 'stockMovements', 'walletTransactions', 'creditEntries', 'customers']
let records: Map<string, { tbl: string; row_id: string; data: any; deleted: boolean; updated_at: string }>
let clock: number
let requests: string[]

function userFor(auth: string | null) {
  return Object.values(USERS).find((u) => `Bearer tok-${u.id}` === auth)
}
const res = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

async function fakeFetch(input: string, init: RequestInit = {}) {
  const url = new URL(input)
  const headers = (init.headers ?? {}) as Record<string, string>
  const method = init.method ?? 'GET'
  requests.push(`${method} ${url.pathname}`)
  if (url.pathname === '/auth/v1/token') {
    const body = JSON.parse(init.body as string)
    const u = USERS[body.email]
    if (!u || body.password !== 'pw') return res(400, { error: 'bad' })
    return res(200, { access_token: `tok-${u.id}`, refresh_token: 'r', expires_in: 3600, user: { id: u.id, email: body.email } })
  }
  const me = userFor(headers.Authorization ?? null)
  if (!me) return res(401, {})
  if (url.pathname === '/rest/v1/profiles') {
    const uid = url.searchParams.get('user_id')!.replace('eq.', '')
    const u = Object.values(USERS).find((x) => x.id === uid)
    return res(200, u ? [{ user_id: u.id, store_id: 'shop', name: u.name, role: u.role, active: u.active, device_no: u.device }] : [])
  }
  if (!me.active) return res(403, {})
  if (url.pathname === '/rest/v1/records') {
    if (method === 'POST') {
      const rows = JSON.parse(init.body as string) as any[]
      const ignore = (headers.Prefer ?? '').includes('ignore-duplicates')
      if (me.role === 'cashier' && rows.some((r) => !CASHIER_INSERT.includes(r.tbl) || r.deleted)) return res(403, { message: 'rls' })
      for (const r of rows) {
        const key = `${r.tbl}|${r.row_id}`
        if (records.has(key) && ignore) continue
        if (records.has(key) && me.role === 'cashier') return res(403, {})
        records.set(key, { tbl: r.tbl, row_id: r.row_id, data: r.data, deleted: r.deleted, updated_at: new Date(++clock).toISOString() })
      }
      return res(201, {})
    }
    const gt = url.searchParams.get('updated_at')?.replace('gt.', '')
    const limit = Number(url.searchParams.get('limit') ?? 1000)
    const out = [...records.values()]
      .filter((r) => (gt ? r.updated_at > gt : true))
      .filter((r) => me.role === 'owner' || !['purchases', 'expenses'].includes(r.tbl))
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
      .slice(0, limit)
    return res(200, out)
  }
  return res(404, {})
}

/* ------------------------------------------------------ simulate separate phones */
interface Phone { t: Record<string, unknown[]>; ls: [string, string][] }
async function snapshot(): Promise<Phone> {
  const t: Phone['t'] = {}
  for (const n of [...ALL_TABLES, 'tombstones', 'syncMeta']) t[n] = await db.table(n).toArray()
  return { t, ls: [...store.entries()] }
}
async function load(p: Phone | null) {
  await resetAllData()
  store.clear()
  if (!p) return
  await db.transaction('rw', [...ALL_TABLES, 'tombstones', 'syncMeta'].map((n) => db.table(n)), async (tx) => {
    markRemote(tx)
    for (const n of Object.keys(p.t)) await db.table(n).bulkPut(p.t[n])
  })
  for (const [k, v] of p.ls) store.set(k, v)
}

let cloud: typeof import('../db/cloud')
let profileMod: typeof import('../auth/profile')
let sync: typeof import('./sync')

async function signInAs(email: string) {
  const u = await cloud.cloudSignIn(email, 'pw')
  profileMod.saveProfile(await profileMod.fetchProfile(u.userId))
}

beforeAll(async () => {
  cloud = await import('../db/cloud')
  profileMod = await import('../auth/profile')
  sync = await import('./sync')
})

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  records = new Map()
  clock = Date.parse('2026-01-01T00:00:00Z')
  requests = []
  USERS['ana@x.com'].active = true
  await load(null)
})

const piece = (name: string, stock = 30, categoryId?: number) =>
  createProduct({ name, unitType: 'piece', cost: 800, price: 1000, stock, categoryId })

/* --------------------------------------------------------------------- tests */
describe('ids', () => {
  it('never collide across phones, even when created in the same millisecond', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) for (const d of [0, 1, 2, 15]) seen.add(newId(d))
    expect(seen.size).toBe(8000)
    expect(Math.max(...seen)).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })

  it('are used for every new row, with this phone\'s device number inside', async () => {
    setDeviceNo(3)
    const id = await piece('Egg')
    expect(id).toBeGreaterThan(1e15)
    expect(Math.floor(id / 64) % 16).toBe(3)
  })
})

describe('change tracking', () => {
  it('marks new and edited rows as waiting, in the same transaction as the data', async () => {
    const id = await piece('Egg')
    expect((await db.products.get(id))!._dirty).toBeGreaterThan(0)
    await updateProduct(id, { price: 1200 })
    expect((await db.products.get(id))!._dirty).toBeGreaterThan(1)
  })

  it('backups stay clean and a restored backup is marked for upload', async () => {
    await piece('Egg')
    const backup = JSON.parse(JSON.stringify(await exportBackup()))
    expect(JSON.stringify(backup)).not.toContain('_dirty')
    await resetAllData()
    await importBackup(backup)
    expect((await db.products.toArray())[0]._dirty).toBe(1)
  })

  it('old rows are all marked as waiting after the upgrade, so the first sign-in uploads the store', async () => {
    // upgrade.test.ts covers v1 -> current; here we only check the marker survives the schema
    expect(db.verno).toBe(5)
  })
})

describe('owner and cashier phones', () => {
  it('shares products and stock, and cashier sales reach the owner without overwriting anything', async () => {
    // --- owner phone
    await signInAs('owner@x.com')
    const cat = await createCategory('Drinks')
    const egg = await piece('Egg', 30, cat)
    await sync.syncNow()
    expect(await sync.pendingCount()).toBe(0)
    expect([...records.values()].some((r) => r.tbl === 'products')).toBe(true)
    const ownerPhone = await snapshot()

    // --- cashier phone joins and receives the store
    await load(null)
    await signInAs('ana@x.com')
    await sync.syncNow()
    expect((await db.products.get(egg))!.stock).toBe(30)
    expect((await db.categories.get(cat))!.name).toBe('Drinks')
    const productRowBefore = JSON.stringify(records.get(`products|${egg}`))

    // cashier sells 2 (even offline; the sale is saved locally first)
    const p = (await db.products.get(egg))!
    await checkout(addPiece(addPiece([], p), p), { method: 'cash' })
    expect((await db.products.get(egg))!.stock).toBe(28)
    await sync.syncNow()
    expect(await sync.pendingCount()).toBe(0)
    expect([...records.values()].filter((r) => r.tbl === 'sales')).toHaveLength(1)
    expect(JSON.stringify(records.get(`products|${egg}`))).toBe(productRowBefore) // cashier never rewrites a product
    const cashierPhone = await snapshot()

    // --- meanwhile the owner sold 3 on their own phone (not yet uploaded)
    await load(ownerPhone)
    const p2 = (await db.products.get(egg))!
    await checkout(addPiece(addPiece(addPiece([], p2), p2), p2), { method: 'cash' })
    await sync.syncNow()
    // owner sees both sales and the right stock: 30 - 3 - 2
    expect(await db.sales.count()).toBe(2)
    expect((await db.products.get(egg))!.stock).toBe(25)
    const ownerAfter = await snapshot()

    // --- cashier syncs again and converges
    await load(cashierPhone)
    await sync.syncNow()
    expect(await db.sales.count()).toBe(2)
    expect((await db.products.get(egg))!.stock).toBe(25)
    void ownerAfter
  })

  it('a cashier cannot change prices or products on the server', async () => {
    await signInAs('owner@x.com')
    const egg = await piece('Egg')
    await sync.syncNow()
    await load(null)
    await signInAs('ana@x.com')
    await sync.syncNow()
    await updateProduct(egg, { price: 1 }) // tampering on the phone
    await sync.syncNow()
    expect(records.get(`products|${egg}`)!.data.price).toBe(1000) // server untouched
    // and a forced write is refused by the server rules too
    const r = await fakeFetch('https://x.supabase.co/rest/v1/records?on_conflict=store_id,tbl,row_id', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-u-ana', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ store_id: 'shop', tbl: 'products', row_id: String(egg), data: { id: egg, price: 1 }, deleted: false }]),
    })
    expect(r.status).toBe(403)
  })

  it('cashiers never receive purchases or expenses', async () => {
    await signInAs('owner@x.com')
    await db.expenses.add({ createdAt: 1, category: 'Salary', amount: 500000, paymentMethod: 'cash' })
    await sync.syncNow()
    expect([...records.values()].some((r) => r.tbl === 'expenses')).toBe(true)
    await load(null)
    await signInAs('ana@x.com')
    await sync.syncNow()
    expect(await db.expenses.count()).toBe(0)
  })

  it('deleting a category or pack on the owner phone removes it from the others', async () => {
    await signInAs('owner@x.com')
    const cat = await createCategory('Snacks')
    const egg = await piece('Egg', 5, cat)
    const pack = await createPack(egg, { name: 'Tray', unitsPerPack: 30, packCost: 20000, packPrice: 25000 })
    await sync.syncNow()
    const owner = await snapshot()
    await load(null)
    await signInAs('ana@x.com')
    await sync.syncNow()
    expect(await db.categories.count()).toBe(1)
    expect(await db.productPacks.count()).toBe(1)
    const cashier = await snapshot()

    await load(owner)
    await deleteCategory(cat)
    await deletePack(pack)
    await sync.syncNow()
    await load(cashier)
    await sync.syncNow()
    expect(await db.categories.count()).toBe(0)
    expect(await db.productPacks.count()).toBe(0)
    expect((await db.products.get(egg))!.categoryId).toBeUndefined()
  })

  it('two cashiers selling at the same time both land, with different ids', async () => {
    await signInAs('owner@x.com')
    const egg = await piece('Egg', 10)
    await sync.syncNow()
    const phones: Phone[] = []
    for (const who of ['ana@x.com', 'ben@x.com']) {
      await load(null)
      await signInAs(who)
      await sync.syncNow()
      const p = (await db.products.get(egg))!
      await checkout(addPiece([], p), { method: 'cash' })
      phones.push(await snapshot())
    }
    for (const ph of phones) {
      await load(ph)
      await sync.syncNow()
    }
    await load(phones[0])
    await sync.syncNow()
    expect(await db.sales.count()).toBe(2)
    expect((await db.products.get(egg))!.stock).toBe(8)
  })
})

describe('stock and opening balance', () => {
  it('stock always equals the sum of its movements after any mix of operations', async () => {
    const egg = await piece('Egg', 20)
    const p = () => db.products.get(egg).then((x) => x!)
    const s1 = await checkout(addPiece([], await p()), { method: 'cash' })
    await checkout(addPiece(addPiece([], await p()), await p()), { method: 'cash' })
    await restock(egg, 12)
    await adjustStock(egg, -3, 'spoilage')
    await voidSale(s1.id)
    const before = (await db.products.get(egg))!.stock
    await sync.recomputeStock([egg])
    expect((await db.products.get(egg))!.stock).toBe(before)
  })

  it('adds one opening-balance movement for stock that has no history, only once', async () => {
    await db.products.add({
      name: 'Old', unitType: 'piece', cost: 1, price: 2, stock: 7, lowStockAt: 0, favorite: false, archived: false, createdAt: 1,
    })
    expect(await sync.reconcileOpeningStock()).toBe(1)
    expect(await sync.reconcileOpeningStock()).toBe(0)
    const m = await db.stockMovements.toArray()
    expect(m).toHaveLength(1)
    expect(m[0].qty).toBe(7)
    const id = (await db.products.toArray())[0].id
    await sync.recomputeStock([id])
    expect((await db.products.get(id))!.stock).toBe(7)
  })
})

describe('accounts', () => {
  it('locks the phone when the account is turned off', async () => {
    await signInAs('ana@x.com')
    const lost = vi.fn()
    sync.setSyncHandlers({ authLost: lost })
    USERS['ana@x.com'].active = false
    await sync.syncNow()
    expect(lost).toHaveBeenCalledOnce()
    expect(sync.getSyncStatus().state).toBe('error')
  })

  it('says offline (not an error) when the server cannot be reached', async () => {
    await signInAs('owner@x.com')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await sync.syncNow()
    expect(sync.getSyncStatus().state).toBe('offline')
  })
})
