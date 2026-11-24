-- Alveolar Modulação: etiquetas impressas de um projeto que foi apagado ou substituído.
-- Liga o código antigo da obra (+ a chave que está no QR impresso) ao projeto atual.
-- Rodar uma vez no SQL Editor; depois, um "insert" por projeto antigo (ver o fim do arquivo).

create table if not exists private.obra_alias (
  antigo uuid primary key,                 -- código da obra que está no QR impresso (obra=...)
  chave_antiga text not null,              -- chave que está no QR impresso (k=...)
  novo uuid not null references public.projetos(id) on delete cascade
);

-- celular (sem login): com o código e a chave antigos, devolve o projeto atual e a chave dele
create or replace function public.resolver_obra(p_projeto uuid, p_chave text)
returns table (projeto uuid, chave text) language sql security definer set search_path = public, private as $$
  select a.novo, k.chave
  from private.obra_alias a
  join private.obra_chave k on k.projeto = a.novo
  where a.antigo = p_projeto and a.chave_antiga = p_chave;
$$;
grant execute on function public.resolver_obra(uuid, text) to anon, authenticated;

-- exemplo de ligação (trocar os três valores):
-- insert into private.obra_alias (antigo, chave_antiga, novo)
-- values ('CODIGO_ANTIGO_COMPLETO', 'CHAVE_ANTIGA', (select id from public.projetos where id::text like 'CODIGO_NOVO%'))
-- on conflict (antigo) do update set chave_antiga = excluded.chave_antiga, novo = excluded.novo;
