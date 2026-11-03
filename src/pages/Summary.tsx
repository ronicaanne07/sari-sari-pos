import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PayMethod } from '../db/db'
import { dayRange, lowStockProducts, summaryBetween, voidSale } from '../db/actions'
import { exportBackup, importBackup, resetAllData } from '../db/backup'
import { seedSampleProducts } from '../db/seed'
import { cloudConfigured, downloadCloudBackup, uploadCloudBackup } from '../db/cloud'
import { formatPeso } from '../lib/money'
import { formatStock } from '../lib/units'
import { PageHeader, btn, formatDateTime, useToast } from '../ui'

const METHOD_LABEL: Record<PayMethod, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', utang: 'Utang' }

export function Summary() {
  const toast = useToast()
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
      <PageHeader title="Summary" />

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
            <Stat label="Cash collected" value={formatPeso(summary.cashCollected)} hint="Cash sales + utang paid" />
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
              <span>{formatPeso(summary.utangCollected)}</span>
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
              <li key={sale.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm ${voided ? 'text-slate-400 line-through' : ''}`}>
                    {sale.kind === 'void' ? 'Void of an earlier sale' : names || 'Sale'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatDateTime(sale.createdAt)} · {METHOD_LABEL[sale.method]}
                    {voided ? ' · voided' : ''}
                  </div>
                </div>
                <div className={`font-semibold ${sale.total < 0 ? 'text-red-600' : ''}`}>{formatPeso(sale.total)}</div>
                {sale.kind === 'sale' && !voided && (
                  <button className={btn.chip} onClick={() => onVoid(sale.id)}>
                    Void
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <DataSection />
    </div>
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

/** Backup, restore and reset. Until cloud sync exists, a backup file is the only copy of the data. */
function DataSection() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  async function onCloudUpload() {
    if (!window.confirm('Upload this device’s complete database to the configured cloud store? This replaces the shared snapshot.')) return
    await toast.run(uploadCloudBackup, 'Cloud backup uploaded')
  }

  async function onCloudDownload() {
    if (!window.confirm('Download the shared cloud snapshot and REPLACE all local data? Download a local backup first.')) return
    await toast.run(downloadCloudBackup, 'Cloud data restored')
  }

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
    if (!window.confirm('Delete ALL products, sales and utang on this phone? This cannot be undone.')) return
    if (!window.confirm('Really delete everything? Download a backup first if unsure.')) return
    await toast.run(resetAllData, 'All data deleted')
  }

  return (
    <section className="m-4 mt-8 space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
      <h3 className="font-semibold">Your data</h3>
      <p className="text-sm text-slate-500">
        Local data is stored on this device. Configure Supabase in .env and follow CLOUD_SETUP.md to share snapshots across devices.
      </p>
      <div className="rounded-xl border border-slate-200 p-3 space-y-2">
        <h4 className="font-medium">Cloud database {cloudConfigured() ? '· configured' : '· not configured'}</h4>
        <p className="text-xs text-slate-500">Cloud sync uses a full database snapshot. Use one device to make changes at a time; syncing does not merge simultaneous edits.</p>
        <button className={`${btn.secondary} w-full`} disabled={!cloudConfigured()} onClick={onCloudUpload}>Upload local data to cloud</button>
        <button className={`${btn.secondary} w-full`} disabled={!cloudConfigured()} onClick={onCloudDownload}>Download cloud data to this device</button>
      </div>
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
