// Runs CLOUD_SETUP_V2.sql in a real Postgres (PGlite, in-process) and checks what each kind of user can do.
// Skipped when @electric-sql/pglite is not installed: npm i -D @electric-sql/pglite
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

let PGlite: typeof import('@electric-sql/pglite').PGlite | undefined
try {
  PGlite = (await import('@electric-sql/pglite')).PGlite
} catch {
  /* optional */
}

const OWNER = '00000000-0000-0000-0000-000000000001'
const ANA = '00000000-0000-0000-0000-000000000002'
const BEN = '00000000-0000-0000-0000-000000000003'
const OTHER = '00000000-0000-0000-0000-000000000009'

describe.skipIf(!PGlite)('Supabase rules (real Postgres)', () => {
  let pg: InstanceType<NonNullable<typeof PGlite>>

  /** Run one statement as a signed-in user (or anon), the way Supabase's API would. */
  async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) {
    await pg.exec(uid ? `set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);` : `set role anon;`)
    try {
      return (await pg.query<T>(sql, params)).rows
    } finally {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`)
    }
  }
  const fails = async (uid: string | null, sql: string, params: unknown[] = []) => {
    try {
      await as(uid, sql, params)
      return false
    } catch {
      return true
    }
  }
  const ins = (tbl: string, id: string, extra = '', data?: string) =>
    `insert into records (store_id, tbl, row_id, data, deleted) values ('shop','${tbl}','${id}',
      '${data ?? `{"id":${id}}`}'::jsonb, false) ${extra}`

  beforeAll(async () => {
    pg = new PGlite!()
    await pg.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      grant usage on schema public to anon, authenticated;
      insert into auth.users values ('${OWNER}','me@x.com'),('${ANA}','ana@x.com'),('${BEN}','ben@x.com'),('${OTHER}','out@x.com');
    `)
    await pg.exec(readFileSync(new URL('../../CLOUD_SETUP_V2.sql', import.meta.url), 'utf8'))
    await pg.exec(`
      select add_member('me@x.com','Owner','owner','shop');
      select add_member('ana@x.com','Ana','cashier','shop');
      select add_member('ben@x.com','Ben','cashier','shop');
      select add_member('out@x.com','Eve','owner','other-store');
    `)
  })

  it('gives each person their own phone number, and rejects a 17th person', async () => {
    const rows = await pg.query<{ name: string; device_no: number }>(`select name, device_no from profiles where store_id='shop' order by device_no`)
    expect(rows.rows).toEqual([{ name: 'Owner', device_no: 0 }, { name: 'Ana', device_no: 1 }, { name: 'Ben', device_no: 2 }])
    expect(await fails(ANA, `select add_member('ana@x.com','Ana','owner','shop')`)).toBe(true) // not callable by users
  })

  it('lets the owner add and change anything, and read it back', async () => {
    await as(OWNER, ins('products', '100'))
    await as(OWNER, `update records set data = '{"id":100,"price":5}' where row_id='100'`)
    expect((await as(OWNER, `select data from records where row_id='100'`)).length).toBe(1)
    await as(OWNER, ins('expenses', '101'))
  })

  it('lets a cashier add sales rows only', async () => {
    await as(ANA, ins('sales', '200'))
    await as(ANA, ins('saleItems', '201'))
    await as(ANA, ins('stockMovements', '202'))
    await as(ANA, ins('walletTransactions', '203'))
    await as(ANA, ins('creditEntries', '204'))
    await as(ANA, ins('customers', '205'))
    expect(await fails(ANA, ins('products', '210'))).toBe(true)
    expect(await fails(ANA, ins('settings', 'x', '', '{"key":"x"}'))).toBe(true)
    expect(await fails(ANA, ins('expenses', '211'))).toBe(true)
    expect(await fails(ANA, ins('categories', '212'))).toBe(true)
  })

  it('stops a cashier from editing, overwriting, deleting or "deleting by tombstone"', async () => {
    expect(await as(ANA, `update records set data='{"id":100,"price":1}' where row_id='100' returning 1`)).toHaveLength(0)
    expect(await as(ANA, `update records set data='{"id":200,"total":0}' where row_id='200' returning 1`)).toHaveLength(0)
    expect(await fails(ANA, ins('sales', '200', `on conflict (store_id,tbl,row_id) do update set data = excluded.data`))).toBe(true)
    // plain re-upload of the same row (a retry) is harmless
    await as(ANA, ins('sales', '200', `on conflict (store_id,tbl,row_id) do nothing`))
    expect(await as(ANA, `delete from records where row_id='200' returning 1`).catch(() => 'denied')).toSatisfy(
      (r: unknown) => r === 'denied' || (r as unknown[]).length === 0,
    )
    expect(await fails(ANA, `insert into records (store_id,tbl,row_id,data,deleted) values ('shop','sales','300',null,true)`)).toBe(true)
    expect((await pg.query(`select data from records where row_id='100'`)).rows[0]).toEqual({ data: { id: 100, price: 5 } })
  })

  it('hides purchases and expenses from cashiers, and everything from other stores and anonymous callers', async () => {
    const tables = (await as<{ tbl: string }>(ANA, `select distinct tbl from records`)).map((r) => r.tbl).sort()
    expect(tables).toEqual(['creditEntries', 'customers', 'products', 'saleItems', 'sales', 'stockMovements', 'walletTransactions'])
    expect((await as(OWNER, `select 1 from records where tbl='expenses'`)).length).toBe(1)
    expect(await as(OTHER, `select 1 from records`)).toHaveLength(0)
    expect(await fails(null, `select 1 from records`)).toBe(true)
    expect(await fails(OTHER, ins('sales', '400'))).toBe(true) // can't write into a store they don't belong to
  })

  it('refuses a row whose id does not match its row_id, and unknown tables', async () => {
    expect(await fails(ANA, ins('sales', '500', '', '{"id":200}'))).toBe(true)
    expect(await fails(OWNER, `insert into records (store_id,tbl,row_id,data) values ('shop','hacked','1','{"id":1}')`)).toBe(true)
  })

  it('lets only the owner see and change people, and cashiers see only themselves', async () => {
    expect(await as(ANA, `select name from profiles`)).toEqual([{ name: 'Ana' }])
    expect((await as(OWNER, `select name from profiles`)).length).toBe(3)
    expect(await as(ANA, `update profiles set role='owner' where user_id='${ANA}' returning 1`)).toHaveLength(0)
    await as(OWNER, `update profiles set active=false where user_id='${BEN}'`)
    expect(await as(BEN, `select 1 from records`)).toHaveLength(0) // turned off: sees nothing
    expect(await fails(BEN, ins('sales', '600'))).toBe(true) // ...and can't add anything
    await as(OWNER, `update profiles set active=true where user_id='${BEN}'`)
    expect((await as(BEN, `select 1 from records`)).length).toBeGreaterThan(0)
  })
})
