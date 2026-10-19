-- Corré esto una sola vez en el SQL Editor de tu proyecto de Supabase.
-- Guarda, por misión, quién es su dueño + nombre personalizado + notas +
-- si está oculta. Los videos/fotos/audios NO se tocan: siguen en el
-- servidor del robot como siempre; esta tabla es solo metadata.

create table if not exists public.mission_records (
  mission_id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  custom_name text,
  notes text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mission_records_user_id_idx on public.mission_records (user_id);

alter table public.mission_records enable row level security;

-- Cada usuario solo puede ver/crear/editar/borrar sus propios registros.
-- Esto es lo que hace que "Misiones y datos" sea privado por cuenta.
create policy "mission_records_select_own" on public.mission_records
  for select using (auth.uid() = user_id);

create policy "mission_records_insert_own" on public.mission_records
  for insert with check (auth.uid() = user_id);

create policy "mission_records_update_own" on public.mission_records
  for update using (auth.uid() = user_id);

create policy "mission_records_delete_own" on public.mission_records
  for delete using (auth.uid() = user_id);
