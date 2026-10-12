-- Atlas Gourmet — esquema de Supabase
-- Pega esto entero en el SQL Editor de tu proyecto (https://supabase.com/dashboard/project/_/sql/new) y pulsa Run.

create extension if not exists pgcrypto;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('visited','wish')),
  name text not null,
  city text,
  country text,
  cuisine text,
  price smallint,
  rating numeric(3,1),
  stars smallint,
  date date,
  dishes text[] not null default '{}',
  wine text,
  companions text,
  notes text,
  reason text,
  priority smallint,
  target text,
  link text,
  fav boolean not null default false,
  lat double precision,
  lng double precision,
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.items enable row level security;

drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;

create policy "items_select_own" on public.items for select using (user_id = auth.uid());
create policy "items_insert_own" on public.items for insert with check (user_id = auth.uid());
create policy "items_update_own" on public.items for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "items_delete_own" on public.items for delete using (user_id = auth.uid());

-- Fotos: cubo privado. Nadie más puede leerlas; la app pide enlaces temporales firmados.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "photos_select_own" on storage.objects;
drop policy if exists "photos_insert_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;

create policy "photos_select_own" on storage.objects for select
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_insert_own" on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_update_own" on storage.objects for update
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_delete_own" on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
