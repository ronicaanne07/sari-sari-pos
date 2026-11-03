import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  PosError,
  addCustomer,
  addManualCharge,
  adjustStock,
  checkout,
  createPack,
  createProduct,
  customerBalance,
  dayRange,
  lowStockProducts,
  recordPayment,
  restock,
  restockPack,
  summaryBetween,
  updateProduct,
  voidSale,
} from './actions'
import { exportBackup, importBackup, resetAllData } from './backup'
import { seedSampleProducts } from './seed'
import { addPiece, addWeight, addPack } from '../lib/cart'

beforeEach(async () => {
  await resetAllData()
})

async function setup() {
  const eggId = await createProduct({ name: 'Egg', unitType: 'piece', cost: 800, price: 1000, stock: 30, lowStockAt: 5 })
  const sugarId = await createProduct({ name: 'Sugar', unitType: 'weight', cost: 7000, price: 8000, stock: 10000, lowStockAt: 1000 })
  const egg = (await db.products.get(eggId))!
  const sugar = (await db.products.get(sugarId))!
  return { egg, sugar }
}

describe('products and stock', () => {
  it('records opening stock as a movement and rejects duplicate barcodes', async () => {
    const id = await createProduct({ name: 'Candy', barcode: '123', unitType: 'piece', cost: 50, price: 100, stock: 5 })
    expect(await db.stockMovements.where('productId').equals(id).count()).toBe(1)
    await expect(
      createProduct({ name: 'Other', barcode: '123', unitType: 'piece', cost: 1, price: 2 }),
    ).rejects.toThrow(/Barcode already used/)
    const other = await createProduct({ name: 'Other', barcode: '456', unitType: 'piece', cost: 1, price: 2 })
    await expect(updateProduct(other, { barcode: '123' })).rejects.toThrow(PosError)
  })

  it('restocks by pack and refreshes cost per piece and per kg', async () => {
    const { egg, sugar } = await setup()
    const tray = await createPack(egg.id, { name: 'Tray of 30', unitsPerPack: 30, packCost: 24300, packPrice: 29000 })
    await restockPack(tray, 2)
    const e = (await db.products.get(egg.id))!
    expect(e.stock).toBe(30 + 60)
    expect(e.cost).toBe(810) // 24300 / 30

    const sack = await createPack(sugar.id, { name: 'Sack 50 kg', unitsPerPack: 50000, packCost: 350000, packPrice: 400000 })
    await restockPack(sack, 1)
    const s = (await db.products.get(sugar.id))!
    expect(s.stock).toBe(60000)
    expect(s.cost).toBe(7000) // ₱3,500 for 50 kg = ₱70/kg
  })

  it('adjusts stock and lists low-stock items', async () => {
    const { egg } = await setup()
    await adjustStock(egg.id, -26, 'spoilage', 'cracked')
    expect((await db.products.get(egg.id))!.stock).toBe(4)
    expect((await lowStockProducts()).map((p) => p.name)).toEqual(['Egg'])
    await restock(egg.id, 20)
    expect(await lowStockProducts()).toHaveLength(0)
    await expect(restock(egg.id, 0)).rejects.toThrow(PosError)
  })
})

describe('checkout', () => {
  it('deducts pieces and grams, and computes total, change and profit', async () => {
    const { egg, sugar } = await setup()
    let cart = addPiece([], egg)
    cart = addPiece(cart, egg)
    cart = addWeight(cart, sugar, 250, 2000) // ₱20 worth of sugar

    const sale = await checkout(cart, { method: 'cash', tendered: 5000 })
    expect(sale.total).toBe(4000)
    expect(sale.change).toBe(1000)
    // profit: eggs 2×(1000-800) + sugar 2000 - round(7000×250/1000)=1750 → 400 + 250
    expect(sale.profit).toBe(650)

    expect((await db.products.get(egg.id))!.stock).toBe(28)
    expect((await db.products.get(sugar.id))!.stock).toBe(9750)
    expect(await db.saleItems.where('saleId').equals(sale.id).count()).toBe(2)
    expect(await db.stockMovements.where('refId').equals(sale.id).count()).toBe(2)
  })

  it('sells a pack as pack-size pieces at the pack price', async () => {
    const { egg } = await setup()
    const trayId = await createPack(egg.id, { name: 'Tray of 30', unitsPerPack: 30, packCost: 24000, packPrice: 29000 })
    const tray = (await db.productPacks.get(trayId))!
    const sale = await checkout(addPack([], egg, tray), { method: 'gcash', reference: 'TRAY1234' })
    expect(sale.total).toBe(29000)
    expect(sale.profit).toBe(29000 - 30 * 800)
    expect((await db.products.get(egg.id))!.stock).toBe(0)
  })

  it('lets stock go negative instead of blocking the sale', async () => {
    const { egg } = await setup()
    let cart = addPiece([], egg)
    cart = [{ ...cart[0], qty: 40, lineTotal: 40000 }]
    await checkout(cart, { method: 'cash' })
    expect((await db.products.get(egg.id))!.stock).toBe(-10)
  })

  it('rejects bad input and saves nothing', async () => {
    const { egg } = await setup()
    const cart = addPiece([], egg)
    await expect(checkout([], { method: 'cash' })).rejects.toThrow(/empty/)
    await expect(checkout(cart, { method: 'cash', tendered: 500 })).rejects.toThrow(/less than the total/)
    await expect(checkout(cart, { method: 'utang' })).rejects.toThrow(/who is taking utang/)
    await expect(checkout(cart, { method: 'utang', customerId: 999 })).rejects.toThrow(/Customer not found/)
    expect(await db.sales.count()).toBe(0)
    expect((await db.products.get(egg.id))!.stock).toBe(30)
  })

  it('rolls back everything if one line fails mid-transaction', async () => {
    const { egg } = await setup()
    const good = addPiece([], egg)
    const ghost = { ...good[0], key: 'p:999', productId: 999, name: 'Ghost' }
    await expect(checkout([...good, ghost], { method: 'cash' })).rejects.toThrow(/no longer exists/)
    expect(await db.sales.count()).toBe(0)
    expect((await db.products.get(egg.id))!.stock).toBe(30)
  })
})

describe('utang', () => {
  it('charges a sale, takes payments, and blocks overpayment', async () => {
    const { egg } = await setup()
    const nena = await addCustomer('Aling Nena', '0917')
    await checkout(addPiece(addPiece([], egg), egg), { method: 'utang', customerId: nena })
    expect(await customerBalance(nena)).toBe(2000)

    await addManualCharge(nena, 500, 'load')
    expect(await customerBalance(nena)).toBe(2500)

    await recordPayment(nena, 1000)
    expect(await customerBalance(nena)).toBe(1500)
    await expect(recordPayment(nena, 1501)).rejects.toThrow(/more than the balance/)
    await recordPayment(nena, 1500)
    expect(await customerBalance(nena)).toBe(0)
  })
})

describe('void', () => {
  it('restores stock, reverses utang, and cannot be done twice', async () => {
    const { egg, sugar } = await setup()
    const nena = await addCustomer('Aling Nena')
    let cart = addPiece([], egg)
    cart = addWeight(cart, sugar, 500, 4000)
    const sale = await checkout(cart, { method: 'utang', customerId: nena })
    expect(await customerBalance(nena)).toBe(5000)

    await voidSale(sale.id)
    expect((await db.products.get(egg.id))!.stock).toBe(30)
    expect((await db.products.get(sugar.id))!.stock).toBe(10000)
    expect(await customerBalance(nena)).toBe(0)

    // original untouched, void is a new negative row
    const original = (await db.sales.get(sale.id))!
    expect(original.total).toBe(5000)
    const voidRow = (await db.sales.where('voidOf').equals(sale.id).first())!
    expect(voidRow.kind).toBe('void')
    expect(voidRow.total).toBe(-5000)

    await expect(voidSale(sale.id)).rejects.toThrow(/already voided/)
    await expect(voidSale(voidRow.id)).rejects.toThrow(/Only sales can be voided/)
  })
})

describe('daily summary', () => {
  it('nets out voids and splits by payment method', async () => {
    const { egg } = await setup()
    const nena = await addCustomer('Aling Nena')
    await checkout(addPiece([], egg), { method: 'cash' }) // +1000
    await checkout(addPiece([], egg), { method: 'gcash', reference: 'GC-1001' }) // +1000
    await checkout(addPiece(addPiece([], egg), egg), { method: 'utang', customerId: nena }) // +2000
    const mistake = await checkout(addPiece([], egg), { method: 'cash' }) // +1000
    await voidSale(mistake.id) // -1000
    await recordPayment(nena, 500)

    const [start, end] = dayRange(new Date())
    const s = await summaryBetween(start, end)
    expect(s.net).toBe(4000) // 1000 + 1000 + 2000 + 1000 - 1000
    expect(s.saleCount).toBe(4)
    expect(s.voidCount).toBe(1)
    expect(s.byMethod).toEqual({ cash: 1000, gcash: 1000, maya: 0, utang: 2000 })
    expect(s.utangCollected).toBe(500)
    expect(s.cashCollected).toBe(1500)
    expect(s.profit).toBe(4 * 200) // 4 eggs kept (1 + 1 + 2), each ₱2 profit; the voided one nets to zero
  })

  it('only counts the requested day', async () => {
    const { egg } = await setup()
    await checkout(addPiece([], egg), { method: 'cash' })
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const [start, end] = dayRange(yesterday)
    expect((await summaryBetween(start, end)).net).toBe(0)
  })
})

describe('backup', () => {
  it('round-trips everything and keeps rows linked', async () => {
    await seedSampleProducts()
    const rice = (await db.products.where('name').startsWith('Bigas').first())!
    const nena = await addCustomer('Aling Nena')
    const sale = await checkout(addWeight([], rice, 500, 2600), { method: 'utang', customerId: nena })

    const backup = JSON.parse(JSON.stringify(await exportBackup()))
    await resetAllData()
    expect(await db.products.count()).toBe(0)

    await importBackup(backup)
    expect((await db.products.get(rice.id))!.stock).toBe(rice.stock - 500)
    expect(await customerBalance(nena)).toBe(2600)
    expect((await db.saleItems.where('saleId').equals(sale.id).first())!.qty).toBe(500)
    await voidSale(sale.id) // still works after restore
    expect(await customerBalance(nena)).toBe(0)
  })

  it('rejects a bad file without touching existing data', async () => {
    await setup()
    await expect(importBackup({ nope: true })).rejects.toThrow(/not a Tindahan POS backup/)
    await expect(importBackup({ app: 'tindahan-pos', version: 1, tables: {} })).rejects.toThrow(/missing/)
    expect(await db.products.count()).toBe(2)
  })
})
