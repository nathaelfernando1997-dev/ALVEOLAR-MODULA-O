// Modulação das lajes alveolares sobre cada pavimento.
// Os ambientes saem da malha formada pelos eixos das paredes; cada ambiente
// retangular recebe painéis que vencem o menor vão apoiados nas paredes.
import type { Regras, Trecho, Pavimento, Ajustes, Box, LinhaProjeto } from './model.ts';

export interface Ambiente { id: string; pav: string; x0: number; x1: number; y0: number; y1: number; // eixos
  apoio: { o: boolean; l: boolean; s: boolean; n: boolean };  // oeste, leste, sul, norte têm parede
  esp: { o: number; l: number; s: number; n: number };
  externo?: { o: boolean; l: boolean; s: boolean; n: boolean } }  // lado que dá para fora (sem laje do outro lado)
export interface PainelLaje { num: number; amb: string; pav: string; x0: number; y0: number; x1: number; y1: number; comp: number; larg: number; sentido: 'H' | 'V' }
export interface LajeAmb extends Ambiente { incluida: boolean; sentido: 'H' | 'V' | null; vao: number; aviso?: string; vigas: number[]; apoiosParede: number[] }

const agrupa = (vs: number[], tol = 0.06) => {
  const s = [...vs].sort((a, b) => a - b); const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > tol) out.push(v); else out[out.length - 1] = (out[out.length - 1] + v) / 2;
  return out;
};

// extras = apoios que não são parede (viga na linha de piso); vazios = áreas sem laje (VAZIO do pavimento de cima)
export function ambientes(pav: Pavimento, ts: Trecho[], extras: Trecho[] = [], vazios: Box[] = []): Ambiente[] {
  const T = [...ts.filter(t => t.pav === pav.id), ...extras];
  const xs = agrupa([...T.filter(t => t.o === 'V').map(t => t.c), ...vazios.flatMap(v => [v.x0, v.x1])]);
  const ys = agrupa([...T.filter(t => t.o === 'H').map(t => t.c), ...vazios.flatMap(v => [v.y0, v.y1])]);
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
  return out;
}

// cargas = paredes do pavimento de cima sem parede embaixo (coordenadas desta planta)
export function modularLajes(ambs: Ambiente[], r: Regras, aj: Ajustes, ts: Trecho[] = [], cargas: { o: 'H' | 'V'; c: number; a: number; b: number }[] = [], bordas: LinhaProjeto[] = []): { ambs: LajeAmb[]; paineis: PainelLaje[] } {
  const res: LajeAmb[] = []; const P: PainelLaje[] = [];
  const fora = aj.lajeFora || [], giro = aj.lajeGiro || [];
  const esV = r.vigaLargura || 0.15;
  for (const a of ambs) {
    // vão livre entre faces das paredes
    const cx0 = a.x0 + a.esp.o / 2, cx1 = a.x1 - a.esp.l / 2, cy0 = a.y0 + a.esp.s / 2, cy1 = a.y1 - a.esp.n / 2;
    const lx = cx1 - cx0, ly = cy1 - cy0;
    const incluida = !fora.includes(a.id);
    const podeH = a.apoio.o && a.apoio.l, podeV = a.apoio.s && a.apoio.n;
    // projeção da laje (beiral) do lado de fora: até onde a laje vai além da parede
    const beiral = (lado: 'o' | 'l' | 's' | 'n') => {
      const o: 'H' | 'V' = lado === 'o' || lado === 'l' ? 'V' : 'H', ed = { o: a.x0, l: a.x1, s: a.y0, n: a.y1 }[lado], dir = lado === 'o' || lado === 's' ? -1 : 1;
      const [r0, r1] = o === 'V' ? [a.y0, a.y1] : [a.x0, a.x1];
      if (a.externo && !a.externo[lado]) return null;
      const c = bordas.filter(b => b.o === o && dir * (b.c - ed) > 0.1 && dir * (b.c - ed) <= 1.6 && Math.min(b.b, r1) - Math.max(b.a, r0) > 0.3)
        .sort((p, q) => Math.abs(p.c - ed) - Math.abs(q.c - ed))[0];
      return c ? { c: c.c, d: Math.abs(c.c - ed) } : null;
    };
    const lados = (sn: 'H' | 'V') => sn === 'H' ? { pontas: ['o', 'l'] as const, laterais: ['s', 'n'] as const } : { pontas: ['s', 'n'] as const, laterais: ['o', 'l'] as const };
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
      const sobCarga = cargas.filter(w => w.o === oParede && Math.min(w.b, l1) - Math.max(w.a, l0) > 0.6 * (l1 - l0)).map(w => w.c);
      for (let k = 0; k < apoios.length - 1; k++) {
        const s0 = apoios[k].b, s1 = apoios[k + 1].a, vao = s1 - s0;
        if (vao <= 0.05) continue;
        const A = k === 0 && bA ? bA.c : s0 - ap, B = k === apoios.length - 2 && bB ? bB.c : s1 + ap;
        const nV = Math.ceil((B - A) / r.lajeComp - 1e-9);
        if (nV <= 1) { vaos.push([s0, s1]); continue; }
        // uma viga só: tenta embaixo de uma parede de cima, se os dois painéis couberem
        const cabe = (c: number) => (c - esV / 2 + ap) - A <= r.lajeComp + 1e-6 && B - (c + esV / 2 - ap) <= r.lajeComp + 1e-6;
        const sc = nV === 2 ? sobCarga.filter(c => c > s0 + 0.5 && c < s1 - 0.5 && cabe(c)).sort((p, q) => Math.abs(p - (A + B) / 2) - Math.abs(q - (A + B) / 2))[0] : undefined;
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
    const avisos: string[] = [];
    if (!sentido) avisos.push('sem parede de apoio nos dois lados');
    else if (L.vigas.length) avisos.push(`vão de ${br2(sentido === 'H' ? lx : ly)} m: ${L.vigas.length} viga(s) sugerida(s) — conferir com o engenheiro`);
    const bP = sentido ? lados(sentido).pontas.map(l => beiral(l)) : [null, null];
    if (sentido) {
      for (const b of bP) if (b) avisos.push(`beiral de ${br2(b.d)} m pela projeção do projeto${b.d > r.beiral + 0.01 ? ` (maior que ${br2(r.beiral)} m — conferir)` : ''}`);
      for (const l of lados(sentido).laterais) { const b = beiral(l); if (b) avisos.push(`projeção de ${br2(b.d)} m na lateral dos painéis — painel não balança de lado: girar a laje ou apoiar a borda`); }
    }
    if (avisos.length) L.aviso = avisos.join(' · ');
    res.push(L);
    if (!incluida || !esc) continue;
    // largura: divide o outro lado em partes iguais até a largura máxima
    const { l0, l1 } = esc.p, ladoL = l1 - l0;
    // folga entre painéis vizinhos para o encaixe
    const f = r.lajeFolga ?? 0.02;
    const n = Math.max(1, Math.ceil((ladoL + f) / (r.lajeLarg + f) - 1e-9)), w = (ladoL - (n - 1) * f) / n;
    esc.p.vaos.forEach(([s0, s1], iv) => { for (let k = 0; k < n; k++) {
      // nas pontas com beiral o painel vai até a linha da projeção
      const a0 = iv === 0 && bP[0] ? bP[0].c : s0 - r.lajeApoio, a1 = iv === esc.p.vaos.length - 1 && bP[1] ? bP[1].c : s1 + r.lajeApoio, b0 = l0 + k * (w + f), b1 = b0 + w;
      const [x0, x1, y0, y1] = sentido === 'H' ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
      P.push({ num: 0, amb: a.id, pav: a.pav, x0, x1, y0, y1, comp: a1 - a0, larg: w, sentido: sentido! });
    } });
    const maior = Math.max(...P.filter(p => p.amb === a.id).map(p => p.comp), 0);
    if (maior > r.lajeComp + 0.005) L.aviso = (L.aviso ? L.aviso + ' · ' : '') + `painel de ${br2(maior)} m (com o beiral) passa do máximo de ${br2(r.lajeComp)} m — viga intermediária ou beiral menor`;
  }
  return { ambs: res, paineis: P };
}

export function numerarLajes(P: PainelLaje[], ordem: string[]) {
  let n = 0;
  for (const pav of ordem) for (const p of P.filter(q => q.pav === pav).sort((a, b) => Math.round(-(a.y0 + a.y1)) - Math.round(-(b.y0 + b.y1)) || a.x0 - b.x0)) p.num = ++n;
  return P.sort((a, b) => a.num - b.num);
}

// áreas marcadas "VAZIO" no pavimento de cima (sem "LAJE" escrito), já nas coordenadas da planta de baixo
export function vaziosDeCima(cima: Pavimento, tc: Trecho[], textos: { text: string; x: number; y: number }[], dx: number, dy: number): Box[] {
  const tx = textos.filter(t => t.x > cima.box.x0 && t.x < cima.box.x1 && t.y > cima.box.y0 && t.y < cima.box.y1);
  const dentro = (a: Ambiente, re: RegExp) => tx.some(t => re.test(t.text.toUpperCase()) && t.x > a.x0 && t.x < a.x1 && t.y > a.y0 && t.y < a.y1);
  return ambientes(cima, tc).filter(a => dentro(a, /\bVAZIO\b/) && !dentro(a, /LAJE/)).map(a => ({ x0: a.x0 + dx, x1: a.x1 + dx, y0: a.y0 + dy, y1: a.y1 + dy }));
}
