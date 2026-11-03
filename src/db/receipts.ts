import { db } from './db'
import { PosError, customerBalance } from './actions'
import { getSettings } from './settings'
import {
  buildPaymentReceipt,
  buildSaleReceipt,
  buildWalletReceipt,
  type Receipt,
  type ReceiptStore,
} from '../lib/receipt'

export type ReceiptTarget =
  | { kind: 'sale'; id: number }
  | { kind: 'wallet'; id: number }
  | { kind: 'payment'; id: number }

/** Loads everything a receipt needs from the database, using the store details in Settings. */
export async function buildReceipt(target: ReceiptTarget): Promise<Receipt> {
  const s = await getSettings()
  const store: ReceiptStore = { storeName: s.storeName, address: s.address, footer: s.footer }

  if (target.kind === 'sale') {
    const sale = await db.sales.get(target.id)
    if (!sale) throw new PosError('Receipt not found')
    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()
    const customer = sale.customerId ? await db.customers.get(sale.customerId) : undefined
    return buildSaleReceipt({
      store,
      saleId: sale.id,
      voidOf: sale.kind === 'void' ? sale.voidOf : undefined,
      createdAt: sale.createdAt,
      method: sale.method,
      items: items.map((i) => ({
        name: i.name,
        unitType: i.unitType,
        qty: i.qty,
        lineTotal: i.lineTotal,
        packed: i.packId !== undefined,
      })),
      total: sale.total,
      tendered: sale.tendered,
      change: sale.change,
      reference: sale.reference,
      customerName: customer?.name,
      utangBalance: customer ? await customerBalance(customer.id) : undefined,
    })
  }

  if (target.kind === 'wallet') {
    const tx = await db.walletTransactions.get(target.id)
    if (!tx) throw new PosError('Receipt not found')
    return buildWalletReceipt({ store, ...tx })
  }

  const entry = await db.creditEntries.get(target.id)
  if (!entry || entry.kind !== 'payment') throw new PosError('Receipt not found')
  const customer = await db.customers.get(entry.customerId)
  return buildPaymentReceipt({
    store,
    id: entry.id,
    createdAt: entry.createdAt,
    customerName: customer?.name ?? 'Customer',
    amount: -entry.amount,
    method: entry.method ?? 'cash',
    reference: entry.reference,
    balance: await customerBalance(entry.customerId),
  })
}
