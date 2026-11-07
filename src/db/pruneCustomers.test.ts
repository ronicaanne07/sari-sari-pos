import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addCustomer, addManualCharge, pruneSettledCustomers, recordPayment } from './actions'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('pruneSettledCustomers', () => {
  it('removes paid-up customers, keeps debtors, keeps history', async () => {
    const paid = await addCustomer('Paid')
    const owes = await addCustomer('Owes')
    await addManualCharge(paid, 5000)
    await addManualCharge(owes, 5000)
    await recordPayment(paid, 5000)
    expect(await pruneSettledCustomers()).toBe(1)
    expect((await db.customers.toArray()).map((c) => c.name)).toEqual(['Owes'])
    expect(await db.creditEntries.where('customerId').equals(paid).count()).toBe(2)
    expect((await db.tombstones.toArray()).filter((t) => t.tbl === 'customers').length).toBe(1)
  })
  it('gives a brand-new customer a day before removing them', async () => {
    const id = await addCustomer('New')
    expect(await pruneSettledCustomers()).toBe(0)
    expect(await pruneSettledCustomers(Date.now() + 25 * 3600_000)).toBe(1)
    expect(await db.customers.get(id)).toBeUndefined()
  })
})
