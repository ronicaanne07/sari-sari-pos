import { describe, expect, it } from 'vitest'
import { formatPrice, formatStock, parseStock, pesoToInput, stockToInput } from './units'

describe('units', () => {
  it('parses piece stock as whole numbers', () => {
    expect(parseStock('48', 'piece')).toBe(48)
    expect(parseStock('', 'piece')).toBe(0)
    expect(parseStock('2.5', 'piece')).toBeNull()
    expect(parseStock('-1', 'piece')).toBeNull()
  })

  it('parses weight stock as kilograms by default', () => {
    expect(parseStock('25', 'weight')).toBe(25000)
    expect(parseStock('0.5', 'weight')).toBe(500)
    expect(parseStock('500g', 'weight')).toBe(500)
    expect(parseStock('0', 'weight')).toBe(0)
    expect(parseStock('', 'weight')).toBe(0)
    expect(parseStock('abc', 'weight')).toBeNull()
  })

  it('formats prices and stock', () => {
    expect(formatPrice(1500, 'piece')).toBe('₱15.00')
    expect(formatPrice(5200, 'weight')).toBe('₱52.00/kg')
    expect(formatStock(48, 'piece')).toBe('48')
    expect(formatStock(2500, 'weight')).toBe('2.5 kg')
  })

  it('round-trips form fields', () => {
    expect(stockToInput(25000, 'weight')).toBe('25')
    expect(parseStock(stockToInput(1250, 'weight'), 'weight')).toBe(1250)
    expect(pesoToInput(5200)).toBe('52.00')
  })
})
