import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildReceipt, type ReceiptTarget } from '../db/receipts'
import { renderReceiptPng } from '../lib/receiptImage'
import { Sheet, btn, useToast } from '../ui'

interface ReceiptApi {
  showReceipt: (target: ReceiptTarget) => void
}

const ReceiptContext = createContext<ReceiptApi | null>(null)

export function useReceipt(): ReceiptApi {
  const ctx = useContext(ReceiptContext)
  if (!ctx) throw new Error('useReceipt must be used inside <ReceiptProvider>')
  return ctx
}

/** Lets any screen open a receipt with showReceipt({ kind: 'sale', id }). */
export function ReceiptProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ReceiptTarget | null>(null)
  const showReceipt = useCallback((t: ReceiptTarget) => setTarget(t), [])
  const api = useMemo(() => ({ showReceipt }), [showReceipt])
  return (
    <ReceiptContext.Provider value={api}>
      {children}
      {target && <ReceiptSheet target={target} onClose={() => setTarget(null)} />}
    </ReceiptContext.Provider>
  )
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ReceiptSheet({ target, onClose }: { target: ReceiptTarget; onClose: () => void }) {
  const toast = useToast()
  const receipt = useLiveQuery(() => buildReceipt(target).catch(() => null), [target.kind, target.id])
  const filename = `receipt-${target.kind}-${target.id}.png`

  async function share() {
    if (!receipt) return
    const res = await toast.run(async () => {
      try {
        const blob = await renderReceiptPng(receipt.lines)
        const file = new File([blob], filename, { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Receipt' })
        } else if (navigator.share) {
          await navigator.share({ title: 'Receipt', text: receipt.text })
        } else {
          download(blob, filename)
          return 'Sharing is not available here, so the image was saved instead'
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // customer closed the share menu
        throw e
      }
    })
    if (res.ok && typeof res.value === 'string') toast.show(res.value)
  }

  async function copy() {
    if (!receipt) return
    try {
      await navigator.clipboard.writeText(receipt.text)
      toast.show('Receipt text copied')
    } catch {
      toast.show('Could not copy. Use Save image instead.', 'error')
    }
  }

  async function saveImage() {
    if (!receipt) return
    await toast.run(async () => download(await renderReceiptPng(receipt.lines), filename), 'Image saved')
  }

  return (
    <Sheet
      title="Receipt"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button className={btn.primary} disabled={!receipt} onClick={share}>
            Share
          </button>
          <button className={btn.secondary} disabled={!receipt} onClick={() => window.print()}>
            Print
          </button>
          <button className={btn.secondary} disabled={!receipt} onClick={saveImage}>
            Save image
          </button>
          <button className={btn.secondary} disabled={!receipt} onClick={copy}>
            Copy text
          </button>
        </div>
      }
    >
      {receipt === undefined ? (
        <p className="py-6 text-center text-slate-500">Loading…</p>
      ) : receipt === null ? (
        <p className="py-6 text-center text-red-600">Receipt not found.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
          {/* The same element is what gets printed (see .receipt-print in index.css). */}
          <pre
            data-testid="receipt-text"
            className="receipt-print mx-auto w-fit font-mono text-[13px] leading-snug text-black"
          >
            {receipt.lines.map((l, i) => (
              <div key={i} className={l.bold ? 'font-bold' : undefined}>
                {l.text || ' '}
              </div>
            ))}
          </pre>
        </div>
      )}
    </Sheet>
  )
}
