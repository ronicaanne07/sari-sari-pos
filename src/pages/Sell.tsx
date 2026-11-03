import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PayMethod, type Product, type ProductPack } from '../db/db'
import { addCustomer, checkout } from '../db/actions'
import {
  addPack,
  addPiece,
  addWeight,
  cartTotal,
  removeLine,
  stepLine,
  type CartLine,
} from '../lib/cart'
import {
  formatPeso,
  formatWeight,
  gramsForAmount,
  parseGrams,
  priceForGrams,
  toCentavos,
} from '../lib/money'
import { formatPrice, formatStock } from '../lib/units'
import { findByBarcode } from '../lib/barcode'
import { normalizeReference } from '../lib/wallet'
import { useSettings } from '../db/settings'
import { Scanner } from '../components/Scanner'
import { ReferenceField, useReferenceStatus } from '../components/ReferenceField'
import { useReceipt } from '../components/ReceiptSheet'
import { PageHeader, Segmented, Sheet, btn, inputCls, useToast } from '../ui'

type Tile = { key: string; product: Product; pack?: ProductPack }
type SetCart = Dispatch<SetStateAction<CartLine[]>>

function stockTone(p: Product): string {
  if (p.stock <= 0) return 'text-red-600'
  if (p.stock <= p.lowStockAt) return 'text-amber-600'
  return 'text-slate-500'
}

export function Sell({ cart, setCart }: { cart: CartLine[]; setCart: SetCart }) {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const packs = useLiveQuery(() => db.productPacks.toArray(), [])
  const [query, setQuery] = useState('')
  const [weighing, setWeighing] = useState<Product | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const toast = useToast()

  const tiles = useMemo<Tile[]>(() => {
    if (!products) return []
    const q = query.trim().toLowerCase()
    const packsByProduct = new Map<number, ProductPack[]>()
    for (const k of packs ?? []) {
      packsByProduct.set(k.productId, [...(packsByProduct.get(k.productId) ?? []), k])
    }
    return products
      .filter((p) => !p.archived && (!q || p.name.toLowerCase().includes(q) || p.barcode === query.trim()))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))
      .flatMap((p): Tile[] => [
        { key: `p${p.id}`, product: p },
        ...(packsByProduct.get(p.id) ?? []).map((k): Tile => ({ key: `k${k.id}`, product: p, pack: k })),
      ])
  }, [products, packs, query])

  function tapProduct(p: Product) {
    navigator.vibrate?.(10)
    if (p.unitType === 'weight') setWeighing(p)
    else setCart((c) => addPiece(c, p))
  }

  function tapTile({ product, pack }: Tile) {
    if (pack) {
      navigator.vibrate?.(10)
      setCart((c) => addPack(c, product, pack))
    } else tapProduct(product)
  }

  /** Keyboard-style barcode scanners type the code and press Enter. */
  function onSearchSubmit(e: FormEvent) {
    e.preventDefault()
    const code = query.trim()
    const hit = code ? findByBarcode(products?.filter((p) => !p.archived) ?? [], code) : undefined
    if (hit) {
      tapProduct(hit)
      setQuery('')
    }
  }

  /** A code from the camera. Pieces go straight into the cart; weighed items need a weight first. */
  function onScan(code: string) {
    const hit = findByBarcode(products?.filter((p) => !p.archived) ?? [], code)
    if (!hit) {
      toast.show(`No product has barcode ${code}. Add the barcode in Products.`, 'error')
      return
    }
    if (hit.unitType === 'weight') {
      setScanning(false)
      setWeighing(hit)
      return
    }
    setCart((c) => addPiece(c, hit))
    toast.show(`Added ${hit.name}`)
  }

  const total = cartTotal(cart)

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title="Sell" />
      <form onSubmit={onSearchSubmit} className="flex gap-2 px-4 pt-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item or barcode"
          className={inputCls}
          aria-label="Search items"
        />
        <button
          type="button"
          onClick={() => setScanning(true)}
          className={`${btn.secondary} shrink-0 px-4`}
          aria-label="Scan barcode with camera"
        >
          📷 Scan
        </button>
      </form>

      {!products ? (
        <p className="p-6 text-center text-slate-500">Loading…</p>
      ) : tiles.length === 0 ? (
        <p className="p-6 text-center text-slate-500">
          {products.length === 0 ? 'No products yet. Add some in the Products tab.' : 'No match.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
          {tiles.map((t) => (
            <button
              key={t.key}
              onClick={() => tapTile(t)}
              className={`flex min-h-24 flex-col justify-between rounded-2xl border p-3 text-left active:scale-[0.98] ${
                t.pack ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
              }`}
            >
              <span className="text-base font-semibold leading-tight">
                {t.product.favorite && !t.pack && <span className="mr-1 text-amber-500">★</span>}
                {t.product.name}
                {t.pack && <span className="block text-sm font-medium text-amber-700">{t.pack.name}</span>}
              </span>
              <span>
                <span className="block text-lg font-bold text-brand-800">
                  {t.pack ? formatPeso(t.pack.packPrice) : formatPrice(t.product.price, t.product.unitType)}
                </span>
                {!t.pack && (
                  <span className={`text-xs ${stockTone(t.product)}`}>
                    {formatStock(t.product.stock, t.product.unitType)} left
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {cart.length > 0 && (
        <div className="sticky bottom-0 mt-auto border-t border-slate-200 bg-white p-3">
          <button onClick={() => setCartOpen(true)} className={`${btn.primary} flex w-full items-center justify-between`}>
            <span>
              {cart.length} item{cart.length === 1 ? '' : 's'}
            </span>
            <span>Charge {formatPeso(total)}</span>
          </button>
        </div>
      )}

      {weighing && (
        <WeightSheet
          product={weighing}
          onClose={() => setWeighing(null)}
          onAdd={(grams, lineTotal) => {
            setCart((c) => addWeight(c, weighing, grams, lineTotal))
            setWeighing(null)
          }}
        />
      )}
      {cartOpen && <CartSheet cart={cart} setCart={setCart} onClose={() => setCartOpen(false)} />}
      {scanning && (
        <Scanner
          continuous
          title="Scan items"
          hint="Point at each item's barcode"
          onDetect={onScan}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------- weighed items */

function WeightSheet({
  product,
  onAdd,
  onClose,
}: {
  product: Product
  onAdd: (grams: number, lineTotal: number) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'weight' | 'amount'>('weight')
  const [unit, setUnit] = useState<'g' | 'kg'>('g')
  const [text, setText] = useState('')

  let grams: number | null = null
  let total: number | null = null
  if (mode === 'weight') {
    grams = parseGrams(text, unit)
    total = grams ? priceForGrams(product.price, grams) : null
  } else {
    const amount = toCentavos(text)
    if (amount && amount > 0) {
      grams = gramsForAmount(product.price, amount)
      total = amount // exactly what the customer paid, not a recomputed figure
    }
  }
  const ready = !!grams && total !== null

  const quick =
    mode === 'weight'
      ? [
          { label: '¼ kg', set: () => { setUnit('g'); setText('250') } },
          { label: '½ kg', set: () => { setUnit('g'); setText('500') } },
          { label: '1 kg', set: () => { setUnit('g'); setText('1000') } },
          { label: '2 kg', set: () => { setUnit('g'); setText('2000') } },
        ]
      : [5, 10, 20, 50, 100].map((pesos) => ({ label: `₱${pesos}`, set: () => setText(String(pesos)) }))

  return (
    <Sheet
      title={`${product.name} · ${formatPrice(product.price, 'weight')}`}
      onClose={onClose}
      footer={
        <button
          className={`${btn.primary} w-full`}
          disabled={!ready}
          onClick={() => ready && onAdd(grams!, total!)}
        >
          Add to cart
        </button>
      }
    >
      <div className="space-y-3">
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m)
            setText('')
          }}
          options={[
            { value: 'weight', label: 'By weight' },
            { value: 'amount', label: 'By amount (₱)' },
          ]}
        />
        <div className="flex gap-2">
          <input
            autoFocus
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'weight' ? 'Weight' : 'Amount in pesos'}
            className={inputCls}
            aria-label={mode === 'weight' ? 'Weight' : 'Amount in pesos'}
          />
          {mode === 'weight' && (
            <div className="w-32 shrink-0">
              <Segmented
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'g', label: 'g' },
                  { value: 'kg', label: 'kg' },
                ]}
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <button key={q.label} type="button" className={btn.chip} onClick={q.set}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="rounded-xl bg-brand-50 p-4 text-center">
          {ready ? (
            <span className="text-2xl font-bold text-brand-800">
              {mode === 'weight' ? formatPeso(total!) : formatWeight(grams!)}
            </span>
          ) : (
            <span className="text-slate-500">
              {mode === 'weight' ? 'Enter the weight to see the price' : 'Enter the amount to see the weight'}
            </span>
          )}
        </div>
        {grams !== null && grams > product.stock && (
          <p className="text-sm text-amber-700">
            Only {formatWeight(Math.max(product.stock, 0))} in stock. You can still add it.
          </p>
        )}
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------- cart */

function CartSheet({
  cart,
  setCart,
  onClose,
}: {
  cart: CartLine[]
  setCart: SetCart
  onClose: () => void
}) {
  const toast = useToast()
  const { showReceipt } = useReceipt()
  const settings = useSettings()
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), [])
  const total = cartTotal(cart)
  const [method, setMethod] = useState<PayMethod>('cash')
  const [tenderedText, setTenderedText] = useState('')
  const [customerId, setCustomerId] = useState('') // '' | 'new' | customer id
  const [newName, setNewName] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const online = method === 'gcash' || method === 'maya' ? method : null
  const refStatus = useReferenceStatus(online, reference)

  // Removing the last line closes the sheet.
  useEffect(() => {
    if (cart.length === 0) onClose()
  }, [cart.length, onClose])

  const tendered = tenderedText.trim() === '' ? total : toCentavos(tenderedText)
  const cashShort = method === 'cash' && (tendered === null || tendered < total)
  const change = method === 'cash' && tendered !== null ? tendered - total : 0
  const utangReady =
    method !== 'utang' || (customerId === 'new' ? newName.trim() !== '' : customerId !== '')
  const refReady = !online || refStatus === 'ok'
  const canConfirm = cart.length > 0 && !cashShort && utangReady && refReady && !busy

  const cashChips = [...new Set([50, 100, 200, 500, 1000].map((p) => p * 100).filter((c) => c >= total))]

  async function confirm() {
    setBusy(true)
    const res = await toast.run(async () => {
      let cid: number | undefined
      if (method === 'utang') cid = customerId === 'new' ? await addCustomer(newName) : Number(customerId)
      return checkout(cart, {
        method,
        tendered: method === 'cash' ? (tendered ?? undefined) : undefined,
        customerId: cid,
        reference: online ? normalizeReference(reference) : undefined,
      })
    })
    setBusy(false)
    if (!res.ok) return
    const sale = res.value
    setCart([])
    onClose()
    if (settings.autoReceipt) {
      showReceipt({ kind: 'sale', id: sale.id })
    } else {
      toast.show(sale.change ? `Saved · change ${formatPeso(sale.change)}` : 'Saved', 'ok', {
        label: 'Receipt',
        onClick: () => showReceipt({ kind: 'sale', id: sale.id }),
      })
    }
  }

  return (
    <Sheet
      title={`Total ${formatPeso(total)}`}
      onClose={onClose}
      footer={
        <button className={`${btn.primary} w-full`} disabled={!canConfirm} onClick={confirm}>
          {busy ? 'Saving…' : `Confirm ${formatPeso(total)}`}
        </button>
      }
    >
      <ul className="divide-y divide-slate-100">
        {cart.map((l) => (
          <li key={l.key} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{l.name}</div>
              {l.unitType === 'weight' && !l.step && (
                <div className="text-sm text-slate-500">{formatWeight(l.qty)}</div>
              )}
            </div>
            {l.step ? (
              <div className="flex items-center gap-1">
                <button
                  className="h-10 w-10 rounded-full border border-slate-300 text-xl active:bg-slate-100"
                  aria-label={`Less ${l.name}`}
                  onClick={() => setCart((c) => stepLine(c, l.key, -1))}
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold">{Math.round(l.qty / l.step.qty)}</span>
                <button
                  className="h-10 w-10 rounded-full border border-slate-300 text-xl active:bg-slate-100"
                  aria-label={`More ${l.name}`}
                  onClick={() => setCart((c) => stepLine(c, l.key, +1))}
                >
                  +
                </button>
              </div>
            ) : (
              <button
                className="h-10 w-10 rounded-full text-xl text-red-600 active:bg-red-50"
                aria-label={`Remove ${l.name}`}
                onClick={() => setCart((c) => removeLine(c, l.key))}
              >
                ×
              </button>
            )}
            <div className="w-20 text-right font-semibold">{formatPeso(l.lineTotal)}</div>
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-3">
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'gcash', label: 'GCash' },
            { value: 'maya', label: 'Maya' },
            { value: 'utang', label: 'Utang' },
          ]}
        />

        {method === 'cash' && (
          <>
            <input
              inputMode="decimal"
              value={tenderedText}
              onChange={(e) => setTenderedText(e.target.value)}
              placeholder={`Cash received (exact ${formatPeso(total)})`}
              className={inputCls}
              aria-label="Cash received"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn.chip} onClick={() => setTenderedText('')}>
                Exact
              </button>
              {cashChips.map((c) => (
                <button key={c} type="button" className={btn.chip} onClick={() => setTenderedText(String(c / 100))}>
                  ₱{c / 100}
                </button>
              ))}
            </div>
            <div className="rounded-xl bg-brand-50 p-3 text-center text-lg font-bold">
              {cashShort ? (
                <span className="text-red-600">
                  Short {tendered === null ? '' : formatPeso(total - tendered)}
                </span>
              ) : (
                <span className="text-brand-800">Change {formatPeso(change)}</span>
              )}
            </div>
          </>
        )}

        {online && (
          <ReferenceField provider={online} value={reference} onChange={setReference} status={refStatus} />
        )}

        {method === 'utang' && (
          <>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls} aria-label="Customer">
              <option value="">Choose customer…</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="new">+ New customer</option>
            </select>
            {customerId === 'new' && (
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Customer name"
                className={inputCls}
                aria-label="New customer name"
              />
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
