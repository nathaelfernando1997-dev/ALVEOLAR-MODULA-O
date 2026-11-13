// Projetos na nuvem (Supabase): login, tabela "projetos" e arquivos DXF no Storage.
import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import type { Config, Projeto, ProjetoCompleto } from './db.ts';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const nuvemConfigurada = !!(URL_ && KEY);
export const sb = nuvemConfigurada ? createClient(URL_!, KEY!) : null;

export async function sessao(): Promise<Session | null> { return sb ? (await sb.auth.getSession()).data.session : null; }
export function aoMudarSessao(cb: (s: Session | null, evento: string) => void) {
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((e, s) => cb(s, e));
  return () => data.subscription.unsubscribe();
}
export async function entrar(email: string, senha: string) { const { error } = await sb!.auth.signInWithPassword({ email, password: senha }); if (error) throw traduz(error.message); }
export async function cadastrar(email: string, senha: string) {
  const { data, error } = await sb!.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin } });
  if (error) throw traduz(error.message);
  return !data.session; // true = precisa confirmar o e-mail
}
export async function recuperarSenha(email: string) { const { error } = await sb!.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (error) throw traduz(error.message); }
export async function novaSenha(senha: string) { const { error } = await sb!.auth.updateUser({ password: senha }); if (error) throw traduz(error.message); }
export async function sair() { await sb?.auth.signOut(); }

function traduz(m: string): Error {
  const t: [RegExp, string][] = [
    [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/Email not confirmed/i, 'Confirme o seu e-mail pelo link que enviamos antes de entrar.'],
    [/User already registered/i, 'Este e-mail já tem conta. Use "Entrar".'],
    [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
    [/rate limit/i, 'Muitas tentativas. Aguarde alguns minutos.'],
  ];
  for (const [r, s] of t) if (r.test(m)) return new Error(s);
  return new Error(m);
}

const caminho = async (id: string) => `${(await sb!.auth.getUser()).data.user!.id}/${id}.dxf`;
// DXF compactado (gzip): o texto do DXF fica ~10x menor, sobe e desce bem mais rápido
const gz = typeof CompressionStream !== 'undefined';
const compactar = (b: Blob) => new Response(b.stream().pipeThrough(new CompressionStream('gzip'))).blob();
const descompactar = async (b: Blob) => new Blob([await new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()], { type: 'application/dxf' });
const linha = (r: { id: string; nome: string; arquivo: string | null; config: Config | null; criado: string; atualizado: string }): Projeto =>
  ({ id: r.id, nome: r.nome, arquivo: r.arquivo || '', config: r.config, criado: Date.parse(r.criado), atualizado: Date.parse(r.atualizado) });

export async function listar(): Promise<Projeto[]> {
  const { data, error } = await sb!.from('projetos').select('id,nome,arquivo,config,criado,atualizado').order('atualizado', { ascending: false });
  if (error) throw error;
  return (data || []).map(linha);
}
export async function criar(nome: string, arquivo: string, dxf: Blob, config: Config | null = null): Promise<Projeto> {
  const { data, error } = await sb!.from('projetos').insert({ nome, arquivo, config }).select('id,nome,arquivo,config,criado,atualizado').single();
  if (error) throw error;
  const up = gz
    ? await sb!.storage.from('projetos').upload((await caminho(data.id)) + '.gz', await compactar(dxf), { upsert: true, contentType: 'application/gzip' })
    : await sb!.storage.from('projetos').upload(await caminho(data.id), dxf, { upsert: true, contentType: 'application/dxf' });
  if (up.error) { await sb!.from('projetos').delete().eq('id', data.id); throw up.error; }
  return linha(data);
}
export async function carregar(id: string): Promise<ProjetoCompleto | null> {
  const { data, error } = await sb!.from('projetos').select('id,nome,arquivo,config,criado,atualizado').eq('id', id).single();
  if (error || !data) return null;
  const c = await caminho(id);
  if (gz) { const z = await sb!.storage.from('projetos').download(c + '.gz'); if (!z.error && z.data) return { ...linha(data), dxf: await descompactar(z.data) }; }
  const arq = await sb!.storage.from('projetos').download(c);
  if (arq.error || !arq.data) throw new Error('Não encontrei o arquivo DXF deste projeto na nuvem.');
  return { ...linha(data), dxf: arq.data };
}
export async function salvarConfig(id: string, config: Config) {
  const { error } = await sb!.from('projetos').update({ config, atualizado: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function renomear(id: string, nome: string) { await sb!.from('projetos').update({ nome, atualizado: new Date().toISOString() }).eq('id', id); }
export async function apagar(id: string) {
  const c = await caminho(id);
  await sb!.storage.from('projetos').remove([c, c + '.gz']);
  await sb!.from('projetos').delete().eq('id', id);
}

// montagem na obra: cada peça marcada pelo celular (QR da etiqueta), num arquivo ao lado do projeto
export interface Marca { status: 'montada' | 'problema'; em: string; por: string; obs?: string }
const caminhoMont = async (id: string) => `${(await sb!.auth.getUser()).data.user!.id}/${id}.montagem.json`;
export async function lerMontagem(id: string): Promise<Record<string, Marca>> {
  const { data, error } = await sb!.storage.from('projetos').download(await caminhoMont(id));
  if (error || !data) return {};
  try { return JSON.parse(await data.text()) as Record<string, Marca>; } catch { return {}; }
}
export async function marcarMontagem(id: string, codigo: string, m: Marca | null): Promise<Record<string, Marca>> {
  const atual = await lerMontagem(id);
  if (m) atual[codigo] = m; else delete atual[codigo];
  const { error } = await sb!.storage.from('projetos').upload(await caminhoMont(id), new Blob([JSON.stringify(atual)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
  if (error) throw error;
  return atual;
}

// ---------- marcação das peças pelo QR, sem login (supabase/marcacoes.sql) ----------
// 'pista' = montada na pista (antes de concretar); 'montada' = instalada na obra
export type Etapa = 'pista' | 'concretada' | 'carregada' | 'montada' | 'problema' | 'desfeita';
export interface Marcacao { peca: string; etapa: Etapa; obs: string | null; por: string | null; em: string }
// chave da obra (só o dono); null = SQL das marcações ainda não rodado
export async function chaveObra(projeto: string, trocar = false): Promise<string | null> {
  if (!sb) return null;
  const { data, error } = await sb.rpc('obra_chave', { p_projeto: projeto, p_trocar: trocar });
  if (error) return null;
  return data as string;
}
export async function marcarPeca(projeto: string, chave: string, peca: string, etapa: Etapa, obs: string | null, por: string) {
  const { error } = await sb!.rpc('marcar_peca', { p_projeto: projeto, p_chave: chave, p_peca: peca, p_etapa: etapa, p_obs: obs, p_por: por });
  if (error) throw new Error(/inválida|trocada/.test(error.message) ? 'Etiqueta inválida ou a chave da obra foi trocada. Use a etiqueta nova.' : 'Não salvou: ' + error.message);
}
export async function situacaoPeca(projeto: string, chave: string, peca: string): Promise<{ obra: string; hist: Marcacao[] }> {
  const { data, error } = await sb!.rpc('situacao_peca', { p_projeto: projeto, p_chave: chave, p_peca: peca });
  if (error) throw new Error(/inválida|trocada/.test(error.message) ? 'Etiqueta inválida ou a chave da obra foi trocada. Use a etiqueta nova.' : error.message);
  const rows = (data || []) as { obra: string; etapa: Etapa | null; obs: string | null; por: string | null; em: string | null }[];
  return { obra: rows[0]?.obra ?? '', hist: rows.filter(r => r.etapa).map(r => ({ peca, etapa: r.etapa!, obs: r.obs, por: r.por, em: r.em! })) };
}
export async function lerMarcacoes(projeto: string): Promise<Marcacao[]> {
  const { data, error } = await sb!.from('pecas_marcacao').select('peca,etapa,obs,por,em').eq('projeto', projeto).order('em');
  if (error) return [];
  return (data || []) as Marcacao[];
}
// situação atual de cada peça a partir do histórico ("desfeita" cancela a marcação anterior)
export function situacoes(hist: Marcacao[]): Map<string, { etapas: Marcacao[]; atual: Marcacao | null }> {
  const m = new Map<string, Marcacao[]>();
  for (const h of hist) { const l = m.get(h.peca) || []; if (h.etapa === 'desfeita') l.pop(); else l.push(h); m.set(h.peca, l); }
  return new Map([...m].map(([k, l]) => [k, { etapas: l, atual: l[l.length - 1] ?? null }]));
}

// ---------- informações das peças para a tela do QR (supabase/pecas_info.sql) ----------
export interface InfoPeca { tipo: string; pav: string; desc: string; area: number; peso: number; ordem?: number;
  esq?: string; dir?: string; face?: string; aberturas?: string; carreta?: number; pilha?: number; desenho?: string }
// envia (substitui) as informações de todas as peças do projeto; false = SQL ainda não rodado
export async function enviarInfoPecas(projeto: string, rows: { peca: string; dados: InfoPeca }[]): Promise<boolean> {
  if (!sb) return false;
  const del = await sb.from('pecas_info').delete().eq('projeto', projeto);
  if (del.error) return false;
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await sb.from('pecas_info').insert(rows.slice(i, i + 100).map(r => ({ projeto, peca: r.peca, dados: r.dados })));
    if (error) return false;
  }
  return true;
}
export async function infoPeca(projeto: string, chave: string, peca: string): Promise<InfoPeca | null> {
  if (!sb) return null;
  const { data, error } = await sb.rpc('info_peca', { p_projeto: projeto, p_chave: chave, p_peca: peca });
  if (error) return null;
  return (data as InfoPeca) ?? null;
}

// ---------- QR sem internet: obra guardada no celular + fila de marcações (supabase/offline.sql) ----------
export interface ObraOffline { obra: string; info: Record<string, InfoPeca>; marcas: Marcacao[]; salvoEm: string }
export interface ItemFila { obra: string; chave: string; peca: string; etapa: Etapa; obs: string | null; por: string; em: string }
const semRede = (msg: string) => (typeof navigator !== 'undefined' && !navigator.onLine) || /fetch|network|load failed|timeout/i.test(msg);
const urlObra = (obra: string) => `/__alv-obra/${obra}`;
export async function lerObraOffline(obra: string): Promise<ObraOffline | null> {
  try { const r = await (await caches.open('alv-dados')).match(urlObra(obra)); return r ? (await r.json()) as ObraOffline : null; } catch { return null; }
}
async function gravarObraOffline(obra: string, d: ObraOffline) {
  try { await (await caches.open('alv-dados')).put(urlObra(obra), new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } })); } catch { /* sem armazenamento */ }
}
// baixa a obra inteira (informações e marcações) e guarda no celular; null = sem sinal ou SQL não rodado
export async function baixarObra(obra: string, chave: string): Promise<ObraOffline | null> {
  if (!sb) return null;
  const { data, error } = await sb.rpc('obra_dados', { p_projeto: obra, p_chave: chave });
  if (error || !data) return null;
  const d = { ...(data as Omit<ObraOffline, 'salvoEm'>), salvoEm: new Date().toISOString() };
  await gravarObraOffline(obra, d);
  return d;
}
export function lerFila(): ItemFila[] { try { return JSON.parse(localStorage.getItem('alv-fila') || '[]') as ItemFila[]; } catch { return []; } }
function gravarFila(f: ItemFila[]) { try { localStorage.setItem('alv-fila', JSON.stringify(f)); } catch { /* sem armazenamento */ } }
export function porNaFila(it: ItemFila) { gravarFila([...lerFila(), it]); }
let enviando: Promise<string[]> | null = null;
// envia a fila na ordem; para no primeiro erro de rede (tenta depois). Devolve as recusas do servidor.
export function enviarFila(): Promise<string[]> {
  if (enviando) return enviando;
  enviando = (async () => {
    const recusas: string[] = [];
    while (sb) {
      const f = lerFila(); if (!f.length) break;
      const it = f[0];
      let { error } = await sb.rpc('marcar_peca_offline', { p_projeto: it.obra, p_chave: it.chave, p_peca: it.peca, p_etapa: it.etapa, p_obs: it.obs, p_por: it.por, p_em: it.em });
      if (error && /marcar_peca_offline|schema cache|function/i.test(error.message) && !semRede(error.message))
        ({ error } = await sb.rpc('marcar_peca', { p_projeto: it.obra, p_chave: it.chave, p_peca: it.peca, p_etapa: it.etapa, p_obs: it.obs, p_por: it.por }));
      if (error && semRede(error.message)) break;
      gravarFila(lerFila().slice(1));                          // enviado (ou recusado pelo servidor: descarta)
      if (error) recusas.push(/inválida|trocada/.test(error.message) ? 'etiqueta inválida ou a chave da obra foi trocada' : error.message);
      if (!error) {                                            // mantém a cópia do celular em dia
        const d = await lerObraOffline(it.obra);
        if (d) await gravarObraOffline(it.obra, { ...d, marcas: [...d.marcas, { peca: it.peca, etapa: it.etapa, obs: it.obs, por: it.por, em: it.em }] });
      }
    }
    return recusas;
  })().finally(() => { enviando = null; });
  return enviando;
}
export { semRede };

// ---------- planta para o portal do cliente (sistema de gestão; tabela da migração 0025 do gestão) ----------
export async function enviarPlantaPortal(projeto: string, dados: unknown) {
  const { error } = await sb!.from('planta_portal').upsert({ projeto, dados, atualizado: new Date().toISOString() });
  if (error) throw new Error(/planta_portal|relation|schema cache/i.test(error.message)
    ? 'Falta rodar no Supabase a migração 0025 do sistema de gestão (planta do portal).'
    : 'Não enviou: ' + error.message);
}
