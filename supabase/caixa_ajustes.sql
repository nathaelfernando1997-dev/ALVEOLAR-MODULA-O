-- Alveolar Modulação: CAIXA DE ENTRADA DE AJUSTES (alterações enviadas pelo Claude para o dono aprovar).
-- Rodar uma vez no SQL Editor do Supabase. Só cria tabela, chave e funções novas: não mexe em nenhum projeto.
--
-- Como funciona:
--  - o Claude NÃO grava nos projetos. Ele só deixa uma proposta (quais ajustes mudam e o valor de antes) nesta caixa;
--  - quando o dono abre o projeto, o sistema mostra a proposta com [Aplicar] e [Recusar];
--  - o Claude se identifica com uma chave própria (só o "hash" dela fica guardado aqui); trocar ou apagar a chave corta o acesso.

create schema if not exists private;
create extension if not exists pgcrypto;

create table if not exists public.caixa_ajustes (
  id uuid primary key default gen_random_uuid(),
  projeto uuid not null references public.projetos(id) on delete cascade,
  criado timestamptz not null default now(),
  autor text not null default 'Claude',
  descricao text not null,
  mudancas jsonb not null,          -- { chaveDoAjuste: valorNovo, ... }  (só as chaves que mudam)
  antes jsonb,                      -- { chaveDoAjuste: valorDeAntes, ... } (para avisar se o projeto mudou depois)
  status text not null default 'pendente' check (status in ('pendente', 'aplicado', 'recusado')),
  resolvido timestamptz
);
create index if not exists caixa_ajustes_projeto on public.caixa_ajustes (projeto, status);

-- o dono vê e resolve (aplica/recusa) as propostas dos projetos dele
alter table public.caixa_ajustes enable row level security;
drop policy if exists "caixa do dono - ler" on public.caixa_ajustes;
drop policy if exists "caixa do dono - resolver" on public.caixa_ajustes;
create policy "caixa do dono - ler" on public.caixa_ajustes for select
  using (exists (select 1 from public.projetos p where p.id = projeto and p.owner = auth.uid()));
create policy "caixa do dono - resolver" on public.caixa_ajustes for update
  using (exists (select 1 from public.projetos p where p.id = projeto and p.owner = auth.uid()))
  with check (exists (select 1 from public.projetos p where p.id = projeto and p.owner = auth.uid()));

-- chave do Claude (guarda só o hash)
create table if not exists private.claude_chave (
  hash text primary key,
  criado timestamptz not null default now(),
  dono uuid                          -- de quem são os projetos que o Claude pode ver
);

-- a chave chega no cabeçalho "x-claude-token" da requisição
create or replace function private.claude_dono() returns uuid
language plpgsql security definer set search_path = public, private, extensions as $$
declare t text; d uuid;
begin
  t := coalesce(current_setting('request.headers', true)::json ->> 'x-claude-token', '');
  if length(t) < 20 then raise exception 'sem chave do Claude'; end if;
  select dono into d from private.claude_chave where hash = encode(digest(t, 'sha256'), 'hex');
  if d is null then raise exception 'chave do Claude inválida'; end if;
  return d;
end $$;

-- lista os projetos do dono (só nome e datas)
create or replace function public.claude_projetos()
returns table (id uuid, nome text, atualizado timestamptz)
language plpgsql security definer set search_path = public, private as $$
declare d uuid := private.claude_dono();
begin
  return query select p.id, p.nome, p.atualizado from public.projetos p where p.owner = d order by p.atualizado desc;
end $$;

-- lê os ajustes atuais de um projeto (para o Claude montar a proposta em cima da versão mais nova)
create or replace function public.claude_projeto(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare d uuid := private.claude_dono(); r jsonb;
begin
  select p.config into r from public.projetos p where p.id = p_id and p.owner = d;
  if r is null then raise exception 'projeto não encontrado'; end if;
  return r;
end $$;

-- deixa uma proposta na caixa (não altera o projeto)
create or replace function public.claude_enviar(p_projeto uuid, p_descricao text, p_mudancas jsonb, p_antes jsonb)
returns uuid
language plpgsql security definer set search_path = public, private as $$
declare d uuid := private.claude_dono(); novo uuid;
begin
  if not exists (select 1 from public.projetos p where p.id = p_projeto and p.owner = d) then raise exception 'projeto não encontrado'; end if;
  insert into public.caixa_ajustes (projeto, descricao, mudancas, antes) values (p_projeto, p_descricao, p_mudancas, p_antes) returning id into novo;
  return novo;
end $$;

-- o Claude vê o que já mandou e se foi aplicado
create or replace function public.claude_caixa(p_projeto uuid)
returns table (id uuid, criado timestamptz, descricao text, status text, resolvido timestamptz)
language plpgsql security definer set search_path = public, private as $$
declare d uuid := private.claude_dono();
begin
  return query select c.id, c.criado, c.descricao, c.status, c.resolvido from public.caixa_ajustes c
    join public.projetos p on p.id = c.projeto where c.projeto = p_projeto and p.owner = d order by c.criado desc;
end $$;

revoke all on function private.claude_dono() from public;
revoke all on function public.claude_projetos() from public;
revoke all on function public.claude_projeto(uuid) from public;
revoke all on function public.claude_enviar(uuid, text, jsonb, jsonb) from public;
revoke all on function public.claude_caixa(uuid) from public;
grant execute on function public.claude_projetos() to anon, authenticated;
grant execute on function public.claude_projeto(uuid) to anon, authenticated;
grant execute on function public.claude_enviar(uuid, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.claude_caixa(uuid) to anon, authenticated;

-- ===================== CRIAR A CHAVE DO CLAUDE (rodar junto, uma vez) =====================
-- Gera uma chave nova para o seu usuário e MOSTRA ela no resultado (copie para a tela segura do Claude,
-- nunca cole no chat). Para trocar a chave depois: rode de novo. Para cortar o acesso: delete from private.claude_chave;
set search_path = public, private, extensions;
delete from private.claude_chave;
with nova as (select encode(gen_random_bytes(24), 'hex') as t),
ins as (
  insert into private.claude_chave (hash, dono)
  select encode(digest(t, 'sha256'), 'hex'), (select id from auth.users where email = 'COLOQUE_SEU_EMAIL_AQUI') from nova
  returning dono
)
select t as chave_do_claude_copie_para_a_tela_segura,
       case when (select dono from ins) is null then 'ERRO: e-mail não encontrado, corrija e rode de novo' else 'ok' end as situacao
from nova;
