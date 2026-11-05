import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  PosError,
  createCategory,
  createProduct,
  deleteCategory,
  renameCategory,
  updateProduct,
} from './actions'
import { exportBackup, importBackup, resetAllData } from './backup'
import { seedSampleProducts } from './seed'

beforeEach(async () => {
  await resetAllData()
})

const piece = (name: string, categoryId?: number) =>
  createProduct({ name, unitType: 'piece', cost: 100, price: 200, stock: 5, categoryId })

describe('categories', () => {
  it('creates categories in order and rejects empty or duplicate names (any capitalisation)', async () => {
    const a = await createCategory('  Drinks ')
    const b = await createCategory('Snacks')
    const list = await db.categories.orderBy('sortOrder').toArray()
    expect(list.map((c) => c.name)).toEqual(['Drinks', 'Snacks'])
    expect(a).not.toBe(b)
    await expect(createCategory('   ')).rejects.toThrow(/required/)
    await expect(createCategory('DRINKS')).rejects.toThrow(/already exists/)
  })

  it('renames a category, but not to a name that is taken', async () => {
    const a = await createCategory('Drinks')
    await createCategory('Snacks')
    await renameCategory(a, 'Beverages')
    expect((await db.categories.get(a))!.name).toBe('Beverages')
    await expect(renameCategory(a, 'snacks')).rejects.toThrow(/already exists/)
    await renameCategory(a, 'BEVERAGES') // changing only the capitalisation of itself is fine
    expect((await db.categories.get(a))!.name).toBe('BEVERAGES')
  })

  it('puts a product in a category and moves or clears it later', async () => {
    const drinks = await createCategory('Drinks')
    const snacks = await createCategory('Snacks')
    const id = await piece('Cola', drinks)
    expect((await db.products.get(id))!.categoryId).toBe(drinks)

    await updateProduct(id, { categoryId: snacks })
    expect((await db.products.get(id))!.categoryId).toBe(snacks)

    await updateProduct(id, { categoryId: undefined }) // back to Uncategorized
    expect((await db.products.get(id))!.categoryId).toBeUndefined()
    expect(await db.products.where('categoryId').equals(snacks).count()).toBe(0)
  })

  it('does not touch the category when other fields are updated', async () => {
    const drinks = await createCategory('Drinks')
    const id = await piece('Cola', drinks)
    await updateProduct(id, { price: 300 })
    expect((await db.products.get(id))!.categoryId).toBe(drinks)
  })

  it('refuses a category that does not exist', async () => {
    await expect(piece('Ghost', 999)).rejects.toThrow(/no longer exists/)
    const id = await piece('Cola')
    await expect(updateProduct(id, { categoryId: 999 })).rejects.toThrow(PosError)
    expect(await db.products.count()).toBe(1)
  })

  it('deleting a category keeps its products, which become Uncategorized', async () => {
    const drinks = await createCategory('Drinks')
    const snacks = await createCategory('Snacks')
    const cola = await piece('Cola', drinks)
    const water = await piece('Water', drinks)
    const chips = await piece('Chips', snacks)

    expect(await deleteCategory(drinks)).toBe(2) // reports how many products were moved
    expect(await db.categories.get(drinks)).toBeUndefined()
    expect((await db.products.get(cola))!.categoryId).toBeUndefined()
    expect((await db.products.get(water))!.categoryId).toBeUndefined()
    expect((await db.products.get(cola))!.name).toBe('Cola') // product itself is intact
    expect((await db.products.get(chips))!.categoryId).toBe(snacks) // other categories untouched
  })

  it('seeds sample categories without duplicating them when loaded twice', async () => {
    await seedSampleProducts()
    const first = await db.categories.count()
    expect(first).toBe(7)
    const products = await db.products.toArray()
    expect(products.every((p) => p.categoryId !== undefined)).toBe(true)
    await seedSampleProducts()
    expect(await db.categories.count()).toBe(first)
  })

  it('round-trips categories through a backup and still restores backups that have none', async () => {
    const drinks = await createCategory('Drinks')
    const id = await piece('Cola', drinks)
    const backup = JSON.parse(JSON.stringify(await exportBackup()))
    expect(backup.version).toBe(4)

    await resetAllData()
    await importBackup(backup)
    expect((await db.categories.get(drinks))!.name).toBe('Drinks')
    expect((await db.products.get(id))!.categoryId).toBe(drinks)

    delete backup.tables.categories
    backup.version = 2
    await importBackup(backup)
    expect(await db.categories.count()).toBe(0)
    expect(await db.products.count()).toBe(1)
  })
})
