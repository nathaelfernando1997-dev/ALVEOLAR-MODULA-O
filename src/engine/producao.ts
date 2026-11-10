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

// ---------- plano de carga ----------
// peças deitadas em pilhas na carreta. Carrega ao contrário da montagem (a última a montar vai embaixo),
// então na obra a peça de cima de alguma pilha é sempre a próxima a montar: descarrega e já monta.
// Peça grande não fica em cima de peça bem menor: a de cima cabe na de baixo (com folga "tol").
export interface PecaCarga { id: string; codigo: string; ordem: number; a: number; b: number; peso: number }   // a × b = medidas da peça deitada
export interface Pilha { n: number; x: number; y: number; comp: number; larg: number; pecas: PecaCarga[] }   // pecas: de baixo para cima
export interface Carreta { n: number; pecas: PecaCarga[]; peso: number; pilhas: Pilha[]; usado: number; avisos: string[]; modo?: 'montagem' | 'tamanho'; estocar?: string[] }
// modo 'montagem': empilha ao contrário da montagem (descarrega já montando); 'tamanho': maior embaixo (menos carretas)
// larg = largura normal da carreta; largMax = com excesso lateral permitido
export interface OpCarga { pesoMax: number; comp: number; larg: number; largMax?: number; altPilha: number; esp: number; tol: number; modo?: 'montagem' | 'tamanho' }
function montarCarreta(pecas: PecaCarga[], o: OpCarga): Carreta | null {
  const peso = pecas.reduce((s, p) => s + p.peso, 0);
  if (peso > o.pesoMax + 1e-6) return null;
  type Faixa = { x: number; comp: number; usadoY: number };
  const faixas: Faixa[] = [], pilhas: Pilha[] = [], maxN = Math.max(1, Math.floor(o.altPilha / o.esp + 1e-6)), avisos: string[] = [];
  let x = 0;
  // de trás para a frente da montagem: a primeira peça colocada é a última a montar
  // por tamanho: maior embaixo; peças de tamanho parecido (dentro da folga) ficam na ordem da montagem
  const fx = (v: number) => Math.round(v / Math.max(o.tol, 0.01));
  const ordemCarga = o.modo === 'tamanho' ? [...pecas].sort((u, v) => fx(Math.max(v.a, v.b)) - fx(Math.max(u.a, u.b)) || fx(Math.min(v.a, v.b)) - fx(Math.min(u.a, u.b)) || v.ordem - u.ordem) : [...pecas].sort((u, v) => v.ordem - u.ordem);
  const WM = o.largMax ?? o.larg;
  for (const p of ordemCarga) {
    const L = Math.max(p.a, p.b), W = Math.min(p.a, p.b);
    if (W > WM + 1e-6) return null;
    if (W > o.larg + 1e-6) avisos.push(`${p.codigo}: ${W.toFixed(2).replace('.', ',')} m de largura deitada, acima da carreta (${o.larg.toFixed(2).replace('.', ',')} m) — excesso lateral`);
    // 1º: em cima de uma pilha onde ela cabe (a de baixo é do mesmo tamanho ou maior), a mais justa
    const topo = (pl: Pilha) => pl.pecas[pl.pecas.length - 1];
    const cabe = (pl: Pilha) => { const t = topo(pl), tL = Math.max(t.a, t.b), tW = Math.min(t.a, t.b); return pl.pecas.length < maxN && L <= tL + o.tol && W <= tW + o.tol; };
    const ok = pilhas.filter(cabe).sort((u, v) => { const tu = topo(u), tv = topo(v); return tu.a * tu.b - tv.a * tv.b; })[0];
    if (ok) { ok.pecas.push(p); continue; }
    // 2º: pilha nova ao lado de outra (mesma faixa da carreta), se couber na largura
    let f = faixas.find(fa => fa.comp + 1e-6 >= L && fa.usadoY + W <= WM + 1e-6);
    if (!f) {
      if (x + L > o.comp + 1e-6) return null;
      f = { x, comp: L, usadoY: 0 }; faixas.push(f); x += L + 0.1;
    }
    pilhas.push({ n: pilhas.length + 1, x: f.x, y: f.usadoY, comp: L, larg: W, pecas: [p], faixa: faixas.indexOf(f) } as Pilha & { faixa: number }); f.usadoY += W + 0.1;
  }
  // centraliza as pilhas de cada faixa na largura (o excesso, se houver, fica dividido entre os dois lados)
  for (const pl of pilhas as (Pilha & { faixa: number })[]) { const fa = faixas[pl.faixa]; pl.y += (WM - (fa.usadoY - 0.1)) / 2; }
  return { n: 0, pecas, peso, pilhas, usado: Math.max(0, x - 0.1), avisos };
}
// divide a sequência de montagem (já em ordem) em carretas: cada carreta leva o trecho seguinte da sequência
// monta uma carreta a partir do começo da sequência: o trecho seguido que couber e, no espaço que sobrar,
// peças um pouco mais à frente (até "adiantar" posições)
function encher(rest: PecaCarga[], o: OpCarga, adiantar: number): { c: Carreta; usadas: PecaCarga[] } {
  let melhor: Carreta | null = null, j = 0;
  while (j < rest.length) { const c = montarCarreta(rest.slice(0, j + 1), o); if (!c) break; melhor = c; j++; }
  if (!melhor) {
    const c = montarCarreta(rest.slice(0, 1), { ...o, pesoMax: Infinity, comp: Infinity, largMax: Infinity })!;
    c.avisos.push('peça sozinha não cabe na carreta pelas regras — conferir'); return { c, usadas: rest.slice(0, 1) };
  }
  let usadas = rest.slice(0, j);
  for (const q of rest.slice(j, j + adiantar)) { const c = montarCarreta([...usadas, q], o); if (c) { usadas = [...usadas, q]; melhor = c; } }
  return { c: melhor, usadas };
}
// peças que precisam ir para o chão (estocar no canteiro) para alcançar a próxima peça a montar
export function estoqueDescarga(c: Carreta): string[] {
  const pil = c.pilhas.map(p => [...p.pecas]), chao = new Set<string>(), out: string[] = [];
  for (const x of [...c.pecas].sort((a, b) => a.ordem - b.ordem)) {
    if (chao.has(x.id)) continue;
    const pl = pil.find(p => p.some(y => y.id === x.id))!;
    while (pl.length && pl[pl.length - 1].id !== x.id) { const y = pl.pop()!; chao.add(y.id); out.push(y.codigo); }
    pl.pop();
  }
  return out;
}
// modo 'auto': em cada carreta, carrega na ordem da montagem quando leva quase o mesmo peso (95%); senão, maior embaixo
export function planoCarga(seq: PecaCarga[], o: OpCarga & { modoPlano?: 'auto' | 'montagem' | 'tamanho' }, adiantar = 80): Carreta[] {
  const out: Carreta[] = [], modo = o.modoPlano ?? 'auto';
  let rest = [...seq];
  while (rest.length) {
    const A = modo !== 'tamanho' ? encher(rest, { ...o, modo: 'montagem' }, adiantar) : null;
    const B = modo !== 'montagem' ? encher(rest, { ...o, modo: 'tamanho' }, adiantar) : null;
    const pesoDe = (r: typeof A) => r ? r.usadas.reduce((s, p) => s + p.peso, 0) : -1;
    const r = A && (!B || pesoDe(A) >= 0.95 * pesoDe(B)) ? A : B!;
    r.c.modo = r === A ? 'montagem' : 'tamanho';
    r.c.n = out.length + 1; r.c.estocar = estoqueDescarga(r.c); out.push(r.c);
    const ids = new Set(r.usadas.map(p => p.id)); rest = rest.filter(p => !ids.has(p.id));
  }
  return out;
}

// ---------- plano de corte (barras de isopor e de treliça) ----------
// first-fit decreasing: cada pedaço vai na primeira barra aberta onde cabe (a sobra de uma barra é usada por outro pedaço);
// pedaço maior que a barra sai emendado (barras inteiras + o resto). Barras com os mesmos cortes viram um "padrão".
export interface Pedaco { comp: number; pecas: string[] }
export interface PadraoCorte { cortes: number[]; qtd: number; sobra: number }
export function planoCorte(pedacos: { comp: number; peca: string }[], barra: number, serra = 0.005) {
  const itens: { comp: number; peca: string }[] = []; let emendas = 0;
  for (const p of pedacos) {
    let c = Math.round(p.comp * 100) / 100;
    if (c < 0.05) continue;
    while (c > barra + 1e-6) { itens.push({ comp: barra, peca: p.peca }); c = Math.round((c - barra) * 100) / 100; emendas++; }
    if (c >= 0.05) itens.push({ comp: c, peca: p.peca });
  }
  itens.sort((a, b) => b.comp - a.comp);
  const barras: { cortes: number[]; livre: number }[] = [];
  for (const it of itens) {
    let b = barras.find(x => x.livre + 1e-6 >= it.comp);
    if (!b) { b = { cortes: [], livre: barra }; barras.push(b); }
    b.cortes.push(it.comp); b.livre -= it.comp + serra;
  }
  const pad = new Map<string, PadraoCorte>();
  for (const b of barras) { const k = b.cortes.map(c => c.toFixed(2)).join('+'); const p = pad.get(k); if (p) p.qtd++; else pad.set(k, { cortes: b.cortes, qtd: 1, sobra: Math.max(0, b.livre) }); }
  const total = itens.reduce((s, i) => s + i.comp, 0);
  // lista de comprimentos: quantos pedaços de cada medida e em que peças vão
  const porComp = new Map<string, { comp: number; n: number; pecas: Set<string> }>();
  for (const it of itens) { const k = it.comp.toFixed(2); const x = porComp.get(k) ?? { comp: it.comp, n: 0, pecas: new Set() }; x.n++; x.pecas.add(it.peca); porComp.set(k, x); }
  return { barras: barras.length, padroes: [...pad.values()].sort((a, b) => b.qtd - a.qtd), total, perda: barras.length ? 1 - total / (barras.length * barra) : 0, emendas,
    medidas: [...porComp.values()].sort((a, b) => b.comp - a.comp) };
}
// pedaços de isopor de cada peça: alvéolos ao longo da altura (parede) ou do comprimento (laje),
// cortados onde passa porta/janela; posição dos alvéolos centralizada na largura
export function isoporDaPeca(larg: number, comp: (x: number) => number, furos: { x: number; w: number; base: number; h: number }[], r: { isoporLarg?: number; isoporEspaco?: number }) {
  const il = r.isoporLarg ?? 0.12, ie = r.isoporEspaco ?? 0.03, passo = il + ie, n = Math.max(0, Math.floor(larg / passo + 1e-6));
  const m = (larg - n * passo + ie) / 2, out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = m + i * passo, x1 = x0 + il, H = comp((x0 + x1) / 2);
    const cort = furos.filter(f => x1 > f.x + 1e-6 && x0 < f.x + f.w - 1e-6).map(f => [f.base, f.base + f.h]).sort((a, b) => a[0] - b[0]);
    let y = 0;
    for (const [a, b] of cort) { if (a - y > 0.05) out.push(a - y); y = Math.max(y, b); }
    if (H - y > 0.05) out.push(H - y);
  }
  return out;
}

// ---------- mesas de produção ----------
// peças deitadas nas mesas (uma camada), na ordem das carretas: cada dia enche as mesas com as próximas peças
export interface Mesa { n: number; pecas: { codigo: string; x: number; y: number; L: number; W: number }[]; usado: number }
export interface DiaProducao { dia: number; mesas: Mesa[]; carretasProntas: number[] }
export function planoMesas(seq: { codigo: string; a: number; b: number; carreta?: number }[], o: { qtd: number; comp: number; larg: number; folga: number; adiantar?: number }): DiaProducao[] {
  const dias: DiaProducao[] = [];
  let rest = [...seq];
  const ultimaDaCarreta = new Map<number, string>();
  for (const p of seq) if (p.carreta) ultimaDaCarreta.set(p.carreta, p.codigo);
  const feito = new Set<string>();
  while (rest.length) {
    const mesas: Mesa[] = [];
    for (let m = 1; m <= o.qtd && rest.length; m++) {
      // faixas ao longo da mesa; peças lado a lado na largura
      const faixas: { x: number; L: number; y: number }[] = []; let x = 0; const ps: Mesa['pecas'] = [];
      const usadas = new Set<typeof rest[number]>();
      for (const p of rest.slice(0, o.adiantar ?? 60)) {
        const L = Math.max(p.a, p.b), W = Math.min(p.a, p.b);
        if (W > o.larg + 1e-6 || L > o.comp + 1e-6) continue;
        let f = faixas.find(fx => fx.L + 1e-6 >= L && fx.y + W <= o.larg + 1e-6);
        if (!f) { if (x + L > o.comp + 1e-6) continue; f = { x, L, y: 0 }; faixas.push(f); x += L + o.folga; }
        ps.push({ codigo: p.codigo, x: f.x, y: f.y, L, W }); f.y += W + o.folga; usadas.add(p);
      }
      if (!ps.length) { const p = rest[0]; ps.push({ codigo: p.codigo, x: 0, y: 0, L: Math.max(p.a, p.b), W: Math.min(p.a, p.b) }); usadas.add(p); }
      rest = rest.filter(p => !usadas.has(p)); for (const p of usadas) feito.add(p.codigo);
      mesas.push({ n: m, pecas: ps, usado: ps.reduce((s, p) => s + p.L * p.W, 0) / (o.comp * o.larg) });
    }
    const prontas = [...ultimaDaCarreta].filter(([c]) => !dias.some(d => d.carretasProntas.includes(c)) && seq.filter(p => p.carreta === c).every(p => feito.has(p.codigo))).map(([c]) => c);
    dias.push({ dia: dias.length + 1, mesas, carretasProntas: prontas });
  }
  return dias;
}
