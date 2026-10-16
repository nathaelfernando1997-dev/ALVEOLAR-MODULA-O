// Projetos salvos no navegador (IndexedDB): o DXF e todos os ajustes.
import type { Ajustes, Esquadria, Pavimento, Regras } from './engine/model.ts';

export interface Config { camada: string; pavs: Pavimento[]; quadro: Esquadria[]; regras: Regras; ajustes: Ajustes }
export interface Projeto { id: string; nome: string; arquivo: string; criado: number; atualizado: number; config: Config | null }
export interface ProjetoCompleto extends Projeto { dxf: Blob }

const DB = 'alveolar-modulacao', V = 1;
function abrir(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, V);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projetos')) db.createObjectStore('projetos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('arquivos')) db.createObjectStore('arquivos');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function req<T>(r: IDBRequest<T>): Promise<T> { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function loja(nome: 'projetos' | 'arquivos', modo: IDBTransactionMode) { const db = await abrir(); return db.transaction(nome, modo).objectStore(nome); }

export async function listar(): Promise<Projeto[]> {
  const s = await loja('projetos', 'readonly');
  const todos = await req(s.getAll()) as Projeto[];
  return todos.sort((a, b) => b.atualizado - a.atualizado);
}
export async function criar(nome: string, arquivo: string, dxf: Blob, config: Config | null = null): Promise<Projeto> {
  const p: Projeto = { id: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`, nome, arquivo, criado: Date.now(), atualizado: Date.now(), config };
  await req((await loja('arquivos', 'readwrite')).put(dxf, p.id));
  await req((await loja('projetos', 'readwrite')).put(p));
  pedirPersistencia();
  return p;
}
export async function carregar(id: string): Promise<ProjetoCompleto | null> {
  const p = await req((await loja('projetos', 'readonly')).get(id)) as Projeto | undefined;
  if (!p) return null;
  const dxf = await req((await loja('arquivos', 'readonly')).get(id)) as Blob;
  return { ...p, dxf };
}
export async function salvarConfig(id: string, config: Config, nome?: string) {
  const s = await loja('projetos', 'readwrite');
  const p = await req(s.get(id)) as Projeto | undefined;
  if (!p) return;
  await req(s.put({ ...p, config, nome: nome ?? p.nome, atualizado: Date.now() }));
}
export async function renomear(id: string, nome: string) {
  const s = await loja('projetos', 'readwrite');
  const p = await req(s.get(id)) as Projeto | undefined;
  if (p) await req(s.put({ ...p, nome, atualizado: Date.now() }));
}
export async function apagar(id: string) {
  await req((await loja('projetos', 'readwrite')).delete(id));
  await req((await loja('arquivos', 'readwrite')).delete(id));
}
// pede ao navegador para não apagar os dados quando faltar espaço
export function pedirPersistencia() { try { navigator.storage?.persist?.(); } catch { /* sem suporte */ } }

// cópia de segurança: um arquivo .json com o DXF e os ajustes
export async function exportarBackup(id: string): Promise<Blob | null> {
  const p = await carregar(id); if (!p) return null;
  const dxf = await p.dxf.text();
  return new Blob([JSON.stringify({ formato: 'alveolar-modulacao', versao: 1, nome: p.nome, arquivo: p.arquivo, config: p.config, dxf })], { type: 'application/json' });
}
export async function importarBackup(f: File): Promise<Projeto> {
  const j = JSON.parse(await f.text());
  if (j.formato !== 'alveolar-modulacao' || !j.dxf) throw new Error('Arquivo de projeto inválido.');
  return criar(j.nome, j.arquivo, new Blob([j.dxf], { type: 'application/dxf' }), j.config ?? null);
}
