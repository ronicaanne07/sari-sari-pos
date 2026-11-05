import { useEffect, useState } from 'react'
import type { CartLine } from './lib/cart'
import { ToastProvider } from './ui'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { AccountBar, LockScreen, LoginScreen } from './auth/screens'
import { tabsFor, type Tab } from './auth/permissions'
import { ReceiptProvider } from './components/ReceiptSheet'
import { Sell } from './pages/Sell'
import { Products } from './pages/Products'
import { Wallet } from './pages/Wallet'
import { Utang } from './pages/Utang'
import { Summary } from './pages/Summary'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'sell', label: 'Sell', icon: '🛒' },
  { id: 'products', label: 'Products', icon: '📦' },
  { id: 'wallet', label: 'Wallet', icon: '📱' },
  { id: 'utang', label: 'Utang', icon: '📒' },
  { id: 'summary', label: 'Summary', icon: '📊' },
]

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  )
}

/** Sign-in first, then the PIN lock, then the app with only the tabs this person's role allows. */
function Gate() {
  const { signedIn, locked } = useAuth()
  if (!signedIn) return <LoginScreen />
  if (locked) return <LockScreen />
  return <Shell />
}

function Shell() {
  const { role, mode } = useAuth()
  const allowed = tabsFor(role)
  const tabs = TABS.filter((t) => allowed.includes(t.id))
  const [tab, setTab] = useState<Tab>('sell')
  // If the role changes while the app is open (the owner demoted someone), leave a screen they can no longer use.
  useEffect(() => {
    if (!allowed.includes(tab)) setTab('sell')
  }, [allowed, tab])
  // The cart lives here so switching tabs (e.g. to check Utang) doesn't lose a sale in progress.
  const [cart, setCart] = useState<CartLine[]>([])

  return (
      <ReceiptProvider>
      <div className="mx-auto flex h-full max-w-xl flex-col bg-slate-50">
        {mode === 'cloud' && <AccountBar />}
        <main className="flex-1 overflow-y-auto">
          {tab === 'sell' && <Sell cart={cart} setCart={setCart} />}
          {tab === 'products' && allowed.includes('products') && <Products />}
          {tab === 'wallet' && <Wallet />}
          {tab === 'utang' && <Utang />}
          {tab === 'summary' && allowed.includes('summary') && <Summary />}
        </main>
        <nav
          className="safe-bottom grid border-t border-slate-200 bg-white"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          aria-label="Main"
        >
          {tabs.map((t) => (
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
                <span className="absolute right-3 top-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{cart.length}</span>
              )}
            </button>
          ))}
        </nav>
      </div>
      </ReceiptProvider>
  )
}
