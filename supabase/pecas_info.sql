-- Alveolar Modulação: informações de cada peça para conferência na tela do QR (sem login).
-- Rodar uma vez no SQL Editor do Supabase (depois do marcacoes.sql). Só cria tabela e função novas.

create table if not exists public.pecas_info (
  projeto uuid not null references public.projetos(id) on delete cascade,
  peca text not null,
  dados jsonb not null,
  atualizado timestamptz not null default now(),
  primary key (projeto, peca)
);

-- só o dono do projeto grava/lê direto (o sistema envia sozinho quando ele abre o projeto)
alter table public.pecas_info enable row level security;
drop policy if exists "info das pecas do dono" on public.pecas_info;
create policy "info das pecas do dono" on public.pecas_info for all
  using (exists (select 1 from public.projetos p where p.id = projeto and p.owner = auth.uid()))
  with check (exists (select 1 from public.projetos p where p.id = projeto and p.owner = auth.uid()));

-- celular (sem login): informações da peça, com a chave da etiqueta
create or replace function public.info_peca(p_projeto uuid, p_chave text, p_peca text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.obra_chave where projeto = p_projeto and chave = p_chave) then
    raise exception 'etiqueta inválida ou chave da obra trocada';
  end if;
  return (select dados from public.pecas_info where projeto = p_projeto and peca = p_peca);
end $$;

revoke all on function public.info_peca(uuid, text, text) from public;
grant execute on function public.info_peca(uuid, text, text) to anon, authenticated;
