import type { PayMethod, WalletProvider, WalletType } from '../db/db'
import { formatPeso, formatWeight } from './money'

/** 32 characters is the width of a 58 mm thermal receipt, and reads well in a chat message too. */
export const RECEIPT_WIDTH = 32
const W = RECEIPT_WIDTH

export interface ReceiptLine {
  text: string
  bold?: boolean
}

export interface Receipt {
  lines: ReceiptLine[]
  text: string
}

export interface ReceiptStore {
  storeName: string
  address: string
  footer: string
}

const PROVIDER: Record<WalletProvider, string> = { gcash: 'GCash', maya: 'Maya' }
const METHOD: Record<PayMethod, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', utang: 'Utang' }

/* ------------------------------------------------------------------ layout */

function wrap(text: string, indent = 0): string[] {
  const width = W - indent
  const out: string[] = []
  let cur = ''
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue
    let w = word
    while (w.length > width) {
      if (cur) out.push(cur)
      cur = ''
      out.push(w.slice(0, width))
      w = w.slice(width)
    }
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w
    else {
      out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  return out.map((l) => ' '.repeat(indent) + l)
}

function center(text: string): string {
  return ' '.repeat(Math.max(0, Math.floor((W - text.length) / 2))) + text
}

/** Left text and right text on one line; the left side is cut if they would collide. */
function row(left: string, right: string): string {
  const room = Math.max(W - right.length - 1, 0)
  const l = left.length > room ? left.slice(0, room) : left
  return l + ' '.repeat(Math.max(1, W - l.length - right.length)) + right
}

const rule = (): ReceiptLine => ({ text: '-'.repeat(W) })
const plain = (text: string): ReceiptLine => ({ text })
const bold = (text: string): ReceiptLine => ({ text, bold: true })

function centered(text: string, isBold = false): ReceiptLine[] {
  return text
    .split('\n')
    .flatMap((part) => wrap(part))
    .map((l) => ({ text: center(l), bold: isBold }))
}

function dateText(ms: number): string {
  return new Date(ms).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const pad = (id: number, prefix = '', n = 5) => `${prefix}${String(id).padStart(n, '0')}`

function header(store: ReceiptStore, title: string, id: string, createdAt: number): ReceiptLine[] {
  return [
    ...centered(store.storeName || 'Tindahan', true),
    ...centered(store.address),
    rule(),
    ...centered(title, true),
    plain(`No. ${id}`),
    plain(dateText(createdAt)),
    rule(),
  ]
}

function footer(store: ReceiptStore): ReceiptLine[] {
  return [rule(), ...centered(store.footer)]
}

function finish(lines: ReceiptLine[]): Receipt {
  return { lines, text: lines.map((l) => l.text).join('\n') }
}

/* ------------------------------------------------------------------- sales */

export interface ReceiptItem {
  name: string
  unitType: 'piece' | 'weight'
  qty: number // pieces or grams (negative on a void)
  lineTotal: number // centavos (negative on a void)
  packed: boolean // sold as a whole pack
}

export interface SaleReceiptInput {
  store: ReceiptStore
  saleId: number
  voidOf?: number
  createdAt: number
  method: PayMethod
  items: ReceiptItem[]
  total: number
  tendered?: number
  change?: number
  reference?: string
  customerName?: string
  utangBalance?: number
}

function itemDetail(it: ReceiptItem): string {
  const qty = Math.abs(it.qty)
  if (it.unitType === 'weight') return formatWeight(qty)
  if (!it.packed && qty > 0 && it.lineTotal % it.qty === 0) {
    return `${qty} x ${formatPeso(Math.abs(it.lineTotal / it.qty))}`
  }
  return `${qty} pcs`
}

export function buildSaleReceipt(r: SaleReceiptInput): Receipt {
  const isVoid = r.voidOf !== undefined
  const lines: ReceiptLine[] = [
    ...header(r.store, isVoid ? '*** VOID ***' : 'RECEIPT', pad(r.saleId), r.createdAt),
  ]
  if (isVoid) lines.push(plain(`Cancels receipt ${pad(r.voidOf!)}`), rule())

  for (const it of r.items) {
    for (const l of wrap(it.name)) lines.push(plain(l))
    lines.push(plain(row('  ' + itemDetail(it), formatPeso(it.lineTotal))))
  }

  lines.push(rule(), bold(row('TOTAL', formatPeso(r.total))))

  if (isVoid) {
    if (r.method === 'utang') lines.push(plain(row('Removed from utang', formatPeso(Math.abs(r.total)))))
    else lines.push(plain(row(`Refund (${METHOD[r.method]})`, formatPeso(Math.abs(r.total)))))
  } else if (r.method === 'cash') {
    if (r.tendered !== undefined) lines.push(plain(row('Cash', formatPeso(r.tendered))))
    lines.push(plain(row('Change', formatPeso(r.change ?? 0))))
  } else if (r.method === 'gcash' || r.method === 'maya') {
    lines.push(plain(row(`Paid by ${METHOD[r.method]}`, formatPeso(r.total))))
  } else {
    lines.push(plain(row('Charged to utang', formatPeso(r.total))))
  }

  if (r.reference) lines.push(plain(`Ref: ${r.reference}`))
  if (r.method === 'utang' && r.customerName) {
    lines.push(plain(`Customer: ${r.customerName}`))
    if (r.utangBalance !== undefined) lines.push(plain(row('Utang balance', formatPeso(r.utangBalance))))
  }

  return finish([...lines, ...footer(r.store)])
}

/* ------------------------------------------------------------ GCash / Maya */

export interface WalletReceiptInput {
  store: ReceiptStore
  id: number
  createdAt: number
  provider: WalletProvider
  type: WalletType
  amount: number
  fee: number
  reference?: string
}

export function buildWalletReceipt(r: WalletReceiptInput): Receipt {
  const name = PROVIDER[r.provider]
  const cashIn = r.type === 'cash_in'
  const lines: ReceiptLine[] = [
    ...header(r.store, `${name.toUpperCase()} ${cashIn ? 'CASH-IN' : 'CASH-OUT'}`, pad(r.id, 'W-'), r.createdAt),
    plain(row(cashIn ? `Sent to your ${name}` : 'Cash given to you', formatPeso(r.amount))),
    plain(row('Service fee', formatPeso(r.fee))),
    rule(),
    bold(row(cashIn ? 'TOTAL PAID (cash)' : `TOTAL SENT (${name})`, formatPeso(r.amount + r.fee))),
  ]
  if (r.reference) lines.push(plain(`Ref: ${r.reference}`))
  return finish([...lines, ...footer(r.store)])
}

/* ---------------------------------------------------------- utang payment */

export interface PaymentReceiptInput {
  store: ReceiptStore
  id: number
  createdAt: number
  customerName: string
  amount: number // positive centavos paid
  method: 'cash' | WalletProvider
  reference?: string
  balance: number
}

export function buildPaymentReceipt(r: PaymentReceiptInput): Receipt {
  const lines: ReceiptLine[] = [
    ...header(r.store, 'UTANG PAYMENT', pad(r.id, 'P-'), r.createdAt),
    plain(`Customer: ${r.customerName}`),
    plain(row(`Paid (${r.method === 'cash' ? 'Cash' : PROVIDER[r.method]})`, formatPeso(r.amount))),
  ]
  if (r.reference) lines.push(plain(`Ref: ${r.reference}`))
  lines.push(rule(), bold(row('Utang balance', formatPeso(r.balance))))
  return finish([...lines, ...footer(r.store)])
}
