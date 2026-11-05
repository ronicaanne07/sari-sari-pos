-- =====================================================================================
-- Tindahan POS: shared store for several phones, with owner and cashier accounts.
-- Run this ONCE in the Supabase SQL editor (after CLOUD_SETUP.sql). It is safe to run again.
-- =====================================================================================

-- 1. People ----------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  store_id   text not null,
  name       text not null,
  role       text not null check (role in ('owner', 'cashier')),
  active     boolean not null default true,
  device_no  int  not null check (device_no between 0 and 15),   -- makes row ids unique per phone
  created_at timestamptz not null default now(),
  unique (store_id, device_no)
);

-- Helpers the policies use. SECURITY DEFINER lets them read profiles without opening it up.
create or replace function public.my_store() returns text
  language sql stable security definer set search_path = public as
$$ select store_id from public.profiles where user_id = auth.uid() and active $$;

create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as
$$ select role from public.profiles where user_id = auth.uid() and active $$;

-- 2. The shared data -------------------------------------------------------------------
create table if not exists public.records (
  store_id   text not null,
  tbl        text not null check (tbl in (
               'products','productPacks','categories','customers','settings',
               'sales','saleItems','stockMovements','walletTransactions','creditEntries',
               'purchases','expenses')),
  row_id     text not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  primary key (store_id, tbl, row_id),
  -- a row can only describe itself: stops one row from carrying another row's id
  check (deleted
         or (tbl = 'settings' and data ->> 'key' = row_id)
         or (tbl <> 'settings' and data ->> 'id' = row_id))
);
create index if not exists records_pull on public.records (store_id, updated_at);

create or replace function public.records_touch() returns trigger
  language plpgsql as
$$ begin new.updated_at := clock_timestamp(); new.updated_by := auth.uid(); return new; end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- 3. Who can do what -------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.records  enable row level security;

revoke all on public.profiles, public.records from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.records to authenticated;   -- no delete for anyone

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or (store_id = public.my_store() and public.my_role() = 'owner'));

drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner on public.profiles for update to authenticated
  using      (store_id = public.my_store() and public.my_role() = 'owner')
  with check (store_id = public.my_store() and public.my_role() = 'owner');

-- everyone in the store reads the store data, except that cashiers never see purchases/expenses
drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated
  using (store_id = public.my_store()
         and (public.my_role() = 'owner' or tbl not in ('purchases', 'expenses')));

-- owner: add and change anything in their store
drop policy if exists records_insert_owner on public.records;
create policy records_insert_owner on public.records for insert to authenticated
  with check (store_id = public.my_store() and public.my_role() = 'owner');

drop policy if exists records_update_owner on public.records;
create policy records_update_owner on public.records for update to authenticated
  using      (store_id = public.my_store() and public.my_role() = 'owner')
  with check (store_id = public.my_store() and public.my_role() = 'owner');

-- cashier: ADD sales-type rows only. Cannot edit, cannot delete, cannot touch products or prices.
drop policy if exists records_insert_cashier on public.records;
create policy records_insert_cashier on public.records for insert to authenticated
  with check (store_id = public.my_store()
              and public.my_role() = 'cashier'
              and not deleted
              and tbl in ('sales', 'saleItems', 'stockMovements', 'walletTransactions', 'creditEntries', 'customers'));

-- 4. Adding people (run in this SQL editor; the app cannot create accounts) --------------
-- Step 1: Authentication > Users > Add user (email + password).  Step 2: run add_member.
create or replace function public.add_member(p_email text, p_name text, p_role text, p_store text default 'my-store')
returns text language plpgsql security definer set search_path = public, auth as
$$
declare uid uuid; dev int;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    raise exception 'No user with email %. Create it first under Authentication > Users.', p_email;
  end if;
  select coalesce((select device_no from public.profiles where user_id = uid), (
    select min(n) from generate_series(0, 15) n
    where n not in (select device_no from public.profiles where store_id = p_store))) into dev;
  if dev is null then raise exception 'A store can have at most 16 people.'; end if;
  insert into public.profiles (user_id, store_id, name, role, device_no)
  values (uid, p_store, p_name, p_role, dev)
  on conflict (user_id) do update
    set name = excluded.name, role = excluded.role, store_id = excluded.store_id, active = true;
  return p_name || ' is now ' || p_role || ' of ' || p_store || ' (phone number ' || dev || ')';
end $$;
revoke all on function public.add_member(text, text, text, text) from public, anon, authenticated;

-- Examples (change the emails, keep the store name the same for everyone):
--   select public.add_member('you@gmail.com',  'Ronica', 'owner',   'my-store');
--   select public.add_member('ana@gmail.com',  'Ana',    'cashier', 'my-store');
--   select public.add_member('ben@gmail.com',  'Ben',    'cashier', 'my-store');
-- Turn someone off:  update public.profiles set active = false where user_id = (select id from auth.users where email = 'ana@gmail.com');
