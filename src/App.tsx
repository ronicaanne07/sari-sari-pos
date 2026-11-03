import { useState } from 'react'
import type { CartLine } from './lib/cart'
import { ToastProvider } from './ui'
import { Sell } from './pages/Sell'
import { Products } from './pages/Products'
import { Utang } from './pages/Utang'
import { Summary } from './pages/Summary'
import { Finance } from './pages/Finance'

type Tab = 'sell' | 'products' | 'utang' | 'summary' | 'finance'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'sell', label: 'Sell', icon: '🛒' },
  { id: 'products', label: 'Products', icon: '📦' },
  { id: 'utang', label: 'Utang', icon: '📒' },
  { id: 'summary', label: 'Summary', icon: '📊' },
  { id: 'finance', label: 'Finance', icon: '🧾' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('sell')
  // The cart lives here so switching tabs (e.g. to check Utang) doesn't lose a sale in progress.
  const [cart, setCart] = useState<CartLine[]>([])

  return (
    <ToastProvider>
      <div className="mx-auto flex h-full max-w-xl flex-col bg-slate-50">
        <main className="flex-1 overflow-y-auto">
          {tab === 'sell' && <Sell cart={cart} setCart={setCart} />}
          {tab === 'products' && <Products />}
          {tab === 'utang' && <Utang />}
          {tab === 'summary' && <Summary />}
          {tab === 'finance' && <Finance />}
        </main>
        <nav className="safe-bottom grid grid-cols-5 border-t border-slate-200 bg-white" aria-label="Main">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative flex flex-col items-center gap-0.5 py-2 text-xs font-semibold ${
                tab === t.id ? 'text-brand-700' : 'text-slate-500'
              }`}
            >
              <span className="text-xl leading-none">{t.icon}</span>
              {t.label}
              {t.id === 'sell' && cart.length > 0 && tab !== 'sell' && (
                <span className="absolute right-6 top-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{cart.length}</span>
              )}
            </button>
          ))}
        </nav>
      </div>
    </ToastProvider>
  )
}
