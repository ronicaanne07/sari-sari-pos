import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  addCustomer,
  checkout,
  createPack,
  createProduct,
  createWalletTransaction,
  recordPayment,
  voidSale,
} from './actions'
import { resetAllData } from './backup'
import { saveSettings } from './settings'
import { buildReceipt } from './receipts'
import { addPack, addPiece, addWeight } from '../lib/cart'

beforeEach(async () => {
  await resetAllData()
  await saveSettings({ storeName: 'Test Store', address: '', footer: 'Thanks!' })
})

describe('buildReceipt from the database', () => {
  it('builds a cash sale receipt with pieces, weight and a pack', async () => {
    const eggId = await createProduct({ name: 'Egg', unitType: 'piece', cost: 800, price: 1000, stock: 60 })
    const sugarId = await createProduct({ name: 'Sugar', unitType: 'weight', cost: 7000, price: 8000, stock: 10000 })
    const egg = (await db.products.get(eggId))!
    const sugar = (await db.products.get(sugarId))!
    const trayId = await createPack(eggId, { name: 'Tray of 30', unitsPerPack: 30, packCost: 24000, packPrice: 29000 })
    const tray = (await db.productPacks.get(trayId))!

    let cart = addPiece(addPiece([], egg), egg)
    cart = addWeight(cart, sugar, 250, 2000)
    cart = addPack(cart, egg, tray)
    const sale = await checkout(cart, { method: 'cash', tendered: 100000 })

    const r = await buildReceipt({ kind: 'sale', id: sale.id })
    expect(r.text).toContain('Test Store')
    expect(r.text).toMatch(/2 x ₱10\.00\s+₱20\.00/)
    expect(r.text).toMatch(/250 g\s+₱20\.00/)
    expect(r.text).toMatch(/30 pcs\s+₱290\.00/)
    expect(r.text).toMatch(/TOTAL\s+₱330\.00/)
    expect(r.text).toMatch(/Change\s+₱670\.00/)
    expect(r.text).toContain('Thanks!')
  })

  it('includes the reference, the utang customer and the live balance', async () => {
    const eggId = await createProduct({ name: 'Egg', unitType: 'piece', cost: 800, price: 1000, stock: 10 })
    const egg = (await db.products.get(eggId))!
    const nena = await addCustomer('Aling Nena')

    const online = await checkout(addPiece([], egg), { method: 'maya', reference: 'MAYA5555' })
    expect((await buildReceipt({ kind: 'sale', id: online.id })).text).toContain('Ref: MAYA5555')

    const credit = await checkout(addPiece(addPiece([], egg), egg), { method: 'utang', customerId: nena })
    const r = await buildReceipt({ kind: 'sale', id: credit.id })
    expect(r.text).toContain('Customer: Aling Nena')
    expect(r.text).toMatch(/Utang balance\s+₱20\.00/)
  })

  it('builds a void receipt that points at the original', async () => {
    const eggId = await createProduct({ name: 'Egg', unitType: 'piece', cost: 800, price: 1000, stock: 10 })
    const egg = (await db.products.get(eggId))!
    const sale = await checkout(addPiece([], egg), { method: 'cash' })
    await voidSale(sale.id)
    const voidRow = (await db.sales.where('voidOf').equals(sale.id).first())!
    const r = await buildReceipt({ kind: 'sale', id: voidRow.id })
    expect(r.text).toContain('*** VOID ***')
    expect(r.text).toContain(`Cancels receipt ${String(sale.id).padStart(5, '0')}`)
    expect(r.text).toMatch(/TOTAL\s+-₱10\.00/)
  })

  it('builds wallet and utang payment receipts', async () => {
    const tx = await createWalletTransaction({
      provider: 'gcash', type: 'cash_in', amount: 50000, fee: 1000, reference: 'WAL12345',
    })
    const w = await buildReceipt({ kind: 'wallet', id: tx.id })
    expect(w.text).toContain('GCASH CASH-IN')
    expect(w.text).toContain('Ref: WAL12345')

    const eggId = await createProduct({ name: 'Egg', unitType: 'piece', cost: 800, price: 1000, stock: 10 })
    const egg = (await db.products.get(eggId))!
    const nena = await addCustomer('Aling Nena')
    await checkout(addPiece(addPiece([], egg), egg), { method: 'utang', customerId: nena })
    await recordPayment(nena, 500, { method: 'gcash', reference: 'UTG12345' })
    const entry = (await db.creditEntries.toArray()).find((e) => e.kind === 'payment')!
    const p = await buildReceipt({ kind: 'payment', id: entry.id })
    expect(p.text).toContain('UTANG PAYMENT')
    expect(p.text).toMatch(/Paid \(GCash\)\s+₱5\.00/)
    expect(p.text).toContain('Ref: UTG12345')
    expect(p.text).toMatch(/Utang balance\s+₱15\.00/)
  })

  it('rejects a receipt that does not exist', async () => {
    await expect(buildReceipt({ kind: 'sale', id: 999 })).rejects.toThrow(/not found/)
    await expect(buildReceipt({ kind: 'wallet', id: 999 })).rejects.toThrow(/not found/)
    await expect(buildReceipt({ kind: 'payment', id: 999 })).rejects.toThrow(/not found/)
  })
})
