import type { Product } from '../db/db'

/**
 * Fast and slow movers, worked out from how OFTEN each product sold in the last N days.
 * "Times sold" counts sales (not pieces), so a sack of rice sold by the kilo and a candy sold by the
 * piece can be compared fairly. Voided sales do not count.
 *
 *  fast : among the top 20% of your products by times sold, and sold at least about once a week
 *  slow : in stock, on the shelf for the whole period, and sold once or never
 *  new  : added less than N days ago, so it is too early to judge (not flagged slow)
 */
export type Movement = 'fast' | 'slow' | 'new' | 'normal'

export const DAY_MS = 86_400_000
export const FAST_SHARE = 0.2

export interface ProductSales {
  times: number // number of sales that included the product
  units: number // pieces or grams sold in that time
  lastSoldAt: number // 0 when it did not sell in the period
}

export interface MovementInfo extends ProductSales {
  label: Movement
}

type Judged = Pick<Product, 'id' | 'createdAt' | 'stock' | 'archived'>

/** The least number of sales that can count as "fast", however quiet the shop is. */
export const minFastSales = (days: number) => Math.max(3, Math.round(days / 7))

export function classify(
  products: Judged[],
  stats: Map<number, ProductSales>,
  now: number,
  days: number,
): Map<number, MovementInfo> {
  const active = products.filter((p) => !p.archived)
  const timesOf = (id: number) => stats.get(id)?.times ?? 0

  const ranked = active.map((p) => timesOf(p.id)).sort((a, b) => b - a)
  const cutoff = ranked.length ? ranked[Math.max(0, Math.ceil(ranked.length * FAST_SHARE) - 1)] : 0
  const fastAt = Math.max(minFastSales(days), cutoff)

  const out = new Map<number, MovementInfo>()
  for (const p of active) {
    const s = stats.get(p.id) ?? { times: 0, units: 0, lastSoldAt: 0 }
    const onShelfLongEnough = now - p.createdAt >= days * DAY_MS
    let label: Movement = 'normal'
    if (s.times > 0 && s.times >= fastAt) label = 'fast'
    else if (!onShelfLongEnough) label = 'new'
    else if (s.times <= 1 && p.stock > 0) label = 'slow' // out of stock can't sell, so it can't be called slow
    out.set(p.id, { ...s, label })
  }
  return out
}
