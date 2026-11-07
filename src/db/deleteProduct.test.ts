import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  PosError,
  checkout,
  createPack,
  createProduct,
  deleteArchivedProducts,
  deleteProduct,
  updateProduct,
  voidSale,
} from './actions'
import { exportBackup, importBackup, resetAllData } from './backup'
import { buildReceipt } from './receipts'
import { addPiece } from '../lib/cart'

beforeEach(async () => {
  await resetAllData()
})

const make = (name: string, barcode?: string) =>
  createProduct({ name, unitType: 'piece', cost: 800, price: 1000, stock: 10, barcode })

describe('deleting archived products', () => {
  it('refuses a product that is still on sale, and one that does not exist', async () => {
    const id = await make('Egg')
    await expect(deleteProduct(id)).rejects.toThrow(/Archive the product first/)
    await expect(deleteProduct(999)).rejects.toThrow(PosError)
    expect(await db.products.count()).toBe(1)
  })

  it('removes an archived product with its packs, frees the barcode and leaves other products alone', async () => {
    const egg = await make('Egg', '4006381333931')
    const rice = await make('Rice')
    await createPack(egg, { name: 'Tray of 30', unitsPerPack: 30, packCost: 20000, packPrice: 29000 })
    await createPack(rice, { name: 'Sack', unitsPerPack: 25, packCost: 100000, packPrice: 130000 })

    await updateProduct(egg, { archived: true })
    await deleteProduct(egg)

    expect(await db.products.get(egg)).toBeUndefined()
    expect(await db.productPacks.where('productId').equals(egg).count()).toBe(0)
    expect(await db.products.get(rice)).toBeTruthy()
    expect(await db.productPacks.where('productId').equals(rice).count()).toBe(1)
    await expect(make('New egg', '4006381333931')).resolves.toBeGreaterThan(0) // the barcode can be used again
  })

  it('leaves a tombstone for the product and each pack so the other phones delete them too', async () => {
    const id = await make('Egg')
    const packId = await createPack(id, { name: 'Tray', unitsPerPack: 30, packCost: 20000, packPrice: 29000 })
    await updateProduct(id, { archived: true })
    await deleteProduct(id)
    const stones = (await db.tombstones.toArray()).map((t) => `${t.tbl}:${t.rowId}`).sort()
    expect(stones).toEqual([`productPacks:${packId}`, `products:${id}`].sort())
  })

  it('keeps past sales, receipts and voids working after the product is gone', async () => {
    const id = await make('Egg')
    const product = (await db.products.get(id))!
    const sale = await checkout(addPiece([], product), { method: 'cash' })
    await updateProduct(id, { archived: true })
    await deleteProduct(id)

    const items = await db.saleItems.where('saleId').equals(sale.id).toArray()
    expect(items.map((i) => i.name)).toEqual(['Egg'])
    const receipt = await buildReceipt({ kind: 'sale', id: sale.id })
    expect(receipt.text).toContain('Egg')
    await expect(voidSale(sale.id)).resolves.toBeUndefined() // no product to put stock back on: still fine
    expect(await db.sales.where('voidOf').equals(sale.id).count()).toBe(1)
  })

  it('deleteArchivedProducts removes only archived ones and reports how many', async () => {
    const a = await make('A')
    const b = await make('B')
    await make('C')
    await updateProduct(a, { archived: true })
    await updateProduct(b, { archived: true })
    expect(await deleteArchivedProducts()).toBe(2)
    expect((await db.products.toArray()).map((p) => p.name)).toEqual(['C'])
    expect(await deleteArchivedProducts()).toBe(0)
  })

  it('a deleted product does not come back from a newer backup restore of the same data', async () => {
    const id = await make('Egg')
    await updateProduct(id, { archived: true })
    await deleteProduct(id)
    const backup = JSON.parse(JSON.stringify(await exportBackup()))
    await resetAllData()
    await importBackup(backup)
    expect(await db.products.count()).toBe(0)
  })
})

describe('sold-by is fixed after creation', () => {
  it('refuses to change a product between pieces and weight', async () => {
    const id = await make('Egg')
    await expect(updateProduct(id, { unitType: 'weight' } as never)).rejects.toThrow(/cannot be changed/)
    expect((await db.products.get(id))!.unitType).toBe('piece')
    await expect(updateProduct(id, { price: 1200 })).resolves.toBeUndefined() // other edits still work
  })
})
