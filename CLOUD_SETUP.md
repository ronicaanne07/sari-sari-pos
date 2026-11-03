# Cloud database setup (Supabase)

## What this version does
- Keeps the existing offline-first IndexedDB database and existing sales, stock, customers, packs, utang and backup workflows.
- Adds purchase-total and expense ledgers stored locally and included in backups.
- Adds a Finance tab with monthly purchase/expense totals and recent entries.
- Adds explicit upload/download of a versioned full database snapshot to Supabase. Cloud data is shared by devices configured with the same Store ID.

## Important sync limitation
This is **snapshot sync**, not real-time row-level synchronization. Upload replaces the store's cloud snapshot; download replaces the current device's local database. Always make a local backup first, and only have one device making changes at a time. Concurrent changes are not merged. A later production iteration should add Supabase Auth, per-row UUIDs, conflict handling, and real-time synchronization.

## Create Supabase project
1. Create a project at https://supabase.com/.
2. Open SQL Editor and run `supabase/migrations/202610220001_pos_snapshots.sql`.
3. Configure Supabase Auth and restrict snapshot access to approved store users before production use. The migration grants access only to authenticated users; this current UI does not yet implement sign-in, so the cloud buttons will not work until an authenticated session mechanism is added. Do not make the table publicly readable/writable as a workaround.
4. Copy `.env.example` to `.env` and set the project URL, publishable/anon key, and a consistent `VITE_POS_STORE_ID` for the store. Never use a `service_role` key in frontend environment variables.
5. Run `npm install`, `npm run dev`, `npm test`, and `npm run build`.

## Finance entries
- Purchases currently record a supplier, total amount and note. They do not yet create purchase line items or automatically increase product stock; use the existing Products → Restock flow to update inventory.
- Expenses record category, amount, payment method and note.
- Monetary amounts are stored as integer centavos. Finance entries are included in JSON backup/restore and cloud snapshots.

## Deployment
Build with `npm run build` and deploy `dist/` to a static host. Set the same environment variables in the hosting provider. Vite environment variables are public to the browser; never put private server keys there.
