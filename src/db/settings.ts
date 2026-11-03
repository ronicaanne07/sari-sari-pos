import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

export interface Settings {
  storeName: string
  address: string
  footer: string
  autoReceipt: boolean // open the receipt right after each sale
  walletFeePercent: number // suggested cash-in / cash-out fee, % of amount
  walletMinFee: number // centavos
}

export const DEFAULT_SETTINGS: Settings = {
  storeName: 'My Tindahan',
  address: '',
  footer: 'Salamat po! Balik kayo.',
  autoReceipt: false,
  walletFeePercent: 2,
  walletMinFee: 500,
}

export async function getSettings(): Promise<Settings> {
  const rows = await db.settings.toArray()
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value
  return out as unknown as Settings
}

export async function saveSettings(changes: Partial<Settings>): Promise<void> {
  await db.settings.bulkPut(Object.entries(changes).map(([key, value]) => ({ key, value })))
}

/** Live settings for components; falls back to the defaults while loading. */
export function useSettings(): Settings {
  return useLiveQuery(getSettings, []) ?? DEFAULT_SETTINGS
}
