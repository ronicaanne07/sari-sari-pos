# Tindahan POS

An offline-first point of sale for a sari-sari store, built to run on a budget Android phone. Includes local storage, finance ledgers, and an optional Supabase snapshot-sync foundation.
Sells by the piece **and** by weight (kg), tracks stock, keeps an utang (credit) ledger, and
works with no internet. All data lives on the phone in IndexedDB.

**Stack:** React 19 · TypeScript · Vite · Tailwind CSS 4 · Dexie (IndexedDB) · vite-plugin-pwa · Vitest

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (also printed as a network URL for your phone)
npm test           # unit tests (money/weight maths, checkout, void, utang, summary, backup)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

The first launch loads a sample catalogue (rice, sugar, eggs, noodles...) so you can try it
straight away. **Summary → Your data** can delete it or load it again.

**Installing on a phone / working offline** needs HTTPS (browsers only allow service workers on
`localhost` or HTTPS). Deploy the `dist/` folder to any static host (Cloudflare Pages, Netlify,
Vercel, GitHub Pages), open the link in Chrome on the phone, and choose *Add to Home screen*.
After the first visit it works without internet.

## What's in it

| Tab | What it does |
|---|---|
| **Sell** | Tap items to add them. Weighed items open a sheet: enter **weight** (g or kg) to get the price, or an **amount** ("₱20 worth") to get the weight. Pack tiles (box, tray, sack) sell a whole pack. Pay by cash (with change), GCash, Maya, or utang. Search box also accepts a keyboard-style barcode scanner. |
| **Products** | Add/edit products, packs, low-stock levels, barcodes. **Restock** by pack or loose, recount stock, record spoilage. Archive instead of deleting. |
| **Utang** | Customers and balances. Receive payments, add manual utang, see the history. Utang sales are added automatically. |
| **Summary** | Sales, estimated profit, cash collected, per-method totals, low-stock list, day-by-day history, **void** a sale. Backup/restore and optional cloud snapshot controls. |
| **Finance** | Record purchases and operating expenses; review recent entries and monthly totals. |

## How the data works

- **Money is integer centavos, weight is integer grams.** Never floats: `0.1 + 0.2 !== 0.3`.
  Helpers are in `src/lib/money.ts`.
- **Prices for weighed items are per kilogram**, stock is in grams. `₱52.00/kg` and 750 g gives
  `Math.round(5200 × 750 / 1000) = ₱39.00`. "₱20 worth" keeps exactly ₱20 as the line total.
- **Packs** (`productPacks`): "Box of 24", "Sack 25 kg". Restocking 2 boxes adds 48 pieces and can
  refresh the per-piece cost. Selling a piece takes one from the same stock (tingi works naturally).
- **Sales are an append-only ledger.** Nothing is edited after the fact: a *void* is a new row
  with negative amounts pointing at the original (`voidOf`). Stock and utang are put back in the
  same transaction. A sale can only be voided once.
- **Checkout is one transaction**: sale, items, stock deduction and utang entry are all saved or none are.
- **Stock may go negative.** A wrong count should never stop a customer from paying; negative
  and low stock show up in red/amber and on the Summary restock list.
- **Every stock change leaves a trail** in `stockMovements` (sale, void, restock, recount, spoilage).

```
src/
  db/db.ts          Dexie schema + types (products, packs, sales, items, customers, credit, stock movements)
  db/actions.ts     all writes: checkout, voidSale, restock, adjustStock, utang payments, daily summary
  db/backup.ts      export / import / reset
  db/seed.ts        sample catalogue
  lib/money.ts      centavo & gram helpers, weight <-> price maths
  lib/cart.ts       pure cart functions
  lib/units.ts      formatting/parsing for piece vs weight fields
  pages/            Sell, Products, Utang, Summary
  ui.tsx            shared UI (sheet, toast, buttons)
```

## Backups

Until cloud sync exists, the phone holds the only copy. **Summary → Download backup** writes a
JSON file; **Restore from backup** replaces everything with it. The app also asks the browser
for persistent storage so data isn't evicted when the phone is low on space. If the owner
clears Chrome's "site data" or uninstalls the app, the data is gone, so back up regularly.

## Not built yet (suggested order)

1. **Load / GCash / Maya cash-in & cash-out** as their own transaction types with their own margins.
2. **Camera barcode scanning** (the `BarcodeDetector` API or ZXing). The `barcode` field and lookup already exist.
3. **Owner PIN** to protect Products, voids, and Summary from the cashier.
4. **Cloud backup** to Supabase (Postgres + auth). Every row has a stable integer id and `createdAt`, so an
   append-only sync is straightforward. Move ids to UUIDs before multi-device sync.
5. **Receipts** (share as text/image, then Bluetooth ESC/POS printing) and Filipino/English labels.
6. Reports: best sellers, profit per item, utang aging.

## Notes

- Profit is an estimate: selling price minus the cost recorded at the time of sale.
- "Cash collected" assumes utang payments are received in cash.
- Prices in the sample data are illustrative.
