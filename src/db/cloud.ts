import { exportBackup, importBackup, type BackupFile } from './backup'

const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const storeId = import.meta.env.VITE_POS_STORE_ID || 'default-store'

const SESSION = 'cloudSession' // login tokens of the signed-in owner
const SYNCED = 'cloudSyncedAt' // updated_at of the cloud copy this device last uploaded or downloaded
const LAST_OK = 'cloudLastBackupAt' // when this device last uploaded successfully
const LAST_ERROR = 'cloudLastError' // last automatic backup problem, shown in settings
const HISTORY_KEEP = 14

export function cloudConfigured() {
  return Boolean(url && key)
}

/* ---------- sign-in (the anon key alone no longer opens your data) ---------- */

interface Session {
  access: string
  refresh: string
  exp: number
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

function readSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION) || 'null')
  } catch {
    return null
  }
}

function saveSession(j: TokenResponse) {
  const s: Session = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 60) * 1000 }
  localStorage.setItem(SESSION, JSON.stringify(s))
  return s
}

export function cloudSignedIn() {
  return readSession() !== null
}

export async function cloudSignIn(email: string, password: string): Promise<void> {
  if (!url || !key) throw new Error('Cloud database is not configured. Follow CLOUD_SETUP.md first.')
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  })
  if (!r.ok) throw new Error('Sign-in failed. Check the email and password.')
  saveSession((await r.json()) as TokenResponse)
}

export function cloudSignOut() {
  localStorage.removeItem(SESSION)
}

async function accessToken(): Promise<string> {
  const s = readSession()
  if (!s) throw new Error('Sign in to the cloud first.')
  if (Date.now() < s.exp) return s.access
  const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: key!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh }),
  })
  if (!r.ok) {
    cloudSignOut()
    throw new Error('Your cloud session expired. Sign in again.')
  }
  return saveSession((await r.json()) as TokenResponse).access
}

async function headers() {
  if (!url || !key) throw new Error('Cloud database is not configured. Follow CLOUD_SETUP.md first.')
  return { apikey: key, Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }
}

/* ---------- backup ---------- */

async function remoteUpdatedAt(): Promise<string | undefined> {
  const r = await fetch(
    `${url}/rest/v1/pos_snapshots?store_id=eq.${encodeURIComponent(storeId)}&select=updated_at`,
    { headers: await headers() },
  )
  if (!r.ok) throw new Error(`Cloud check failed (${r.status}): ${await r.text()}`)
  const rows = (await r.json()) as Array<{ updated_at: string }>
  return rows[0]?.updated_at
}

/**
 * Uploads the complete local database as one snapshot, and keeps the last few in history.
 * Refuses when the cloud holds a newer copy than this device has seen (another device uploaded),
 * unless `force` is true. Use one active writer at a time.
 */
export async function uploadCloudBackup(force = false): Promise<void> {
  const remote = await remoteUpdatedAt()
  if (!force && remote && remote !== localStorage.getItem(SYNCED)) {
    throw new Error(
      'The cloud has a different backup from another device. Download it first, or choose "Upload anyway" if this device has the right data.',
    )
  }
  const backup = await exportBackup()
  const updated_at = new Date().toISOString()
  const h = await headers()

  const response = await fetch(`${url}/rest/v1/pos_snapshots?on_conflict=store_id`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ store_id: storeId, payload: backup, updated_at }),
  })
  if (!response.ok) throw new Error(`Cloud upload failed (${response.status}): ${await response.text()}`)
  localStorage.setItem(SYNCED, updated_at)
  localStorage.setItem(LAST_OK, updated_at)
  localStorage.removeItem(LAST_ERROR)

  // History is a safety net: a failure here must not fail the backup itself.
  try {
    await fetch(`${url}/rest/v1/pos_snapshot_history`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify({ store_id: storeId, payload: backup, created_at: updated_at }),
    })
    const old = await fetch(
      `${url}/rest/v1/pos_snapshot_history?store_id=eq.${encodeURIComponent(storeId)}&select=id&order=created_at.desc&offset=${HISTORY_KEEP}`,
      { headers: h },
    )
    if (old.ok) {
      const ids = ((await old.json()) as Array<{ id: number }>).map((x) => x.id)
      if (ids.length) {
        await fetch(`${url}/rest/v1/pos_snapshot_history?id=in.(${ids.join(',')})`, { method: 'DELETE', headers: h })
      }
    }
  } catch {
    /* ignore */
  }
}

/** Downloads and replaces the local database. Download a local backup before restoring. */
export async function downloadCloudBackup(): Promise<void> {
  const response = await fetch(
    `${url}/rest/v1/pos_snapshots?store_id=eq.${encodeURIComponent(storeId)}&select=payload,updated_at&limit=1`,
    { headers: await headers() },
  )
  if (!response.ok) throw new Error(`Cloud download failed (${response.status}): ${await response.text()}`)
  const rows = (await response.json()) as Array<{ payload: BackupFile; updated_at: string }>
  if (!rows.length) throw new Error('No cloud backup exists for this Store ID yet. Upload from the device containing your current data first.')
  await importBackup(rows[0].payload)
  localStorage.setItem(SYNCED, rows[0].updated_at)
}

/* ---------- automatic backup (store phone only) ---------- */

export function lastCloudBackup(): { at: string | null; error: string | null } {
  return { at: localStorage.getItem(LAST_OK), error: localStorage.getItem(LAST_ERROR) }
}

let autoStarted = false

/**
 * Call once, on the phone that makes the sales. Never on a device that only views data.
 * Failures are kept for the settings screen instead of being lost silently.
 */
export function startAutoCloudBackup(everyMs = 15 * 60 * 1000) {
  if (autoStarted) return
  autoStarted = true
  let running = false
  const run = async () => {
    if (running || !navigator.onLine || !cloudConfigured() || !cloudSignedIn()) return
    const last = Date.parse(localStorage.getItem(LAST_OK) || '') || 0
    if (Date.now() - last < everyMs) return
    running = true
    try {
      await uploadCloudBackup()
    } catch (e) {
      localStorage.setItem(LAST_ERROR, e instanceof Error ? e.message : String(e))
    } finally {
      running = false
    }
  }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && run())
  setInterval(run, Math.min(everyMs, 5 * 60 * 1000))
  run()
}