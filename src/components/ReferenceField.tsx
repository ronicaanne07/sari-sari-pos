import { useLiveQuery } from 'dexie-react-hooks'
import type { WalletProvider } from '../db/db'
import { referenceInUse } from '../db/actions'
import { MIN_REFERENCE_LENGTH, normalizeReference } from '../lib/wallet'
import { inputCls } from '../ui'

export type RefStatus = 'empty' | 'short' | 'used' | 'ok'

export const PROVIDER_NAME: Record<WalletProvider, string> = { gcash: 'GCash', maya: 'Maya' }

/** Live check of a typed reference number. The database re-checks when saving, this is for feedback. */
export function useReferenceStatus(provider: WalletProvider | null, value: string): RefStatus {
  const ref = normalizeReference(value)
  const used = useLiveQuery(
    async () => (provider && ref && ref.length >= MIN_REFERENCE_LENGTH ? referenceInUse(provider, ref) : false),
    [provider, ref],
  )
  if (!ref) return 'empty'
  if (ref.length < MIN_REFERENCE_LENGTH) return 'short'
  return used ? 'used' : 'ok'
}

export function ReferenceField({
  provider,
  value,
  onChange,
  status,
}: {
  provider: WalletProvider
  value: string
  onChange: (v: string) => void
  status: RefStatus
}) {
  const name = PROVIDER_NAME[provider]
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="payment-reference">
        {name} reference number
      </label>
      <input
        id="payment-reference"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="From the customer's payment screen"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className={`${inputCls} ${status === 'used' ? 'border-red-500 focus:border-red-500' : ''}`}
      />
      <p
        className={`mt-1 text-xs ${
          status === 'used' ? 'font-semibold text-red-600' : status === 'ok' ? 'text-brand-700' : 'text-slate-500'
        }`}
      >
        {status === 'used' && 'Already used. Ask to see the customer’s payment screen again.'}
        {status === 'ok' && '✓ Reference looks good'}
        {status === 'short' && 'Too short. Type the whole reference number.'}
        {status === 'empty' && 'Required. Check that the money arrived in your app first.'}
      </p>
    </div>
  )
}
