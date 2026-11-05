import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { exportBackup, importBackup, resetAllData } from './backup'

beforeEach(async () => {
  await resetAllData()
})

describe('purchases and expenses (Finance page)', () => {
  it('saves an expense and a purchase exactly as the Finance page does', async () => {
    const eid = await db.expenses.add({
      createdAt: Date.now(), category: 'Utilities', amount: 125000, paymentMethod: 'gcash', note: undefined,
    })
    const pid = await db.purchases.add({
      createdAt: Date.now(), supplier: 'Puregold', totalCost: 540000, note: undefined, items: [],
    })
    expect((await db.expenses.get(eid))!.amount).toBe(125000)
    expect((await db.purchases.get(pid))!.items).toEqual([])
  })

  it('lists the newest 50 first using the createdAt index', async () => {
    for (let i = 1; i <= 60; i++) {
      await db.expenses.add({ createdAt: i, category: 'Other', amount: i * 100, paymentMethod: 'cash' })
      await db.purchases.add({ createdAt: i, totalCost: i * 100, items: [] })
    }
    // the same queries Finance.tsx runs
    const expenses = await db.expenses.orderBy('createdAt').reverse().limit(50).toArray()
    const purchases = await db.purchases.orderBy('createdAt').reverse().limit(50).toArray()
    expect(expenses).toHaveLength(50)
    expect(expenses[0].createdAt).toBe(60)
    expect(expenses.at(-1)!.createdAt).toBe(11)
    expect(purchases[0].createdAt).toBe(60)

    // and the monthly totals it computes
    const sinceTen = expenses.filter((x) => x.createdAt >= 51).reduce((s, x) => s + x.amount, 0)
    expect(sinceTen).toBe((51 + 52 + 53 + 54 + 55 + 56 + 57 + 58 + 59 + 60) * 100)
  })

  it('is included in backups, and older backups without these tables still restore', async () => {
    await db.expenses.add({ createdAt: 1, category: 'Salary', amount: 500000, paymentMethod: 'cash' })
    await db.purchases.add({ createdAt: 2, supplier: 'Supplier A', totalCost: 100000, items: [] })
    const backup = JSON.parse(JSON.stringify(await exportBackup()))
    expect(backup.tables.expenses).toHaveLength(1)
    expect(backup.tables.purchases).toHaveLength(1)

    await resetAllData()
    await importBackup(backup)
    expect((await db.expenses.toArray())[0].category).toBe('Salary')
    expect((await db.purchases.toArray())[0].supplier).toBe('Supplier A')

    delete backup.tables.expenses
    delete backup.tables.purchases
    backup.version = 3
    await importBackup(backup)
    expect(await db.expenses.count()).toBe(0)
  })
})
