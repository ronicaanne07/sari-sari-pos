import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { db } from '../db/db'
import { markRemote } from '../db/syncHooks'
import { cloudConfigured, cloudSignIn, cloudSignOut, cloudSignedIn } from '../db/cloud'
import { startSync, stopSync, setSyncHandlers } from '../sync/sync'
import { clearProfile, fetchProfile, getProfile, saveProfile, type Profile, type Role } from './profile'
import { clearPin, hasPin, verifyPin } from './pin'

/** Phones that sit unused for this long lock themselves (only when a PIN is set). */
const AUTO_LOCK_MS = 60_000
export const MAX_PIN_TRIES = 5

interface AuthApi {
  /** 'local' = the cloud is not configured (developing on one phone): no sign-in, everything allowed. */
  mode: 'local' | 'cloud'
  signedIn: boolean
  profile: Profile | null
  role: Role
  locked: boolean
  /** Why the phone was signed out (account turned off, session expired...). */
  notice: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  lock: () => void
  /** Returns true when the PIN was right. After MAX_PIN_TRIES wrong tries the phone signs out instead. */
  unlock: (pin: string) => Promise<boolean>
  pinChanged: () => void
}

const AuthContext = createContext<AuthApi | null>(null)

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** Cashier phones never hold the owner's purchases and expenses. */
async function dropOwnerOnlyData() {
  await db.transaction('rw', [db.purchases, db.expenses], async (tx) => {
    markRemote(tx)
    await db.purchases.clear()
    await db.expenses.clear()
  })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = cloudConfigured() ? 'cloud' : 'local'
  const [profile, setProfile] = useState<Profile | null>(() => (mode === 'cloud' && cloudSignedIn() ? getProfile() : null))
  const [locked, setLocked] = useState(() => mode === 'cloud' && hasPin())
  const [notice, setNotice] = useState<string | null>(null)
  const tries = useRef(0)

  const signedIn = mode === 'local' || profile !== null

  const doSignOut = useCallback((why: string | null = null) => {
    stopSync()
    cloudSignOut()
    clearProfile()
    clearPin()
    setProfile(null)
    setLocked(false)
    setNotice(why)
    tries.current = 0
  }, [])

  // Sync runs while someone is signed in. The server can also tell us the account was turned off.
  useEffect(() => {
    if (mode !== 'cloud') return
    setSyncHandlers({
      authLost: (reason) => doSignOut(reason),
      profileChanged: (p) => setProfile(p),
    })
    if (profile) startSync()
    return () => stopSync()
  }, [mode, profile?.userId, doSignOut]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lock again after the phone was put down for a minute.
  useEffect(() => {
    if (mode !== 'cloud') return
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS && hasPin()) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [mode])

  const signIn = useCallback(async (email: string, password: string) => {
    const user = await cloudSignIn(email, password)
    let p: Profile
    try {
      p = await fetchProfile(user.userId)
    } catch (e) {
      cloudSignOut()
      throw e
    }
    const before = getProfile()
    // A different person on this phone: download the store again for them, and never keep owner-only data for a cashier.
    if (!before || before.userId !== p.userId) await db.syncMeta.delete('cursor')
    if (p.role === 'cashier') await dropOwnerOnlyData()
    saveProfile(p)
    setNotice(null)
    setLocked(false)
    setProfile(p)
  }, [])

  const unlock = useCallback(
    async (pin: string) => {
      if (await verifyPin(pin)) {
        tries.current = 0
        setLocked(false)
        return true
      }
      tries.current++
      if (tries.current >= MAX_PIN_TRIES) doSignOut('Too many wrong PIN tries. Please sign in again.')
      return false
    },
    [doSignOut],
  )

  const api = useMemo<AuthApi>(
    () => ({
      mode,
      signedIn,
      profile,
      role: profile?.role ?? 'owner',
      locked: mode === 'cloud' && locked,
      notice,
      signIn,
      signOut: () => doSignOut(null),
      lock: () => hasPin() && setLocked(true),
      unlock,
      pinChanged: () => setLocked(false),
    }),
    [mode, signedIn, profile, locked, notice, signIn, unlock, doSignOut],
  )

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}
