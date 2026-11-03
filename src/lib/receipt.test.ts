import { describe, expect, it } from 'vitest'
import {
  RECEIPT_WIDTH,
  buildPaymentReceipt,
  buildSaleReceipt,
  buildWalletReceipt,
  type Receipt,
  type ReceiptStore,
} from './receipt'
import { barcodeKey, findByBarcode } from './barcode'

const store: ReceiptStore = {
  storeName: 'Tindahan ni Aling Nena',
  address: 'Purok 3, Brgy. Maligaya\n0917 123 4567',
  footer: 'Salamat po! Balik kayo.',
}

const T = new Date('2026-11-03T10:30:00').getTime()

function expectFits(r: Receipt) {
  for (const l of r.lines) expect(l.text.length).toBeLessThanOrEqual(RECEIPT_WIDTH)
}

describe('sale receipt', () => {
  const base = {
    store,
    saleId: 12,
    createdAt: T,
    items: [
      { name: 'Pancit Canton', unitType: 'piece' as const, qty: 2, lineTotal: 3000, packed: false },
      { name: 'Asukal (sugar)', unitType: 'weight' as const, qty: 250, lineTotal: 2000, packed: false },
      { name: 'Itlog (egg) (Tray of 30)', unitType: 'piece' as const, qty: 30, lineTotal: 29000, packed: true },
    ],
    total: 34000,
  }

  it('lists items with quantities, weights and pack sizes, and a total', () => {
    const r = buildSaleReceipt({ ...base, method: 'cash', tendered: 50000, change: 16000 })
    expect(r.text).toContain('Tindahan ni Aling Nena')
    expect(r.text).toContain('No. 00012')
    expect(r.text).toMatch(/2 x ₱15\.00\s+₱30\.00/)
    expect(r.text).toMatch(/250 g\s+₱20\.00/)
    expect(r.text).toMatch(/30 pcs\s+₱290\.00/)
    expect(r.text).toMatch(/TOTAL\s+₱340\.00/)
    expect(r.text).toMatch(/Cash\s+₱500\.00/)
    expect(r.text).toMatch(/Change\s+₱160\.00/)
    expect(r.text).toContain('Salamat po!')
    expectFits(r)
  })

  it('prints the reference number for GCash and Maya', () => {
    const r = buildSaleReceipt({ ...base, method: 'gcash', reference: '5034112887' })
    expect(r.text).toMatch(/Paid by GCash\s+₱340\.00/)
    expect(r.text).toContain('Ref: 5034112887')
    expect(r.text).not.toContain('Change')
    expectFits(r)
  })

  it('shows the customer and balance for utang', () => {
    const r = buildSaleReceipt({ ...base, method: 'utang', customerName: 'Aling Nena', utangBalance: 51000 })
    expect(r.text).toMatch(/Charged to utang\s+₱340\.00/)
    expect(r.text).toContain('Customer: Aling Nena')
    expect(r.text).toMatch(/Utang balance\s+₱510\.00/)
  })

  it('marks a void and shows negative amounts', () => {
    const r = buildSaleReceipt({
      store,
      saleId: 13,
      voidOf: 12,
      createdAt: T,
      method: 'cash',
      items: [{ name: 'Pancit Canton', unitType: 'piece', qty: -2, lineTotal: -3000, packed: false }],
      total: -3000,
    })
    expect(r.text).toContain('*** VOID ***')
    expect(r.text).toContain('Cancels receipt 00012')
    expect(r.text).toMatch(/2 x ₱15\.00\s+-₱30\.00/)
    expect(r.text).toMatch(/Refund \(Cash\)\s+₱30\.00/)
  })

  it('wraps long names and long store names without exceeding the width', () => {
    const r = buildSaleReceipt({
      ...base,
      store: { ...store, storeName: 'Napakahabang Pangalan ng Tindahan sa Barangay Maligaya Norte' },
      method: 'cash',
      items: [
        {
          name: 'Extra Long Product Name With Many Words And Pack Size (Case of 48 pieces)',
          unitType: 'piece',
          qty: 1,
          lineTotal: 123456,
          packed: true,
        },
      ],
      total: 123456,
    })
    expectFits(r)
    expect(r.text).toContain('₱1,234.56')
  })

  it('keeps the text and the drawn lines identical', () => {
    const r = buildSaleReceipt({ ...base, method: 'cash', tendered: 34000, change: 0 })
    expect(r.text.split('\n')).toEqual(r.lines.map((l) => l.text))
    expect(r.lines.some((l) => l.bold)).toBe(true)
  })
})

describe('wallet receipt', () => {
  it('shows what the customer paid for a cash-in', () => {
    const r = buildWalletReceipt({
      store, id: 5, createdAt: T, provider: 'gcash', type: 'cash_in', amount: 50000, fee: 1000, reference: 'CI0001',
    })
    expect(r.text).toContain('GCASH CASH-IN')
    expect(r.text).toContain('No. W-00005')
    expect(r.text).toMatch(/Sent to your GCash\s+₱500\.00/)
    expect(r.text).toMatch(/Service fee\s+₱10\.00/)
    expect(r.text).toMatch(/TOTAL PAID \(cash\)\s+₱510\.00/)
    expect(r.text).toContain('Ref: CI0001')
    expectFits(r)
  })

  it('shows cash given and total sent for a cash-out', () => {
    const r = buildWalletReceipt({
      store, id: 6, createdAt: T, provider: 'maya', type: 'cash_out', amount: 100000, fee: 2000, reference: 'CO0001',
    })
    expect(r.text).toContain('MAYA CASH-OUT')
    expect(r.text).toMatch(/Cash given to you\s+₱1,000\.00/)
    expect(r.text).toMatch(/TOTAL SENT \(Maya\)\s+₱1,020\.00/)
    expectFits(r)
  })
})

describe('utang payment receipt', () => {
  it('shows the amount, method, reference and new balance', () => {
    const r = buildPaymentReceipt({
      store, id: 9, createdAt: T, customerName: 'Aling Nena', amount: 20000, method: 'maya', reference: 'PAY9999', balance: 31000,
    })
    expect(r.text).toContain('UTANG PAYMENT')
    expect(r.text).toContain('Customer: Aling Nena')
    expect(r.text).toMatch(/Paid \(Maya\)\s+₱200\.00/)
    expect(r.text).toContain('Ref: PAY9999')
    expect(r.text).toMatch(/Utang balance\s+₱310\.00/)
    expectFits(r)
  })
})

describe('barcode matching', () => {
  it('treats a UPC-A and its zero-padded EAN-13 as the same code', () => {
    expect(barcodeKey('012345678905')).toBe(barcodeKey('0012345678905'))
    expect(barcodeKey(' 4800016644801 ')).toBe('4800016644801')
  })

  it('does not strip zeros from short or non-numeric codes', () => {
    expect(barcodeKey('0012')).toBe('0012')
    expect(barcodeKey('AB-0012')).toBe('AB-0012')
  })

  it('finds a product by scanned code', () => {
    const items = [{ barcode: '012345678905', n: 'a' }, { barcode: undefined, n: 'b' }, { barcode: '4800016644801', n: 'c' }]
    expect(findByBarcode(items, '0012345678905')?.n).toBe('a')
    expect(findByBarcode(items, '4800016644801')?.n).toBe('c')
    expect(findByBarcode(items, '999')).toBeUndefined()
    expect(findByBarcode(items, '  ')).toBeUndefined()
  })
})
