import type { WalletTransaction } from '../db/db'

type Moves = Pick<WalletTransaction, 'type' | 'amount' | 'fee'>

/** Change in the cash drawer. Works for voids too, because their amounts are negative. */
export function walletCashEffect(tx: Moves): number {
  return tx.type === 'cash_in' ? tx.amount + tx.fee : -tx.amount
}

/** Change in your GCash / Maya balance (what you hold in the app). */
export function walletFloatEffect(tx: Moves): number {
  return tx.type === 'cash_in' ? -tx.amount : tx.amount + tx.fee
}

/** Suggested fee: a percentage rounded UP to a whole peso, never below the minimum. */
export function suggestFee(amount: number, percent: number, minFee: number): number {
  if (amount <= 0) return 0
  const raw = (amount * percent) / 100
  return Math.max(minFee, Math.ceil(raw / 100) * 100)
}

/** References are compared ignoring case and spaces: "5034 112 887" equals "5034112887". */
export function normalizeReference(ref: string | undefined): string | undefined {
  const r = ref?.replace(/\s+/g, '').toUpperCase()
  return r ? r : undefined
}

export const MIN_REFERENCE_LENGTH = 4
