-- Atlas Gourmet — migración v2
-- Pega esto en el SQL Editor de Supabase y pulsa Run (no borra nada, solo añade).

alter table public.items add column if not exists address text;
alter table public.items add column if not exists avg_price numeric(7,2);
