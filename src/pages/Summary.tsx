import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PayMethod } from '../db/db'
import { dayRange, lowStockProducts, summaryBetween, voidSale } from '../db/actions'
import { exportBackup, importBackup, resetAllData } from '../db/backup'
import { seedSampleProducts } from '../db/seed'
import { useAuth } from '../auth/AuthProvider'
import { beep, prepareBeep } from '../lib/beep'
import { useMovement } from '../db/movement'
import type { Product, Sale } from '../db/db'
import {
  downloadCloudBackup,
  isStorePhone,
  lastCloudBackup,
  setStorePhone,
  uploadCloudBackup,
} from '../db/cloud'
import { formatPeso, toCentavos } from '../lib/money'
import { formatStock, pesoToInput } from '../lib/units'
import { saveSettings, useSettings } from '../db/settings'
import { useReceipt } from '../components/ReceiptSheet'
import { Field, PageHeader, Sheet, btn, formatDateTime, inputCls, useToast } from '../ui'

const pad = (n: number) => String(n).padStart(2, '0')
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function fromDateInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null
}
const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

const PAGE = 10

type SaleRow = { sale: Sale; voided: boolean; names: string }

/**
 * One tidy line per sale. Tap a line for its receipt and void buttons. Shows the latest 10, and a filter
 * by payment method, so a busy day stays readable. Everything is still there under "Show more".
 */
function TransactionList({
  sales,
  isToday,
  onReceipt,
  onVoid,
}: {
  sales: SaleRow[]
  isToday: boolean
  onReceipt: (saleId: number) => void
  onVoid: (saleId: number) => void
}) {
  const [filter, setFilter] = useState<'all' | PayMethod>('all')
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState<number | null>(null)

  const rows = sales.filter((r) => filter === 'all' || r.sale.method === filter)
  const visible = rows.slice(0, shown)
  const count = sales.filter((r) => r.sale.kind === 'sale').length

  return (
    <>
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="font-semibold">Transactions{count ? ` (${count})` : ''}</h3>
        {rows.length > PAGE && shown > PAGE && (
          <button className="text-sm text-slate-500 underline" onClick={() => setShown(PAGE)}>
            Show fewer
          </button>
        )}
      </div>

      {sales.length === 0 ? (
        <p className="text-sm text-slate-500">{isToday ? 'No sales yet today.' : 'No sales on this day.'}</p>
      ) : (
        <>
          <div role="group" aria-label="Filter by payment" className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {(['all', 'cash', 'gcash', 'maya', 'utang'] as const).map((m) => (
              <button
                key={m}
                className={`shrink-0 rounded-full border px-3 py-1 text-sm font-medium ${
                  filter === m ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'
                }`}
                onClick={() => {
                  setFilter(m)
                  setShown(PAGE)
                  setOpen(null)
                }}
              >
                {m === 'all' ? 'All' : METHOD_LABEL[m]}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No {filter === 'all' ? '' : METHOD_LABEL[filter] + ' '}sales on this day.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {visible.map(({ sale, voided, names }) => {
                const expanded = open === sale.id
                return (
                  <li key={sale.id}>
                    <button
                      className="flex w-full items-center gap-3 px-3 py-2 text-left"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : sale.id)}
                    >
                      <span className="w-14 shrink-0 text-xs text-slate-500">{timeOf(sale.createdAt)}</span>
                      <span className={`min-w-0 flex-1 truncate text-sm ${voided ? 'text-slate-400 line-through' : ''}`}>
                        {sale.kind === 'void' ? 'Void of an earlier sale' : names || 'Sale'}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`block text-sm font-semibold ${sale.total < 0 ? 'text-red-600' : ''}`}>
                          {formatPeso(sale.total)}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {METHOD_LABEL[sale.method]}
                          {voided ? ' · voided' : ''}
                        </span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="space-y-2 bg-slate-50 px-3 pb-3 pt-1">
                        <div className="text-xs text-slate-500">
                          {formatDateTime(sale.createdAt)} · {METHOD_LABEL[sale.method]}
                          {sale.reference ? ` · ref ${sale.reference}` : ''}
                        </div>
                        {names && sale.kind === 'sale' && <div className="text-sm">{names}</div>}
                        <div className="flex gap-2">
                          <button className={btn.chip} onClick={() => onReceipt(sale.id)}>
                            Receipt
                          </button>
                          {sale.kind === 'sale' && !voided && (
                            <button className={btn.chip} onClick={() => onVoid(sale.id)}>
                              Void
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {rows.length > shown && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className={btn.secondary} onClick={() => setShown(shown + 20)}>
                Show more ({rows.length - shown} left)
              </button>
              <button className={btn.secondary} onClick={() => setShown(rows.length)}>
                Show all
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}

const METHOD_LABEL: Record<PayMethod, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', utang: 'Utang' }

export function Summary() {
  const toast = useToast()
  const { showReceipt } = useReceipt()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [day, setDay] = useState(() => new Date())
  const [start, end] = dayRange(day)
  const isToday = start === dayRange(new Date())[0]

  const summary = useLiveQuery(() => summaryBetween(start, end), [start, end])
  const low = useLiveQuery(() => lowStockProducts(), [])
  const sales = useLiveQuery(async () => {
    const rows = await db.sales.where('createdAt').between(start, end, true, false).reverse().sortBy('createdAt')
    const items = await db.saleItems.where('saleId').anyOf(rows.map((s) => s.id)).toArray()
    // the void can be on a later day than the sale, so look it up by the sale, not by today's rows
    const voided = new Set((await db.sales.where('voidOf').anyOf(rows.map((s) => s.id)).toArray()).map((v) => v.voidOf))
    return rows.map((s) => ({
      sale: s,
      voided: voided.has(s.id),
      names: items.filter((i) => i.saleId === s.id).map((i) => i.name).join(', '),
    }))
  }, [start, end])

  function shiftDay(delta: number) {
    const d = new Date(day)
    d.setDate(d.getDate() + delta)
    setDay(d)
  }

  async function onVoid(id: number) {
    if (!window.confirm('Void this sale? Stock and utang will be put back.')) return
    await toast.run(() => voidSale(id), 'Sale voided')
  }

  return (
    <div>
      <PageHeader
        title="Summary"
        right={
          <button className={`${btn.chip} py-2`} onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </button>
        }
      />

      <div className="flex items-center justify-between px-4 pt-3">
        <button className={btn.chip} onClick={() => shiftDay(-1)} aria-label="Previous day">
          ‹
        </button>
        <label className="flex flex-col items-center text-center">
          <span className="font-semibold">
            {isToday ? 'Today' : day.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          <input
            type="date"
            aria-label="Go to a date"
            value={toDateInput(day)}
            max={toDateInput(new Date())}
            onChange={(e) => {
              const d = fromDateInput(e.target.value)
              if (d && d.getTime() <= Date.now()) setDay(d)
            }}
            className="w-36 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-center text-xs text-slate-600"
          />
        </label>
        <button className={`${btn.chip} disabled:opacity-30`} disabled={isToday} onClick={() => shiftDay(1)} aria-label="Next day">
          ›
        </button>
      </div>

      {summary && (
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Sales" value={formatPeso(summary.net)} big />
            <Stat label="Estimated profit" value={formatPeso(summary.profit)} big />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Cash in drawer today"
              value={formatPeso(summary.cashCollected)}
              hint="Cash sales + cash utang paid + cash-in − cash-out"
            />
            <Stat
              label="Transactions"
              value={String(summary.saleCount - summary.voidCount)}
              hint={summary.voidCount ? `${summary.voidCount} voided (not counted)` : undefined}
            />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <h3 className="mb-1 text-sm font-semibold text-slate-600">By payment</h3>
            {(Object.keys(METHOD_LABEL) as PayMethod[]).map((m) => (
              <div key={m} className="flex justify-between py-0.5">
                <span>{METHOD_LABEL[m]}</span>
                <span className="font-medium">{formatPeso(summary.byMethod[m])}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-100 pt-1 text-sm text-slate-500">
              <span>Utang collected</span>
              <span>
                {formatPeso(summary.utangCollected)}
                {summary.utangCollected !== summary.utangCollectedCash &&
                  ` (cash ${formatPeso(summary.utangCollectedCash)})`}
              </span>
            </div>
            <div className="flex justify-between text-sm text-slate-500">
              <span>GCash/Maya cash-in/out fees</span>
              <span>{formatPeso(summary.walletFees)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-500">
              <span>Cash-in/out effect on drawer</span>
              <span>{formatPeso(summary.walletCashEffect)}</span>
            </div>
          </div>
        </div>
      )}

      {isToday && low && low.length > 0 && (
        <section className="mx-4 mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <h3 className="mb-1 font-semibold text-amber-800">Time to restock ({low.length})</h3>
          <ul className="text-sm">
            {low.map((p) => (
              <li key={p.id} className="flex justify-between py-0.5">
                <span>{p.name}</span>
                <span className={p.stock <= 0 ? 'font-semibold text-red-600' : ''}>
                  {formatStock(p.stock, p.unitType)}
                  {p.unitType === 'piece' ? ' pcs' : ''} left
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isToday && <MovementSection />}

      <section className="px-4">
        {!sales ? null : (
          <TransactionList
            key={start}
            sales={sales}
            isToday={isToday}
            onReceipt={(id) => showReceipt({ kind: 'sale', id })}
            onVoid={onVoid}
          />
        )}
      </section>

      <CloudSection />
      <DataSection />
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

/** Store details printed on receipts, plus the suggested GCash/Maya fee. */
function SettingsSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const s = useSettings()
  const [storeName, setStoreName] = useState(s.storeName)
  const [address, setAddress] = useState(s.address)
  const [footer, setFooter] = useState(s.footer)
  const [autoReceipt, setAutoReceipt] = useState(s.autoReceipt)
  const [percent, setPercent] = useState(String(s.walletFeePercent))
  const [minFee, setMinFee] = useState(pesoToInput(s.walletMinFee))
  const [scanBeep, setScanBeep] = useState(s.scanBeep)
  const [scanDelay, setScanDelay] = useState(String(s.scanDelaySec))
  const [movementDays, setMovementDays] = useState(String(s.movementDays))
  const [autoRemovePaid, setAutoRemovePaid] = useState(s.autoRemovePaid)

  const percentN = Number(percent)
  const minFeeC = toCentavos(minFee)
  const valid = Number.isFinite(percentN) && percentN >= 0 && percentN <= 100 && minFeeC !== null

  async function save() {
    if (!valid || minFeeC === null) return
    const res = await toast.run(
      () =>
        saveSettings({
          storeName: storeName.trim() || 'My Tindahan',
          address: address.trim(),
          footer: footer.trim(),
          autoReceipt,
          walletFeePercent: percentN,
          walletMinFee: minFeeC,
          scanBeep,
          scanDelaySec: Number(scanDelay),
          movementDays: Number(movementDays),
          autoRemovePaid,
        }),
      'Settings saved',
    )
    if (res.ok) onClose()
  }

  return (
    <Sheet
      title="Settings"
      onClose={onClose}
      footer={
        <button className={`${btn.primary} w-full`} disabled={!valid} onClick={save}>
          Save
        </button>
      }
    >
      <div className="space-y-3">
        <h3 className="font-semibold">Receipt</h3>
        <Field label="Store name">
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Address / contact (optional)">
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className={inputCls} />
        </Field>
        <Field label="Message at the bottom">
          <input value={footer} onChange={(e) => setFooter(e.target.value)} className={inputCls} />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={autoReceipt} onChange={(e) => setAutoReceipt(e.target.checked)} />
          <span>Show the receipt right after every sale</span>
        </label>

        <h3 className="pt-2 font-semibold">GCash / Maya cash-in and cash-out</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Suggested fee (%)">
            <input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Minimum fee (₱)">
            <input inputMode="decimal" value={minFee} onChange={(e) => setMinFee(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          The fee is only a suggestion. You can type a different fee on each transaction.
        </p>

        <h3 className="pt-2 font-semibold">Utang customers</h3>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={autoRemovePaid} onChange={(e) => setAutoRemovePaid(e.target.checked)} />
          <span>
            Remove customers from the list once they owe nothing
            <span className="block text-xs text-slate-500">
              Their past sales and payments stay in the history. Done on the owner's phone when the Utang tab is open.
            </span>
          </span>
        </label>

        <h3 className="pt-2 font-semibold">Fast and slow movers</h3>
        <Field
          label="Look back"
          hint="Products that sell often over this period are flagged Fast. Products that sold once or never are flagged Slow."
        >
          <select value={movementDays} onChange={(e) => setMovementDays(e.target.value)} className={inputCls}>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </Field>

        <h3 className="pt-2 font-semibold">Barcode scanner</h3>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={scanBeep} onChange={(e) => setScanBeep(e.target.checked)} />
          <span>Beep when a barcode is scanned</span>
        </label>
        <button
          type="button"
          className={btn.secondary}
          onClick={() => {
            prepareBeep()
            beep()
          }}
        >
          Test the beep
        </button>
        <Field
          label="Wait before the same item can be scanned again"
          hint="Move the item away from the camera, then scan it again after this wait. Holding one item still never adds it twice."
        >
          <select value={scanDelay} onChange={(e) => setScanDelay(e.target.value)} className={inputCls}>
            <option value="1">1 second</option>
            <option value="2">2 seconds</option>
            <option value="3">3 seconds</option>
            <option value="5">5 seconds</option>
          </select>
        </Field>
      </div>
    </Sheet>
  )
}

const stockValue = (p: Product) => (p.unitType === 'weight' ? Math.round((p.stock * p.cost) / 1000) : p.stock * p.cost)

/** Which products sell fast (keep them stocked) and which sit on the shelf (stop buying more). */
function MovementSection() {
  const movement = useMovement()
  const products = useLiveQuery(() => db.products.toArray(), [])
  if (!movement || !products) return null

  const rows = products.flatMap((p) => {
    const m = movement.byProduct.get(p.id)
    return m ? [{ p, m }] : []
  })
  const fast = rows.filter((r) => r.m.label === 'fast').sort((a, b) => b.m.times - a.m.times || a.p.name.localeCompare(b.p.name))
  const slow = rows.filter((r) => r.m.label === 'slow').sort((a, b) => a.m.times - b.m.times || a.p.name.localeCompare(b.p.name))
  if (fast.length === 0 && slow.length === 0) return null

  const sold = (n: number) => (n === 0 ? 'no sales' : n === 1 ? 'sold once' : `sold ${n} times`)
  const tiedUp = slow.reduce((sum, r) => sum + stockValue(r.p), 0)

  return (
    <section className="mx-4 mb-4 space-y-3" aria-label="Fast and slow movers">
      <h3 className="font-semibold">Fast and slow movers · last {movement.days} days</h3>

      {fast.length > 0 && (
        <div className="rounded-2xl border border-green-300 bg-green-50 p-3">
          <h4 className="mb-1 font-semibold text-green-800">🔥 Fast movers ({fast.length})</h4>
          <p className="mb-1 text-xs text-green-800">Your best sellers. Do not let these run out.</p>
          <ul className="text-sm">
            {fast.slice(0, 10).map(({ p, m }) => (
              <li key={p.id} className="flex justify-between gap-2 py-0.5">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-right">
                  {sold(m.times)} ·{' '}
                  <span className={p.stock <= p.lowStockAt ? 'font-semibold text-red-600' : ''}>
                    {formatStock(p.stock, p.unitType)}
                    {p.unitType === 'piece' ? ' pcs' : ''} left{p.stock <= p.lowStockAt ? ' · restock' : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {slow.length > 0 && (
        <div className="rounded-2xl border border-slate-300 bg-slate-50 p-3">
          <h4 className="mb-1 font-semibold text-slate-700">🐢 Slow movers ({slow.length})</h4>
          <p className="mb-1 text-xs text-slate-600">
            On the shelf and barely selling. About {formatPeso(tiedUp)} of your money is tied up in them. Think of a
            promo, or stop restocking.
          </p>
          <ul className="text-sm">
            {slow.slice(0, 10).map(({ p, m }) => (
              <li key={p.id} className="flex justify-between gap-2 py-0.5">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-right">
                  {sold(m.times)} · {formatStock(p.stock, p.unitType)}
                  {p.unitType === 'piece' ? ' pcs' : ''} left
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, hint, big }: { label: string; value: string; hint?: string; big?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`font-bold text-brand-800 ${big ? 'text-2xl' : 'text-xl'}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

/**
 * A safety copy of the whole store in your own Supabase project, on top of the live sync.
 * Only the owner reaches this screen, and the owner is always signed in when the cloud is set up.
 */
function CloudSection() {
  const toast = useToast()
  const { mode, profile } = useAuth()
  const [storePhone, setStorePhoneState] = useState(isStorePhone())
  const [tick, setTick] = useState(0)
  const [conflict, setConflict] = useState(false)

  // refresh "last backup" while this screen is open (automatic backups update it in the background)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [])
  void tick
  const { at, error } = lastCloudBackup()

  if (mode !== 'cloud' || !profile) {
    return (
      <section className="m-4 space-y-1 rounded-2xl border border-slate-200 bg-white p-3">
        <h3 className="font-semibold">Online backup</h3>
        <p className="text-sm text-slate-500">
          Not set up. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild (see SETUP_ACCOUNTS.md).
        </p>
      </section>
    )
  }

  /** toast.run hides ordinary errors behind "Something went wrong", so show the real cloud message. */
  async function attempt(fn: () => Promise<unknown>, okMessage: string): Promise<boolean> {
    try {
      await fn()
      toast.show(okMessage)
      return true
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 'error')
      return false
    }
  }

  async function onUpload(force: boolean) {
    setConflict(false)
    try {
      await uploadCloudBackup(force)
      toast.show('Safety copy saved online')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/another device/.test(msg)) setConflict(true)
      toast.show(msg, 'error')
    }
    setTick((n) => n + 1)
  }

  async function onDownload() {
    if (!window.confirm('Restoring replaces the data on this phone with the safety copy, then shares it with the other phones. Continue?')) return
    await attempt(downloadCloudBackup, 'Restored from the safety copy')
  }

  return (
    <section className="m-4 space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
      <h3 className="font-semibold">Online safety copy</h3>
      <p className="text-sm text-slate-500">
        All phones already share the store live. This is an extra full copy you can restore if something goes badly wrong.
      </p>
      <p className="text-sm text-slate-500">
        {at ? `Last safety copy: ${formatDateTime(Date.parse(at))}` : 'No safety copy from this phone yet.'}
      </p>
      {error && <p className="text-sm text-red-600">Last automatic copy failed: {error}</p>}
      <button className={`${btn.primary} w-full`} onClick={() => onUpload(false)}>
        Save a safety copy now
      </button>
      {conflict && (
        <button className={`${btn.secondary} w-full`} onClick={() => onUpload(true)}>
          Save anyway (this phone has the right data)
        </button>
      )}
      <button className={`${btn.secondary} w-full`} onClick={onDownload}>
        Restore from the safety copy
      </button>
      <label className="flex items-start gap-2 pt-1">
        <input
          type="checkbox"
          className="mt-1"
          checked={storePhone}
          onChange={(e) => {
            setStorePhone(e.target.checked)
            setStorePhoneState(e.target.checked)
          }}
        />
        <span className="text-sm">
          Save a safety copy automatically from this phone.
          <span className="block text-xs text-slate-500">Turn this on for one phone only, normally the owner's.</span>
        </span>
      </label>
    </section>
  )
}

/** Backup, restore and reset. Until cloud sync exists, a backup file is the only copy of the data. */
function DataSection() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  async function onExport() {
    await toast.run(async () => {
      const data = await exportBackup()
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tindahan-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    }, 'Backup downloaded')
  }

  async function onImport(file: File | undefined) {
    if (!file) return
    if (!window.confirm('Restoring replaces ALL current data with the backup. Continue?')) return
    await toast.run(async () => importBackup(JSON.parse(await file.text())), 'Backup restored')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onReset() {
    if (!window.confirm('Delete ALL products, sales and utang on this phone? This phone will download the shared store again the next time it syncs.')) return
    if (!window.confirm('Really delete everything? Download a backup first if unsure.')) return
    await toast.run(resetAllData, 'All data deleted')
  }

  return (
    <section className="m-4 mt-8 space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
      <h3 className="font-semibold">Your data</h3>
      <p className="text-sm text-slate-500">
        Each phone keeps a full copy of the store and shares it online. Download a backup file now and then as well.
      </p>
      <button className={`${btn.secondary} w-full`} onClick={onExport}>
        Download backup
      </button>
      <button className={`${btn.secondary} w-full`} onClick={() => fileRef.current?.click()}>
        Restore from backup
      </button>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
      <button className={`${btn.secondary} w-full`} onClick={() => toast.run(seedSampleProducts, 'Sample products added')}>
        Add sample products
      </button>
      <button className={`${btn.danger} w-full`} onClick={onReset}>
        Delete all data
      </button>
    </section>
  )
}
