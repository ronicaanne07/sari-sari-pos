import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  type Product,
  type ProductPack,
  type UnitType,
  type Category,
} from '../db/db'
import {
  adjustStock,
  createCategory,
  createPack,
  createProduct,
  deleteArchivedProducts,
  deleteCategory,
  deletePack,
  deleteProduct,
  renameCategory,
  restock,
  restockPack,
  updateProduct,
} from '../db/actions'
import { formatPeso, toCentavos } from '../lib/money'
import { formatPrice, formatStock, parseStock, pesoToInput, stockToInput } from '../lib/units'
import { barcodeKey } from '../lib/barcode'
import { Scanner } from '../components/Scanner'
import { Field, PageHeader, Segmented, Sheet, btn, inputCls, useToast } from '../ui'

export function Products() {
  const toast = useToast()
  const products = useLiveQuery(() => db.products.toArray(), [])
  const categories = useLiveQuery(
      () => db.categories.orderBy('sortOrder').toArray(),
      []
    )

  const [showCategories, setShowCategories] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<number | 'all' | 'uncategorized' >('all')
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [restocking, setRestocking] = useState<Product | null>(null)

  const archivedCount = (products ?? []).filter((p) => p.archived).length

  async function removeAllArchived() {
    if (archivedCount === 0) return
    const many = archivedCount === 1 ? '1 archived product' : `all ${archivedCount} archived products`
    if (
      !window.confirm(
        `Permanently delete ${many}?\n\nPast sales and receipts keep their records. The products, their packs and barcodes are removed from every phone. This cannot be undone.`,
      )
    )
      return
    await toast.run(async () => {
      await deleteArchivedProducts()
    }, `${archivedCount} archived product${archivedCount === 1 ? '' : 's'} deleted`)
  }

  const q = query.trim().toLowerCase()
  const list = (products ?? [])
    .filter((p) => p.archived === showArchived)

    // Search products
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (!!p.barcode && barcodeKey(p.barcode) === barcodeKey(query))
    )

    // Filter by category
    .filter((p) => {
      if (categoryFilter === 'all') return true

      if (categoryFilter === 'uncategorized') {
        return !p.categoryId
      }

      return p.categoryId === categoryFilter
    })

    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
      <PageHeader
        title="Products"
        right={
          <div className="flex gap-2">
            <button
              className={`${btn.secondary} py-2`}
              onClick={() => setShowCategories(true)}
            >
              Categories
            </button>

            <button
              className={`${btn.primary} py-2`}
              onClick={() => setEditing('new')}
            >
              + Add
            </button>
          </div>
        }
      />
      <div className="space-y-2 px-4 pt-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products"
          className={inputCls}
          aria-label="Search products"
        />
        {categories && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            <button
              className={categoryFilter === 'all' ? btn.primary : btn.chip}
              onClick={() => setCategoryFilter('all')}
            >
              All
            </button>

            <button
              className={
                categoryFilter === 'uncategorized' ? btn.primary : btn.chip
              }
              onClick={() => setCategoryFilter('uncategorized')}
            >
              Uncategorized
            </button>

            {categories.map((category) => (
              <button
                key={category.id}
                className={
                  categoryFilter === category.id ? btn.primary : btn.chip
                }
                onClick={() => setCategoryFilter(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived (hidden from Sell)
        </label>
        {showArchived && archivedCount > 0 && (
          <button className={`${btn.secondary} w-full border-red-300! text-red-700!`} onClick={removeAllArchived}>
            Delete {archivedCount === 1 ? 'the archived product' : `all ${archivedCount} archived products`} permanently
          </button>
        )}
      </div>

      {!products ? (
        <p className="p-6 text-center text-slate-500">Loading…</p>
      ) : list.length === 0 ? (
        <p className="p-6 text-center text-slate-500">
          {showArchived ? 'Nothing archived.' : 'No products. Tap + Add to create one.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 px-4 py-2">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(p)}>
                <div className="truncate font-medium">
                  {p.favorite && <span className="mr-1 text-amber-500">★</span>}
                  {p.name}
                </div>
                <div className="text-xs text-slate-400">
                  {categories?.find((c) => c.id === p.categoryId)?.name ?? 'Uncategorized'}
                </div>
                <div className="text-sm text-slate-500">
                  {formatPrice(p.price, p.unitType)} ·{' '}
                  <span className={p.stock <= 0 ? 'text-red-600' : p.stock <= p.lowStockAt ? 'text-amber-600' : ''}>
                    {formatStock(p.stock, p.unitType)} {p.unitType === 'piece' ? 'pcs' : ''} in stock
                  </span>
                </div>
              </button>
              {!p.archived && (
                <button className={btn.chip} onClick={() => setRestocking(p)}>
                  Restock
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <ProductSheet product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {restocking && <RestockSheet product={restocking} onClose={() => setRestocking(null)} />}
      {showCategories && (
        <CategoryManager
          onClose={() => setShowCategories(false)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------- add / edit product */

function ProductSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const toast = useToast()
  const categories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').toArray(),
    []
  )

  const [categoryId, setCategoryId] = useState(
    product?.categoryId ? String(product.categoryId) : ''
  )
  const isNew = product === null
  const [name, setName] = useState(product?.name ?? '')
  const [barcode, setBarcode] = useState(product?.barcode ?? '')
  const [unitType, setUnitType] = useState<UnitType>(product?.unitType ?? 'piece')
  const [price, setPrice] = useState(product ? pesoToInput(product.price) : '')
  const [cost, setCost] = useState(product ? pesoToInput(product.cost) : '')
  const [stock, setStock] = useState('')
  const [low, setLow] = useState(product ? stockToInput(product.lowStockAt, product.unitType) : '')
  const [favorite, setFavorite] = useState(product?.favorite ?? false)
  const [scanning, setScanning] = useState(false)

  const priceC = toCentavos(price)
  const costC = cost.trim() === '' ? 0 : toCentavos(cost)
  const stockU = parseStock(stock, unitType)
  const lowU = parseStock(low, unitType)
  const valid = name.trim() !== '' && priceC !== null && costC !== null && stockU !== null && lowU !== null

  async function save() {
    if (!valid) return
    const res = await toast.run(async () => {
      if (isNew) {
        await createProduct({
          name,
          barcode,
          unitType,
          price: priceC,
          cost: costC,
          stock: stockU,
          lowStockAt: lowU,
          favorite,
          categoryId: categoryId ? Number(categoryId) : undefined,
        })
      } else {
        await updateProduct(product.id, {
          name,
          barcode,
          price: priceC,
          cost: costC,
          lowStockAt: lowU,
          favorite,
          categoryId: categoryId ? Number(categoryId) : undefined,
        })
      }
    }, 'Saved')
    if (res.ok) onClose()
  }

  async function toggleArchive() {
    if (!product) return
    const res = await toast.run(
      () => updateProduct(product.id, { archived: !product.archived }),
      product.archived ? 'Restored to Sell' : 'Archived',
    )
    if (res.ok) onClose()
  }

  async function removeForever() {
    if (!product) return
    if (
      !window.confirm(
        `Permanently delete "${product.name}"?\n\nPast sales and receipts keep their records. The product, its packs and its barcode are removed from every phone. This cannot be undone.`,
      )
    )
      return
    const res = await toast.run(() => deleteProduct(product.id), 'Product deleted')
    if (res.ok) onClose()
  }

  const unitWord = unitType === 'weight' ? 'kg' : 'piece'

  return (
    <Sheet
      title={isNew ? 'New product' : 'Edit product'}
      onClose={onClose}
      footer={
        <button className={`${btn.primary} w-full`} disabled={!valid} onClick={save}>
          Save
        </button>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus={isNew} />
        </Field>
        <Field label="Sold by" hint={isNew ? undefined : 'Fixed when the product was created. To change it, archive this product and add a new one.'}>
          {isNew ? (
            <Segmented
              value={unitType}
              onChange={setUnitType}
              options={[
                { value: 'piece', label: 'Per piece' },
                { value: 'weight', label: 'By weight (kg)' },
              ]}
            />
          ) : (
            <div
              aria-label="Sold by"
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-100 px-3 py-3 text-base font-medium text-slate-700"
            >
              <span>{unitType === 'weight' ? 'By weight (kg)' : 'Per piece'}</span>
              <span aria-hidden="true">🔒</span>
            </div>
          )}
        </Field>
        <Field label="Category">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputCls}
          >
            <option value="">Uncategorized</option>

            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Selling price per ${unitWord} (₱)`}>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </Field>
          <Field label={`Cost per ${unitWord} (₱)`}>
            <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} />
          </Field>
        </div>
        {isNew && (
          <Field label={unitType === 'weight' ? 'Stock now (kg)' : 'Stock now (pieces)'}>
            <input inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value)} className={inputCls} />
          </Field>
        )}
        <Field
          label={unitType === 'weight' ? 'Low-stock alert at (kg)' : 'Low-stock alert at (pieces)'}
          hint="Shows on the Summary tab when stock reaches this level."
        >
          <input inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Barcode (optional)" hint="Scan it with the camera, a Bluetooth/USB scanner, or type it.">
          <div className="flex gap-2">
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} aria-label="Barcode" />
            <button type="button" className={`${btn.secondary} shrink-0 px-4`} onClick={() => setScanning(true)}>
              📷 Scan
            </button>
          </div>
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          <span>Favorite (shown first on Sell)</span>
        </label>

        {product && (
          <>
            <PacksEditor product={product} />
            <CorrectStock product={product} />
            <button className={`${btn.secondary} w-full`} onClick={toggleArchive}>
              {product.archived ? 'Restore to Sell' : 'Archive (hide from Sell)'}
            </button>
            {product.archived && (
              <button className={`${btn.danger} w-full`} onClick={removeForever}>
                Delete permanently
              </button>
            )}
          </>
        )}
      </div>
      {scanning && (
        <Scanner
          title="Scan the product barcode"
          onDetect={(code) => {
            setBarcode(code)
            setScanning(false)
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </Sheet>
  )
}

/** Bulk sizes: "Box of 24", "Sack 25 kg". Used for restocking and sold as their own tile on Sell. */
function PacksEditor({ product }: { product: Product }) {
  const toast = useToast()
  const packs = useLiveQuery(() => db.productPacks.where('productId').equals(product.id).toArray(), [product.id])
  const [name, setName] = useState('')
  const [units, setUnits] = useState('')
  const [packCost, setPackCost] = useState('')
  const [packPrice, setPackPrice] = useState('')

  const unitsU = parseStock(units, product.unitType)
  const costC = packCost.trim() === '' ? 0 : toCentavos(packCost)
  const priceC = toCentavos(packPrice)
  const valid = name.trim() !== '' && !!unitsU && costC !== null && priceC !== null

  async function add() {
    if (!valid) return
    const res = await toast.run(
      () => createPack(product.id, { name, unitsPerPack: unitsU, packCost: costC, packPrice: priceC }),
      'Pack added',
    )
    if (res.ok) {
      setName('')
      setUnits('')
      setPackCost('')
      setPackPrice('')
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <h3 className="mb-2 font-semibold">Packs / bulk sizes</h3>
      {packs?.map((k: ProductPack) => (
        <div key={k.id} className="flex items-center justify-between gap-2 py-1 text-sm">
          <span>
            <b>{k.name}</b> · {formatStock(k.unitsPerPack, product.unitType)}
            {product.unitType === 'piece' ? ' pcs' : ''} · cost {formatPeso(k.packCost)} · sells {formatPeso(k.packPrice)}
          </span>
          <button
            className="h-8 w-8 shrink-0 rounded-full text-red-600 active:bg-red-50"
            aria-label={`Delete ${k.name}`}
            onClick={() => toast.run(() => deletePack(k.id))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (Box of 24)" className={`${inputCls} col-span-2`} aria-label="Pack name" />
        <input inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} placeholder={product.unitType === 'weight' ? 'Kilos in pack' : 'Pieces in pack'} className={inputCls} aria-label="Units in pack" />
        <input inputMode="decimal" value={packCost} onChange={(e) => setPackCost(e.target.value)} placeholder="Pack cost ₱" className={inputCls} aria-label="Pack cost" />
        <input inputMode="decimal" value={packPrice} onChange={(e) => setPackPrice(e.target.value)} placeholder="Pack price ₱" className={`${inputCls} col-span-2`} aria-label="Pack price" />
        <button className={`${btn.secondary} col-span-2`} disabled={!valid} onClick={add}>
          Add pack
        </button>
      </div>
    </div>
  )
}

/** For stock counts and losses. Every change is recorded in the stock history. */
function CorrectStock({ product }: { product: Product }) {
  const toast = useToast()
  const [actual, setActual] = useState('')
  const [reason, setReason] = useState<'adjustment' | 'spoilage'>('adjustment')
  const actualU = actual.trim() === '' ? null : parseStock(actual, product.unitType)

  async function apply() {
    if (actualU === null) return
    const res = await toast.run(
      () => adjustStock(product.id, actualU - product.stock, reason),
      'Stock updated',
    )
    if (res.ok) setActual('')
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <h3 className="mb-1 font-semibold">Correct stock</h3>
      <p className="mb-2 text-sm text-slate-500">
        Now: {formatStock(product.stock, product.unitType)}
        {product.unitType === 'piece' ? ' pcs' : ''}. Type what is really on the shelf.
      </p>
      <Segmented
        value={reason}
        onChange={setReason}
        options={[
          { value: 'adjustment', label: 'Recount' },
          { value: 'spoilage', label: 'Spoiled / broken' },
        ]}
      />
      <div className="mt-2 flex gap-2">
        <input
          inputMode="decimal"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          placeholder={product.unitType === 'weight' ? 'Actual kg' : 'Actual pieces'}
          className={inputCls}
          aria-label="Actual stock"
        />
        <button className={btn.secondary} disabled={actualU === null || actualU === product.stock} onClick={apply}>
          Update
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- restock */

function RestockSheet({ product, onClose }: { product: Product; onClose: () => void }) {
  const toast = useToast()
  const packs = useLiveQuery(() => db.productPacks.where('productId').equals(product.id).toArray(), [product.id])
  const [choice, setChoice] = useState<string | null>(null) // pack id, 'loose', or null = first pack/loose
  const [count, setCount] = useState('')
  const [newCost, setNewCost] = useState('')
  const [updateCost, setUpdateCost] = useState(true)

  const selected = choice ?? (packs && packs.length > 0 ? String(packs[0].id) : 'loose')
  const pack = packs?.find((k) => String(k.id) === selected)
  const isPack = !!pack
  const qty = isPack ? Number(count) : parseStock(count, product.unitType)
  const qtyOk = isPack ? Number.isInteger(qty) && (qty ?? 0) > 0 : !!qty
  const costC = newCost.trim() === '' ? undefined : toCentavos(newCost)

  async function save() {
    if (!qtyOk || qty === null) return
    const res = await toast.run(
      () =>
        pack
          ? restockPack(pack.id, qty, { updateCost })
          : restock(product.id, qty, { cost: costC ?? undefined }),
      'Stock added',
    )
    if (res.ok) onClose()
  }

  const options = [
    ...(packs ?? []).map((k) => ({ value: String(k.id), label: k.name })),
    { value: 'loose', label: product.unitType === 'weight' ? 'By kg' : 'By piece' },
  ]

  return (
    <Sheet
      title={`Restock ${product.name}`}
      onClose={onClose}
      footer={
        <button className={`${btn.primary} w-full`} disabled={!qtyOk} onClick={save}>
          Add to stock
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Now in stock: {formatStock(product.stock, product.unitType)}
          {product.unitType === 'piece' ? ' pcs' : ''}
        </p>
        <Segmented value={selected} onChange={setChoice} options={options} />
        <Field
          label={
            isPack
              ? `How many "${pack.name}"?`
              : product.unitType === 'weight'
                ? 'How many kg?'
                : 'How many pieces?'
          }
          hint={pack ? `Adds ${formatStock(Number(count || 0) * pack.unitsPerPack, product.unitType)}${product.unitType === 'piece' ? ' pcs' : ''}` : undefined}
        >
          <input autoFocus inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} className={inputCls} />
        </Field>
        {isPack ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
            Update cost from pack cost ({formatPeso(pack.packCost)})
          </label>
        ) : (
          <Field label={`New cost per ${product.unitType === 'weight' ? 'kg' : 'piece'} (₱, optional)`}>
            <input inputMode="decimal" value={newCost} onChange={(e) => setNewCost(e.target.value)} className={inputCls} />
          </Field>
        )}
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------- category management */

function CategoryManager({ onClose }: { onClose: () => void }) {
  const toast = useToast()

  const categories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').toArray(),
    []
  )

  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  function resetForm() {
    setName('')
    setEditingId(null)
  }

  async function saveCategory() {
    if (!name.trim()) return

    const res = await toast.run(
      async () => {
        if (editingId !== null) {
          await renameCategory(editingId, name)
        } else {
          await createCategory(name)
        }
      },
      editingId !== null ? 'Category updated' : 'Category added'
    )

    if (res.ok) {
      resetForm()
    }
  }

  async function removeCategory(category: Category) {
    const affected = await db.products
      .where('categoryId')
      .equals(category.id)
      .count()

    const confirmed = window.confirm(
      `Delete "${category.name}"?\n\n${affected} product(s) will become Uncategorized. Your products and sales records will not be deleted.`
    )

    if (!confirmed) return

    await toast.run(
      () => deleteCategory(category.id),
      `${affected} product(s) moved to Uncategorized`
    )

    if (editingId === category.id) {
      resetForm()
    }
  }

  return (
    <Sheet
      title="Manage categories"
      onClose={onClose}
    >
      <div className="space-y-4">

        <div className="rounded-xl border border-slate-200 p-3">
          <h3 className="mb-3 font-semibold">
            {editingId !== null ? 'Rename category' : 'Add new category'}
          </h3>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter category name"
            className={inputCls}
            autoFocus
          />

          <div className="mt-2 flex gap-2">

            <button
              className={`${btn.primary} flex-1`}
              disabled={!name.trim()}
              onClick={saveCategory}
            >
              {editingId !== null ? 'Save changes' : 'Add category'}
            </button>

            {editingId !== null && (
              <button
                className={btn.secondary}
                onClick={resetForm}
              >
                Cancel
              </button>
            )}

          </div>
        </div>

        <div>
          <h3 className="mb-2 font-semibold">
            Existing categories
          </h3>

          {!categories ? (
            <p className="text-sm text-slate-500">
              Loading categories...
            </p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-slate-500">
              No categories created yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">

              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between gap-2 py-3"
                >

                  <span className="font-medium">
                    {category.name}
                  </span>

                  <div className="flex gap-2">

                    <button
                      className={btn.chip}
                      onClick={() => {
                        setEditingId(category.id)
                        setName(category.name)
                      }}
                    >
                      Rename
                    </button>

                    <button
                      className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      onClick={() => removeCategory(category)}
                    >
                      Delete
                    </button>

                  </div>
                </div>
              ))}

            </div>
          )}
        </div>

      </div>
    </Sheet>
  )
}