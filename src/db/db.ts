import Dexie, { type EntityTable } from 'dexie'

/**
 * Units:
 *  - money  -> integer centavos
 *  - stock  -> pieces for `piece` products, grams for `weight` products
 *  - price  -> centavos per piece, or centavos per KILOGRAM for `weight` products
 */
export type UnitType = 'piece' | 'weight'
export type PayMethod = 'cash' | 'gcash' | 'maya' | 'utang'
/** Online payment providers. Their payments and transfers carry a reference number. */
export type WalletProvider = 'gcash' | 'maya'
export type WalletType = 'cash_in' | 'cash_out'

export interface Product {
  id: number
  name: string
  barcode?: string
  unitType: UnitType
  cost: number // per piece, or per kg
  price: number // per piece, or per kg
  stock: number // pieces or grams (may go negative: we never block a sale)
  lowStockAt: number // alert threshold, same unit as stock
  favorite: boolean
  archived: boolean
  createdAt: number
}

/** A way to buy/sell in bulk: "Box of 24", "Sack 25 kg". unitsPerPack is pieces or grams. */
export interface ProductPack {
  id: number
  productId: number
  name: string
  unitsPerPack: number
  packCost: number
  packPrice: number
}

/**
 * Sales are an append-only ledger. A void is a NEW row (kind "void", negative amounts)
 * pointing at the original through `voidOf`. Original rows are never edited.
 */
export interface Sale {
  id: number
  createdAt: number
  kind: 'sale' | 'void'
  voidOf?: number
  method: PayMethod
  total: number // centavos (negative for voids)
  profit: number // centavos (negative for voids)
  tendered?: number // cash handed over
  change?: number
  customerId?: number // set for utang sales
  reference?: string // GCash / Maya reference number (upper-case, no spaces)
  note?: string
}

export interface SaleItem {
  id: number
  saleId: number
  productId: number
  packId?: number
  name: string // snapshot, survives renames
  unitType: UnitType
  qty: number // pieces or grams (negative for voids)
  lineTotal: number // centavos
  lineCost: number // centavos
}

export interface Customer {
  id: number
  name: string
  phone?: string
  createdAt: number
}

/** Signed amount: charges are positive, payments/voids negative. Balance = sum(amount). */
export interface CreditEntry {
  id: number
  customerId: number
  createdAt: number
  kind: 'charge' | 'payment' | 'void'
  amount: number
  saleId?: number
  method?: 'cash' | WalletProvider // how a payment was received (cash when missing)
  reference?: string // for gcash / maya payments
  note?: string
}

/**
 * GCash / Maya cash-in and cash-out done for a customer. Append-only like sales:
 * a void is a new row with negated amounts pointing at the original.
 *
 *  cash_in : customer hands over cash (amount + fee); you send `amount` from your wallet.
 *  cash_out: you hand over cash (amount); the customer sends you `amount + fee` in the wallet.
 *  In both cases `fee` is your earning.
 */
export interface WalletTransaction {
  id: number
  createdAt: number
  kind: 'tx' | 'void'
  voidOf?: number
  provider: WalletProvider
  type: WalletType
  amount: number // centavos (negative for voids)
  fee: number // centavos (negative for voids)
  reference?: string
  note?: string
}

export interface Setting {
  key: string
  value: unknown
}

export interface StockMovement {
  id: number
  productId: number
  createdAt: number
  type: 'sale' | 'void' | 'restock' | 'adjustment' | 'spoilage'
  qty: number // signed, stock units
  refId?: number // saleId for sale/void
  note?: string
}

class TindahanDB extends Dexie {
  products!: EntityTable<Product, 'id'>
  productPacks!: EntityTable<ProductPack, 'id'>
  sales!: EntityTable<Sale, 'id'>
  saleItems!: EntityTable<SaleItem, 'id'>
  customers!: EntityTable<Customer, 'id'>
  creditEntries!: EntityTable<CreditEntry, 'id'>
  stockMovements!: EntityTable<StockMovement, 'id'>
  walletTransactions!: EntityTable<WalletTransaction, 'id'>
  settings!: EntityTable<Setting, 'key'>

  constructor() {
    super('tindahan')
    // IndexedDB cannot index booleans, so favorite/archived are filtered in JS (catalog is small).
    this.version(1).stores({
      products: '++id, name, barcode',
      productPacks: '++id, productId',
      sales: '++id, createdAt, kind, voidOf, customerId',
      saleItems: '++id, saleId, productId',
      customers: '++id, name',
      creditEntries: '++id, customerId, createdAt',
      stockMovements: '++id, productId, createdAt, refId',
    })
    // v2: payment references (indexed so duplicates are caught), wallet transactions, settings.
    // Tables not listed here carry over unchanged, so phones already on v1 upgrade in place.
    this.version(2).stores({
      sales: '++id, createdAt, kind, voidOf, customerId, reference',
      creditEntries: '++id, customerId, createdAt, reference',
      walletTransactions: '++id, createdAt, kind, voidOf, reference',
      settings: 'key',
    })
  }
}

export const db = new TindahanDB()

export const ALL_TABLES = [
  'products',
  'productPacks',
  'sales',
  'saleItems',
  'customers',
  'creditEntries',
  'stockMovements',
  'walletTransactions',
  'settings',
] as const

/** Tables that backups made by version 1 of the app do not contain. */
export const OPTIONAL_BACKUP_TABLES: readonly (typeof ALL_TABLES)[number][] = ['walletTransactions', 'settings']
