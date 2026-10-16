-- Alveolar Modulação: tabelas e armazenamento dos projetos (rodar uma vez no SQL Editor do Supabase)

create table if not exists public.projetos (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  arquivo text,
  config jsonb,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);

alter table public.projetos enable row level security;

drop policy if exists "projetos do dono" on public.projetos;
create policy "projetos do dono" on public.projetos
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- arquivos DXF (privados, uma pasta por usuário)
insert into storage.buckets (id, name, public)
values ('projetos', 'projetos', false)
on conflict (id) do nothing;

drop policy if exists "dxf do dono - ler" on storage.objects;
drop policy if exists "dxf do dono - enviar" on storage.objects;
drop policy if exists "dxf do dono - alterar" on storage.objects;
drop policy if exists "dxf do dono - apagar" on storage.objects;
create policy "dxf do dono - ler" on storage.objects for select
  using (bucket_id = 'projetos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dxf do dono - enviar" on storage.objects for insert
  with check (bucket_id = 'projetos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dxf do dono - alterar" on storage.objects for update
  using (bucket_id = 'projetos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dxf do dono - apagar" on storage.objects for delete
  using (bucket_id = 'projetos' and (storage.foldername(name))[1] = auth.uid()::text);
