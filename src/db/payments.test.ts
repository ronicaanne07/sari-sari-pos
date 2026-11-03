import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  addCustomer,
  checkout,
  createProduct,
  createWalletTransaction,
  dayRange,
  recordPayment,
  summaryBetween,
  voidSale,
  voidWalletTransaction,
} from './actions'
import { exportBackup, importBackup, resetAllData } from './backup'
import { DEFAULT_SETTINGS, getSettings, saveSettings } from './settings'
import { addPiece } from '../lib/cart'
import { normalizeReference, suggestFee, walletCashEffect, walletFloatEffect } from '../lib/wallet'

beforeEach(async () => {
  await resetAllData()
})

async function egg() {
  const id = await createProduct({ name: 'Egg', unitType: 'piece', cost: 800, price: 1000, stock: 30 })
  return (await db.products.get(id))!
}

describe('wallet maths', () => {
  it('works out drawer and wallet effects for cash-in and cash-out', () => {
    // customer sends ₱500 to a number: pays ₱500 + ₱10 fee in cash, your wallet drops ₱500
    const cashIn = { type: 'cash_in' as const, amount: 50000, fee: 1000 }
    expect(walletCashEffect(cashIn)).toBe(51000)
    expect(walletFloatEffect(cashIn)).toBe(-50000)
    // customer cashes out ₱1,000: you hand over ₱1,000, they send ₱1,000 + ₱20 fee
    const cashOut = { type: 'cash_out' as const, amount: 100000, fee: 2000 }
    expect(walletCashEffect(cashOut)).toBe(-100000)
    expect(walletFloatEffect(cashOut)).toBe(102000)
    // a void is the same transaction negated, so it cancels out exactly
    const voidRow = { ...cashOut, amount: -100000, fee: -2000 }
    expect(walletCashEffect(voidRow)).toBe(100000)
  })

  it('suggests a fee: percentage rounded up to a whole peso with a minimum', () => {
    expect(suggestFee(50000, 2, 500)).toBe(1000) // 2% of ₱500 = ₱10
    expect(suggestFee(10000, 2, 500)).toBe(500) // 2% of ₱100 = ₱2, minimum ₱5
    expect(suggestFee(75000, 2, 500)).toBe(1500) // 2% of ₱750 = ₱15
    expect(suggestFee(33300, 2, 500)).toBe(700) // ₱6.66 rounds up to ₱7
    expect(suggestFee(0, 2, 500)).toBe(0)
  })

  it('normalises references', () => {
    expect(normalizeReference(' 5034 112 887 ')).toBe('5034112887')
    expect(normalizeReference('ab12cd')).toBe('AB12CD')
    expect(normalizeReference('   ')).toBeUndefined()
    expect(normalizeReference(undefined)).toBeUndefined()
  })
})

describe('online payment references', () => {
  it('requires a reference for GCash and Maya sales and stores it normalised', async () => {
    const p = await egg()
    await expect(checkout(addPiece([], p), { method: 'gcash' })).rejects.toThrow(/Enter the reference/)
    await expect(checkout(addPiece([], p), { method: 'gcash', reference: '12' })).rejects.toThrow(/too short/)
    const sale = await checkout(addPiece([], p), { method: 'gcash', reference: ' 5034 112 887 ' })
    expect(sale.reference).toBe('5034112887')
    expect((await db.sales.get(sale.id))!.reference).toBe('5034112887')
    // nothing was saved by the failed attempts
    expect(await db.sales.count()).toBe(1)
    expect((await db.products.get(p.id))!.stock).toBe(29)
  })

  it('rejects a reference that was already used, in any spelling', async () => {
    const p = await egg()
    await checkout(addPiece([], p), { method: 'gcash', reference: 'ABC12345' })
    await expect(
      checkout(addPiece([], p), { method: 'gcash', reference: 'abc 12345' }),
    ).rejects.toThrow(/already used/)
    expect((await db.products.get(p.id))!.stock).toBe(29)
  })

  it('keeps providers separate and ignores references for cash', async () => {
    const p = await egg()
    await checkout(addPiece([], p), { method: 'gcash', reference: 'SAME1234' })
    await checkout(addPiece([], p), { method: 'maya', reference: 'SAME1234' }) // different provider: fine
    const cash = await checkout(addPiece([], p), { method: 'cash', reference: 'SAME1234' })
    expect(cash.reference).toBeUndefined()
  })

  it('still blocks reuse after the original sale is voided (the money arrived once)', async () => {
    const p = await egg()
    const sale = await checkout(addPiece([], p), { method: 'gcash', reference: 'VOID1234' })
    await voidSale(sale.id)
    await expect(
      checkout(addPiece([], p), { method: 'gcash', reference: 'VOID1234' }),
    ).rejects.toThrow(/already used/)
  })

  it('accepts online utang payments with a reference and blocks reuse across features', async () => {
    const p = await egg()
    const nena = await addCustomer('Aling Nena')
    await checkout(addPiece(addPiece(addPiece([], p), p), p), { method: 'utang', customerId: nena }) // ₱30

    await expect(recordPayment(nena, 1000, { method: 'gcash' })).rejects.toThrow(/Enter the reference/)
    await recordPayment(nena, 1000, { method: 'gcash', reference: 'PAY12345' })
    // same reference on a sale is now refused
    await expect(
      checkout(addPiece([], p), { method: 'gcash', reference: 'pay12345' }),
    ).rejects.toThrow(/already used/)
    // and on a wallet transaction too
    await expect(
      createWalletTransaction({ provider: 'gcash', type: 'cash_in', amount: 10000, fee: 500, reference: 'PAY12345' }),
    ).rejects.toThrow(/already used/)

    const entry = (await db.creditEntries.toArray()).find((e) => e.kind === 'payment')!
    expect(entry.method).toBe('gcash')
    expect(entry.reference).toBe('PAY12345')
  })
})

describe('wallet transactions', () => {
  it('saves a transaction, blocks duplicate references and voids exactly once', async () => {
    const tx = await createWalletTransaction({
      provider: 'gcash', type: 'cash_in', amount: 50000, fee: 1000, reference: 'CI-0001', note: 'Mang Jose',
    })
    expect(tx.reference).toBe('CI-0001')
    await expect(
      createWalletTransaction({ provider: 'gcash', type: 'cash_out', amount: 20000, fee: 500, reference: 'ci-0001' }),
    ).rejects.toThrow(/already used/)
    await expect(
      createWalletTransaction({ provider: 'maya', type: 'cash_in', amount: 0, fee: 0, reference: 'ZZ-0001' }),
    ).rejects.toThrow(/Amount/)

    await voidWalletTransaction(tx.id)
    const voidRow = (await db.walletTransactions.where('voidOf').equals(tx.id).first())!
    expect(voidRow.amount).toBe(-50000)
    expect(voidRow.fee).toBe(-1000)
    expect((await db.walletTransactions.get(tx.id))!.amount).toBe(50000) // original untouched
    await expect(voidWalletTransaction(tx.id)).rejects.toThrow(/already voided/)
    await expect(voidWalletTransaction(voidRow.id)).rejects.toThrow(/Only transactions/)
  })
})

describe('summary with wallet and online payments', () => {
  it('adds fees to profit and wallet cash to the drawer, and nets out voids', async () => {
    const p = await egg()
    const nena = await addCustomer('Aling Nena')
    const today = () => dayRange(new Date())

    await checkout(addPiece([], p), { method: 'cash' }) // +1000 cash, profit 200
    await checkout(addPiece([], p), { method: 'gcash', reference: 'SALE1234' }) // not cash, profit 200
    await checkout(addPiece(addPiece([], p), p), { method: 'utang', customerId: nena }) // ₱20 utang, profit 400
    await recordPayment(nena, 500) // cash payment
    await recordPayment(nena, 700, { method: 'maya', reference: 'MAYA1234' }) // online payment: not in drawer

    const cashIn = await createWalletTransaction({
      provider: 'gcash', type: 'cash_in', amount: 50000, fee: 1000, reference: 'CI-0001',
    }) // drawer +51000
    await createWalletTransaction({
      provider: 'maya', type: 'cash_out', amount: 100000, fee: 2000, reference: 'CO-0001',
    }) // drawer -100000
    const mistake = await createWalletTransaction({
      provider: 'gcash', type: 'cash_in', amount: 30000, fee: 600, reference: 'CI-0002',
    })
    await voidWalletTransaction(mistake.id) // cancels out

    const [start, end] = today()
    const s = await summaryBetween(start, end)
    expect(s.net).toBe(4000)
    expect(s.utangCollected).toBe(1200)
    expect(s.utangCollectedCash).toBe(500)
    expect(s.walletFees).toBe(3000) // 1000 + 2000, voided one nets to 0
    expect(s.walletCount).toBe(2)
    expect(s.walletCashEffect).toBe(51000 - 100000)
    // drawer: cash sale 1000 + cash utang payment 500 + wallet (-49000)
    expect(s.cashCollected).toBe(1000 + 500 - 49000)
    // profit: 4 eggs x 200 + fees 3000
    expect(s.profit).toBe(800 + 3000)
    expect(cashIn.id).toBeGreaterThan(0)
  })
})

describe('settings', () => {
  it('returns defaults, saves changes and keeps the rest', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
    await saveSettings({ storeName: 'Tindahan ni Nena', autoReceipt: true })
    const s = await getSettings()
    expect(s.storeName).toBe('Tindahan ni Nena')
    expect(s.autoReceipt).toBe(true)
    expect(s.footer).toBe(DEFAULT_SETTINGS.footer)
  })
})

describe('backup with the new tables', () => {
  it('round-trips wallet transactions and settings', async () => {
    await saveSettings({ storeName: 'Backup Store' })
    const tx = await createWalletTransaction({
      provider: 'gcash', type: 'cash_out', amount: 20000, fee: 500, reference: 'BK-0001',
    })
    const backup = JSON.parse(JSON.stringify(await exportBackup()))
    expect(backup.version).toBe(2)
    await resetAllData()
    await importBackup(backup)
    expect((await db.walletTransactions.get(tx.id))!.reference).toBe('BK-0001')
    expect((await getSettings()).storeName).toBe('Backup Store')
    // duplicates are still caught after a restore
    await expect(
      createWalletTransaction({ provider: 'gcash', type: 'cash_in', amount: 10000, fee: 500, reference: 'BK-0001' }),
    ).rejects.toThrow(/already used/)
  })

  it('still restores a version 1 backup that has no wallet or settings tables', async () => {
    const p = await egg()
    const full = JSON.parse(JSON.stringify(await exportBackup()))
    delete full.tables.walletTransactions
    delete full.tables.settings
    full.version = 1
    await resetAllData()
    await importBackup(full)
    expect(await db.products.get(p.id)).toBeTruthy()
    expect(await db.walletTransactions.count()).toBe(0)
    expect((await getSettings()).storeName).toBe(DEFAULT_SETTINGS.storeName)
  })
})
