import { db } from './db'
import { createCategory, createPack, createProduct } from './actions'

const SEEDED_KEY = 'tindahan:seeded'

/** Finds a category by name or creates it, so loading the samples twice never fails or duplicates. */
async function categoryId(name: string): Promise<number> {
  const existing = (await db.categories.toArray()).find((c) => c.name.toLowerCase() === name.toLowerCase())
  return existing ? existing.id : createCategory(name)
}

/** Sample catalogue so the app is usable on first launch. Prices are in centavos. */
export async function seedSampleProducts(): Promise<void> {
  const drinks = await categoryId('Drinks')
  const snacks = await categoryId('Snacks')
  const noodles = await categoryId('Noodles')
  const rice = await categoryId('Rice & Grains')
  const condiments = await categoryId('Condiments')
  const fresh = await categoryId('Fresh')
  const toiletries = await categoryId('Toiletries')

  const canton = await createProduct({
    name: 'Pancit Canton', unitType: 'piece', cost: 1200, price: 1500, stock: 48, lowStockAt: 12, favorite: true,
    categoryId: noodles,
  })
  await createPack(canton, { name: 'Box of 24', unitsPerPack: 24, packCost: 28800, packPrice: 34800 })

  const egg = await createProduct({
    name: 'Itlog (egg)', unitType: 'piece', cost: 800, price: 1000, stock: 60, lowStockAt: 12, favorite: true,
    categoryId: fresh,
  })
  await createPack(egg, { name: 'Tray of 30', unitsPerPack: 30, packCost: 24000, packPrice: 29000 })

  await createProduct({ name: 'Softdrink mismo', unitType: 'piece', cost: 1300, price: 1500, stock: 24, lowStockAt: 6, favorite: true, categoryId: drinks })
  await createProduct({ name: 'Bottled water 500ml', unitType: 'piece', cost: 700, price: 1000, stock: 30, lowStockAt: 6, categoryId: drinks })
  await createProduct({ name: 'Candy', unitType: 'piece', cost: 50, price: 100, stock: 200, lowStockAt: 50, categoryId: snacks })
  await createProduct({ name: 'Chips (small)', unitType: 'piece', cost: 700, price: 900, stock: 40, lowStockAt: 10, categoryId: snacks })
  await createProduct({ name: 'Shampoo sachet', unitType: 'piece', cost: 500, price: 700, stock: 60, lowStockAt: 12, categoryId: toiletries })

  const coffee = await createProduct({
    name: '3-in-1 coffee sachet', unitType: 'piece', cost: 550, price: 700, stock: 100, lowStockAt: 20,
    categoryId: drinks,
  })
  await createPack(coffee, { name: 'Bag of 30', unitsPerPack: 30, packCost: 16500, packPrice: 21000 })

  // Sold by weight: price and cost are per KILOGRAM, stock is in grams.
  const bigas = await createProduct({
    name: 'Bigas (rice)', unitType: 'weight', cost: 4600, price: 5200, stock: 25000, lowStockAt: 5000, favorite: true,
    categoryId: rice,
  })
  await createPack(bigas, { name: 'Sack 25 kg', unitsPerPack: 25000, packCost: 115000, packPrice: 130000 })

  await createProduct({ name: 'Asukal (sugar)', unitType: 'weight', cost: 7000, price: 8000, stock: 10000, lowStockAt: 2000, favorite: true, categoryId: condiments })
  await createProduct({ name: 'Asin (salt)', unitType: 'weight', cost: 2000, price: 3000, stock: 3000, lowStockAt: 500, categoryId: condiments })
  await createProduct({ name: 'Bawang (garlic)', unitType: 'weight', cost: 12000, price: 15000, stock: 2000, lowStockAt: 500, categoryId: fresh })
  await createProduct({ name: 'Sibuyas (onion)', unitType: 'weight', cost: 10000, price: 13000, stock: 3000, lowStockAt: 500, categoryId: fresh })
}

/** Seeds once, on the very first launch, so deleting the samples later doesn't bring them back. */
export async function ensureSeeded(): Promise<void> {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return
    if ((await db.products.count()) === 0) await seedSampleProducts()
    localStorage.setItem(SEEDED_KEY, '1')
  } catch {
    /* storage blocked (private mode): start with an empty catalogue */
  }
}
