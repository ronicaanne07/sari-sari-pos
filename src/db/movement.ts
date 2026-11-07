import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { useSettings } from './settings'
import { DAY_MS, classify, type MovementInfo, type ProductSales } from '../lib/movement'

/** How many times each product sold in the last `days` days (voided sales left out). */
export async function movementStats(days: number, now = Date.now()): Promise<Map<number, ProductSales>> {
  const since = now - days * DAY_MS
  const inWindow = (await db.sales.where('createdAt').between(since, now, true, true).toArray()).filter(
    (s) => s.kind === 'sale',
  )
  const voided = new Set((await db.sales.where('voidOf').anyOf(inWindow.map((s) => s.id)).toArray()).map((v) => v.voidOf))
  const live = inWindow.filter((s) => !voided.has(s.id))
  const soldAt = new Map(live.map((s) => [s.id, s.createdAt]))
  const items = await db.saleItems.where('saleId').anyOf(live.map((s) => s.id)).toArray()

  const salesOf = new Map<number, Set<number>>()
  const out = new Map<number, ProductSales>()
  for (const it of items) {
    const s = out.get(it.productId) ?? { times: 0, units: 0, lastSoldAt: 0 }
    s.units += it.qty
    s.lastSoldAt = Math.max(s.lastSoldAt, soldAt.get(it.saleId) ?? 0)
    const set = salesOf.get(it.productId) ?? new Set<number>()
    set.add(it.saleId)
    salesOf.set(it.productId, set)
    s.times = set.size
    out.set(it.productId, s)
  }
  return out
}

/** Every product's fast/slow label, kept up to date as sales are made. Undefined while loading. */
export function useMovement(): { byProduct: Map<number, MovementInfo>; days: number } | undefined {
  const { movementDays } = useSettings()
  return useLiveQuery(async () => {
    const now = Date.now()
    const products = await db.products.toArray()
    return { byProduct: classify(products, await movementStats(movementDays, now), now, movementDays), days: movementDays }
  }, [movementDays])
}
