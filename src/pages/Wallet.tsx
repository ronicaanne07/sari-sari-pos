import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type WalletProvider, type WalletType } from '../db/db'
import { createWalletTransaction, dayRange, summaryBetween, voidWalletTransaction } from '../db/actions'
import { useSettings } from '../db/settings'
import { formatPeso, toCentavos } from '../lib/money'
import { pesoToInput } from '../lib/units'
import { suggestFee } from '../lib/wallet'
import { PROVIDER_NAME, ReferenceField, useReferenceStatus } from '../components/ReferenceField'
import { useReceipt } from '../components/ReceiptSheet'
import { Field, PageHeader, Segmented, btn, formatDateTime, inputCls, useToast } from '../ui'

const TYPE_LABEL: Record<WalletType, string> = { cash_in: 'Cash-in', cash_out: 'Cash-out' }

export function Wallet() {
  const toast = useToast()
  const { showReceipt } = useReceipt()
  const settings = useSettings()

  const [provider, setProvider] = useState<WalletProvider>('gcash')
  const [type, setType] = useState<WalletType>('cash_in')
  const [amountText, setAmountText] = useState('')
  const [feeText, setFeeText] = useState('')
  const [feeEdited, setFeeEdited] = useState(false)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const amount = toCentavos(amountText)
  const suggested = amount ? suggestFee(amount, settings.walletFeePercent, settings.walletMinFee) : 0
  const fee = feeEdited ? toCentavos(feeText) : suggested
  const refStatus = useReferenceStatus(provider, reference)
  const name = PROVIDER_NAME[provider]
  const ready = !!amount && fee !== null && refStatus === 'ok' && !busy

  const [start, end] = dayRange(new Date())
  const today = useLiveQuery(async () => {
    const rows = await db.walletTransactions.where('createdAt').between(start, end, true, false).reverse().sortBy('createdAt')
    const voided = new Set(rows.filter((r) => r.kind === 'void').map((r) => r.voidOf))
    return rows.map((tx) => ({ tx, voided: voided.has(tx.id) }))
  }, [start, end])
  const totals = useLiveQuery(() => summaryBetween(start, end), [start, end])

  async function save() {
    if (!ready || !amount || fee === null) return
    setBusy(true)
    const res = await toast.run(() =>
      createWalletTransaction({ provider, type, amount, fee, reference, note }),
    )
    setBusy(false)
    if (!res.ok) return
    const id = res.value.id
    setAmountText('')
    setFeeText('')
    setFeeEdited(false)
    setReference('')
    setNote('')
    if (settings.autoReceipt) showReceipt({ kind: 'wallet', id })
    else toast.show('Saved', 'ok', { label: 'Receipt', onClick: () => showReceipt({ kind: 'wallet', id }) })
  }

  async function onVoid(id: number) {
    if (!window.confirm('Void this transaction? It will be taken out of today’s totals.')) return
    await toast.run(() => voidWalletTransaction(id), 'Transaction voided')
  }

  const total = (amount ?? 0) + (fee ?? 0)

  return (
    <div>
      <PageHeader title="GCash / Maya" />

      <div className="grid grid-cols-2 gap-3 px-4 pt-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="text-sm text-slate-500">Fees earned today</div>
          <div className="text-xl font-bold text-brand-800">{formatPeso(totals?.walletFees ?? 0)}</div>
          <div className="text-xs text-slate-500">{totals?.walletCount ?? 0} transactions</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="text-sm text-slate-500">Cash drawer effect</div>
          <div className="text-xl font-bold text-brand-800">{formatPeso(totals?.walletCashEffect ?? 0)}</div>
          <div className="text-xs text-slate-500">cash-in adds, cash-out takes</div>
        </div>
      </div>

      <div className="m-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
        <Segmented
          value={provider}
          onChange={setProvider}
          options={[
            { value: 'gcash', label: 'GCash' },
            { value: 'maya', label: 'Maya' },
          ]}
        />
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'cash_in', label: 'Cash-in' },
            { value: 'cash_out', label: 'Cash-out' },
          ]}
        />

        <Field label="Amount (₱)">
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className={inputCls}
            placeholder="0.00"
          />
        </Field>
        <Field
          label="Fee (₱)"
          hint={`Suggested ${settings.walletFeePercent}% (minimum ${formatPeso(settings.walletMinFee)}). You can change it.`}
        >
          <input
            inputMode="decimal"
            value={feeEdited ? feeText : amount ? pesoToInput(suggested) : ''}
            onChange={(e) => {
              setFeeEdited(true)
              setFeeText(e.target.value)
            }}
            className={inputCls}
            placeholder="0.00"
            aria-label="Fee"
          />
        </Field>

        {!!amount && fee !== null && (
          <div className="space-y-1 rounded-xl bg-brand-50 p-3 text-sm" data-testid="wallet-instructions">
            {type === 'cash_in' ? (
              <>
                <div className="flex justify-between">
                  <span>Customer gives you cash</span>
                  <b>{formatPeso(total)}</b>
                </div>
                <div className="flex justify-between">
                  <span>Send from your {name}</span>
                  <b>{formatPeso(amount)}</b>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Give the customer cash</span>
                  <b>{formatPeso(amount)}</b>
                </div>
                <div className="flex justify-between">
                  <span>Customer sends you ({name})</span>
                  <b>{formatPeso(total)}</b>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-brand-100 pt-1 text-brand-800">
              <span>Your earning</span>
              <b>{formatPeso(fee)}</b>
            </div>
          </div>
        )}

        <ReferenceField provider={provider} value={reference} onChange={setReference} status={refStatus} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Customer or note (optional)"
          className={inputCls}
          aria-label="Note"
        />
        <button className={`${btn.primary} w-full`} disabled={!ready} onClick={save}>
          {busy ? 'Saving…' : `Save ${TYPE_LABEL[type].toLowerCase()}`}
        </button>
      </div>

      <section className="px-4 pb-6">
        <h3 className="mb-1 font-semibold">Today</h3>
        {!today || today.length === 0 ? (
          <p className="text-sm text-slate-500">No GCash or Maya transactions yet today.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {today.map(({ tx, voided }) => (
              <li key={tx.id} className="py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className={`min-w-0 ${voided ? 'text-slate-400 line-through' : ''}`}>
                    <div className="text-sm font-medium">
                      {tx.kind === 'void' ? 'Void · ' : ''}
                      {PROVIDER_NAME[tx.provider]} {TYPE_LABEL[tx.type]}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDateTime(tx.createdAt)}
                      {tx.reference ? ` · ref ${tx.reference}` : ''}
                      {tx.note ? ` · ${tx.note}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold ${tx.amount < 0 ? 'text-red-600' : ''}`}>{formatPeso(tx.amount)}</div>
                    <div className="text-xs text-slate-500">fee {formatPeso(tx.fee)}</div>
                  </div>
                </div>
                {tx.kind === 'tx' && (
                  <div className="mt-1 flex gap-2">
                    <button className={btn.chip} onClick={() => showReceipt({ kind: 'wallet', id: tx.id })}>
                      Receipt
                    </button>
                    {!voided && (
                      <button className={btn.chip} onClick={() => onVoid(tx.id)}>
                        Void
                      </button>
                    )}
                    {voided && <span className="self-center text-xs text-slate-400">voided</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
