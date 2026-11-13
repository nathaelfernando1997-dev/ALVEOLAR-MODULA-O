-- Alveolar Modulação: QR funcionando sem internet.
-- Rodar uma vez no SQL Editor do Supabase (depois do marcacoes.sql, marcacoes_pista.sql e pecas_info.sql).
-- Só cria funções novas; não apaga nada.

-- marcação feita sem sinal: grava com a hora em que foi feita no celular
create or replace function public.marcar_peca_offline(p_projeto uuid, p_chave text, p_peca text, p_etapa text,
  p_obs text default null, p_por text default null, p_em timestamptz default null)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.obra_chave where projeto = p_projeto and chave = p_chave) then
    raise exception 'etiqueta inválida ou chave da obra trocada';
  end if;
  if p_etapa not in ('pista', 'concretada', 'carregada', 'montada', 'problema', 'desfeita') then raise exception 'etapa inválida'; end if;
  insert into public.pecas_marcacao (projeto, peca, etapa, obs, por, em)
  values (p_projeto, left(p_peca, 40), p_etapa, left(p_obs, 500), left(p_por, 80),
          greatest(least(coalesce(p_em, now()), now()), now() - interval '60 days'));
end $$;

-- a obra inteira (informações das peças e marcações) para guardar no celular
create or replace function public.obra_dados(p_projeto uuid, p_chave text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.obra_chave where projeto = p_projeto and chave = p_chave) then
    raise exception 'etiqueta inválida ou chave da obra trocada';
  end if;
  return jsonb_build_object(
    'obra', (select nome from public.projetos where id = p_projeto),
    'info', coalesce((select jsonb_object_agg(peca, dados) from public.pecas_info where projeto = p_projeto), '{}'::jsonb),
    'marcas', coalesce((select jsonb_agg(jsonb_build_object('peca', peca, 'etapa', etapa, 'obs', obs, 'por', por, 'em', em) order by em)
                        from public.pecas_marcacao where projeto = p_projeto), '[]'::jsonb));
end $$;

revoke all on function public.marcar_peca_offline(uuid, text, text, text, text, text, timestamptz) from public;
grant execute on function public.marcar_peca_offline(uuid, text, text, text, text, text, timestamptz) to anon, authenticated;
revoke all on function public.obra_dados(uuid, text) from public;
grant execute on function public.obra_dados(uuid, text) to anon, authenticated;
