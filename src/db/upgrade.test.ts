import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

/**
 * A phone that already ran version 1 of the app must keep all its data when the new version opens
 * the same database. The v1 schema is recreated here exactly as it shipped, filled with data,
 * closed, and then opened through the real (v2) `db`.
 */
describe('upgrading an existing v1 database to v2', () => {
  it('keeps every row and adds the new tables and indexes', async () => {
    const old = new Dexie('tindahan')
    old.version(1).stores({
      products: '++id, name, barcode',
      productPacks: '++id, productId',
      sales: '++id, createdAt, kind, voidOf, customerId',
      saleItems: '++id, saleId, productId',
      customers: '++id, name',
      creditEntries: '++id, customerId, createdAt',
      stockMovements: '++id, productId, createdAt, refId',
    })
    await old.open()
    await old.table('products').add({
      name: 'Egg', unitType: 'piece', cost: 800, price: 1000, stock: 30, lowStockAt: 5,
      favorite: true, archived: false, createdAt: 1,
    })
    await old.table('sales').add({
      createdAt: 5, kind: 'sale', method: 'cash', total: 1000, profit: 200, tendered: 1000, change: 0,
    })
    await old.table('customers').add({ name: 'Aling Nena', createdAt: 2 })
    await old.table('creditEntries').add({ customerId: 1, createdAt: 3, kind: 'charge', amount: 2000 })
    old.close()

    const { db } = await import('./db')
    const { createWalletTransaction, referenceInUse, checkout } = await import('./actions')
    const { getSettings } = await import('./settings')
    const { addPiece } = await import('../lib/cart')

    // old data is all still there
    expect((await db.products.toArray()).map((p) => p.name)).toEqual(['Egg'])
    expect(await db.sales.count()).toBe(1)
    expect((await db.creditEntries.toArray())[0].amount).toBe(2000)
    expect((await db.customers.toArray())[0].name).toBe('Aling Nena')

    // the new tables work, and old rows (no method/reference) are treated as cash
    expect(await db.walletTransactions.count()).toBe(0)
    expect((await getSettings()).storeName).toBe('My Tindahan')
    expect((await db.creditEntries.toArray())[0].method).toBeUndefined()

    // new features work on top of the upgraded data
    const egg = (await db.products.toCollection().first())!
    const sale = await checkout(addPiece([], egg), { method: 'gcash', reference: 'UPG-1234' })
    expect(sale.reference).toBe('UPG-1234')
    expect(await referenceInUse('gcash', 'upg-1234')).toBe(true)
    await createWalletTransaction({ provider: 'maya', type: 'cash_in', amount: 10000, fee: 500, reference: 'UPG-5678' })
    expect(await db.walletTransactions.count()).toBe(1)
  })
})
