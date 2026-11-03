-- Shared full-snapshot storage for a single-owner/single-store deployment.
-- IMPORTANT: this policy is intentionally NOT public. Configure Supabase Auth and
-- sign in users before enabling client access. Do not expose a service_role key.
create table if not exists public.pos_snapshots (
  store_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.pos_snapshots enable row level security;
-- Restrict access to authenticated users. For a multi-store deployment, replace
-- this with membership-based policies and a store_members table.
create policy "authenticated users can read POS snapshots"
  on public.pos_snapshots for select to authenticated using (true);
create policy "authenticated users can insert POS snapshots"
  on public.pos_snapshots for insert to authenticated with check (true);
create policy "authenticated users can update POS snapshots"
  on public.pos_snapshots for update to authenticated using (true) with check (true);
grant select, insert, update on public.pos_snapshots to authenticated;
