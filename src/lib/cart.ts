import type { Product, ProductPack, UnitType } from '../db/db'

/**
 * A cart line. `qty` is always in stock units (pieces or grams) and `lineTotal` in centavos.
 * Piece and pack lines can be stepped with +/- (`step` is one click's worth);
 * weight lines are one-off entries and are removed rather than stepped.
 */
export interface CartLine {
  key: string
  productId: number
  packId?: number
  name: string
  unitType: UnitType
  qty: number
  lineTotal: number
  step?: { qty: number; total: number }
}

let weightSeq = 0

export function addPiece(cart: CartLine[], p: Product): CartLine[] {
  const key = `p:${p.id}`
  const existing = cart.find((l) => l.key === key)
  if (existing) return stepLine(cart, key, +1)
  return [
    ...cart,
    {
      key,
      productId: p.id,
      name: p.name,
      unitType: 'piece',
      qty: 1,
      lineTotal: p.price,
      step: { qty: 1, total: p.price },
    },
  ]
}

export function addPack(cart: CartLine[], p: Product, pack: ProductPack): CartLine[] {
  const key = `k:${pack.id}`
  const existing = cart.find((l) => l.key === key)
  if (existing) return stepLine(cart, key, +1)
  return [
    ...cart,
    {
      key,
      productId: p.id,
      packId: pack.id,
      name: `${p.name} (${pack.name})`,
      unitType: p.unitType,
      qty: pack.unitsPerPack,
      lineTotal: pack.packPrice,
      step: { qty: pack.unitsPerPack, total: pack.packPrice },
    },
  ]
}

/** `total` is passed in (not recomputed) so "₱20 worth" keeps its exact ₱20. */
export function addWeight(cart: CartLine[], p: Product, grams: number, total: number): CartLine[] {
  return [
    ...cart,
    {
      key: `w:${p.id}:${++weightSeq}`,
      productId: p.id,
      name: p.name,
      unitType: 'weight',
      qty: grams,
      lineTotal: total,
    },
  ]
}

/** +1 / -1 on a piece or pack line. Dropping to zero removes the line. */
export function stepLine(cart: CartLine[], key: string, delta: number): CartLine[] {
  return cart.flatMap((l) => {
    if (l.key !== key || !l.step) return [l]
    const count = Math.round(l.qty / l.step.qty) + delta
    if (count <= 0) return []
    return [{ ...l, qty: count * l.step.qty, lineTotal: count * l.step.total }]
  })
}

export function removeLine(cart: CartLine[], key: string): CartLine[] {
  return cart.filter((l) => l.key !== key)
}

export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((sum, l) => sum + l.lineTotal, 0)
}
