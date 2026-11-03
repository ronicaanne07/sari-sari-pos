# Tindahan POS

An offline-first point of sale for a sari-sari store, built to run on a budget Android phone.
Sells by the piece **and** by weight (kg), tracks stock, keeps an utang (credit) ledger, handles
GCash/Maya payments with reference numbers and cash-in/cash-out, scans barcodes with the phone
camera, and prints or shares receipts. It works with no internet. All data lives on the phone in IndexedDB.

**Stack:** React 19 · TypeScript · Vite · Tailwind CSS 4 · Dexie (IndexedDB) · ZXing · vite-plugin-pwa · Vitest

## Run it

1. Install Node.js (LTS) from nodejs.org.
2. In the project folder:

```bash
npm install
npm run dev        # http://localhost:5173  (also printed as a network URL for your phone)
npm test           # unit tests
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

The first launch loads a sample catalogue (rice, sugar, eggs, noodles...) so you can try it
straight away. **Summary → Your data** can delete it or load it again.

**Camera scanning, installing on a phone and working offline all need HTTPS** (browsers only allow
the camera and service workers on `localhost` or HTTPS). Deploy the `dist/` folder to any static host
(Cloudflare Pages, Netlify, Vercel, GitHub Pages), open the link in Chrome on the phone, and choose
*Add to Home screen*. After the first visit it works without internet, including the barcode reader.

## What's in it

| Tab | What it does |
|---|---|
| **Sell** | Tap items to add them, or **📷 Scan** barcodes one after another. Weighed items open a sheet: enter **weight** (g or kg) to get the price, or an **amount** ("₱20 worth") to get the weight. Pack tiles sell a whole pack. Pay by cash (with change), **GCash / Maya (reference number required)**, or utang. After each sale tap **Receipt**. |
| **Products** | Add/edit products, packs, low-stock levels. Scan a barcode into a product with the camera. **Restock** by pack or loose, recount stock, record spoilage. Archive instead of deleting. |
| **Wallet** | GCash / Maya **cash-in and cash-out** with a suggested fee, clear instructions ("customer gives you ₱510, send ₱500 from your GCash"), reference number, receipt, and void. |
| **Utang** | Customers and balances. Receive payments by cash, GCash or Maya (with reference), add manual utang, see the history and print payment receipts. |
| **Summary** | Sales, estimated profit, cash in the drawer, per-method totals, wallet fees, low-stock list, day-by-day history, receipts, **void**. **⚙ Settings** for store name, receipt footer, auto-receipt and fee suggestion. Backup and restore. |

## Online payments and reference numbers

- GCash and Maya payments **cannot be saved without a reference number** (at least 4 characters).
  The field checks as you type: too short, already used, or OK.
- A reference can be used **once per provider**, across sales, utang payments and wallet transactions.
  The same payment screenshot shown twice is rejected. Capitalisation and spaces are ignored
  (`5034 112 887` equals `5034112887`). GCash and Maya are checked separately.
- A voided sale **keeps** its reference reserved: the money arrived once, so it can't be reused.
- The app cannot check with GCash or Maya that the money really arrived. Always confirm the payment in
  your own app before saving. The reference only stops the same one being used twice.

### Cash-in / cash-out maths

| | Customer hands you | You hand over / send | Your earning |
|---|---|---|---|
| **Cash-in** ₱500, fee ₱10 | cash ₱510 | send ₱500 from your wallet | ₱10 |
| **Cash-out** ₱1,000, fee ₱20 | sends you ₱1,020 in the app | cash ₱1,000 | ₱20 |

The Summary adds the fees to profit and the cash effect (cash-in adds, cash-out takes) to
"Cash in drawer today".

## Barcode scanning

- **📷 Scan** on Sell keeps the camera open and adds each item as you point at it. The same code is
  ignored for 2 seconds so one item is not added five times. Weighed items stop and ask for the weight.
- **📷 Scan** next to the barcode field in Products fills it from the camera.
- There is always a box to **type the code**, for dim shops, damaged labels or a denied camera. A
  Bluetooth/USB keyboard-style scanner typing into the search box also works.
- Reads EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, ITF and QR. Uses the phone's built-in
  `BarcodeDetector` when it has one (Chrome on Android) and ZXing otherwise (iPhone, desktop).
  UPC-A and EAN-13 versions of the same code match each other.
- The flashlight button appears on phones that allow it.

## Receipts

Open from the **Receipt** button after a sale, wallet transaction or utang payment, from the Summary and
Wallet lists, or automatically after every sale (Settings). Receipts are 32 characters wide, like a 58 mm
roll. **Share** sends an image through the phone's share menu (Messenger, Viber, SMS...), **Save image**
downloads it, **Copy text** copies plain text, and **Print** uses the phone's print dialog (works with
printers that Android can print to). Voids print as `*** VOID ***` and point at the original receipt.

Direct Bluetooth thermal printing (raw ESC/POS) is not included.

## How the data works

- **Money is integer centavos, weight is integer grams.** Never floats: `0.1 + 0.2 !== 0.3`.
  Helpers are in `src/lib/money.ts`.
- **Prices for weighed items are per kilogram**, stock is in grams. `₱52.00/kg` and 750 g gives
  `Math.round(5200 × 750 / 1000) = ₱39.00`. "₱20 worth" keeps exactly ₱20 as the line total.
- **Packs** (`productPacks`): "Box of 24", "Sack 25 kg". Restocking 2 boxes adds 48 pieces and can
  refresh the per-piece cost. Selling a piece takes one from the same stock (tingi works naturally).
- **Sales and wallet transactions are append-only ledgers.** Nothing is edited after the fact: a *void* is a
  new row with negative amounts pointing at the original (`voidOf`). Stock and utang are put back in the
  same transaction. Each can only be voided once.
- **Checkout is one transaction**: sale, items, stock deduction and utang entry are all saved or none are.
- **Stock may go negative.** A wrong count should never stop a customer from paying; negative and low
  stock show in red/amber and on the Summary restock list.
- **Every stock change leaves a trail** in `stockMovements`.
- **Upgrades keep your data.** The database is versioned (now v2). A phone that ran the first version
  upgrades in place, which is covered by a test. Old backups still restore.

```
src/
  db/db.ts           Dexie schema + types (v2)
  db/actions.ts      all writes: checkout, voidSale, restock, utang, wallet, reference checks, daily summary
  db/receipts.ts     loads what a receipt needs from the database
  db/settings.ts     store name, receipt footer, fee suggestion
  db/backup.ts       export / import / reset
  db/seed.ts         sample catalogue
  lib/money.ts       centavo & gram helpers, weight <-> price maths
  lib/cart.ts        pure cart functions
  lib/wallet.ts      cash-in/out effects, fee suggestion, reference normalising
  lib/receipt.ts     receipt text layout (pure, unit tested)
  lib/receiptImage.ts   receipt as a PNG
  lib/scanner.ts     BarcodeDetector with lazy-loaded ZXing fallback
  lib/barcode.ts     barcode matching
  components/        Scanner, ReceiptSheet, ReferenceField
  pages/             Sell, Products, Wallet, Utang, Summary
```

## Backups

Until cloud sync exists, the phone holds the only copy. **Summary → Download backup** writes a
JSON file; **Restore from backup** replaces everything with it. The app also asks the browser
for persistent storage so data isn't evicted when the phone is low on space. If the owner
clears Chrome's "site data" or uninstalls the app, the data is gone, so back up regularly.

## Not built yet (suggested order)

1. **Load (prepaid airtime) sales** with their own margins.
2. **Owner PIN** to protect Products, voids, Settings and Summary from the cashier.
3. **Cloud backup** to Supabase or a Laravel API (Postgres + auth). Every row has a stable integer id and
   `createdAt`, so an append-only sync is straightforward. Move ids to UUIDs before multi-device sync.
4. **Bluetooth thermal printer** (ESC/POS) and Filipino/English labels.
5. Reports: best sellers, profit per item, utang aging.

## Notes

- Profit is an estimate: selling price minus the cost recorded at the time of sale, plus wallet fees.
- "Cash in drawer today" counts cash sales, utang paid in cash, and wallet cash-in minus cash-out. It
  does not know your starting cash.
- Prices in the sample data are illustrative.
- `npm audit` reports advisories in build-time tools (the PWA plugin's dependencies). They do not ship
  to the phone. Check for updates with `npm outdated` before deploying.
