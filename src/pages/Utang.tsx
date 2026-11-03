import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CreditEntry, type Customer } from '../db/db'
import { addCustomer, addManualCharge, recordPayment } from '../db/actions'
import { formatPeso, toCentavos } from '../lib/money'
import { Field, PageHeader, Sheet, btn, formatDateTime, inputCls, useToast } from '../ui'

interface Row {
  customer: Customer
  balance: number
}

export function Utang() {
  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const [customers, entries] = await Promise.all([db.customers.toArray(), db.creditEntries.toArray()])
    const balances = new Map<number, number>()
    for (const e of entries) balances.set(e.customerId, (balances.get(e.customerId) ?? 0) + e.amount)
    return customers.map((customer) => ({ customer, balance: balances.get(customer.id) ?? 0 }))
  }, [])
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const q = query.trim().toLowerCase()
  const list = (rows ?? [])
    .filter((r) => !q || r.customer.name.toLowerCase().includes(q))
    .sort((a, b) => b.balance - a.balance || a.customer.name.localeCompare(b.customer.name))
  const totalOwed = (rows ?? []).reduce((s, r) => s + Math.max(r.balance, 0), 0)
  const open = rows?.find((r) => r.customer.id === openId)

  return (
    <div>
      <PageHeader
        title="Utang"
        right={
          <button className={`${btn.primary} py-2`} onClick={() => setAdding(true)}>
            + Customer
          </button>
        }
      />
      <div className="space-y-3 px-4 pt-3">
        <div className="rounded-2xl bg-brand-50 p-4 text-center">
          <div className="text-sm text-slate-600">Total utang owed to you</div>
          <div className="text-3xl font-bold text-brand-800">{formatPeso(totalOwed)}</div>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customers"
          className={inputCls}
          aria-label="Search customers"
        />
      </div>

      {!rows ? (
        <p className="p-6 text-center text-slate-500">Loading…</p>
      ) : list.length === 0 ? (
        <p className="p-6 text-center text-slate-500">
          {rows.length === 0 ? 'No customers yet. Add one, or choose Utang when selling.' : 'No match.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 px-4 py-2">
          {list.map(({ customer, balance }) => (
            <li key={customer.id}>
              <button className="flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => setOpenId(customer.id)}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{customer.name}</span>
                  {customer.phone && <span className="text-sm text-slate-500">{customer.phone}</span>}
                </span>
                <span className={`font-bold ${balance > 0 ? 'text-red-600' : 'text-slate-400'}`}>{formatPeso(balance)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && <NewCustomerSheet onClose={() => setAdding(false)} />}
      {open && <CustomerSheet customer={open.customer} balance={open.balance} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function NewCustomerSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  async function save() {
    const res = await toast.run(() => addCustomer(name, phone), 'Customer added')
    if (res.ok) onClose()
  }

  return (
    <Sheet
      title="New customer"
      onClose={onClose}
      footer={
        <button className={`${btn.primary} w-full`} disabled={!name.trim()} onClick={save}>
          Save
        </button>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Phone (optional)">
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </Field>
      </div>
    </Sheet>
  )
}

const KIND_LABEL: Record<CreditEntry['kind'], string> = {
  charge: 'Utang',
  payment: 'Payment',
  void: 'Sale voided',
}

function CustomerSheet({ customer, balance, onClose }: { customer: Customer; balance: number; onClose: () => void }) {
  const toast = useToast()
  const entries = useLiveQuery(
    () => db.creditEntries.where('customerId').equals(customer.id).reverse().sortBy('createdAt'),
    [customer.id],
  )
  const [mode, setMode] = useState<'payment' | 'charge'>('payment')
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const amount = toCentavos(amountText)

  async function submit() {
    if (!amount) return
    const res = await toast.run(
      () => (mode === 'payment' ? recordPayment(customer.id, amount, note) : addManualCharge(customer.id, amount, note)),
      mode === 'payment' ? 'Payment recorded' : 'Utang added',
    )
    if (res.ok) {
      setAmountText('')
      setNote('')
    }
  }

  return (
    <Sheet title={customer.name} onClose={onClose}>
      <div className="mb-3 rounded-2xl bg-brand-50 p-4 text-center">
        <div className="text-sm text-slate-600">Balance</div>
        <div className={`text-3xl font-bold ${balance > 0 ? 'text-red-600' : 'text-brand-800'}`}>{formatPeso(balance)}</div>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 p-3">
        <div className="flex gap-2">
          <button className={mode === 'payment' ? btn.primary : btn.secondary} onClick={() => setMode('payment')}>
            Receive payment
          </button>
          <button className={mode === 'charge' ? btn.primary : btn.secondary} onClick={() => setMode('charge')}>
            Add utang
          </button>
        </div>
        <input
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="Amount ₱"
          className={inputCls}
          aria-label="Amount"
        />
        {mode === 'payment' && balance > 0 && (
          <button type="button" className={btn.chip} onClick={() => setAmountText(String(balance / 100))}>
            Pay in full ({formatPeso(balance)})
          </button>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls} aria-label="Note" />
        <button className={`${btn.primary} w-full`} disabled={!amount} onClick={submit}>
          {mode === 'payment' ? 'Save payment' : 'Save utang'}
        </button>
      </div>

      <h3 className="mb-1 mt-4 font-semibold">History</h3>
      {!entries || entries.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="block font-medium">{KIND_LABEL[e.kind]}</span>
                <span className="text-slate-500">
                  {formatDateTime(e.createdAt)}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
              </span>
              <span className={`font-semibold ${e.amount > 0 ? 'text-red-600' : 'text-brand-700'}`}>
                {e.amount > 0 ? '+' : ''}
                {formatPeso(e.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
