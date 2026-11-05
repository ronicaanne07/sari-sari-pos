import { authHeaders, cloudUrl } from '../db/cloud'
import { setDeviceNo } from '../db/ids'

export type Role = 'owner' | 'cashier'

export interface Profile {
  userId: string
  storeId: string
  name: string
  role: Role
  deviceNo: number
}

/** The account was turned off, removed or signed out online. The phone must lock and ask for a sign-in. */
export class AuthLostError extends Error {}

const KEY = 'authProfile'

export function getProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

export function saveProfile(p: Profile) {
  localStorage.setItem(KEY, JSON.stringify(p))
  setDeviceNo(p.deviceNo)
}

export function clearProfile() {
  localStorage.removeItem(KEY)
}

/** Reads this account's role from the shared store. Needs internet. */
export async function fetchProfile(userId: string): Promise<Profile> {
  const r = await fetch(
    `${cloudUrl()}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,store_id,name,role,active,device_no`,
    { headers: await authHeaders() },
  )
  if (r.status === 401 || r.status === 403) throw new AuthLostError('Please sign in again.')
  if (!r.ok) throw new Error(`Could not load your account (${r.status})`)
  const rows = (await r.json()) as Array<{
    user_id: string
    store_id: string
    name: string
    role: Role
    active: boolean
    device_no: number
  }>
  const row = rows[0]
  if (!row) throw new AuthLostError('This account is not set up for the store yet. Ask the owner to add you.')
  if (!row.active) throw new AuthLostError('This account has been turned off. Ask the owner.')
  return { userId: row.user_id, storeId: row.store_id, name: row.name, role: row.role, deviceNo: row.device_no }
}
