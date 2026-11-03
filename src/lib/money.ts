/**
 * Money is stored as integer centavos and weight as integer grams.
 * Never store pesos or kilograms as floats: 0.1 + 0.2 !== 0.3.
 */

/** "12.50" or 12.5 -> 1250. Returns null if the input is not a valid non-negative number. */
export function toCentavos(input: string | number): number | null {
  const n = typeof input === 'number' ? input : Number(input.trim().replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function formatPeso(centavos: number): string {
  const sign = centavos < 0 ? '-' : ''
  const abs = Math.abs(centavos) / 100
  return `${sign}₱${abs.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** 750 -> "750 g", 1500 -> "1.5 kg", 25000 -> "25 kg" */
export function formatWeight(grams: number): string {
  const sign = grams < 0 ? '-' : ''
  const abs = Math.abs(grams)
  if (abs < 1000) return `${sign}${abs} g`
  const kg = (abs / 1000).toFixed(3).replace(/\.?0+$/, '')
  return `${sign}${kg} kg`
}

/**
 * Accepts "750", "750g", "0.75kg", "1.5 kg", "1,5kg" (comma decimal).
 * A bare number is read as grams when `defaultUnit` is "g", kilograms when "kg".
 * Returns integer grams, or null when the input is not a positive weight.
 */
export function parseGrams(input: string, defaultUnit: 'g' | 'kg' = 'g'): number | null {
  const m = input
    .trim()
    .toLowerCase()
    .replace(',', '.')
    .match(/^(\d*\.?\d+)\s*(kg|kilo|kilos|g|gr|gram|grams)?$/)
  if (!m) return null
  const value = Number(m[1])
  const unit = m[2] ?? defaultUnit
  const grams = Math.round(unit.startsWith('k') ? value * 1000 : value)
  return grams > 0 ? grams : null
}

/** Price of `grams` of an item that costs `pricePerKg` centavos per kilogram. */
export function priceForGrams(pricePerKg: number, grams: number): number {
  return Math.round((pricePerKg * grams) / 1000)
}

/**
 * "₱20 worth of sugar": how many grams does the customer get for `amount` centavos?
 * Rounds to the nearest gram. The sale line keeps `amount` as its exact total.
 */
export function gramsForAmount(pricePerKg: number, amount: number): number {
  if (pricePerKg <= 0) return 0
  return Math.round((amount * 1000) / pricePerKg)
}
