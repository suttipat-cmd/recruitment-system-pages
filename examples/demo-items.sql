-- OPTIONAL DEMO ONLY. Ask the project owner to review/run this in their SQL Editor.
-- Creates a NEW public demo table. Stops if items already exists; never drops existing data.
-- Anyone with the public key may READ and INSERT demo rows. Do not use for private data.
begin;
create table public.items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now()
);
alter table public.items enable row level security;
grant usage on schema public to anon;
grant select, insert on table public.items to anon;
create policy "demo_read_items" on public.items for select to anon using (true);
create policy "demo_insert_items" on public.items for insert to anon
  with check (char_length(btrim(title)) between 1 and 120);
commit;
