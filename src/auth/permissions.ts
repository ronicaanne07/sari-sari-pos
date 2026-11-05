import type { Role } from './profile'

export type Tab = 'sell' | 'products' | 'wallet' | 'utang' | 'summary'

/**
 * What each role may open. The server enforces the same split (see CLOUD_SETUP_V2.sql): hiding a tab only
 * keeps the screen simple, the database refuses a cashier's edits to products and prices either way.
 *
 *  owner  : everything, including Products, Summary (sales, profit, backups) and settings
 *  cashier: only the screens that record transactions
 */
const ALLOWED: Record<Role, readonly Tab[]> = {
  owner: ['sell', 'products', 'wallet', 'utang', 'summary'],
  cashier: ['sell', 'wallet', 'utang'],
}

export const tabsFor = (role: Role): readonly Tab[] => ALLOWED[role]
export const canOpen = (role: Role, tab: Tab): boolean => ALLOWED[role].includes(tab)
