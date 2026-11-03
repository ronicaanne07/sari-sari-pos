import type { UnitType } from '../db/db'
import { formatPeso, formatWeight, parseGrams } from './money'

/** Price shown to the cashier: "₱15.00" or "₱52.00/kg". */
export function formatPrice(centavos: number, unitType: UnitType): string {
  return formatPeso(centavos) + (unitType === 'weight' ? '/kg' : '')
}

/** Stock shown to the cashier: "48" pieces or "25 kg". */
export function formatStock(units: number, unitType: UnitType): string {
  return unitType === 'weight' ? formatWeight(units) : String(units)
}

/**
 * Reads a stock quantity typed by the owner and returns stock units.
 * Pieces: whole numbers. Weight: kilograms ("25", "0.5") unless a unit is typed ("500g").
 * An empty box means 0. Returns null for anything that is not a valid quantity.
 */
export function parseStock(text: string, unitType: UnitType): number | null {
  const t = text.trim()
  if (t === '') return 0
  if (unitType === 'piece') {
    const n = Number(t)
    return Number.isInteger(n) && n >= 0 ? n : null
  }
  if (Number(t.replace(',', '.')) === 0) return 0
  return parseGrams(t, 'kg')
}

/** Inverse of parseStock, for filling a form field. */
export function stockToInput(units: number, unitType: UnitType): string {
  return unitType === 'weight' ? String(units / 1000) : String(units)
}

/** Pesos for a form field: 5200 -> "52.00". */
export function pesoToInput(centavos: number): string {
  return (centavos / 100).toFixed(2)
}
