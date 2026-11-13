-- Alveolar Modulação: etapa nova "Peça montada na pista" no QR das etiquetas.
-- Rodar uma vez no SQL Editor do Supabase (depois do marcacoes.sql). Não apaga nenhuma marcação.
-- A instalação na obra continua gravada como 'montada' (o portal do gestão já lê assim).

alter table public.pecas_marcacao drop constraint if exists pecas_marcacao_etapa_check;
alter table public.pecas_marcacao add constraint pecas_marcacao_etapa_check
  check (etapa in ('pista', 'concretada', 'carregada', 'montada', 'problema', 'desfeita'));

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

revoke all on function public.marcar_peca(uuid, text, text, text, text, text) from public;
grant execute on function public.marcar_peca(uuid, text, text, text, text, text) to anon, authenticated;
