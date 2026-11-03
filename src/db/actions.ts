import {
  db,
  type CreditEntry,
  type PayMethod,
  type Product,
  type ProductPack,
  type Sale,
  type SaleItem,
  type UnitType,
  type WalletProvider,
  type WalletTransaction,
  type WalletType,
} from './db'
import type { CartLine } from '../lib/cart'
import { priceForGrams } from '../lib/money'
import { MIN_REFERENCE_LENGTH, normalizeReference, walletCashEffect } from '../lib/wallet'

/** Errors with a message that is safe to show the cashier as-is. */
export class PosError extends Error {}

const ALL = () => [
  db.products,
  db.productPacks,
  db.sales,
  db.saleItems,
  db.customers,
  db.creditEntries,
  db.stockMovements,
  db.walletTransactions,
]

function assertInt(n: number, label: string, { min = 0 } = {}) {
  if (!Number.isInteger(n) || n < min) throw new PosError(`${label} is not valid`)
}

const PROVIDER_LABEL: Record<WalletProvider, string> = { gcash: 'GCash', maya: 'Maya' }

/** Normalises and sanity-checks a typed reference number. */
function checkReference(raw: string | undefined): string {
  const ref = normalizeReference(raw)
  if (!ref) throw new PosError('Enter the reference number')
  if (ref.length < MIN_REFERENCE_LENGTH) throw new PosError('That reference number looks too short')
  return ref
}

/**
 * A reference may only be used once per provider, across sales, utang payments and wallet
 * transactions. This catches the same payment screenshot being shown twice.
 * Voided sales keep their reference on purpose: the money still arrived once.
 */
export async function referenceInUse(provider: WalletProvider, reference: string): Promise<boolean> {
  const ref = normalizeReference(reference)
  if (!ref) return false
  if ((await db.sales.where('reference').equals(ref).filter((s) => s.method === provider).count()) > 0) return true
  if ((await db.creditEntries.where('reference').equals(ref).filter((e) => e.method === provider).count()) > 0) return true
  return (await db.walletTransactions.where('reference').equals(ref).filter((w) => w.provider === provider).count()) > 0
}

async function assertReferenceFree(provider: WalletProvider, reference: string): Promise<void> {
  if (await referenceInUse(provider, reference)) {
    throw new PosError(`${PROVIDER_LABEL[provider]} reference ${reference} was already used`)
  }
}

/* ------------------------------------------------------------------ products */

export interface NewProduct {
  name: string
  barcode?: string
  unitType: UnitType
  cost: number // centavos per piece / per kg
  price: number
  stock?: number // pieces / grams
  lowStockAt?: number
  favorite?: boolean
}

async function assertBarcodeFree(barcode: string | undefined, selfId?: number) {
  if (!barcode) return
  const other = await db.products.where('barcode').equals(barcode).first()
  if (other && other.id !== selfId) throw new PosError(`Barcode already used by "${other.name}"`)
}

export async function createProduct(input: NewProduct): Promise<number> {
  const name = input.name.trim()
  if (!name) throw new PosError('Product name is required')
  assertInt(input.price, 'Price')
  assertInt(input.cost, 'Cost')
  const stock = input.stock ?? 0
  assertInt(stock, 'Stock', { min: Number.MIN_SAFE_INTEGER })
  const barcode = input.barcode?.trim() || undefined

  return db.transaction('rw', [db.products, db.stockMovements], async () => {
    await assertBarcodeFree(barcode)
    const id = await db.products.add({
      name,
      barcode,
      unitType: input.unitType,
      cost: input.cost,
      price: input.price,
      stock,
      lowStockAt: input.lowStockAt ?? 0,
      favorite: input.favorite ?? false,
      archived: false,
      createdAt: Date.now(),
    })
    if (stock !== 0) {
      await db.stockMovements.add({
        productId: id,
        createdAt: Date.now(),
        type: 'adjustment',
        qty: stock,
        note: 'Initial stock',
      })
    }
    return id
  })
}

/** Stock is deliberately not editable here: use restock() / adjustStock() so it leaves a trail. */
export async function updateProduct(
  id: number,
  changes: Partial<
    Pick<Product, 'name' | 'barcode' | 'cost' | 'price' | 'lowStockAt' | 'favorite' | 'archived'>
  >,
): Promise<void> {
  if (changes.name !== undefined && !changes.name.trim()) throw new PosError('Product name is required')
  if (changes.price !== undefined) assertInt(changes.price, 'Price')
  if (changes.cost !== undefined) assertInt(changes.cost, 'Cost')
  if (changes.barcode !== undefined) changes = { ...changes, barcode: changes.barcode.trim() || undefined }
  await db.transaction('rw', db.products, async () => {
    if (changes.barcode) await assertBarcodeFree(changes.barcode, id)
    await db.products.update(id, changes)
  })
}

export async function createPack(
  productId: number,
  pack: Omit<ProductPack, 'id' | 'productId'>,
): Promise<number> {
  if (!pack.name.trim()) throw new PosError('Pack name is required')
  assertInt(pack.unitsPerPack, 'Units per pack', { min: 1 })
  assertInt(pack.packCost, 'Pack cost')
  assertInt(pack.packPrice, 'Pack price')
  return db.productPacks.add({ ...pack, name: pack.name.trim(), productId })
}

export async function deletePack(packId: number): Promise<void> {
  await db.productPacks.delete(packId)
}

/* --------------------------------------------------------------------- stock */

/** `qty` is in stock units (pieces or grams). `cost` optionally updates the per-unit/per-kg cost. */
export async function restock(
  productId: number,
  qty: number,
  opts: { cost?: number; note?: string } = {},
): Promise<void> {
  assertInt(qty, 'Quantity', { min: 1 })
  if (opts.cost !== undefined) assertInt(opts.cost, 'Cost')
  await db.transaction('rw', [db.products, db.stockMovements], async () => {
    const p = await db.products.get(productId)
    if (!p) throw new PosError('Product not found')
    await db.products.update(productId, {
      stock: p.stock + qty,
      ...(opts.cost !== undefined ? { cost: opts.cost } : {}),
    })
    await db.stockMovements.add({
      productId,
      createdAt: Date.now(),
      type: 'restock',
      qty,
      note: opts.note,
    })
  })
}

/** Restock by whole packs and (optionally) refresh the product cost from the pack cost. */
export async function restockPack(
  packId: number,
  packCount: number,
  { updateCost = true }: { updateCost?: boolean } = {},
): Promise<void> {
  assertInt(packCount, 'Pack count', { min: 1 })
  const pack = await db.productPacks.get(packId)
  if (!pack) throw new PosError('Pack not found')
  const product = await db.products.get(pack.productId)
  if (!product) throw new PosError('Product not found')
  const cost =
    product.unitType === 'weight'
      ? Math.round((pack.packCost * 1000) / pack.unitsPerPack) // per kg
      : Math.round(pack.packCost / pack.unitsPerPack) // per piece
  await restock(product.id, packCount * pack.unitsPerPack, {
    cost: updateCost ? cost : undefined,
    note: `${packCount} × ${pack.name}`,
  })
}

/** `delta` is signed, in stock units. Use for stock counts, spoilage, breakage. */
export async function adjustStock(
  productId: number,
  delta: number,
  type: 'adjustment' | 'spoilage' = 'adjustment',
  note?: string,
): Promise<void> {
  assertInt(delta, 'Quantity', { min: Number.MIN_SAFE_INTEGER })
  if (delta === 0) return
  await db.transaction('rw', [db.products, db.stockMovements], async () => {
    const p = await db.products.get(productId)
    if (!p) throw new PosError('Product not found')
    await db.products.update(productId, { stock: p.stock + delta })
    await db.stockMovements.add({ productId, createdAt: Date.now(), type, qty: delta, note })
  })
}

export async function lowStockProducts(): Promise<Product[]> {
  const all = await db.products.toArray()
  return all.filter((p) => !p.archived && p.stock <= p.lowStockAt).sort((a, b) => a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------- selling */

export interface CheckoutOptions {
  method: PayMethod
  tendered?: number // cash only; defaults to exact amount
  customerId?: number // required for utang
  reference?: string // required for gcash / maya
  note?: string
}

function lineCost(product: Product, line: CartLine): number {
  return product.unitType === 'weight'
    ? priceForGrams(product.cost, line.qty)
    : product.cost * line.qty
}

/**
 * Saves the sale, its items, the stock deductions and (for utang) the credit entry
 * in ONE transaction: either everything is saved or nothing is.
 * Stock is allowed to go negative: a wrong count should never stop a customer from paying.
 */
export async function checkout(cart: CartLine[], opts: CheckoutOptions): Promise<Sale> {
  if (cart.length === 0) throw new PosError('The cart is empty')
  for (const l of cart) {
    assertInt(l.qty, `Quantity of ${l.name}`, { min: 1 })
    assertInt(l.lineTotal, `Price of ${l.name}`)
  }
  const total = cart.reduce((s, l) => s + l.lineTotal, 0)

  let tendered: number | undefined
  let change: number | undefined
  if (opts.method === 'cash') {
    tendered = opts.tendered ?? total
    if (tendered < total) throw new PosError('Cash given is less than the total')
    change = tendered - total
  }
  if (opts.method === 'utang' && !opts.customerId) throw new PosError('Choose who is taking utang')
  const online = opts.method === 'gcash' || opts.method === 'maya' ? opts.method : undefined
  const reference = online ? checkReference(opts.reference) : undefined

  return db.transaction('rw', ALL(), async () => {
    if (online && reference) await assertReferenceFree(online, reference)
    if (opts.method === 'utang') {
      const c = await db.customers.get(opts.customerId!)
      if (!c) throw new PosError('Customer not found')
    }

    const products = new Map<number, Product>()
    for (const l of cart) {
      if (products.has(l.productId)) continue
      const p = await db.products.get(l.productId)
      if (!p) throw new PosError(`"${l.name}" no longer exists`)
      products.set(l.productId, p)
    }

    const costs = cart.map((l) => lineCost(products.get(l.productId)!, l))
    const cost = costs.reduce((s, c) => s + c, 0)
    const createdAt = Date.now()

    const saleData: Omit<Sale, 'id'> = {
      createdAt,
      kind: 'sale',
      method: opts.method,
      total,
      profit: total - cost,
      tendered,
      change,
      customerId: opts.method === 'utang' ? opts.customerId : undefined,
      reference,
      note: opts.note,
    }
    const saleId = await db.sales.add(saleData)

    for (const [i, l] of cart.entries()) {
      await db.saleItems.add({
        saleId,
        productId: l.productId,
        packId: l.packId,
        name: l.name,
        unitType: l.unitType,
        qty: l.qty,
        lineTotal: l.lineTotal,
        lineCost: costs[i],
      })
      await db.products
        .where('id')
        .equals(l.productId)
        .modify((p) => {
          p.stock -= l.qty
        })
      await db.stockMovements.add({
        productId: l.productId,
        createdAt,
        type: 'sale',
        qty: -l.qty,
        refId: saleId,
      })
    }

    if (opts.method === 'utang') {
      await db.creditEntries.add({
        customerId: opts.customerId!,
        createdAt,
        kind: 'charge',
        amount: total,
        saleId,
      })
    }

    return { ...saleData, id: saleId }
  })
}

/**
 * Voids are new ledger rows: the original sale stays untouched. Stock goes back on the shelf
 * and an utang sale is taken off the customer's balance. A sale can only be voided once.
 */
export async function voidSale(saleId: number): Promise<void> {
  await db.transaction('rw', ALL(), async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) throw new PosError('Sale not found')
    if (sale.kind !== 'sale') throw new PosError('Only sales can be voided')
    if ((await db.sales.where('voidOf').equals(saleId).count()) > 0) {
      throw new PosError('This sale was already voided')
    }

    const items = await db.saleItems.where('saleId').equals(saleId).toArray()
    const createdAt = Date.now()
    const voidId = await db.sales.add({
      createdAt,
      kind: 'void',
      voidOf: saleId,
      method: sale.method,
      total: -sale.total,
      profit: -sale.profit,
      customerId: sale.customerId,
    })

    for (const it of items) {
      const reversed: Omit<SaleItem, 'id'> = {
        saleId: voidId,
        productId: it.productId,
        packId: it.packId,
        name: it.name,
        unitType: it.unitType,
        qty: -it.qty,
        lineTotal: -it.lineTotal,
        lineCost: -it.lineCost,
      }
      await db.saleItems.add(reversed)
      await db.products
        .where('id')
        .equals(it.productId)
        .modify((p) => {
          p.stock += it.qty
        })
      await db.stockMovements.add({
        productId: it.productId,
        createdAt,
        type: 'void',
        qty: it.qty,
        refId: voidId,
      })
    }

    if (sale.method === 'utang' && sale.customerId) {
      await db.creditEntries.add({
        customerId: sale.customerId,
        createdAt,
        kind: 'void',
        amount: -sale.total,
        saleId: voidId,
      })
    }
  })
}

/* --------------------------------------------------------------------- utang */

export async function addCustomer(name: string, phone?: string): Promise<number> {
  const n = name.trim()
  if (!n) throw new PosError('Name is required')
  return db.customers.add({ name: n, phone: phone?.trim() || undefined, createdAt: Date.now() })
}

export async function customerBalance(customerId: number): Promise<number> {
  const entries = await db.creditEntries.where('customerId').equals(customerId).toArray()
  return entries.reduce((s, e) => s + e.amount, 0)
}

/** Utang that did not come from a sale (e.g. an item you don't track). */
export async function addManualCharge(customerId: number, amount: number, note?: string): Promise<void> {
  assertInt(amount, 'Amount', { min: 1 })
  const entry: Omit<CreditEntry, 'id'> = {
    customerId,
    createdAt: Date.now(),
    kind: 'charge',
    amount,
    note: note?.trim() || undefined,
  }
  await db.creditEntries.add(entry)
}

export interface PaymentOptions {
  method?: 'cash' | WalletProvider // default cash
  reference?: string // required for gcash / maya
  note?: string
}

/** Overpaying is rejected so a typo can't push a balance negative. */
export async function recordPayment(
  customerId: number,
  amount: number,
  opts: PaymentOptions = {},
): Promise<void> {
  assertInt(amount, 'Amount', { min: 1 })
  const method = opts.method ?? 'cash'
  const reference = method === 'cash' ? undefined : checkReference(opts.reference)
  await db.transaction('rw', ALL(), async () => {
    if (method !== 'cash' && reference) await assertReferenceFree(method, reference)
    const balance = await customerBalance(customerId)
    if (amount > balance) throw new PosError('That is more than the balance owed')
    await db.creditEntries.add({
      customerId,
      createdAt: Date.now(),
      kind: 'payment',
      amount: -amount,
      method,
      reference,
      note: opts.note?.trim() || undefined,
    })
  })
}

/* ------------------------------------------------------------------- summary */

export interface DaySummary {
  net: number // sales minus voids
  profit: number // estimated: item profit (price minus cost at time of sale) + wallet fees
  saleCount: number
  voidCount: number
  byMethod: Record<PayMethod, number>
  utangCollected: number // all payments received on old utang
  utangCollectedCash: number // the part received in cash
  walletFees: number // earned on GCash / Maya cash-in and cash-out
  walletCashEffect: number // change in the drawer from cash-in (+) and cash-out (-)
  walletCount: number // wallet transactions, voided ones not counted
  cashCollected: number // net change in the drawer: cash sales + cash utang payments + wallet cash effect
}

/** [start, end) of the local calendar day containing `date`. */
export function dayRange(date: Date): [number, number] {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return [start.getTime(), end.getTime()]
}

export async function summaryBetween(start: number, end: number): Promise<DaySummary> {
  const sales = await db.sales.where('createdAt').between(start, end, true, false).toArray()
  const payments = (await db.creditEntries.where('createdAt').between(start, end, true, false).toArray()).filter(
    (e) => e.kind === 'payment',
  )

  const byMethod: Record<PayMethod, number> = { cash: 0, gcash: 0, maya: 0, utang: 0 }
  let net = 0
  let profit = 0
  let saleCount = 0
  let voidCount = 0
  for (const s of sales) {
    net += s.total
    profit += s.profit
    byMethod[s.method] += s.total
    if (s.kind === 'sale') saleCount++
    else voidCount++
  }
  const utangCollected = -payments.reduce((s, e) => s + e.amount, 0)
  const utangCollectedCash = -payments
    .filter((e) => (e.method ?? 'cash') === 'cash')
    .reduce((s, e) => s + e.amount, 0)

  const wallet = await db.walletTransactions.where('createdAt').between(start, end, true, false).toArray()
  let walletFees = 0
  let walletCash = 0
  let walletCount = 0
  for (const w of wallet) {
    walletFees += w.fee
    walletCash += walletCashEffect(w)
    walletCount += w.kind === 'tx' ? 1 : -1
  }

  return {
    net,
    profit: profit + walletFees,
    saleCount,
    voidCount,
    byMethod,
    utangCollected,
    utangCollectedCash,
    walletFees,
    walletCashEffect: walletCash,
    walletCount,
    cashCollected: byMethod.cash + utangCollectedCash + walletCash,
  }
}

/* ------------------------------------------------------------ GCash / Maya */

export interface WalletInput {
  provider: WalletProvider
  type: WalletType
  amount: number // centavos moved through the wallet
  fee: number // centavos you earn
  reference: string
  note?: string
}

export async function createWalletTransaction(input: WalletInput): Promise<WalletTransaction> {
  assertInt(input.amount, 'Amount', { min: 1 })
  assertInt(input.fee, 'Fee')
  const reference = checkReference(input.reference)
  return db.transaction('rw', ALL(), async () => {
    await assertReferenceFree(input.provider, reference)
    const data: Omit<WalletTransaction, 'id'> = {
      createdAt: Date.now(),
      kind: 'tx',
      provider: input.provider,
      type: input.type,
      amount: input.amount,
      fee: input.fee,
      reference,
      note: input.note?.trim() || undefined,
    }
    const id = await db.walletTransactions.add(data)
    return { ...data, id }
  })
}

/** Like voidSale: a new negated row, the original is untouched, and it can only happen once. */
export async function voidWalletTransaction(id: number): Promise<void> {
  await db.transaction('rw', db.walletTransactions, async () => {
    const tx = await db.walletTransactions.get(id)
    if (!tx) throw new PosError('Transaction not found')
    if (tx.kind !== 'tx') throw new PosError('Only transactions can be voided')
    if ((await db.walletTransactions.where('voidOf').equals(id).count()) > 0) {
      throw new PosError('This transaction was already voided')
    }
    await db.walletTransactions.add({
      createdAt: Date.now(),
      kind: 'void',
      voidOf: id,
      provider: tx.provider,
      type: tx.type,
      amount: -tx.amount,
      fee: -tx.fee,
    })
  })
}
