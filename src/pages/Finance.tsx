import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { formatPeso, toCentavos } from '../lib/money'
import { PageHeader, btn, inputCls, useToast } from '../ui'

export function Finance() {
  const toast = useToast()
  const [mode, setMode] = useState<'purchase' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Utilities')
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [method, setMethod] = useState<'cash' | 'gcash' | 'maya' | 'bank' | 'other'>('cash')
  const purchases = useLiveQuery(() => db.purchases.orderBy('createdAt').reverse().limit(50).toArray(), []) ?? []
  const expenses = useLiveQuery(() => db.expenses.orderBy('createdAt').reverse().limit(50).toArray(), []) ?? []
  const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0,0,0,0)
  const expenseTotal = expenses.filter(x => x.createdAt >= thisMonth.getTime()).reduce((s,x) => s+x.amount, 0)
  const purchaseTotal = purchases.filter(x => x.createdAt >= thisMonth.getTime()).reduce((s,x) => s+x.totalCost, 0)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const cents = toCentavos(amount)
    if (cents === null || cents <= 0) { toast.show('Enter a valid amount', 'error'); return }
    await toast.run(async () => {
      if (mode === 'expense') {
        await db.expenses.add({ createdAt: Date.now(), category: category.trim() || 'Other', amount: cents, paymentMethod: method, note: note.trim() || undefined })
      } else {
        await db.purchases.add({ createdAt: Date.now(), supplier: supplier.trim() || undefined, totalCost: cents, note: note.trim() || undefined, items: [] })
      }
      setAmount(''); setNote(''); setSupplier('')
    }, mode === 'expense' ? 'Expense recorded' : 'Purchase recorded')
  }

  return <div className="pb-6">
    <PageHeader title="Purchases & Expenses" />
    <div className="grid grid-cols-2 gap-3 p-4">
      <div className="rounded-2xl border bg-white p-3"><div className="text-sm text-slate-500">Purchases this month</div><div className="text-xl font-bold">{formatPeso(purchaseTotal)}</div></div>
      <div className="rounded-2xl border bg-white p-3"><div className="text-sm text-slate-500">Expenses this month</div><div className="text-xl font-bold">{formatPeso(expenseTotal)}</div></div>
    </div>
    <form onSubmit={save} className="mx-4 space-y-3 rounded-2xl border bg-white p-4">
      <div className="grid grid-cols-2 gap-2"><button type="button" className={mode==='expense'?btn.primary:btn.secondary} onClick={()=>setMode('expense')}>Add expense</button><button type="button" className={mode==='purchase'?btn.primary:btn.secondary} onClick={()=>setMode('purchase')}>Record purchase</button></div>
      {mode==='expense' ? <><label className="block text-sm font-medium">Category<input className={inputCls} value={category} onChange={e=>setCategory(e.target.value)} placeholder="Utilities, salary, transport" /></label><label className="block text-sm font-medium">Payment method<select className={inputCls} value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option value="cash">Cash</option><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank">Bank</option><option value="other">Other</option></select></label></> : <label className="block text-sm font-medium">Supplier (optional)<input className={inputCls} value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="Supplier name" /></label>}
      <label className="block text-sm font-medium">Amount (₱)<input className={inputCls} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required /></label>
      <label className="block text-sm font-medium">Notes (optional)<input className={inputCls} value={note} onChange={e=>setNote(e.target.value)} placeholder="Details or receipt reference" /></label>
      <button className={`${btn.primary} w-full`} type="submit">Save {mode}</button>
    </form>
    <section className="p-4"><h2 className="mb-2 font-semibold">Recent expenses</h2>{expenses.length===0?<p className="text-sm text-slate-500">No expenses recorded.</p>:<ul className="divide-y rounded-xl border bg-white px-3">{expenses.map(x=><li key={x.id} className="flex justify-between gap-3 py-3"><div><div className="font-medium">{x.category}</div><div className="text-xs text-slate-500">{new Date(x.createdAt).toLocaleDateString()} · {x.note || x.paymentMethod}</div></div><strong>{formatPeso(x.amount)}</strong></li>)}</ul>}</section>
    <section className="px-4"><h2 className="mb-2 font-semibold">Recent purchases</h2>{purchases.length===0?<p className="text-sm text-slate-500">No purchases recorded.</p>:<ul className="divide-y rounded-xl border bg-white px-3">{purchases.map(x=><li key={x.id} className="flex justify-between gap-3 py-3"><div><div className="font-medium">{x.supplier || 'Purchase'}</div><div className="text-xs text-slate-500">{new Date(x.createdAt).toLocaleDateString()} · {x.note || 'Stock purchase total'}</div></div><strong>{formatPeso(x.totalCost)}</strong></li>)}</ul>}</section>
  </div>
}
