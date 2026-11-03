import Dexie, { type EntityTable } from 'dexie'

/**
 * Units:
 *  - money  -> integer centavos
 *  - stock  -> pieces for `piece` products, grams for `weight` products
 *  - price  -> centavos per piece, or centavos per KILOGRAM for `weight` products
 */
export type UnitType = 'piece' | 'weight'
export type PayMethod = 'cash' | 'gcash' | 'maya' | 'utang'

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
  note?: string
}

export interface Purchase {
  id: number
  createdAt: number
  supplier?: string
  totalCost: number // integer centavos
  note?: string
  items: PurchaseItem[]
}

export interface PurchaseItem {
  productId: number
  productName: string
  qty: number
  unitCost: number // centavos per piece or kg
  lineCost: number // centavos
}

export interface Expense {
  id: number
  createdAt: number
  category: string
  amount: number // integer centavos
  paymentMethod: 'cash' | 'gcash' | 'maya' | 'bank' | 'other'
  note?: string
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
  purchases!: EntityTable<Purchase, 'id'>
  expenses!: EntityTable<Expense, 'id'>

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
    this.version(2).stores({
      products: '++id, name, barcode',
      productPacks: '++id, productId',
      sales: '++id, createdAt, kind, voidOf, customerId',
      saleItems: '++id, saleId, productId',
      customers: '++id, name',
      creditEntries: '++id, customerId, createdAt',
      stockMovements: '++id, productId, createdAt, refId',
      purchases: '++id, createdAt',
      expenses: '++id, createdAt, category',
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
  'purchases',
  'expenses',
] as const
