import { ALL_TABLES, db } from '../db/db'
import { markRemote, setLocalChangeListener } from '../db/syncHooks'
import { authHeaders, cloudConfigured, cloudUrl } from '../db/cloud'
import { AuthLostError, fetchProfile, getProfile, saveProfile, type Profile, type Role } from '../auth/profile'

/**
 * Shared store sync. Every phone keeps its own full copy in IndexedDB (so selling never waits for
 * the internet) and exchanges rows with one `records` table in Supabase:
 *
 *   push  rows marked _dirty, tagged with table + id   (cashiers: only sales-type rows)
 *   pull  rows changed on the server since the last pull
 *   stock is NOT merged: it is always recomputed from the stock movements, which only ever get added,
 *         so two phones selling the same item at once can never overwrite each other's numbers.
 */

type TableName = (typeof ALL_TABLES)[number]
type Row = Record<string, unknown> & { _dirty?: number }

/** What a cashier's phone is allowed to upload. The server enforces the same list. */
export const CASHIER_PUSH: readonly TableName[] = [
  'sales',
  'saleItems',
  'stockMovements',
  'walletTransactions',
  'creditEntries',
  'customers',
]
/** Never sent to cashier phones. */
export const OWNER_ONLY_TABLES: readonly TableName[] = ['purchases', 'expenses']

const PAGE = 500
const OVERLAP_MS = 10_000

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error'
  lastSyncAt: number | null
  error: string | null
  pending: number
}

let status: SyncStatus = { state: 'idle', lastSyncAt: null, error: null, pending: 0 }
const subscribers = new Set<() => void>()

export function getSyncStatus(): SyncStatus {
  return status
}
export function subscribeSync(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  subscribers.forEach((f) => f())
}

let onAuthLost: ((reason: string) => void) | null = null
let onProfileChanged: ((p: Profile) => void) | null = null
export function setSyncHandlers(h: { authLost?: (reason: string) => void; profileChanged?: (p: Profile) => void }) {
  onAuthLost = h.authLost ?? null
  onProfileChanged = h.profileChanged ?? null
}

/* ----------------------------------------------------------------- helpers */

const pkOf = (name: string, row: Row) => (name === 'settings' ? (row.key as string) : (row.id as number))
const strip = (row: Row) => {
  const { _dirty, ...rest } = row
  void _dirty
  return rest
}

export async function pendingCount(): Promise<number> {
  let n = await db.tombstones.count()
  for (const name of ALL_TABLES) n += await db.table(name).where('_dirty').above(0).count()
  return n
}

async function meta<T>(key: string): Promise<T | undefined> {
  return (await db.syncMeta.get(key))?.value as T | undefined
}
const setMeta = (key: string, value: unknown) => db.syncMeta.put({ key, value })

async function request(path: string, init: RequestInit = {}) {
  const res = await fetch(`${cloudUrl()}/rest/v1/${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers as Record<string, string> | undefined) },
  })
  if (res.status === 401 || res.status === 403) {
    throw new AuthLostError(`The server refused this account (${res.status}). Sign in again.`)
  }
  if (!res.ok) throw new Error(`Sync failed (${res.status}): ${await res.text()}`)
  return res
}

/* ---------------------------------------------------------- opening balance */

/**
 * Stock is derived from movements, so every product must start with movements that add up to its
 * current stock. Products made by older versions of the app might not: add one "Opening balance"
 * movement for the difference, once, before anything is uploaded.
 */
export async function reconcileOpeningStock(): Promise<number> {
  let fixed = 0
  await db.transaction('rw', [db.products, db.stockMovements], async () => {
    for (const p of await db.products.toArray()) {
      const sum = (await db.stockMovements.where('productId').equals(p.id).toArray()).reduce((s, m) => s + m.qty, 0)
      if (sum !== p.stock) {
        await db.stockMovements.add({
          productId: p.id,
          createdAt: Date.now(),
          type: 'adjustment',
          qty: p.stock - sum,
          note: 'Opening balance',
        })
        fixed++
      }
    }
  })
  return fixed
}

export async function recomputeStock(productIds: Iterable<number>): Promise<void> {
  await db.transaction('rw', [db.products, db.stockMovements], async (tx) => {
    markRemote(tx) // a recomputed number is not a change worth uploading
    for (const id of new Set(productIds)) {
      const p = await db.products.get(id)
      if (!p) continue
      const sum = (await db.stockMovements.where('productId').equals(id).toArray()).reduce((s, m) => s + m.qty, 0)
      if (sum !== p.stock) await db.products.update(id, { stock: sum })
    }
  })
}

/* --------------------------------------------------------------------- push */

async function clearDirty(name: TableName, rows: Row[]) {
  const table = db.table(name)
  await db.transaction('rw', table, async (tx) => {
    markRemote(tx)
    for (const sent of rows) {
      const key = pkOf(name, sent)
      const now = (await table.get(key)) as Row | undefined
      // only clear it if nothing changed while the upload was in flight
      if (now && now._dirty === sent._dirty) await table.update(key, { _dirty: 0 })
    }
  })
}

async function pushAll(profile: Profile): Promise<void> {
  const owner = profile.role === 'owner'
  const prefer = owner ? 'resolution=merge-duplicates,return=minimal' : 'resolution=ignore-duplicates,return=minimal'
  const path = 'records?on_conflict=store_id,tbl,row_id'

  for (const name of ALL_TABLES) {
    const table = db.table(name)
    const allowed = owner || CASHIER_PUSH.includes(name)
    for (;;) {
      const rows = (await table.where('_dirty').above(0).limit(PAGE).toArray()) as Row[]
      if (!rows.length) break
      if (allowed) {
        const body = rows.map((r) => ({
          store_id: profile.storeId,
          tbl: name,
          row_id: String(pkOf(name, r)),
          data: strip(r),
          deleted: false,
        }))
        await request(path, { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(body) })
      }
      // not allowed to upload (e.g. a cashier phone's cached stock numbers): local-only, just clear it
      await clearDirty(name, rows)
    }
  }

  if (owner) {
    for (;;) {
      const stones = await db.tombstones.limit(PAGE).toArray()
      if (!stones.length) break
      const body = stones.map((t) => ({
        store_id: profile.storeId,
        tbl: t.tbl,
        row_id: t.rowId,
        data: null,
        deleted: true,
      }))
      await request(path, { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(body) })
      await db.tombstones.bulkDelete(stones.map((t) => t.id))
    }
  }
}

/* --------------------------------------------------------------------- pull */

interface RemoteRow {
  tbl: string
  row_id: string
  data: Row | null
  deleted: boolean
  updated_at: string
}

async function applyRemote(rows: RemoteRow[], touched: Set<number>) {
  const known = new Set<string>(ALL_TABLES)
  await db.transaction('rw', ALL_TABLES.map((n) => db.table(n)), async (tx) => {
    markRemote(tx)
    for (const r of rows) {
      if (!known.has(r.tbl)) continue
      const table = db.table(r.tbl)
      const key = r.tbl === 'settings' ? r.row_id : Number(r.row_id)
      const local = (await table.get(key)) as Row | undefined
      if (local && (local._dirty ?? 0) > 0) continue // an edit of ours that is still waiting to upload wins
      if (r.deleted) {
        if (local) await table.delete(key)
        continue
      }
      if (!r.data) continue
      // the key always comes from row_id, never from inside the data, so one row can't overwrite another
      await table.put({ ...r.data, [r.tbl === 'settings' ? 'key' : 'id']: key, _dirty: 0 })
      if (r.tbl === 'products') touched.add(key as number)
      if (r.tbl === 'stockMovements' && typeof r.data.productId === 'number') touched.add(r.data.productId)
    }
  })
}

async function pullAll(): Promise<void> {
  const cursor = await meta<string>('cursor')
  let after = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : undefined
  let newest = cursor
  const touched = new Set<number>()

  for (;;) {
    const q = new URLSearchParams({
      select: 'tbl,row_id,data,deleted,updated_at',
      order: 'updated_at.asc',
      limit: String(PAGE),
    })
    if (after) q.set('updated_at', `gt.${after}`)
    const rows = (await (await request(`records?${q}`)).json()) as RemoteRow[]
    if (!rows.length) break
    await applyRemote(rows, touched)
    after = rows[rows.length - 1].updated_at
    if (!newest || after > newest) newest = after
    if (rows.length < PAGE) break
  }
  await recomputeStock(touched)
  if (newest) await setMeta('cursor', newest)
}

/* ------------------------------------------------------------------ profile */

async function refreshProfile(current: Profile): Promise<Profile> {
  const fresh = await fetchProfile(current.userId) // throws AuthLostError if turned off / removed
  if (fresh.role !== current.role || fresh.name !== current.name || fresh.deviceNo !== current.deviceNo) {
    saveProfile(fresh)
    onProfileChanged?.(fresh)
  }
  return fresh
}

/* ---------------------------------------------------------------- the cycle */

let running: Promise<void> | null = null

/** One full exchange: reconcile (once), upload, download. Safe to call often; overlapping calls share one run. */
export function syncNow(): Promise<void> {
  if (running) return running
  running = (async () => {
    const profile = getProfile()
    if (!cloudConfigured() || !profile) return
    if (!navigator.onLine) {
      setStatus({ state: 'offline', pending: await pendingCount() })
      return
    }
    setStatus({ state: 'syncing', error: null })
    try {
      const current = await refreshProfile(profile)
      if (!(await meta<boolean>('openingStockDone'))) {
        await reconcileOpeningStock()
        await setMeta('openingStockDone', true)
      }
      await pushAll(current)
      await pullAll()
      setStatus({ state: 'idle', lastSyncAt: Date.now(), error: null, pending: await pendingCount() })
    } catch (e) {
      if (e instanceof AuthLostError) {
        setStatus({ state: 'error', error: e.message })
        onAuthLost?.(e.message)
      } else if (e instanceof TypeError) {
        setStatus({ state: 'offline', pending: await pendingCount() }) // fetch could not reach the server
      } else {
        setStatus({ state: 'error', error: e instanceof Error ? e.message : String(e), pending: await pendingCount() })
      }
    }
  })().finally(() => {
    running = null
  })
  return running
}

/* ---------------------------------------------------------------- scheduling */

let started = false
let timer: ReturnType<typeof setInterval> | undefined
let debounce: ReturnType<typeof setTimeout> | undefined
const onOnline = () => void syncNow()
const onVisible = () => document.visibilityState === 'visible' && void syncNow()

export function startSync(everyMs = 30_000) {
  if (started) return
  started = true
  void syncNow()
  timer = setInterval(() => void syncNow(), everyMs)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  // upload soon after a sale instead of waiting for the next tick
  setLocalChangeListener(() => {
    clearTimeout(debounce)
    debounce = setTimeout(() => void syncNow(), 1500)
  })
}

export function stopSync() {
  if (!started) return
  started = false
  clearInterval(timer)
  clearTimeout(debounce)
  window.removeEventListener('online', onOnline)
  document.removeEventListener('visibilitychange', onVisible)
  setLocalChangeListener(null)
}

export type { Role }
