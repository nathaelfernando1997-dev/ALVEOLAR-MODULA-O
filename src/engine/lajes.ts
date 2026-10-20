// Modulação das lajes alveolares sobre cada pavimento.
// Os ambientes saem da malha formada pelos eixos das paredes; cada ambiente
// retangular recebe painéis que vencem o menor vão apoiados nas paredes.
import type { Regras, Trecho, Pavimento, Ajustes, Box, LinhaProjeto } from './model.ts';

export interface Ambiente { id: string; pav: string; x0: number; x1: number; y0: number; y1: number; // eixos
  apoio: { o: boolean; l: boolean; s: boolean; n: boolean };  // oeste, leste, sul, norte têm parede
  esp: { o: number; l: number; s: number; n: number };
  externo?: { o: boolean; l: boolean; s: boolean; n: boolean } }  // lado que dá para fora (sem laje do outro lado)
export interface PainelLaje { num: number; amb: string; pav: string; x0: number; y0: number; x1: number; y1: number; comp: number; larg: number; sentido: 'H' | 'V';
  dente?: { x0: number; y0: number; x1: number; y1: number } }   // recorte num canto (painel em L para encaixar)
export const areaLaje = (p: PainelLaje) => p.comp * p.larg - (p.dente ? (p.dente.x1 - p.dente.x0) * (p.dente.y1 - p.dente.y0) : 0);
export interface LajeAmb extends Ambiente { incluida: boolean; sentido: 'H' | 'V' | null; vao: number; aviso?: string; info?: string; vigas: number[]; apoiosParede: number[] }

const agrupa = (vs: number[], tol = 0.06) => {
  const s = [...vs].sort((a, b) => a - b); const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > tol) out.push(v); else out[out.length - 1] = (out[out.length - 1] + v) / 2;
  return out;
};

// extras = apoios que não são parede (viga na linha de piso); vazios = áreas sem laje (VAZIO do pavimento de cima)
// op.fechar = cálculo novo (motor 2): fecha quinas abertas e tira sobras minúsculas
// op.cobertas = ambientes do pavimento de cima (nesta planta): área sem paredes embaixo deles (garagem, varanda) leva laje,
// apoiada em vigas na borda, que voltam em `op.vigasBorda`
export function ambientes(pav: Pavimento, ts: Trecho[], extras: Trecho[] = [], vazios: Box[] = [], op: { fechar?: boolean; cobertas?: Box[]; vigasBorda?: Trecho[] } = {}): Ambiente[] {
  let cobertas = op.cobertas ?? [];
  const vigasBorda = op.vigasBorda;
  if (cobertas.length) {
    // só as áreas de cima que ficam (quase todas) fora dos ambientes daqui
    const base = ambientes(pav, ts, extras, vazios, { fechar: op.fechar });
    const sob = (b: Box) => base.reduce((s, a) => s + Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)), 0);
    cobertas = cobertas.filter(b => { const A = (b.x1 - b.x0) * (b.y1 - b.y0); return A > 1 && A - sob(b) > 0.3 * A; });
    if (!cobertas.length) return base;
  }
  const T0 = [...ts.filter(t => t.pav === pav.id), ...extras];
  // ponta que para antes do eixo da parede perpendicular (quina com pilar/shaft, parede torta) vai até ele
  const chega = (q: Trecho, c: number) => q.s - 0.12 <= c && c <= q.e + 0.12;
  const ate = (t: Trecho, lim: number, dir: 1 | -1) => T0.filter(q => q.o !== t.o && chega(q, t.c) && dir * (q.c - lim) > 0 && dir * (q.c - lim) <= 0.4)
    .reduce((m, q) => dir * (q.c - m) > 0 ? q.c : m, lim);
  const T = op.fechar ? T0.map(t => ({ ...t, s: ate(t, t.s, -1), e: ate(t, t.e, 1) })) : T0;
  const xs = agrupa([...T.filter(t => t.o === 'V').map(t => t.c), ...[...vazios, ...cobertas].flatMap(v => [v.x0, v.x1])]);
  const ys = agrupa([...T.filter(t => t.o === 'H').map(t => t.c), ...[...vazios, ...cobertas].flatMap(v => [v.y0, v.y1])]);
  if (xs.length < 2 || ys.length < 2) return [];
  // parede cobrindo uma aresta da malha (folga para colunas nos encontros)
  // a aresta pode estar coberta por mais de um trecho (parede dividida nos encontros em T)
  const parede = (o: 'H' | 'V', c: number, a: number, b: number) => {
    const ps = T.filter(t => t.o === o && Math.abs(t.c - c) < 0.08 && t.s < b && t.e > a).sort((p, q) => p.s - q.s);
    if (!ps.length) return undefined;
    let pos = a;
    for (const t of ps) { if (t.s - pos > 0.25) return undefined; pos = Math.max(pos, t.e); }
    return b - pos > 0.25 ? undefined : ps[0];
  };
  const nx = xs.length - 1, ny = ys.length - 1;
  const id = (i: number, j: number) => j * nx + i;
  const fora = new Array(nx * ny).fill(false);
  // células ligadas à borda sem atravessar parede = área externa
  const fila: [number, number][] = [];
  for (let i = 0; i < nx; i++) { fila.push([i, 0], [i, ny - 1]); }
  for (let j = 0; j < ny; j++) { fila.push([0, j], [nx - 1, j]); }
  const abertoBorda = (i: number, j: number) =>
    (i === 0 && !parede('V', xs[0], ys[j], ys[j + 1])) || (i === nx - 1 && !parede('V', xs[nx], ys[j], ys[j + 1])) ||
    (j === 0 && !parede('H', ys[0], xs[i], xs[i + 1])) || (j === ny - 1 && !parede('H', ys[ny], xs[i], xs[i + 1]));
  const seed = fila.filter(([i, j]) => abertoBorda(i, j));
  for (const [i, j] of seed) fora[id(i, j)] = true;
  const viz = (i: number, j: number): [number, number, boolean][] => [
    [i - 1, j, !!(i > 0 && !parede('V', xs[i], ys[j], ys[j + 1]))], [i + 1, j, !!(i < nx - 1 && !parede('V', xs[i + 1], ys[j], ys[j + 1]))],
    [i, j - 1, !!(j > 0 && !parede('H', ys[j], xs[i], xs[i + 1]))], [i, j + 1, !!(j < ny - 1 && !parede('H', ys[j + 1], xs[i], xs[i + 1]))],
  ];
  const pilha = [...seed];
  while (pilha.length) { const [i, j] = pilha.pop()!; for (const [a, b, ok] of viz(i, j)) if (ok && !fora[id(a, b)]) { fora[id(a, b)] = true; pilha.push([a, b]); } }
  // células dentro de um vazio não levam laje
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (vazios.some(v => cx > v.x0 && cx < v.x1 && cy > v.y0 && cy < v.y1)) fora[id(i, j)] = true;
  }
  // embaixo do pavimento de cima sem paredes: leva laje; onde a borda não tem parede, viga
  if (cobertas.length) {
    const novo = new Array(nx * ny).fill(false);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (fora[id(i, j)] && !vazios.some(v => cx > v.x0 && cx < v.x1 && cy > v.y0 && cy < v.y1) &&
        cobertas.some(v => cx > v.x0 && cx < v.x1 && cy > v.y0 && cy < v.y1)) { fora[id(i, j)] = false; novo[id(i, j)] = true; }
    }
    const fo = (i: number, j: number) => i < 0 || j < 0 || i >= nx || j >= ny || fora[id(i, j)];
    const arestas: { o: 'H' | 'V'; c: number; a: number; b: number }[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!novo[id(i, j)]) continue;
      if (fo(i - 1, j) && !parede('V', xs[i], ys[j], ys[j + 1])) arestas.push({ o: 'V', c: xs[i], a: ys[j], b: ys[j + 1] });
      if (fo(i + 1, j) && !parede('V', xs[i + 1], ys[j], ys[j + 1])) arestas.push({ o: 'V', c: xs[i + 1], a: ys[j], b: ys[j + 1] });
      if (fo(i, j - 1) && !parede('H', ys[j], xs[i], xs[i + 1])) arestas.push({ o: 'H', c: ys[j], a: xs[i], b: xs[i + 1] });
      if (fo(i, j + 1) && !parede('H', ys[j + 1], xs[i], xs[i + 1])) arestas.push({ o: 'H', c: ys[j + 1], a: xs[i], b: xs[i + 1] });
    }
    arestas.sort((p, q) => p.o.localeCompare(q.o) || p.c - q.c || p.a - q.a);
    const vs: typeof arestas = [];
    for (const e of arestas) { const u = vs[vs.length - 1]; if (u && u.o === e.o && u.c === e.c && Math.abs(u.b - e.a) < 1e-6) u.b = e.b; else vs.push({ ...e }); }
    for (const v of vs) {
      const t: Trecho = { id: `${pav.id}|borda|${v.o}|${v.c.toFixed(2)}|${v.a.toFixed(2)}`, pav: pav.id, o: v.o, c: v.c, s: v.a, e: v.b, vaos: [], H: pav.altura, esp: 0.15 };
      T.push(t); vigasBorda?.push(t);
    }
  }
  // ambientes = componentes internas
  const comp = new Array(nx * ny).fill(-1); let nc = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (fora[id(i, j)] || comp[id(i, j)] >= 0) continue;
    const st = [[i, j]]; comp[id(i, j)] = nc;
    while (st.length) { const [a, b] = st.pop()!; for (const [c2, d2, ok] of viz(a, b)) if (ok && comp[id(c2, d2)] < 0 && !fora[id(c2, d2)]) { comp[id(c2, d2)] = nc; st.push([c2, d2]); } }
    nc++;
  }
  // vizinhas de um lado do retângulo: alguma fora (ou além da malha) = lado externo
  const fr = (fixo: number, k0: number, k1: number, var_: 'i' | 'j') => {
    for (let k = k0; k <= k1; k++) {
      const [i, j] = var_ === 'j' ? [fixo, k] : [k, fixo];
      if (i < 0 || j < 0 || i >= nx || j >= ny || fora[id(i, j)]) return true;
    }
    return false;
  };
  // cada componente vira retângulos: por linhas (mesmo vão em x) ou por colunas (mesmo vão em y);
  // fica a divisão que deixa a laje apoiada nas paredes com menos vigas
  type Ret = { i0: number; i1: number; j0: number; j1: number };
  const ret = (k: number, porLinha: boolean): Ret[] => {
    const rs: Ret[] = [];
    const [na, nb] = porLinha ? [ny, nx] : [nx, ny];
    const cel = (a: number, b: number) => porLinha ? comp[id(b, a)] : comp[id(a, b)];
    for (let a = 0; a < na; a++) {
      let b = 0;
      while (b < nb) {
        if (cel(a, b) !== k) { b++; continue; }
        let b1 = b; while (b1 + 1 < nb && cel(a, b1 + 1) === k) b1++;
        if (porLinha) { const prev = rs.find(r => r.j1 === a - 1 && r.i0 === b && r.i1 === b1); if (prev) prev.j1 = a; else rs.push({ i0: b, i1: b1, j0: a, j1: a }); }
        else { const prev = rs.find(r => r.i1 === a - 1 && r.j0 === b && r.j1 === b1); if (prev) prev.i1 = a; else rs.push({ i0: a, i1: a, j0: b, j1: b1 }); }
        b = b1 + 1;
      }
    }
    return rs;
  };
  const amb = (r: Ret): Ambiente => {
    const x0 = xs[r.i0], x1 = xs[r.i1 + 1], y0 = ys[r.j0], y1 = ys[r.j1 + 1];
    const po = parede('V', x0, y0, y1), pl = parede('V', x1, y0, y1), ps = parede('H', y0, x0, x1), pn = parede('H', y1, x0, x1);
    return { id: `${pav.id}|L${x0.toFixed(2)}|${y0.toFixed(2)}`, pav: pav.id, x0, x1, y0, y1,
      apoio: { o: !!po, l: !!pl, s: !!ps, n: !!pn },
      externo: { o: fr(r.i0 - 1, r.j0, r.j1, 'j'), l: fr(r.i1 + 1, r.j0, r.j1, 'j'), s: fr(r.j0 - 1, r.i0, r.i1, 'i'), n: fr(r.j1 + 1, r.i0, r.i1, 'i') },
      esp: { o: po?.esp ?? 0, l: pl?.esp ?? 0, s: ps?.esp ?? 0, n: pn?.esp ?? 0 } };
  };
  // custo: vigas que cada retângulo pediria no melhor sentido; sem apoio nos dois lados pesa mais
  // (as paredes internas paralelas também apoiam a laje)
  const vigasNo = (o: 'H' | 'V', i0: number, i1: number, l0: number, l1: number) => {
    const cs = [i0, ...T.filter(t => t.o === o && t.c > i0 + 0.3 && t.c < i1 - 0.3 && Math.min(t.e, l1) - Math.max(t.s, l0) > 0.6 * (l1 - l0)).map(t => t.c).sort((p, q) => p - q), i1];
    let n = 0; for (let k = 0; k < cs.length - 1; k++) n += Math.max(0, Math.ceil((cs[k + 1] - cs[k]) / 5 - 1e-9) - 1);
    return n;
  };
  const custo = (A: Ambiente[]) => A.reduce((s, a) => {
    const op: number[] = [];
    if (a.apoio.o && a.apoio.l) op.push(vigasNo('V', a.x0, a.x1, a.y0, a.y1));
    if (a.apoio.s && a.apoio.n) op.push(vigasNo('H', a.y0, a.y1, a.x0, a.x1));
    return s + (op.length ? Math.min(...op) : 10);
  }, 0);
  const out: Ambiente[] = [];
  for (let k = 0; k < nc; k++) {
    const L = ret(k, true).map(amb), C = ret(k, false).map(amb);
    out.push(...(custo(C) < custo(L) ? C : L));
  }
  // sobra entre eixos muito próximos (encontro de paredes) não é ambiente
  return op.fechar ? out.filter(a => a.x1 - a.x0 >= 0.3 || a.y1 - a.y0 >= 0.3) : out;
}

// cargas = paredes do pavimento de cima sem parede embaixo (coordenadas desta planta)
export function modularLajes(ambs: Ambiente[], r: Regras, aj: Ajustes, ts: Trecho[] = [], cargas: { o: 'H' | 'V'; c: number; a: number; b: number }[] = [], bordas: LinhaProjeto[] = []): { ambs: LajeAmb[]; paineis: PainelLaje[] } {
  const res: LajeAmb[] = []; const P: PainelLaje[] = [];
  const dentes: { p: PainelLaje; ponta: 0 | 1; c: number }[] = [];
  const fora = aj.lajeFora || [], giro = aj.lajeGiro || [];
  const esV = r.vigaLargura || 0.15;
  const novo = (r.motor ?? 1) >= 2;
  for (const a of ambs) {
    // vão livre entre faces das paredes
    const cx0 = a.x0 + a.esp.o / 2, cx1 = a.x1 - a.esp.l / 2, cy0 = a.y0 + a.esp.s / 2, cy1 = a.y1 - a.esp.n / 2;
    const lx = cx1 - cx0, ly = cy1 - cy0;
    const incluida = !fora.includes(a.id);
    const podeH = a.apoio.o && a.apoio.l, podeV = a.apoio.s && a.apoio.n;
    // projeção da laje (beiral) do lado de fora: até onde a laje vai além da parede
    // o beiral não pode entrar em outro ambiente com laje
    const invade = (x0: number, x1: number, y0: number, y1: number) => ambs.some(b => b !== a && b.pav === a.pav && !fora.includes(b.id) &&
      Math.min(b.x1, x1) - Math.max(b.x0, x0) > 0.05 && Math.min(b.y1, y1) - Math.max(b.y0, y0) > 0.05);
    const latOk = <B extends { c: number }>(l: 'o' | 'l' | 's' | 'n', b: B | null): B | null => {
      if (!b) return null;
      const ed = { o: a.x0, l: a.x1, s: a.y0, n: a.y1 }[l];
      return (l === 'o' || l === 'l' ? invade(Math.min(b.c, ed), Math.max(b.c, ed), a.y0, a.y1) : invade(a.x0, a.x1, Math.min(b.c, ed), Math.max(b.c, ed))) ? null : b;
    };
    const cands = (lado: 'o' | 'l' | 's' | 'n') => {
      const o: 'H' | 'V' = lado === 'o' || lado === 'l' ? 'V' : 'H', ed = { o: a.x0, l: a.x1, s: a.y0, n: a.y1 }[lado], dir = lado === 'o' || lado === 's' ? -1 : 1;
      const [r0, r1] = o === 'V' ? [a.y0, a.y1] : [a.x0, a.x1];
      if (a.externo && !a.externo[lado]) return [];
      return bordas.filter(b => b.o === o && dir * (b.c - ed) > (novo ? -0.05 : 0.1) && dir * (b.c - ed) <= 2.5 && Math.min(b.b, r1) - Math.max(b.a, r0) > 0.3)
        .sort((p, q) => Math.abs(p.c - ed) - Math.abs(q.c - ed));
    };
    // com várias linhas de projeção, fica a que fecha o contorno com a do lado vizinho (quina); senão a mais perto
    const todos = { o: cands('o'), l: cands('l'), s: cands('s'), n: cands('n') };
    const quina = (b: LinhaProjeto, c: LinhaProjeto) => [b.a, b.b].some(t => Math.abs(t - c.c) < 0.05) && [c.a, c.b].some(t => Math.abs(t - b.c) < 0.05);
    const beiral = (lado: 'o' | 'l' | 's' | 'n') => {
      const cs = todos[lado]; if (!cs.length) return null;
      // projeção em cima da parede: a laje termina ali (a linha mais longe é de outro desenho, ex.: poço, jardim)
      if (novo && Math.abs(cs[0].c - { o: a.x0, l: a.x1, s: a.y0, n: a.y1 }[lado]) <= 0.1) return null;
      const viz = (lado === 'o' || lado === 'l' ? [...todos.s, ...todos.n] : [...todos.o, ...todos.l]);
      const c = cs.find(b => viz.some(v => quina(b, v))) ?? cs[0];
      const ed = { o: a.x0, l: a.x1, s: a.y0, n: a.y1 }[lado];
      return { c: c.c, d: Math.abs(c.c - ed) };
    };
    const lados = (sn: 'H' | 'V') => sn === 'H' ? { pontas: ['o', 'l'] as const, laterais: ['s', 'n'] as const } : { pontas: ['s', 'n'] as const, laterais: ['o', 'l'] as const };
    // apoio em cima da parede: 6 cm onde a parede recebe laje dos dois lados; 10 cm onde só esta laje apoia
    const vizinho = (lado: 'o' | 'l' | 's' | 'n') => ambs.some(b => b !== a && b.pav === a.pav && !fora.includes(b.id) && (
      lado === 'o' ? Math.abs(b.x1 - a.x0) < 0.05 && Math.min(b.y1, a.y1) - Math.max(b.y0, a.y0) > 0.3
      : lado === 'l' ? Math.abs(b.x0 - a.x1) < 0.05 && Math.min(b.y1, a.y1) - Math.max(b.y0, a.y0) > 0.3
      : lado === 's' ? Math.abs(b.y1 - a.y0) < 0.05 && Math.min(b.x1, a.x1) - Math.max(b.x0, a.x0) > 0.3
      : Math.abs(b.y0 - a.y1) < 0.05 && Math.min(b.x1, a.x1) - Math.max(b.x0, a.x0) > 0.3));
    const apo = (lado: 'o' | 'l' | 's' | 'n') => !a.apoio[lado] ? 0 : vizinho(lado) ? r.lajeApoio : (r.lajeApoioBorda ?? 0.10);
    // planeja os apoios num sentido: bordas + paredes internas (a laje apoia nelas) + vigas só onde faltar
    const plano = (sent: 'H' | 'V') => {
      const [ini, fim] = sent === 'H' ? [cx0, cx1] : [cy0, cy1];
      const [l0, l1] = sent === 'H' ? [cy0, cy1] : [cx0, cx1];
      const oParede: 'H' | 'V' = sent === 'H' ? 'V' : 'H';
      // parede interna paralela às bordas de apoio, cobrindo boa parte do outro lado
      const internas = ts.filter(t => t.pav === a.pav && t.o === oParede && t.c > ini + 0.3 && t.c < fim - 0.3 &&
        Math.min(t.e, l1) - Math.max(t.s, l0) > 0.6 * (l1 - l0)).map(t => ({ c: t.c, esp: t.esp })).sort((p, q) => p.c - q.c);
      const apoios: { a: number; b: number }[] = [{ a: ini - 1, b: ini }];
      for (const w of internas) apoios.push({ a: w.c - w.esp / 2, b: w.c + w.esp / 2 });
      apoios.push({ a: fim, b: fim + 1 });
      const vaos: [number, number][] = []; const vigas: number[] = [];
      // o beiral entra no comprimento do painel da ponta
      const [bA, bB] = lados(sent).pontas.map(l => beiral(l));
      const ap = r.lajeApoio, g = esV - 2 * ap;   // g = folga entre as pontas dos painéis em cima da viga
      // paredes de cima que cruzam o vão: melhor lugar para a viga (já carrega a parede)
      const noL = ts.filter(t => t.pav === a.pav && t.o === oParede && (Math.abs(t.e - l0) < 0.25 || Math.abs(t.s - l1) < 0.25)).map(t => t.c);
      const sobCarga = cargas.filter(w => w.o === oParede && Math.min(w.b, l1) - Math.max(w.a, l0) > 0.6 * (l1 - l0)).map(w => w.c);
      for (let k = 0; k < apoios.length - 1; k++) {
        const s0 = apoios[k].b, s1 = apoios[k + 1].a, vao = s1 - s0;
        if (vao <= 0.05) continue;
        const [pA, pB] = lados(sent).pontas;
        const A = k === 0 ? (bA ? bA.c : s0 - apo(pA)) : s0 - ap, B = k === apoios.length - 2 ? (bB ? bB.c : s1 + apo(pB)) : s1 + ap;
        const nV = Math.ceil((B - A) / r.lajeComp - 1e-9);
        if (nV <= 1) { vaos.push([s0, s1]); continue; }
        // uma viga só: tenta embaixo de uma parede de cima, se os dois painéis couberem
        const cabe = (c: number) => (c - esV / 2 + ap) - A <= r.lajeComp + 1e-6 && B - (c + esV / 2 - ap) <= r.lajeComp + 1e-6;
        const meio = (p: number, q: number) => Math.abs(p - (A + B) / 2) - Math.abs(q - (A + B) / 2);
        const ok = (c: number) => c > s0 + 0.5 && c < s1 - 0.5 && cabe(c);
        // 1º no alinhamento de uma parede que chega na lateral do ambiente (no L/T das paredes); 2º embaixo de parede de cima
        const sc = nV === 2 ? (noL.filter(ok).sort(meio)[0] ?? sobCarga.filter(ok).sort(meio)[0]) : undefined;
        const cs: number[] = [];
        if (sc !== undefined) cs.push(sc);
        else { const Pm = (B - A - (nV - 1) * g) / nV; for (let m = 1; m < nV; m++) cs.push(A + m * Pm + (m - 1) * g + esV / 2 - ap); }
        let q0 = s0;
        for (const c of cs) { vaos.push([q0, c - esV / 2]); vigas.push(c); q0 = c + esV / 2; }
        vaos.push([q0, s1]);
      }
      return { vaos, vigas, internas: internas.map(w => w.c), maior: Math.max(...vaos.map(([p, q]) => q - p)), l0, l1 };
    };
    // parede de cima dentro do ambiente correndo no mesmo sentido dos painéis pede treliça na junta; atravessando, distribui melhor
    const aoLongo = (sn: 'H' | 'V') => cargas.filter(w => w.o === sn && (sn === 'H' ? w.c > a.y0 + 0.1 && w.c < a.y1 - 0.1 && Math.min(w.b, a.x1) - Math.max(w.a, a.x0) > 0.3
      : w.c > a.x0 + 0.1 && w.c < a.x1 - 0.1 && Math.min(w.b, a.y1) - Math.max(w.a, a.y0) > 0.3)).length;
    // beiral na lateral dos painéis não dá (painel só balança na ponta): conta contra o sentido
    const opcoes = ([podeH ? 'H' : null, podeV ? 'V' : null].filter(Boolean) as ('H' | 'V')[]).map(sn => ({ sn, p: plano(sn), n: aoLongo(sn) + lados(sn).laterais.filter(l => beiral(l)).length * 2 }));
    // escolhe o sentido com menos vigas; empate: menos paredes de cima ao longo dos painéis (treliça), depois o menor vão
    opcoes.sort((x, y) => x.p.vigas.length - y.p.vigas.length || x.n - y.n || x.p.maior - y.p.maior);
    let esc = opcoes[0];
    if (esc && giro.includes(a.id) && opcoes[1]) esc = opcoes[1];
    const sentido = esc ? esc.sn : null;
    const L: LajeAmb = { ...a, incluida, sentido, vao: esc ? esc.p.maior : 0, vigas: esc ? esc.p.vigas : [], apoiosParede: esc ? esc.p.internas : [] };
    const br2 = (v: number) => v.toFixed(2).replace('.', ',');
    // aviso = precisa de atenção; info = só para saber (viga já sugerida, beiral dentro do permitido)
    const avisos: string[] = [], infos: string[] = [];
    if (!sentido) avisos.push('sem parede de apoio nos dois lados');
    else if (L.vigas.length) infos.push(`vão de ${br2(sentido === 'H' ? lx : ly)} m: ${L.vigas.length} viga(s) no meio (aba Vigas)`);
    const bP = sentido ? lados(sentido).pontas.map(l => beiral(l)) : [null, null];
    if (sentido) {
      for (const b of bP) if (b) (b.d > r.beiral + 0.01 ? avisos : infos).push(`beiral de ${br2(b.d)} m pela projeção do projeto${b.d > r.beiral + 0.01 ? ` (maior que ${br2(r.beiral)} m — conferir)` : ''}`);
      for (const l of lados(sentido).laterais) { const b = latOk(l, beiral(l)); if (b) (b.d > r.beiral + 0.01 ? avisos : infos).push(`beiral de ${br2(b.d)} m na lateral pela projeção do projeto (incluído nos painéis)${b.d > r.beiral + 0.01 ? ` — maior que ${br2(r.beiral)} m, conferir` : ''}`); }
    }
    if (avisos.length) L.aviso = avisos.join(' · ');
    if (infos.length) L.info = infos.join(' · ');
    res.push(L);
    if (!incluida || !esc) continue;
    // largura: divide o outro lado em partes iguais até a largura máxima
    // nas laterais o painel também entra em cima da parede
    const [la0, la1] = lados(esc.sn).laterais;
    // beiral na lateral: a laje vai até a linha da projeção (divide em mais painéis se passar da largura máxima)
    const bl0 = latOk(la0, beiral(la0)), bl1 = latOk(la1, beiral(la1));
    const l0 = bl0 ? bl0.c : esc.p.l0 - apo(la0), l1 = bl1 ? bl1.c : esc.p.l1 + apo(la1), ladoL = l1 - l0;
    const [pa0, pa1] = lados(esc.sn).pontas;
    // folga entre painéis vizinhos para o encaixe
    const f = r.lajeFolga ?? 0.02;
    const n = Math.max(1, Math.ceil((ladoL + f) / (r.lajeLarg + f) - 1e-9)), w = (ladoL - (n - 1) * f) / n;
    esc.p.vaos.forEach(([s0, s1], iv) => { for (let k = 0; k < n; k++) {
      // nas pontas com beiral o painel vai até a linha da projeção
      const ult = iv === esc.p.vaos.length - 1;
      const b0 = l0 + k * (w + f), b1 = b0 + w;
      // beiral na ponta: só nas fileiras que não entram em outro ambiente
      const livre = (p: number, q: number) => !(sentido === 'H' ? invade(Math.min(p, q), Math.max(p, q), b0, b1) : invade(b0, b1, Math.min(p, q), Math.max(p, q)));
      const e0 = iv === 0 && bP[0] && livre(bP[0].c, s0) ? bP[0].c : null, e1 = ult && bP[1] && livre(s1, bP[1].c) ? bP[1].c : null;
      const pend0 = iv === 0 && bP[0] && e0 === null ? bP[0].c : null, pend1 = ult && bP[1] && e1 === null ? bP[1].c : null;
      const a0 = iv === 0 ? (e0 ?? s0 - apo(pa0)) : s0 - r.lajeApoio, a1 = ult ? (e1 ?? s1 + apo(pa1)) : s1 + r.lajeApoio;
      const [x0, x1, y0, y1] = sentido === 'H' ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
      const pn: PainelLaje = { num: 0, amb: a.id, pav: a.pav, x0, x1, y0, y1, comp: a1 - a0, larg: w, sentido: sentido! };
      P.push(pn);
      if (pend0 !== null) dentes.push({ p: pn, ponta: 0, c: pend0 });
      if (pend1 !== null) dentes.push({ p: pn, ponta: 1, c: pend1 });
    } });
    const maior = Math.max(...P.filter(p => p.amb === a.id).map(p => p.comp), 0);
    if (maior > r.lajeComp + 0.005) L.aviso = (L.aviso ? L.aviso + ' · ' : '') + `painel de ${br2(maior)} m (com o beiral) passa do máximo de ${br2(r.lajeComp)} m — viga intermediária ou beiral menor`;
  }
  // beiral que bate em outra laje numa parte da fileira: o painel avança só na parte livre (dente)
  const f = r.lajeFolga ?? 0.02;
  for (const { p, ponta, c } of dentes) {
    const H = p.sentido === 'H';
    const [w0, w1] = H ? [p.y0, p.y1] : [p.x0, p.x1];            // largura do painel
    const ed = ponta === 0 ? (H ? p.x0 : p.y0) : (H ? p.x1 : p.y1);
    const [e0, e1] = [Math.min(c, ed), Math.max(c, ed)];          // faixa do beiral no sentido do vão
    // partes da largura ocupadas por outros painéis dentro da faixa do beiral
    const ocup = P.filter(q => q !== p && q.pav === p.pav && Math.min(H ? q.x1 : q.y1, e1) - Math.max(H ? q.x0 : q.y0, e0) > 0.02)
      .map(q => H ? [q.y0 - f, q.y1 + f] : [q.x0 - f, q.x1 + f]).filter(([u, v]) => v > w0 && u < w1);
    if (!ocup.length) continue;
    const lo = Math.min(...ocup.map(o => o[0])), hi = Math.max(...ocup.map(o => o[1]));
    // a parte livre tem que ficar num lado só da largura (dente num canto)
    let livre: [number, number] | null = null, corte: [number, number] | null = null;
    if (lo > w0 + 0.3 && hi >= w1 - 0.01) { livre = [w0, lo]; corte = [lo, w1]; }
    else if (hi < w1 - 0.3 && lo <= w0 + 0.01) { livre = [hi, w1]; corte = [w0, hi]; }
    if (!livre || !corte) continue;
    const semDente = corte[1] - corte[0] < 0.05;   // a outra laje só encosta: avança inteiro
    if (Math.abs(c - (ponta === 0 ? (H ? p.x1 : p.y1) : (H ? p.x0 : p.y0))) > r.lajeComp + 0.005) continue;   // passaria do comprimento máximo
    const novo = c;
    if (H) {
      if (semDente) { if (ponta === 0) p.x0 = novo; else p.x1 = novo; }
      else if (ponta === 0) { p.dente = { x0: novo, x1: p.x0, y0: corte[0], y1: corte[1] }; p.x0 = novo; } else { p.dente = { x0: p.x1, x1: novo, y0: corte[0], y1: corte[1] }; p.x1 = novo; }
      p.comp = p.x1 - p.x0;
    } else {
      if (semDente) { if (ponta === 0) p.y0 = novo; else p.y1 = novo; }
      else if (ponta === 0) { p.dente = { x0: corte[0], x1: corte[1], y0: novo, y1: p.y0 }; p.y0 = novo; } else { p.dente = { x0: corte[0], x1: corte[1], y0: p.y1, y1: novo }; p.y1 = novo; }
      p.comp = p.y1 - p.y0;
    }
  }
  return { ambs: res, paineis: P };
}

export function numerarLajes(P: PainelLaje[], ordem: string[]) {
  let n = 0;
  for (const pav of ordem) for (const p of P.filter(q => q.pav === pav).sort((a, b) => Math.round(-(a.y0 + a.y1)) - Math.round(-(b.y0 + b.y1)) || a.x0 - b.x0)) p.num = ++n;
  return P.sort((a, b) => a.num - b.num);
}

// áreas marcadas "VAZIO" no pavimento de cima (sem "LAJE" escrito), já nas coordenadas da planta de baixo
// retângulo fechado pelas paredes mais próximas de um ponto (texto dentro da área), nos quatro lados
export function caixaDoPonto(ts: Trecho[], x: number, y: number): Box | null {
  const V = ts.filter(t => t.o === 'V' && t.s - 0.15 <= y && y <= t.e + 0.15), H = ts.filter(t => t.o === 'H' && t.s - 0.15 <= x && x <= t.e + 0.15);
  const x0 = Math.max(...V.filter(t => t.c < x).map(t => t.c)), x1 = Math.min(...V.filter(t => t.c > x).map(t => t.c));
  const y0 = Math.max(...H.filter(t => t.c < y).map(t => t.c)), y1 = Math.min(...H.filter(t => t.c > y).map(t => t.c));
  return [x0, x1, y0, y1].every(isFinite) ? { x0, x1, y0, y1 } : null;
}

export function vaziosDeCima(cima: Pavimento, tc: Trecho[], textos: { text: string; x: number; y: number }[], dx: number, dy: number): Box[] {
  const tx = textos.filter(t => t.x > cima.box.x0 && t.x < cima.box.x1 && t.y > cima.box.y0 && t.y < cima.box.y1);
  const dentro = (a: Ambiente, re: RegExp) => tx.some(t => re.test(t.text.toUpperCase()) && t.x > a.x0 && t.x < a.x1 && t.y > a.y0 && t.y < a.y1);
  return ambientes(cima, tc).filter(a => dentro(a, /\bVAZIO\b/) && !dentro(a, /LAJE/)).map(a => ({ x0: a.x0 + dx, x1: a.x1 + dx, y0: a.y0 + dy, y1: a.y1 + dy }));
}
