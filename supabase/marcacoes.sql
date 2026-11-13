-- Alveolar Modulação: marcação das peças pelo QR da etiqueta, SEM login (rodar uma vez no SQL Editor do Supabase)
-- Mexe só em tabelas e funções novas da modulação; não toca em nada do gestão.

create schema if not exists private;

-- chave secreta de cada obra (vai dentro do QR). Só o dono do projeto vê ou troca.
create table if not exists private.obra_chave (
  projeto uuid primary key references public.projetos(id) on delete cascade,
  chave text not null default replace(gen_random_uuid()::text, '-', ''),
  criada timestamptz not null default now()
);

-- histórico das marcações de cada peça
create table if not exists public.pecas_marcacao (
  id bigint generated always as identity primary key,
  projeto uuid not null references public.projetos(id) on delete cascade,
  peca text not null,
  etapa text not null check (etapa in ('pista', 'concretada', 'carregada', 'montada', 'problema', 'desfeita')),
  obs text,
  por text,
  em timestamptz not null default now()
);
create index if not exists pecas_marcacao_projeto on public.pecas_marcacao (projeto, peca, em);

-- o dono do projeto lê as marcações; ninguém grava direto (só pela função abaixo)
alter table public.pecas_marcacao enable row level security;
drop policy if exists "marcacoes do dono" on public.pecas_marcacao;
create policy "marcacoes do dono" on public.pecas_marcacao for select
  using (exists (select 1 from public.projetos p where p.id = projeto and p.owner = auth.uid()));

-- dono: pega (ou troca) a chave da obra
create or replace function public.obra_chave(p_projeto uuid, p_trocar boolean default false)
returns text language plpgsql security definer set search_path = public, private as $$
declare k text;
begin
  if not exists (select 1 from public.projetos where id = p_projeto and owner = auth.uid()) then
    raise exception 'sem permissão';
  end if;
  if p_trocar then delete from private.obra_chave where projeto = p_projeto; end if;
  insert into private.obra_chave (projeto) values (p_projeto) on conflict (projeto) do nothing;
  select chave into k from private.obra_chave where projeto = p_projeto;
  return k;
end $$;

-- celular (sem login): marca a peça, se a chave da etiqueta for a da obra
create or replace function public.marcar_peca(p_projeto uuid, p_chave text, p_peca text, p_etapa text, p_obs text default null, p_por text default null)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.obra_chave where projeto = p_projeto and chave = p_chave) then
    raise exception 'etiqueta inválida ou chave da obra trocada';
  end if;
  if p_etapa not in ('pista', 'concretada', 'carregada', 'montada', 'problema', 'desfeita') then raise exception 'etapa inválida'; end if;
  insert into public.pecas_marcacao (projeto, peca, etapa, obs, por)
  values (p_projeto, left(p_peca, 40), p_etapa, left(p_obs, 500), left(p_por, 80));
end $$;

-- celular (sem login): histórico da peça e nome da obra, com a chave
create or replace function public.situacao_peca(p_projeto uuid, p_chave text, p_peca text)
returns table (obra text, etapa text, obs text, por text, em timestamptz)
language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.obra_chave where projeto = p_projeto and chave = p_chave) then
    raise exception 'etiqueta inválida ou chave da obra trocada';
  end if;
  return query
    select pr.nome, m.etapa, m.obs, m.por, m.em
    from public.projetos pr left join public.pecas_marcacao m on m.projeto = pr.id and m.peca = p_peca
    where pr.id = p_projeto order by m.em;
end $$;

revoke all on function public.obra_chave(uuid, boolean) from public, anon;
grant execute on function public.obra_chave(uuid, boolean) to authenticated;
revoke all on function public.marcar_peca(uuid, text, text, text, text, text) from public;
grant execute on function public.marcar_peca(uuid, text, text, text, text, text) to anon, authenticated;
revoke all on function public.situacao_peca(uuid, text, text) from public;
grant execute on function public.situacao_peca(uuid, text, text) to anon, authenticated;
