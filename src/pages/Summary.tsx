import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PayMethod } from '../db/db'
import { dayRange, lowStockProducts, summaryBetween, voidSale } from '../db/actions'
import { exportBackup, importBackup, resetAllData } from '../db/backup'
import { seedSampleProducts } from '../db/seed'
import { useAuth } from '../auth/AuthProvider'
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
    const voided = new Set(rows.filter((s) => s.kind === 'void').map((s) => s.voidOf))
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
        <span className="font-semibold">
          {isToday ? 'Today' : day.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
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

      <section className="px-4">
        <h3 className="mb-1 font-semibold">Transactions</h3>
        {!sales || sales.length === 0 ? (
          <p className="text-sm text-slate-500">No sales on this day.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sales.map(({ sale, voided, names }) => (
              <li key={sale.id} className="py-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${voided ? 'text-slate-400 line-through' : ''}`}>
                      {sale.kind === 'void' ? 'Void of an earlier sale' : names || 'Sale'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDateTime(sale.createdAt)} · {METHOD_LABEL[sale.method]}
                      {sale.reference ? ` ref ${sale.reference}` : ''}
                      {voided ? ' · voided' : ''}
                    </div>
                  </div>
                  <div className={`font-semibold ${sale.total < 0 ? 'text-red-600' : ''}`}>{formatPeso(sale.total)}</div>
                </div>
                <div className="mt-1 flex gap-2">
                  <button className={btn.chip} onClick={() => showReceipt({ kind: 'sale', id: sale.id })}>
                    Receipt
                  </button>
                  {sale.kind === 'sale' && !voided && (
                    <button className={btn.chip} onClick={() => onVoid(sale.id)}>
                      Void
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
      </div>
    </Sheet>
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
