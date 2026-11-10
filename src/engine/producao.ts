// Informações de produção e montagem: etiqueta e orientação de cada painel, sequência de montagem,
// peso e cargas (romaneio), escoramento das lajes e conferência automática.
import type { Painel, Pavimento, Regras } from './model.ts';
import { areaPainel } from './model.ts';
import type { LajeAmb, PainelLaje } from './lajes.ts';
import { areaLaje } from './lajes.ts';

const br = (v: number) => v.toFixed(2).replace('.', ',');

// ---------- etiqueta ----------
// sigla do pavimento na etiqueta da peça: T = térreo, 1, 2, 3… = pavimentos; senão as iniciais
export function siglas(pavs: Pavimento[]): Map<string, string> {
  const m = new Map<string, string>();
  pavs.forEach((p, i) => {
    const n = p.nome.toUpperCase();
    const s = /T[ÉE]RREO/.test(n) ? 'T' : /(\d+)/.test(n) ? n.match(/(\d+)/)![1] : /COBERT/.test(n) ? 'C' : String(i);
    m.set(p.id, s);
  });
  return m;
}
export const codigoParede = (p: Painel, sg: Map<string, string>) => `${sg.get(p.pav) ?? ''}-P${p.num}`;
export const codigoLaje = (p: PainelLaje, sg: Map<string, string>) => `${sg.get(p.pav) ?? ''}-L${p.num}`;

// ---------- vizinhos e orientação ----------
const ponta = (p: Painel, lado: 'a' | 'b'): [number, number] => p.o === 'H' ? [p[lado], p.c] : [p.c, p[lado]];
function distSeg(x: number, y: number, q: Painel): number {
  const [ax, ay] = ponta(q, 'a'), [bx, by] = ponta(q, 'b');
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
// painéis que encostam em cada ponta (emenda, canto em L ou encontro em T), até 35 cm
export function vizinhos(ps: Painel[]): Map<number, { a: Painel[]; b: Painel[] }> {
  const out = new Map<number, { a: Painel[]; b: Painel[] }>();
  for (const p of ps) {
    const v = { a: [] as Painel[], b: [] as Painel[] };
    for (const lado of ['a', 'b'] as const) {
      const [x, y] = ponta(p, lado);
      for (const q of ps) if (q.num !== p.num && q.pav === p.pav && distSeg(x, y, q) <= 0.35) v[lado].push(q);
    }
    out.set(p.num, v);
  }
  return out;
}
// de que lado a vista do painel é desenhada (face de quem olha a peça como no desenho)
export interface Face { face: 'externa' | 'interna' | 'divisa'; amb?: string }
export function faceDaVista(p: Painel, ambs: LajeAmb[], nomes: { text: string; x: number; y: number }[]): Face {
  const m = (p.a + p.b) / 2, d = 0.35;
  // com "a" na esquerda da vista: parede horizontal é vista de baixo (y menor); vertical, da direita (x maior)
  const [vx, vy] = p.o === 'H' ? [m, p.c - d] : [p.c + d, m];        // lado de quem olha a vista
  const [ox, oy] = p.o === 'H' ? [m, p.c + d] : [p.c - d, m];        // o outro lado
  const dentro = (x: number, y: number) => ambs.find(a => a.pav === p.pav && x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1);
  const av = dentro(vx, vy), ao = dentro(ox, oy);
  const nome = (a?: LajeAmb) => a && nomes.find(t => t.x > a.x0 && t.x < a.x1 && t.y > a.y0 && t.y < a.y1)?.text;
  if (av && !ao) return { face: 'interna', amb: nome(av) };
  if (!av && ao) return { face: 'externa' };
  if (!av && !ao) return { face: 'divisa' };
  return { face: 'interna', amb: nome(av) };
}

// ---------- sequência de montagem ----------
// começa num canto (painel com outro perpendicular encostado) e cresce sempre por um painel que encosta
// nos já montados, preferindo o que fecha um canto (fica travado) e o mais perto do último
export function ordemMontagem(ps: Painel[]): Map<number, number> {
  const viz = vizinhos(ps), ordem = new Map<number, number>();
  const todos = (p: Painel) => [...viz.get(p.num)!.a, ...viz.get(p.num)!.b];
  const canto = (p: Painel) => todos(p).some(q => q.o !== p.o);
  const meio = (p: Painel): [number, number] => p.o === 'H' ? [(p.a + p.b) / 2, p.c] : [p.c, (p.a + p.b) / 2];
  const rest = new Set(ps.map(p => p.num)), porNum = new Map(ps.map(p => [p.num, p]));
  let n = 0, ult: Painel | null = null;
  while (rest.size) {
    // candidatos: encostam em algum já montado
    let cand = [...rest].map(k => porNum.get(k)!).filter(p => todos(p).some(q => ordem.has(q.num)));
    if (!cand.length) {
      const livres = [...rest].map(k => porNum.get(k)!);
      const cs = livres.filter(canto);
      cand = [(cs.length ? cs : livres).sort((p, q) => meio(q)[1] - meio(p)[1] || meio(p)[0] - meio(q)[0])[0]];
    }
    const nota = (p: Painel) => {
      const trav = todos(p).filter(q => ordem.has(q.num) && q.o !== p.o).length;   // fecha canto com peça já montada
      const dist = ult ? Math.hypot(meio(p)[0] - meio(ult)[0], meio(p)[1] - meio(ult)[1]) : 0;
      return -trav * 100 + dist;
    };
    const p = cand.sort((x, y) => nota(x) - nota(y) || x.num - y.num)[0];
    ordem.set(p.num, ++n); rest.delete(p.num); ult = p;
  }
  return ordem;
}

// ---------- peso ----------
// concreto do painel = área líquida × espessura − isopor; peso = concreto × densidade
function concreto(larg: number, comp: number, area: number, furos: { w: number; h: number }[], r: Regras, esp?: number) {
  const il = r.isoporLarg ?? 0.12, ia = r.isoporAlt ?? 0.09, ie = r.isoporEspaco ?? 0.03, cap = r.capeamento ?? 0.025;
  const e = esp ?? ia + 2 * cap, n = (w: number) => Math.max(0, Math.floor(w / (il + ie) + 1e-6));
  let iso = n(larg) * comp, ab = 0;
  for (const f of furos) { ab += f.w * f.h; iso -= n(f.w) * f.h; }
  return Math.max(0, (area - ab) * e - iso * il * ia);
}
export const pesoParede = (p: Painel, r: Regras) =>
  concreto(p.larg, areaPainel(p) / p.larg, areaPainel(p), p.recortes.map(x => ({ w: x.w, h: x.h })), r) * (r.densidade ?? 2500);
export const pesoLaje = (p: PainelLaje, r: Regras, esp?: number) => concreto(p.larg, p.comp, areaLaje(p), [], r, esp) * (r.densidade ?? 2500);

// ---------- romaneio ----------
export interface ItemCarga { ordem: number; codigo: string; desc: string; area: number; peso: number; carga: number }
// itens na ordem de uso; abre carga nova quando passa do limite do caminhão
export function cargas<T extends { peso: number }>(itens: T[], max: number, inicio = 1): (T & { carga: number })[] {
  let c = inicio, soma = 0;
  return itens.map(it => { if (soma > 0 && soma + it.peso > max) { c++; soma = 0; } soma += it.peso; return { ...it, carga: c }; });
}

// ---------- escoramento ----------
// linhas de escora perpendiculares ao vão, igualmente espaçadas, a no máximo "max" uma da outra (e das paredes)
export interface LinhaEscora { amb: string; o: 'H' | 'V'; c: number; a: number; b: number }
export function escoras(lj: LajeAmb[], max: number): { linhas: LinhaEscora[]; vaos: { amb: string; o: 'H' | 'V'; ini: number; fim: number; c: number; n: number; passo: number }[] } {
  const linhas: LinhaEscora[] = [], vaos: { amb: string; o: 'H' | 'V'; ini: number; fim: number; c: number; n: number; passo: number }[] = [];
  for (const a of lj) {
    if (!a.incluida || !a.sentido) continue;
    const fx0 = a.x0 + a.esp.o / 2, fx1 = a.x1 - a.esp.l / 2, fy0 = a.y0 + a.esp.s / 2, fy1 = a.y1 - a.esp.n / 2;
    // sentido H: painéis vencem o vão em x → escoras são linhas verticais (x constante)
    const [ini, fim, l0, l1] = a.sentido === 'H' ? [fx0, fx1, fy0, fy1] : [fy0, fy1, fx0, fx1];
    const L = fim - ini; if (L <= 0.3) continue;
    const n = Math.max(L > 1.5 ? 1 : 0, Math.ceil(L / max - 1e-6) - 1);
    if (!n) continue;
    const passo = L / (n + 1);
    for (let i = 1; i <= n; i++) linhas.push({ amb: a.id, o: a.sentido === 'H' ? 'V' : 'H', c: ini + passo * i, a: l0 + 0.05, b: l1 - 0.05 });
    vaos.push({ amb: a.id, o: a.sentido, ini, fim, c: (l0 + l1) / 2, n, passo });
  }
  return { linhas, vaos };
}

// ---------- peças iguais ----------
const assinParede = (p: Painel) => [br(p.larg), br(p.H), p.chanfro ? `${br(p.chanfro.ha)}>${br(p.chanfro.hb)}` : '',
  ...p.recortes.map(r => `${r.tipo}:${br(r.dl)}:${br(r.base)}:${br(r.w)}:${br(r.h)}`).sort()].join('|');
export function repetidas<T>(xs: T[], chave: (x: T) => string): T[][] {
  const g = new Map<string, T[]>();
  for (const x of xs) { const k = chave(x); g.set(k, [...(g.get(k) || []), x]); }
  return [...g.values()].filter(v => v.length > 1).sort((a, b) => b.length - a.length);
}
export const paredesIguais = (ps: Painel[]) => repetidas(ps, assinParede);
export const lajesIguais = (pl: PainelLaje[], comTrelica: Set<number>) =>
  repetidas(pl.filter(p => !comTrelica.has(p.num)), p => [br(p.comp), br(p.larg), p.dente ? `${br(p.dente.x1 - p.dente.x0)}x${br(p.dente.y1 - p.dente.y0)}` : ''].join('|'));

// ---------- conferência ----------
export interface Alerta { nivel: 'erro' | 'atencao'; onde: string; texto: string }
export function conferencia(pavs: Pavimento[], ps: Painel[], lj: LajeAmb[], r: Regras, trelSemLaje: { pav: string; t: number }[]): Alerta[] {
  const out: Alerta[] = [], nomePav = new Map(pavs.map(p => [p.id, p.nome]));
  for (const p of ps) {
    const onde = `${nomePav.get(p.pav)} · painel ${p.num}`;
    if (p.larg > r.larguraMax + 1e-6) out.push({ nivel: 'erro', onde, texto: `largura ${br(p.larg)} m acima do máximo de ${br(r.larguraMax)} m` });
    if (p.aviso) out.push({ nivel: 'atencao', onde, texto: p.aviso });
    for (const x of p.recortes) {
      const esq = x.dl, dir = p.larg - x.dl - x.w, topo = (p.chanfro ? Math.min(p.chanfro.ha, p.chanfro.hb) : p.H) - x.base - x.h;
      // a boneca de transporte (sai na obra) não conta: só a tira de painel que fica entre ela e 15 cm
      const pouco = (v: number) => v > r.boneca + 0.005 && v < 0.15;
      if (pouco(esq)) out.push({ nivel: 'atencao', onde, texto: `${x.tipo}: só ${br(esq)} m de painel à esquerda da abertura` });
      if (pouco(dir)) out.push({ nivel: 'atencao', onde, texto: `${x.tipo}: só ${br(dir)} m de painel à direita da abertura` });
      if (topo > 0.005 && topo < 0.15) out.push({ nivel: 'atencao', onde, texto: `${x.tipo}: só ${br(topo)} m de painel em cima da abertura (verga)` });
    }
  }
  for (const a of lj) if (a.incluida && a.aviso) out.push({ nivel: 'atencao', onde: `${nomePav.get(a.pav)} · laje`, texto: a.aviso });
  for (const t of trelSemLaje) out.push({ nivel: 'erro', onde: `${nomePav.get(t.pav)} · treliça T${t.t}`, texto: 'sem laje modulada embaixo — conferir o apoio' });
  return out;
}
