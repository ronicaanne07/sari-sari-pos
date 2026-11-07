import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CreditEntry, type Customer } from '../db/db'
import { addCustomer, addManualCharge, pruneSettledCustomers, recordPayment } from '../db/actions'
import { useSettings } from '../db/settings'
import { useAuth } from '../auth/AuthProvider'
import { formatPeso, toCentavos } from '../lib/money'
import { normalizeReference } from '../lib/wallet'
import { ReferenceField, useReferenceStatus } from '../components/ReferenceField'
import { useReceipt } from '../components/ReceiptSheet'
import { Field, PageHeader, Segmented, Sheet, btn, formatDateTime, inputCls, useToast } from '../ui'

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
  const { autoRemovePaid } = useSettings()
  const { role, mode } = useAuth()
  // Only the owner's phone (or a store without accounts) cleans up: cashier phones cannot delete shared data.
  const canPrune = autoRemovePaid && (mode !== 'cloud' || role === 'owner')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  // Clean up after the customer sheet is closed, so a fully paid customer does not vanish mid-receipt.
  useEffect(() => {
    if (!canPrune || !rows || openId !== null) return
    if (rows.some((r) => r.balance === 0)) void pruneSettledCustomers()
  }, [canPrune, rows, openId])

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
  const { showReceipt } = useReceipt()
  const entries = useLiveQuery(
    () => db.creditEntries.where('customerId').equals(customer.id).reverse().sortBy('createdAt'),
    [customer.id],
  )
  const [mode, setMode] = useState<'payment' | 'charge'>('payment')
  const [payMethod, setPayMethod] = useState<'cash' | 'gcash' | 'maya'>('cash')
  const [amountText, setAmountText] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const amount = toCentavos(amountText)
  const online = mode === 'payment' && payMethod !== 'cash' ? payMethod : null
  const refStatus = useReferenceStatus(online, reference)
  const canSubmit = !!amount && (!online || refStatus === 'ok')

  async function submit() {
    if (!amount) return
    if (mode === 'charge') {
      const res = await toast.run(() => addManualCharge(customer.id, amount, note), 'Utang added')
      if (res.ok) {
        setAmountText('')
        setNote('')
      }
      return
    }
    const res = await toast.run(async () => {
      await recordPayment(customer.id, amount, {
        method: payMethod,
        reference: online ? normalizeReference(reference) : undefined,
        note,
      })
      // the payment row that was just saved: newest credit entry of this customer
      const saved = (await db.creditEntries.where('customerId').equals(customer.id).sortBy('createdAt')).at(-1)
      return saved?.id
    })
    if (!res.ok) return
    setAmountText('')
    setReference('')
    setNote('')
    const entryId = res.value
    toast.show('Payment recorded', 'ok', entryId ? { label: 'Receipt', onClick: () => showReceipt({ kind: 'payment', id: entryId }) } : undefined)
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
        {mode === 'payment' && (
          <Segmented
            value={payMethod}
            onChange={setPayMethod}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'gcash', label: 'GCash' },
              { value: 'maya', label: 'Maya' },
            ]}
          />
        )}
        {online && <ReferenceField provider={online} value={reference} onChange={setReference} status={refStatus} />}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls} aria-label="Note" />
        <button className={`${btn.primary} w-full`} disabled={!canSubmit} onClick={submit}>
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
                  {e.kind === 'payment' && e.method && e.method !== 'cash'
                    ? ` · ${e.method === 'gcash' ? 'GCash' : 'Maya'} ref ${e.reference ?? ''}`
                    : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
                {e.kind === 'payment' && (
                  <button className="ml-2 text-xs font-semibold text-brand-700 underline" onClick={() => showReceipt({ kind: 'payment', id: e.id })}>
                    Receipt
                  </button>
                )}
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
