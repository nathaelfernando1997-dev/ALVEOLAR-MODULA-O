// Modulação das lajes alveolares sobre cada pavimento.
// Os ambientes saem da malha formada pelos eixos das paredes; cada ambiente
// retangular recebe painéis que vencem o menor vão apoiados nas paredes.
import type { Regras, Trecho, Pavimento, Ajustes } from './model.ts';

export interface Ambiente { id: string; pav: string; x0: number; x1: number; y0: number; y1: number; // eixos
  apoio: { o: boolean; l: boolean; s: boolean; n: boolean };  // oeste, leste, sul, norte têm parede
  esp: { o: number; l: number; s: number; n: number } }
export interface PainelLaje { num: number; amb: string; pav: string; x0: number; y0: number; x1: number; y1: number; comp: number; larg: number; sentido: 'H' | 'V' }
export interface LajeAmb extends Ambiente { incluida: boolean; sentido: 'H' | 'V' | null; vao: number; aviso?: string; vigas: number[] }

const agrupa = (vs: number[], tol = 0.06) => {
  const s = [...vs].sort((a, b) => a - b); const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > tol) out.push(v); else out[out.length - 1] = (out[out.length - 1] + v) / 2;
  return out;
};

export function ambientes(pav: Pavimento, ts: Trecho[]): Ambiente[] {
  const T = ts.filter(t => t.pav === pav.id);
  const xs = agrupa(T.filter(t => t.o === 'V').map(t => t.c));
  const ys = agrupa(T.filter(t => t.o === 'H').map(t => t.c));
  if (xs.length < 2 || ys.length < 2) return [];
  // parede cobrindo uma aresta da malha (folga para colunas nos encontros)
  const parede = (o: 'H' | 'V', c: number, a: number, b: number) =>
    T.find(t => t.o === o && Math.abs(t.c - c) < 0.08 && t.s <= a + 0.25 && t.e >= b - 0.25);
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
  // ambientes = componentes internas
  const comp = new Array(nx * ny).fill(-1); let nc = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (fora[id(i, j)] || comp[id(i, j)] >= 0) continue;
    const st = [[i, j]]; comp[id(i, j)] = nc;
    while (st.length) { const [a, b] = st.pop()!; for (const [c2, d2, ok] of viz(a, b)) if (ok && comp[id(c2, d2)] < 0 && !fora[id(c2, d2)]) { comp[id(c2, d2)] = nc; st.push([c2, d2]); } }
    nc++;
  }
  // cada componente vira retângulos (linhas de células com o mesmo vão em x)
  const out: Ambiente[] = [];
  for (let k = 0; k < nc; k++) {
    const linhas: { i0: number; i1: number; j0: number; j1: number }[] = [];
    for (let j = 0; j < ny; j++) {
      let i = 0;
      while (i < nx) {
        if (comp[id(i, j)] !== k) { i++; continue; }
        let i1 = i; while (i1 + 1 < nx && comp[id(i1 + 1, j)] === k) i1++;
        const prev = linhas.find(r => r.j1 === j - 1 && r.i0 === i && r.i1 === i1);
        if (prev) prev.j1 = j; else linhas.push({ i0: i, i1, j0: j, j1: j });
        i = i1 + 1;
      }
    }
    linhas.forEach((r, n) => {
      const x0 = xs[r.i0], x1 = xs[r.i1 + 1], y0 = ys[r.j0], y1 = ys[r.j1 + 1];
      const po = parede('V', x0, y0, y1), pl = parede('V', x1, y0, y1), ps = parede('H', y0, x0, x1), pn = parede('H', y1, x0, x1);
      out.push({ id: `${pav.id}|L${x0.toFixed(2)}|${y0.toFixed(2)}`, pav: pav.id, x0, x1, y0, y1,
        apoio: { o: !!po, l: !!pl, s: !!ps, n: !!pn },
        esp: { o: po?.esp ?? 0, l: pl?.esp ?? 0, s: ps?.esp ?? 0, n: pn?.esp ?? 0 } });
      void n;
    });
  }
  return out;
}

export function modularLajes(ambs: Ambiente[], r: Regras, aj: Ajustes): { ambs: LajeAmb[]; paineis: PainelLaje[] } {
  const res: LajeAmb[] = []; const P: PainelLaje[] = [];
  const fora = aj.lajeFora || [], giro = aj.lajeGiro || [];
  const vaoMax = r.lajeComp - 2 * r.lajeApoio;
  for (const a of ambs) {
    // vão livre entre faces das paredes
    const cx0 = a.x0 + a.esp.o / 2, cx1 = a.x1 - a.esp.l / 2, cy0 = a.y0 + a.esp.s / 2, cy1 = a.y1 - a.esp.n / 2;
    const lx = cx1 - cx0, ly = cy1 - cy0;
    const incluida = !fora.includes(a.id);
    // sentido do painel: vence o menor vão que tenha parede dos dois lados
    const podeH = a.apoio.o && a.apoio.l, podeV = a.apoio.s && a.apoio.n;
    let sentido: 'H' | 'V' | null = podeH && podeV ? (lx <= ly ? 'H' : 'V') : podeH ? 'H' : podeV ? 'V' : null;
    if (sentido && giro.includes(a.id)) sentido = sentido === 'H' ? (podeV ? 'V' : 'H') : (podeH ? 'H' : 'V');
    const L: LajeAmb = { ...a, incluida, sentido, vao: sentido === 'H' ? lx : sentido === 'V' ? ly : 0, vigas: [] };
    if (!sentido) L.aviso = 'sem parede de apoio nos dois lados';
    res.push(L);
    if (!incluida || !sentido) continue;
    // vão maior que o painel: sugere vigas intermediárias
    const vao = sentido === 'H' ? lx : ly;
    const nV = Math.ceil((vao + 2 * r.lajeApoio) / r.lajeComp - 1e-9);
    const trechosVao: [number, number][] = [];
    const ini = sentido === 'H' ? cx0 : cy0, esV = 0.15;
    if (nV > 1) {
      const passo = (vao - (nV - 1) * esV) / nV;
      L.aviso = `vão de ${vao.toFixed(2).replace('.', ',')} m maior que o painel: ${nV - 1} viga(s) sugerida(s) — conferir com o engenheiro`;
      for (let k = 0; k < nV; k++) { const s0 = ini + k * (passo + esV); trechosVao.push([s0, s0 + passo]); if (k) L.vigas.push(s0 - esV / 2); }
    } else trechosVao.push([ini, ini + vao]);
    // largura: divide o outro lado em partes iguais até a largura máxima
    const lado0 = sentido === 'H' ? cy0 : cx0, ladoL = sentido === 'H' ? ly : lx;
    const n = Math.max(1, Math.ceil(ladoL / r.lajeLarg - 1e-9)), w = ladoL / n;
    for (const [s0, s1] of trechosVao) for (let k = 0; k < n; k++) {
      const a0 = s0 - r.lajeApoio, a1 = s1 + r.lajeApoio, b0 = lado0 + k * w, b1 = b0 + w;
      const [x0, x1, y0, y1] = sentido === 'H' ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
      P.push({ num: 0, amb: a.id, pav: a.pav, x0, x1, y0, y1, comp: a1 - a0, larg: w, sentido });
    }
  }
  return { ambs: res, paineis: P };
}

export function numerarLajes(P: PainelLaje[], ordem: string[]) {
  let n = 0;
  for (const pav of ordem) for (const p of P.filter(q => q.pav === pav).sort((a, b) => Math.round(-(a.y0 + a.y1)) - Math.round(-(b.y0 + b.y1)) || a.x0 - b.x0)) p.num = ++n;
  return P.sort((a, b) => a.num - b.num);
}
