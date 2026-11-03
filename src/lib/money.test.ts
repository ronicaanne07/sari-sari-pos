import { describe, expect, it } from 'vitest'
import {
  formatPeso,
  formatWeight,
  gramsForAmount,
  parseGrams,
  priceForGrams,
  toCentavos,
} from './money'
import { addPack, addPiece, addWeight, cartTotal, removeLine, stepLine } from './cart'
import type { Product, ProductPack } from '../db/db'

describe('money', () => {
  it('converts pesos to integer centavos without float drift', () => {
    expect(toCentavos('12.50')).toBe(1250)
    expect(toCentavos(0.1 + 0.2)).toBe(30)
    expect(toCentavos('1,250')).toBe(125000)
    expect(toCentavos('abc')).toBeNull()
    expect(toCentavos('-5')).toBeNull()
  })

  it('formats pesos and weights', () => {
    expect(formatPeso(1250)).toBe('₱12.50')
    expect(formatPeso(-500)).toBe('-₱5.00')
    expect(formatWeight(750)).toBe('750 g')
    expect(formatWeight(1500)).toBe('1.5 kg')
    expect(formatWeight(25000)).toBe('25 kg')
  })

  it('parses weight input in grams and kilograms', () => {
    expect(parseGrams('750')).toBe(750)
    expect(parseGrams('750g')).toBe(750)
    expect(parseGrams('0.75kg')).toBe(750)
    expect(parseGrams('1,5 kg')).toBe(1500)
    expect(parseGrams('2', 'kg')).toBe(2000)
    expect(parseGrams('0')).toBeNull()
    expect(parseGrams('')).toBeNull()
    expect(parseGrams('five')).toBeNull()
  })

  it('prices by weight and works backwards from an amount', () => {
    // sugar at ₱80/kg
    expect(priceForGrams(8000, 750)).toBe(6000) // 750 g = ₱60
    expect(priceForGrams(8000, 250)).toBe(2000)
    // ₱20 worth of sugar at ₱80/kg = 250 g
    expect(gramsForAmount(8000, 2000)).toBe(250)
    // ₱10 worth of rice at ₱52/kg ≈ 192 g
    expect(gramsForAmount(5200, 1000)).toBe(192)
    expect(gramsForAmount(0, 1000)).toBe(0)
  })
})

const product = (over: Partial<Product> = {}): Product => ({
  id: 1,
  name: 'Egg',
  unitType: 'piece',
  cost: 800,
  price: 1000,
  stock: 10,
  lowStockAt: 0,
  favorite: false,
  archived: false,
  createdAt: 0,
  ...over,
})

describe('cart', () => {
  it('stacks pieces and steps up/down, removing at zero', () => {
    let cart = addPiece([], product())
    cart = addPiece(cart, product())
    expect(cart).toHaveLength(1)
    expect(cart[0].qty).toBe(2)
    expect(cartTotal(cart)).toBe(2000)
    cart = stepLine(cart, 'p:1', -1)
    expect(cart[0].qty).toBe(1)
    cart = stepLine(cart, 'p:1', -1)
    expect(cart).toHaveLength(0)
  })

  it('sells packs as whole multiples of the pack size', () => {
    const pack: ProductPack = { id: 7, productId: 1, name: 'Tray of 30', unitsPerPack: 30, packCost: 24000, packPrice: 29000 }
    let cart = addPack([], product(), pack)
    cart = addPack(cart, product(), pack)
    expect(cart[0].qty).toBe(60)
    expect(cart[0].lineTotal).toBe(58000)
    cart = stepLine(cart, 'k:7', -1)
    expect(cart[0].qty).toBe(30)
    expect(cart[0].lineTotal).toBe(29000)
  })

  it('keeps each weight entry as its own line with its exact total', () => {
    const sugar = product({ id: 2, name: 'Sugar', unitType: 'weight', price: 8000, cost: 7000 })
    let cart = addWeight([], sugar, 250, 2000)
    cart = addWeight(cart, sugar, 300, 2400)
    expect(cart).toHaveLength(2)
    expect(cartTotal(cart)).toBe(4400)
    cart = removeLine(cart, cart[0].key)
    expect(cart).toHaveLength(1)
    // weight lines have no +/- step
    expect(stepLine(cart, cart[0].key, +1)[0].qty).toBe(300)
  })
})
