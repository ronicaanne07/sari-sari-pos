import { db } from './db'
import { createPack, createProduct } from './actions'

const SEEDED_KEY = 'tindahan:seeded'

/** Sample catalogue so the app is usable on first launch. Prices are in centavos. */
export async function seedSampleProducts(): Promise<void> {
  const noodles = await createProduct({
    name: 'Pancit Canton', unitType: 'piece', cost: 1200, price: 1500, stock: 48, lowStockAt: 12, favorite: true,
  })
  await createPack(noodles, { name: 'Box of 24', unitsPerPack: 24, packCost: 28800, packPrice: 34800 })

  const egg = await createProduct({
    name: 'Itlog (egg)', unitType: 'piece', cost: 800, price: 1000, stock: 60, lowStockAt: 12, favorite: true,
  })
  await createPack(egg, { name: 'Tray of 30', unitsPerPack: 30, packCost: 24000, packPrice: 29000 })

  await createProduct({ name: 'Softdrink mismo', unitType: 'piece', cost: 1300, price: 1500, stock: 24, lowStockAt: 6, favorite: true })
  await createProduct({ name: 'Bottled water 500ml', unitType: 'piece', cost: 700, price: 1000, stock: 30, lowStockAt: 6 })
  await createProduct({ name: 'Candy', unitType: 'piece', cost: 50, price: 100, stock: 200, lowStockAt: 50 })
  await createProduct({ name: 'Chips (small)', unitType: 'piece', cost: 700, price: 900, stock: 40, lowStockAt: 10 })
  await createProduct({ name: 'Shampoo sachet', unitType: 'piece', cost: 500, price: 700, stock: 60, lowStockAt: 12 })

  const coffee = await createProduct({
    name: '3-in-1 coffee sachet', unitType: 'piece', cost: 550, price: 700, stock: 100, lowStockAt: 20,
  })
  await createPack(coffee, { name: 'Bag of 30', unitsPerPack: 30, packCost: 16500, packPrice: 21000 })

  // Sold by weight: price and cost are per KILOGRAM, stock is in grams.
  const rice = await createProduct({
    name: 'Bigas (rice)', unitType: 'weight', cost: 4600, price: 5200, stock: 25000, lowStockAt: 5000, favorite: true,
  })
  await createPack(rice, { name: 'Sack 25 kg', unitsPerPack: 25000, packCost: 115000, packPrice: 130000 })

  await createProduct({ name: 'Asukal (sugar)', unitType: 'weight', cost: 7000, price: 8000, stock: 10000, lowStockAt: 2000, favorite: true })
  await createProduct({ name: 'Asin (salt)', unitType: 'weight', cost: 2000, price: 3000, stock: 3000, lowStockAt: 500 })
  await createProduct({ name: 'Bawang (garlic)', unitType: 'weight', cost: 12000, price: 15000, stock: 2000, lowStockAt: 500 })
  await createProduct({ name: 'Sibuyas (onion)', unitType: 'weight', cost: 10000, price: 13000, stock: 3000, lowStockAt: 500 })
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
