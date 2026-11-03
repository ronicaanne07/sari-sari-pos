import { exportBackup, importBackup, type BackupFile } from './backup'

const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const storeId = import.meta.env.VITE_POS_STORE_ID || 'default-store'

export function cloudConfigured() {
  return Boolean(url && key)
}

function headers() {
  if (!url || !key) throw new Error('Cloud database is not configured. Follow CLOUD_SETUP.md first.')
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

/** Uploads the complete local database as one versioned snapshot. Use one active writer at a time. */
export async function uploadCloudBackup(): Promise<void> {
  const backup = await exportBackup()
  const response = await fetch(`${url}/rest/v1/pos_snapshots?on_conflict=store_id`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ store_id: storeId, payload: backup, updated_at: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error(`Cloud upload failed (${response.status}): ${await response.text()}`)
}

/** Downloads and replaces the local database. Download a local backup before restoring. */
export async function downloadCloudBackup(): Promise<void> {
  const response = await fetch(`${url}/rest/v1/pos_snapshots?store_id=eq.${encodeURIComponent(storeId)}&select=payload&limit=1`, { headers: headers() })
  if (!response.ok) throw new Error(`Cloud download failed (${response.status}): ${await response.text()}`)
  const rows = await response.json() as Array<{ payload: BackupFile }>
  if (!rows.length) throw new Error('No cloud backup exists for this Store ID yet. Upload from the device containing your current data first.')
  await importBackup(rows[0].payload)
}
