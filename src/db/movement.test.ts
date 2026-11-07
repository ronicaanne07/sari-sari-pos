import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { checkout, createProduct, voidSale } from './actions'
import { resetAllData } from './backup'
import { movementStats } from './movement'
import { addPiece } from '../lib/cart'
import { DAY_MS, classify, minFastSales, type ProductSales } from '../lib/movement'

beforeEach(async () => {
  await resetAllData()
})

const NOW = Date.parse('2026-11-07T12:00:00Z')
const old = NOW - 90 * DAY_MS
const p = (id: number, over: Partial<{ createdAt: number; stock: number; archived: boolean }> = {}) => ({
  id,
  createdAt: old,
  stock: 10,
  archived: false,
  ...over,
})
const sold = (times: number): ProductSales => ({ times, units: times, lastSoldAt: times ? NOW : 0 })

describe('classify', () => {
  it('flags the busiest products as fast and the ones that hardly sell as slow', () => {
    // 10 products: #1 sold 20 times, #2 sold 12, #3..#6 sold 5, #7 sold 2, #8 sold 1, #9 and #10 never
    const times = [20, 12, 5, 5, 5, 5, 2, 1, 0, 0]
    const products = times.map((_, i) => p(i + 1))
    const stats = new Map(times.map((t, i) => [i + 1, sold(t)]))
    const m = classify(products, stats, NOW, 30)
    const label = (id: number) => m.get(id)!.label
    expect([label(1), label(2)]).toEqual(['fast', 'fast']) // top 20% of 10 = 2 products
    expect(label(3)).toBe('normal') // sells well, but is not in the top fifth
    expect(label(7)).toBe('normal') // 2 sales: not slow yet
    expect([label(8), label(9), label(10)]).toEqual(['slow', 'slow', 'slow']) // 1 sale or none
  })

  it('needs a real number of sales to be fast, even in a quiet shop', () => {
    const products = [p(1), p(2), p(3)]
    const stats = new Map([[1, sold(2)], [2, sold(1)], [3, sold(0)]]) // the best seller sold only twice
    expect(minFastSales(30)).toBe(4)
    expect(classify(products, stats, NOW, 30).get(1)!.label).toBe('normal')
  })

  it('does not call a brand new product slow, but can call it fast', () => {
    const fresh = NOW - 5 * DAY_MS
    const products = [p(1, { createdAt: fresh }), p(2, { createdAt: fresh }), p(3), p(4), p(5), p(6)]
    const stats = new Map([[1, sold(0)], [2, sold(9)], [3, sold(3)], [4, sold(3)], [5, sold(3)], [6, sold(3)]])
    const m = classify(products, stats, NOW, 30)
    expect(m.get(1)!.label).toBe('new')
    expect(m.get(2)!.label).toBe('fast')
  })

  it('does not call an out-of-stock product slow, and ignores archived ones', () => {
    const products = [p(1, { stock: 0 }), p(2, { archived: true }), p(3)]
    const m = classify(products, new Map(), NOW, 30)
    expect(m.get(1)!.label).toBe('normal')
    expect(m.has(2)).toBe(false)
    expect(m.get(3)!.label).toBe('slow')
  })

  it('handles a shop with no products or no sales', () => {
    expect(classify([], new Map(), NOW, 30).size).toBe(0)
    expect(classify([p(1)], new Map(), NOW, 30).get(1)!.label).toBe('slow')
  })
})

describe('movementStats', () => {
  const make = (name: string) => createProduct({ name, unitType: 'piece', cost: 800, price: 1000, stock: 100 })

  it('counts sales in the period, once per sale, and leaves out voided sales', async () => {
    const egg = await db.products.get(await make('Egg'))
    const rice = await db.products.get(await make('Rice'))
    const lines = (n: number) => Array.from({ length: n }).reduce<ReturnType<typeof addPiece>>((c) => addPiece(c, egg!), [])
    await checkout(lines(3), { method: 'cash' }) // 1 sale, 3 eggs
    await checkout(lines(1), { method: 'cash' }) // 1 sale, 1 egg
    const mistake = await checkout(addPiece([], egg!), { method: 'cash' })
    await voidSale(mistake.id) // does not count
    await checkout(addPiece([], rice!), { method: 'cash' })

    const stats = await movementStats(30)
    expect(stats.get(egg!.id)).toMatchObject({ times: 2, units: 4 })
    expect(stats.get(rice!.id)).toMatchObject({ times: 1, units: 1 })
  })

  it('only looks at the chosen number of days', async () => {
    const egg = (await db.products.get(await make('Egg')))!
    const sale = await checkout(addPiece([], egg), { method: 'cash' })
    await db.sales.update(sale.id, { createdAt: Date.now() - 40 * DAY_MS }) // 40 days ago
    expect((await movementStats(30)).get(egg.id)).toBeUndefined()
    expect((await movementStats(60)).get(egg.id)?.times).toBe(1)
  })
})
