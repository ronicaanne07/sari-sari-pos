import { useEffect, useState, useSyncExternalStore } from 'react'
import { Field, Sheet, btn, formatDateTime, inputCls, useToast } from '../ui'
import { getSyncStatus, pendingCount, subscribeSync, syncNow } from '../sync/sync'
import { useAuth } from './AuthProvider'
import { clearPin, hasPin, isValidPin, setPin } from './pin'

const ROLE_LABEL = { owner: 'Owner', cashier: 'Cashier' } as const

/** Shown until someone signs in. The first sign-in on a phone needs internet; after that it works offline. */
export function LoginScreen() {
  const { signIn, notice } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Cannot reach the internet. The first sign-in on a phone needs a connection.'
          : err instanceof Error
            ? err.message
            : 'Sign-in failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4 p-6">
      <div className="text-center">
        <div className="text-5xl">🏪</div>
        <h1 className="mt-2 text-2xl font-bold">Tindahan POS</h1>
        <p className="text-sm text-slate-500">Sign in with the account the owner made for you.</p>
      </div>
      {notice && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{notice}</p>}
      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className={`${btn.primary} w-full`} type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

/** Shown when a PIN is set and the phone was just opened or left alone for a minute. */
export function LockScreen() {
  const { unlock, signOut, profile } = useAuth()
  const [pin, setPinValue] = useState('')
  const [wrong, setWrong] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const ok = await unlock(pin)
    setWrong(!ok)
    setPinValue('')
  }

  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-4 p-6">
      <div className="text-center">
        <div className="text-5xl">🔒</div>
        <h1 className="mt-2 text-xl font-bold">{profile ? `Hi ${profile.name}` : 'Locked'}</h1>
        <p className="text-sm text-slate-500">Enter your PIN to continue.</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={6}
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
          className={`${inputCls} text-center text-2xl tracking-widest`}
        />
        {wrong && <p className="text-center text-sm text-red-600">Wrong PIN. Try again.</p>}
        <button className={`${btn.primary} w-full`} type="submit" disabled={pin.length < 4}>
          Unlock
        </button>
      </form>
      <button className="text-sm text-slate-500 underline" onClick={signOut}>
        Forgot the PIN? Sign out and sign in again
      </button>
    </div>
  )
}

function useSyncStatus() {
  return useSyncExternalStore(subscribeSync, getSyncStatus)
}

/** Thin strip above every screen: who is signed in and whether their sales are safely online. */
export function AccountBar() {
  const { profile } = useAuth()
  const sync = useSyncStatus()
  const [open, setOpen] = useState(false)
  if (!profile) return null

  const text =
    sync.state === 'syncing'
      ? 'Syncing…'
      : sync.state === 'offline'
        ? `Offline${sync.pending ? ` · ${sync.pending} waiting to upload` : ''}`
        : sync.state === 'error'
          ? 'Sync problem'
          : sync.pending
            ? `${sync.pending} waiting to upload`
            : sync.lastSyncAt
              ? 'All synced'
              : 'Not synced yet'
  const dot = sync.state === 'error' ? 'bg-red-500' : sync.state === 'offline' || sync.pending ? 'bg-amber-500' : 'bg-green-500'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between border-b border-slate-200 bg-white px-4 py-1.5 text-left text-xs text-slate-600"
        aria-label="Account"
      >
        <span className="font-semibold">
          {profile.name} · {ROLE_LABEL[profile.role]}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
          {text}
        </span>
      </button>
      {open && <AccountSheet onClose={() => setOpen(false)} />}
    </>
  )
}

function AccountSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const { profile, signOut, lock, pinChanged } = useAuth()
  const sync = useSyncStatus()
  const [pinOn, setPinOn] = useState(hasPin())
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pending, setPending] = useState(0)

  useEffect(() => {
    void pendingCount().then(setPending)
  }, [sync])

  async function savePin() {
    if (!isValidPin(pin1)) return toast.show('The PIN must be 4 to 6 digits.', 'error')
    if (pin1 !== pin2) return toast.show('The two PINs are not the same.', 'error')
    await setPin(pin1)
    setPin1('')
    setPin2('')
    setPinOn(true)
    pinChanged()
    toast.show('PIN saved')
  }

  function removePin() {
    clearPin()
    setPinOn(false)
    toast.show('PIN removed')
  }

  function onSignOut() {
    const warn = pending
      ? `${pending} change${pending === 1 ? '' : 's'} have not been uploaded yet. They stay on this phone and upload when someone signs in here. Sign out anyway?`
      : 'Sign out of this phone?'
    if (window.confirm(warn)) signOut()
  }

  if (!profile) return null
  return (
    <Sheet title="My account" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <div className="font-semibold">{profile.name}</div>
          <div className="text-slate-500">
            {ROLE_LABEL[profile.role]} · {profile.storeId}
          </div>
          <div className="mt-1 text-slate-500">
            {sync.lastSyncAt ? `Last synced ${formatDateTime(sync.lastSyncAt)}` : 'Not synced yet'}
            {pending ? ` · ${pending} waiting to upload` : ''}
          </div>
          {sync.error && <div className="mt-1 text-red-600">{sync.error}</div>}
        </div>
        <button className={`${btn.secondary} w-full`} onClick={() => void syncNow()}>
          Sync now
        </button>

        <div className="space-y-2">
          <h3 className="font-semibold">PIN lock (optional)</h3>
          <p className="text-xs text-slate-500">
            Locks this phone when you put it down for a minute, so nobody else can sell under your name.
          </p>
          <Field label={pinOn ? 'New PIN (4 to 6 digits)' : 'PIN (4 to 6 digits)'}>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin1}
              onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))}
              className={inputCls}
            />
          </Field>
          <Field label="Type it again">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
              className={inputCls}
            />
          </Field>
          <button className={`${btn.secondary} w-full`} onClick={savePin} disabled={!pin1 || !pin2}>
            {pinOn ? 'Change PIN' : 'Set PIN'}
          </button>
          {pinOn && (
            <div className="grid grid-cols-2 gap-2">
              <button
                className={btn.secondary}
                onClick={() => {
                  lock()
                  onClose()
                }}
              >
                Lock now
              </button>
              <button className={btn.secondary} onClick={removePin}>
                Remove PIN
              </button>
            </div>
          )}
        </div>

        <button className={`${btn.danger} w-full`} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </Sheet>
  )
}
