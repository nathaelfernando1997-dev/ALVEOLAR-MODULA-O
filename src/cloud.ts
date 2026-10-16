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
  const up = await sb!.storage.from('projetos').upload(await caminho(data.id), dxf, { upsert: true, contentType: 'application/dxf' });
  if (up.error) { await sb!.from('projetos').delete().eq('id', data.id); throw up.error; }
  return linha(data);
}
export async function carregar(id: string): Promise<ProjetoCompleto | null> {
  const { data, error } = await sb!.from('projetos').select('id,nome,arquivo,config,criado,atualizado').eq('id', id).single();
  if (error || !data) return null;
  const arq = await sb!.storage.from('projetos').download(await caminho(id));
  if (arq.error || !arq.data) throw new Error('Não encontrei o arquivo DXF deste projeto na nuvem.');
  return { ...linha(data), dxf: arq.data };
}
export async function salvarConfig(id: string, config: Config) {
  const { error } = await sb!.from('projetos').update({ config, atualizado: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function renomear(id: string, nome: string) { await sb!.from('projetos').update({ nome, atualizado: new Date().toISOString() }).eq('id', id); }
export async function apagar(id: string) {
  await sb!.storage.from('projetos').remove([await caminho(id)]);
  await sb!.from('projetos').delete().eq('id', id);
}
