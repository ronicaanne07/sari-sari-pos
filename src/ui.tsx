import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { PosError } from './db/actions'

/* ------------------------------------------------------------------ styling */

export const btn = {
  primary:
    'rounded-xl bg-brand-700 px-4 py-3 text-base font-semibold text-white active:bg-brand-800 disabled:opacity-40',
  secondary:
    'rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-medium text-slate-800 active:bg-slate-100 disabled:opacity-40',
  danger:
    'rounded-xl bg-red-600 px-4 py-3 text-base font-semibold text-white active:bg-red-700 disabled:opacity-40',
  chip: 'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 active:bg-slate-100',
}

export const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100'

/* ------------------------------------------------------------------- toasts */

export type RunResult<T> = { ok: true; value: T } | { ok: false }

interface ToastApi {
  show: (message: string, kind?: 'ok' | 'error') => void
  /** Runs an action; PosError messages are shown to the cashier, anything else is logged. */
  run: <T>(fn: () => Promise<T>, okMessage?: string) => Promise<RunResult<T>>
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; kind: 'ok' | 'error' } | null>(null)

  const show = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now()
    setToast({ id, message, kind })
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3500)
  }, [])

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMessage?: string): Promise<RunResult<T>> => {
      try {
        const value = await fn()
        if (okMessage) show(okMessage)
        return { ok: true, value }
      } catch (e) {
        if (!(e instanceof PosError)) console.error(e)
        show(e instanceof PosError ? e.message : 'Something went wrong. Please try again.', 'error')
        return { ok: false }
      }
    },
    [show],
  )

  const api = useMemo(() => ({ show, run }), [show, run])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 top-4 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-center text-base font-medium text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-red-600' : 'bg-slate-900'
          }`}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}

/* ------------------------------------------------------------------- pieces */

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-10 w-10 rounded-full text-2xl leading-none text-slate-500 active:bg-slate-100"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="safe-bottom border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold disabled:opacity-60 ${
            o.value === value ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <h1 className="text-xl font-bold text-brand-800">{title}</h1>
      {right}
    </div>
  )
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
