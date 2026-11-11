// Planta de locação dos pontos de fundação (blocos) para levar ao Eberick:
// um ponto em cada canto de parede (L), encontro (T, cruz), ponta solta, coluna no meio da parede
// e, se pedido, pontos intermediários para não passar do espaçamento máximo.
// Sai em DXF (metros), nas mesmas coordenadas do projeto de arquitetura.
import type { Trecho, Painel, Pavimento } from './model.ts';
import type { Prim } from './dxf.ts';

export type TipoPonto = 'L' | 'T' | 'X' | 'ponta' | 'emenda' | 'coluna' | 'intermediário' | 'manual';
export interface PontoFund { n: number; x: number; y: number; tipo: TipoPonto; esp: number }

const TOL = 0.15;

export function pontosFundacao(ts: Trecho[], ps: Painel[], espacMax = 0, ed: { extra?: { x: number; y: number }[]; remover?: { x: number; y: number }[] } = {}): PontoFund[] {
  type Q = { x: number; y: number; tipo?: TipoPonto; esp: number };
  const qs: Q[] = [];
  const add = (x: number, y: number, esp: number, tipo?: TipoPonto) => {
    const q = qs.find(p => Math.hypot(p.x - x, p.y - y) < TOL);
    if (q) { q.esp = Math.max(q.esp, esp); return; }   // já é canto/encontro: fica o tipo de lá
    qs.push({ x, y, esp, tipo });
  };
  const xy = (t: Trecho, pos: number): [number, number] => t.o === 'H' ? [pos, t.c] : [t.c, pos];
  // cruzamentos H x V (parede que passa pela outra)
  for (const h of ts.filter(t => t.o === 'H')) for (const v of ts.filter(t => t.o === 'V'))
    if (v.c > h.s - TOL && v.c < h.e + TOL && h.c > v.s - TOL && h.c < v.e + TOL) add(v.c, h.c, Math.max(h.esp, v.esp));
  // pontas das paredes (depois dos cruzamentos: o ponto fica no eixo da outra parede)
  for (const t of ts) { add(...xy(t, t.s), t.esp); add(...xy(t, t.e), t.esp); }
  // colunas no meio da parede: espaço entre dois painéis seguidos do mesmo trecho
  const porTrecho = new Map<string, Painel[]>();
  for (const p of ps) porTrecho.set(p.trecho, [...(porTrecho.get(p.trecho) || []), p]);
  for (const [id, L] of porTrecho) {
    const t = ts.find(x => x.id === id); if (!t) continue;
    L.sort((p, q) => p.a - q.a);
    for (let i = 0; i < L.length - 1; i++) { const g0 = L[i].a + L[i].larg, g1 = L[i + 1].a; if (g1 - g0 > 0.06) add(...xy(t, (g0 + g1) / 2), t.esp, 'coluna'); }
  }
  // tipo pelo número de braços de parede que saem do ponto
  for (const q of qs) {
    if (q.tipo) continue;
    const dirs = new Set<string>();
    for (const t of ts) {
      const [u, w] = t.o === 'H' ? [q.x, q.y] : [q.y, q.x];
      if (Math.abs(w - t.c) > TOL || u < t.s - TOL || u > t.e + TOL) continue;
      if (u > t.s + TOL) dirs.add(t.o === 'H' ? 'o' : 's');
      if (u < t.e - TOL) dirs.add(t.o === 'H' ? 'l' : 'n');
    }
    const n = dirs.size;
    q.tipo = n >= 4 ? 'X' : n === 3 ? 'T' : n === 2 ? ((dirs.has('o') && dirs.has('l')) || (dirs.has('s') && dirs.has('n')) ? 'emenda' : 'L') : 'ponta';
  }
  // espaçamento máximo ao longo de cada parede
  if (espacMax > 0.5) for (const t of ts) {
    const nos = qs.filter(q => (t.o === 'H' ? Math.abs(q.y - t.c) < TOL && q.x > t.s - TOL && q.x < t.e + TOL : Math.abs(q.x - t.c) < TOL && q.y > t.s - TOL && q.y < t.e + TOL))
      .map(q => t.o === 'H' ? q.x : q.y).sort((a, b) => a - b);
    for (let i = 0; i < nos.length - 1; i++) {
      const d = nos[i + 1] - nos[i], k = Math.ceil(d / espacMax - 1e-9);
      for (let j = 1; j < k; j++) qs.push({ ...(() => { const [x, y] = xy(t, nos[i] + d * j / k); return { x, y }; })(), esp: t.esp, tipo: 'intermediário' });
    }
  }
  // edição à mão: pontos tirados e pontos acrescentados
  for (const r of ed.remover || []) { const i = qs.findIndex(q => Math.hypot(q.x - r.x, q.y - r.y) < TOL); if (i >= 0) qs.splice(i, 1); }
  for (const e of ed.extra || []) if (!qs.some(q => Math.hypot(q.x - e.x, q.y - e.y) < 0.05)) {
    const t = ts.find(t => t.o === 'H' ? Math.abs(t.c - e.y) < 0.1 && e.x > t.s - TOL && e.x < t.e + TOL : Math.abs(t.c - e.x) < 0.1 && e.y > t.s - TOL && e.y < t.e + TOL);
    qs.push({ x: e.x, y: e.y, esp: t?.esp ?? 0.15, tipo: 'manual' });
  }
  // numeração: de cima para baixo, da esquerda para a direita
  qs.sort((p, q) => Math.abs(p.y - q.y) > TOL ? q.y - p.y : p.x - q.x);
  return qs.map((q, i) => ({ n: i + 1, x: q.x, y: q.y, tipo: q.tipo!, esp: q.esp }));
}

const DESC: Record<TipoPonto, string> = { L: 'canto (L)', T: 'encontro (T)', X: 'cruzamento', ponta: 'ponta de parede', emenda: 'emenda de parede', coluna: 'coluna no meio da parede', 'intermediário': 'intermediário (espaçamento)', manual: 'ponto acrescentado' };

// DXF R12 simples (LINE, CIRCLE, TEXT), em metros, nas coordenadas do projeto
export function dxfFundacao(pav: Pavimento, ts: Trecho[], pts: PontoFund[], arq: Prim[] = [], cotas = true): string {
  const o: string[] = [];
  // sem acentos (o Eberick e outros programas nem sempre leem o \U+ do AutoCAD)
  const tx = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/·/g, '-').replace(/[^\x20-\x7e]/g, '');
  const line = (l: string, x1: number, y1: number, x2: number, y2: number, cor = 7) => o.push('0', 'LINE', '8', l, '62', String(cor), '10', x1.toFixed(4), '20', y1.toFixed(4), '11', x2.toFixed(4), '21', y2.toFixed(4));
  const circ = (l: string, x: number, y: number, r: number, cor = 7) => o.push('0', 'CIRCLE', '8', l, '62', String(cor), '10', x.toFixed(4), '20', y.toFixed(4), '40', r.toFixed(4));
  const text = (l: string, x: number, y: number, h: number, t: string, cor = 7, rot = 0, centro = false) => {
    o.push('0', 'TEXT', '8', l, '62', String(cor), '10', x.toFixed(4), '20', y.toFixed(4), '40', h.toFixed(3), '1', tx(t));
    if (rot) o.push('50', String(rot));
    if (centro) o.push('72', '1', '11', x.toFixed(4), '21', y.toFixed(4));
  };
  const rect = (l: string, x0: number, y0: number, x1: number, y1: number, cor = 7) => { line(l, x0, y0, x1, y0, cor); line(l, x1, y0, x1, y1, cor); line(l, x1, y1, x0, y1, cor); line(l, x0, y1, x0, y0, cor); };
  const br = (v: number) => v.toFixed(2).replace('.', ',');
  // arquitetura embaixo, em cinza
  for (const p of arq) for (let i = 0; i < p.pts.length - 1; i++) line('ARQUITETURA', p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1], 8);
  // paredes: eixo e faces
  for (const t of ts) {
    const h = t.esp / 2;
    if (t.o === 'H') { line('EIXO-PAREDE', t.s, t.c, t.e, t.c, 1); line('PAREDE', t.s, t.c - h, t.e, t.c - h, 7); line('PAREDE', t.s, t.c + h, t.e, t.c + h, 7); }
    else { line('EIXO-PAREDE', t.c, t.s, t.c, t.e, 1); line('PAREDE', t.c - h, t.s, t.c - h, t.e, 7); line('PAREDE', t.c + h, t.s, t.c + h, t.e, 7); }
  }
  // pontos: quadrado do pilar/coluna (espessura x espessura), cruz no centro e nome
  for (const p of pts) {
    const h = p.esp / 2;
    rect('PILAR', p.x - h, p.y - h, p.x + h, p.y + h, 3);
    line('PONTO-CENTRO', p.x - h * 1.6, p.y, p.x + h * 1.6, p.y, 2); line('PONTO-CENTRO', p.x, p.y - h * 1.6, p.x, p.y + h * 1.6, 2);
    circ('BLOCO', p.x, p.y, 0.25, 4);
    text('NOME-BLOCO', p.x + 0.18, p.y + 0.18, 0.12, `B${p.n}`, 4);
  }
  // cotas entre pontos ao longo de cada parede (locação)
  if (cotas) for (const t of ts) {
    const nos = pts.filter(q => t.o === 'H' ? Math.abs(q.y - t.c) < TOL && q.x > t.s - TOL && q.x < t.e + TOL : Math.abs(q.x - t.c) < TOL && q.y > t.s - TOL && q.y < t.e + TOL)
      .map(q => t.o === 'H' ? q.x : q.y).sort((a, b) => a - b);
    const off = t.esp / 2 + 0.35;
    for (let i = 0; i < nos.length - 1; i++) {
      const a = nos[i], b = nos[i + 1]; if (b - a < 0.2) continue;
      if (t.o === 'H') { const y = t.c - off; line('COTA', a, y, b, y, 5); line('COTA', a, y - .05, a, y + .05, 5); line('COTA', b, y - .05, b, y + .05, 5); text('COTA', (a + b) / 2, y + .04, .09, br(b - a), 5, 0, true); }
      else { const x = t.c + off; line('COTA', x, a, x, b, 5); line('COTA', x - .05, a, x + .05, a, 5); line('COTA', x - .05, b, x + .05, b, 5); text('COTA', x - .04, (a + b) / 2, .09, br(b - a), 5, 90, true); }
    }
  }
  // título e tabela de coordenadas ao lado
  const b = pav.box;
  text('TEXTO', b.x0, b.y1 + 1.2, .3, `LOCAÇÃO DOS PONTOS DE FUNDAÇÃO - ${pav.nome.toUpperCase()}`);
  text('TEXTO', b.x0, b.y1 + 0.8, .14, `${pts.length} pontos · coordenadas em metros (mesma origem do projeto) · quadrado = pilar/coluna (espessura da parede)`);
  let ty = b.y1, txx = b.x1 + 2;
  text('TABELA', txx, ty, .16, 'PONTO    X (m)       Y (m)      TIPO');
  for (const p of pts) {
    ty -= 0.26;
    if (ty < b.y0 - 2) { ty = b.y1 - 0.26; txx += 5; }
    text('TABELA', txx, ty, .12, `B${p.n}`); text('TABELA', txx + 0.8, ty, .12, p.x.toFixed(3)); text('TABELA', txx + 2, ty, .12, p.y.toFixed(3)); text('TABELA', txx + 3.2, ty, .1, DESC[p.tipo]);
  }
  return ['0', 'SECTION', '2', 'ENTITIES', ...o, '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
}

export function csvFundacao(pts: PontoFund[]): string {
  return ['Ponto;X (m);Y (m);Tipo;Pilar (cm)', ...pts.map(p => `B${p.n};${p.x.toFixed(3).replace('.', ',')};${p.y.toFixed(3).replace('.', ',')};${DESC[p.tipo]};${Math.round(p.esp * 100)}x${Math.round(p.esp * 100)}`)].join('\r\n');
}

// ---------- planta de locação (gabarito) ----------
// eixos verticais numerados (1, 2, 3… da esquerda para a direita) e horizontais com letras (A, B, C… de baixo para cima),
// cotas parciais e acumuladas a partir da origem (canto de baixo à esquerda) e cada ponto com a coordenada (X; Y)
export interface DesenhoLoc {
  linhas: { x1: number; y1: number; x2: number; y2: number; l: string; cor: number; tr?: boolean }[];
  circs: { x: number; y: number; r: number; l: string; cor: number }[];
  textos: { x: number; y: number; h: number; t: string; l: string; cor: number; rot?: number; centro?: boolean }[];
}
export interface Locacao { ox: number; oy: number; ex: { nome: string; v: number }[]; ey: { nome: string; v: number }[]; pts: (PontoFund & { X: number; Y: number; eixo: string })[]; d: DesenhoLoc }

const letra = (i: number): string => i < 26 ? String.fromCharCode(65 + i) : letra(Math.floor(i / 26) - 1) + letra(i % 26);
const brl = (v: number) => v.toFixed(2).replace('.', ',');

export function locacao(pts: PontoFund[], origem?: { x: number; y: number } | null): Locacao {
  const d: DesenhoLoc = { linhas: [], circs: [], textos: [] };
  const agr = (vs: number[]) => { const s = [...vs].sort((a, b) => a - b), o: number[] = []; for (const v of s) if (!o.length || v - o[o.length - 1] > 0.05) o.push(v); return o; };
  const xs = agr(pts.map(p => p.x)), ys = agr(pts.map(p => p.y));
  if (!xs.length) return { ox: 0, oy: 0, ex: [], ey: [], pts: [], d };
  const ox = origem?.x ?? xs[0], oy = origem?.y ?? ys[0], X1 = xs[xs.length - 1], Y1 = ys[ys.length - 1], X0 = xs[0], Y0 = ys[0];
  const ex = xs.map((v, i) => ({ nome: String(i + 1), v })), ey = ys.map((v, i) => ({ nome: letra(i), v }));
  const R = 0.3, M = 1.2;   // raio da bolinha do eixo e distância das linhas além da obra
  const L = (x1: number, y1: number, x2: number, y2: number, l: string, cor: number, tr = false) => d.linhas.push({ x1, y1, x2, y2, l, cor, tr });
  const T = (x: number, y: number, h: number, t: string, l: string, cor: number, rot = 0, centro = true) => d.textos.push({ x, y, h, t, l, cor, rot, centro });
  // eixos com bolinha nas duas pontas; eixos muito juntos: a bolinha sobe um nível (não fica uma em cima da outra)
  const niveis = (vs: number[]) => { const lv: number[] = []; vs.forEach((v, i) => { let n = 0; while (vs.slice(0, i).some((u, j) => lv[j] === n && v - u < 2 * R + 0.06)) n++; lv.push(n); }); return lv; };
  const nx = niveis(xs), ny = niveis(ys), PASSO = 2 * R + 0.25;
  const topo = Y1 + M + R + Math.max(0, ...nx) * PASSO, esq = X0 - M - R - Math.max(0, ...ny) * PASSO;
  ex.forEach((e, i) => {
    const yb = Y0 - M - R - nx[i] * PASSO, yt = Y1 + M + R + nx[i] * PASSO;
    L(e.v, yb + R, e.v, yt - R, 'EIXO-LOCACAO', 1, true);
    for (const y of [yb, yt]) { d.circs.push({ x: e.v, y, r: R, l: 'EIXO-LOCACAO', cor: 1 }); T(e.v, y - 0.09, 0.22, e.nome, 'EIXO-NOME', 1); }
    // distância acumulada desde a origem, em pé ao lado da linha do eixo
    T(e.v - 0.05, topo + R + 0.2, .13, brl(e.v - ox), 'COTA-ACUMULADA', 5, 90, false);
  });
  ey.forEach((e, i) => {
    const xl = X0 - M - R - ny[i] * PASSO, xr = X1 + M + R + ny[i] * PASSO;
    L(xl + R, e.v, xr - R, e.v, 'EIXO-LOCACAO', 1, true);
    for (const x of [xl, xr]) { d.circs.push({ x, y: e.v, r: R, l: 'EIXO-LOCACAO', cor: 1 }); T(x, e.v - 0.09, 0.22, e.nome, 'EIXO-NOME', 1); }
    T(esq - R - 0.2, e.v + 0.05, .13, brl(e.v - oy), 'COTA-ACUMULADA', 5, 0, false);
    d.textos[d.textos.length - 1].x -= 0.75;
  });
  // cotas parciais entre eixos, em cima e à esquerda (texto de cota pequena vai um pouco para fora)
  const cotaH = (a: number, b: number, y: number, t: string, k: number) => { L(a, y, b, y, 'COTA', 5); L(a, y - .07, a, y + .07, 'COTA', 5); L(b, y - .07, b, y + .07, 'COTA', 5); T((a + b) / 2, y + .06 + (b - a < 0.6 ? (k % 2) * 0.2 : 0), .12, t, 'COTA', 5); };
  const cotaV = (x: number, a: number, b: number, t: string, k: number) => { L(x, a, x, b, 'COTA', 5); L(x - .07, a, x + .07, a, 'COTA', 5); L(x - .07, b, x + .07, b, 'COTA', 5); T(x - .06 - (b - a < 0.6 ? (k % 2) * 0.2 : 0), (a + b) / 2, .12, t, 'COTA', 5, 90); };
  const yP = topo + R + 1.25, xP = esq - R - 1.25;
  for (let i = 0; i < xs.length - 1; i++) if (xs[i + 1] - xs[i] > 0.05) cotaH(xs[i], xs[i + 1], yP, brl(xs[i + 1] - xs[i]), i);
  for (let i = 0; i < ys.length - 1; i++) if (ys[i + 1] - ys[i] > 0.05) cotaV(xP, ys[i], ys[i + 1], brl(ys[i + 1] - ys[i]), i);
  cotaH(X0, X1, yP + 0.55, brl(X1 - X0), 0); cotaV(xP - 0.55, Y0, Y1, brl(Y1 - Y0), 0);
  T(X0, yP + 1.0, .13, 'numeros em pe junto dos eixos = distancia acumulada desde a origem', 'COTA', 5, 0, false);
  // origem
  L(ox - .35, oy - .35, ox + .35, oy + .35, 'ORIGEM', 6); L(ox - .35, oy + .35, ox + .35, oy - .35, 'ORIGEM', 6);
  T(ox + 0.45, oy - 0.6, .16, 'ORIGEM (0,00 ; 0,00)', 'ORIGEM', 6, 0, false);
  // pontos com a coordenada
  const out = pts.map(p => {
    const X = p.x - ox, Y = p.y - oy;
    const ix = xs.findIndex(v => Math.abs(v - p.x) <= 0.05), iy = ys.findIndex(v => Math.abs(v - p.y) <= 0.05);
    const eixo = `${ex[ix]?.nome ?? '?'}/${ey[iy]?.nome ?? '?'}`;
    d.circs.push({ x: p.x, y: p.y, r: 0.12, l: 'PONTO', cor: 3 });
    L(p.x - .2, p.y, p.x + .2, p.y, 'PONTO', 3); L(p.x, p.y - .2, p.x, p.y + .2, 'PONTO', 3);
    T(p.x + 0.16, p.y + 0.2, .13, `B${p.n}`, 'PONTO-NOME', 4, 0, false);
    T(p.x + 0.16, p.y - 0.3, .1, `(${brl(X)} ; ${brl(Y)})`, 'PONTO-COORD', 2, 0, false);
    return { ...p, X, Y, eixo };
  });
  return { ox, oy, ex, ey, pts: out, d };
}

export function dxfLocacao(pav: Pavimento, loc: Locacao, arq: Prim[] = [], origemDesc = 'eixo 1 / eixo A'): string {
  const o: string[] = [];
  const tx = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/·/g, '-').replace(/[^\x20-\x7e]/g, '');
  // camada do eixo em traço e ponto (tabela de tipos de linha)
  const hdr = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CENTER', '70', '0', '3', 'Center ____ _ ____', '72', '65', '73', '4', '40', '0.6', '49', '0.4', '49', '-0.08', '49', '0.04', '49', '-0.08', '0', 'ENDTAB', '0', 'ENDSEC'];
  const line = (l: string, x1: number, y1: number, x2: number, y2: number, cor: number, tr = false) => o.push('0', 'LINE', '8', l, ...(tr ? ['6', 'CENTER'] : []), '62', String(cor), '10', x1.toFixed(4), '20', y1.toFixed(4), '11', x2.toFixed(4), '21', y2.toFixed(4));
  for (const p of arq) for (let i = 0; i < p.pts.length - 1; i++) line('ARQUITETURA', p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1], 8);
  for (const l of loc.d.linhas) line(l.l, l.x1, l.y1, l.x2, l.y2, l.cor, l.tr);
  for (const c of loc.d.circs) o.push('0', 'CIRCLE', '8', c.l, '62', String(c.cor), '10', c.x.toFixed(4), '20', c.y.toFixed(4), '40', c.r.toFixed(4));
  const text = (l: string, x: number, y: number, h: number, t: string, cor: number, rot = 0, centro = false) => {
    o.push('0', 'TEXT', '8', l, '62', String(cor), '10', x.toFixed(4), '20', y.toFixed(4), '40', h.toFixed(3), '1', tx(t));
    if (rot) o.push('50', String(rot));
    if (centro) o.push('72', '1', '11', x.toFixed(4), '21', y.toFixed(4));
  };
  for (const t of loc.d.textos) text(t.l, t.x, t.y, t.h, t.t, t.cor, t.rot, t.centro);
  // título e tabela
  const xMax = Math.max(...loc.ex.map(e => e.v)), yMax = Math.max(...loc.ey.map(e => e.v)), xMin = Math.min(...loc.ex.map(e => e.v)), yMin = Math.min(...loc.ey.map(e => e.v));
  text('TEXTO', xMin - 2.5, yMax + 7, .35, `PLANTA DE LOCACAO - ${pav.nome.toUpperCase()}`, 7);
  text('TEXTO', xMin - 2.5, yMax + 6.5, .14, `${loc.pts.length} pontos - coordenadas em metros a partir da ORIGEM (${origemDesc})`, 7);
  let ty = yMax + 1.5, txx = xMax + 3.5;
  text('TABELA', txx, ty, .16, 'PONTO   EIXO     X (m)     Y (m)', 7);
  for (const p of loc.pts) {
    ty -= 0.28;
    if (ty < yMin - 2) { ty = yMax + 1.5 - 0.28; txx += 4.5; }
    text('TABELA', txx, ty, .13, `B${p.n}`, 7); text('TABELA', txx + 0.8, ty, .13, p.eixo, 7); text('TABELA', txx + 1.7, ty, .13, brl(p.X), 7); text('TABELA', txx + 2.8, ty, .13, brl(p.Y), 7);
  }
  return [...hdr, '0', 'SECTION', '2', 'ENTITIES', ...o, '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
}

export function csvLocacao(loc: Locacao): string {
  const n = (v: number) => v.toFixed(3).replace('.', ',');
  return ['Ponto;Eixo;X a partir da origem (m);Y a partir da origem (m);X do projeto (m);Y do projeto (m);Tipo',
    ...loc.pts.map(p => `B${p.n};${p.eixo};${n(p.X)};${n(p.Y)};${n(p.x)};${n(p.y)};${DESC[p.tipo]}`)].join('\r\n');
}

// mesmo desenho em SVG para a tela
export function svgLocacao(loc: Locacao, X: (x: number) => number, Y: (y: number) => number, k: number): string {
  const cor = (c: number) => ({ 1: '#c92a2a', 2: '#b08900', 3: '#2b8a3e', 4: '#1971c2', 5: '#1c7ed6', 6: '#ae3ec9' } as Record<number, string>)[c] ?? '#333';
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return loc.d.linhas.map(l => `<line x1="${X(l.x1)}" y1="${Y(l.y1)}" x2="${X(l.x2)}" y2="${Y(l.y2)}" stroke="${cor(l.cor)}" stroke-width="${l.tr ? 1.2 : 1.6}"${l.tr ? ' stroke-dasharray="24 6 4 6"' : ''}/>`).join('') +
    loc.d.circs.map(c => `<circle cx="${X(c.x)}" cy="${Y(c.y)}" r="${c.r * k}" fill="#fff" stroke="${cor(c.cor)}" stroke-width="2"/>`).join('') +
    loc.d.textos.map(t => `<text x="${X(t.x)}" y="${Y(t.y)}" font-size="${t.h * k * 1.3}" fill="${cor(t.cor)}"${t.centro ? ' text-anchor="middle"' : ''}${t.rot ? ` transform="rotate(${-t.rot} ${X(t.x)} ${Y(t.y)})"` : ''}>${esc(t.t)}</text>`).join('');
}

// ---------- esperas (arranques) dos painéis na fundação ----------
// em cada painel, esperas a `borda` das pontas e no meio até o espaçamento máximo; embaixo de porta não tem espera
export interface Espera { n: number; cod: string; painel: Painel; d: number; x: number; y: number }
export function esperasPaineis(ps: Painel[], cod: (p: Painel) => string, borda = 0.2, espac = 1.2): Espera[] {
  const out: Espera[] = [];
  for (const p of [...ps].sort((a, b) => a.num - b.num)) {
    // trechos do pé do painel que encostam na fundação (tira as portas)
    const portas = p.recortes.filter(r => r.base <= 0.01).map(r => [r.dl, r.dl + r.w] as [number, number]).sort((a, b) => a[0] - b[0]);
    const segs: [number, number][] = []; let s0 = 0;
    for (const [a, b] of portas) { if (a - s0 > 0.05) segs.push([s0, a]); s0 = Math.max(s0, b); }
    if (p.larg - s0 > 0.05) segs.push([s0, p.larg]);
    const ds: number[] = [];
    for (const [a, b] of segs) {
      const L = b - a;
      if (L < 0.15) continue;
      if (L < 2 * borda + 0.1) { ds.push(a + L / 2); continue; }
      const i0 = a + borda, i1 = b - borda, k = Math.max(1, Math.ceil((i1 - i0) / espac - 1e-9));
      for (let j = 0; j <= k; j++) ds.push(i0 + (i1 - i0) * j / k);
    }
    for (const d of ds) out.push({ n: out.length + 1, cod: cod(p), painel: p, d, x: p.o === 'H' ? p.a + d : p.c, y: p.o === 'H' ? p.c : p.a + d });
  }
  return out;
}

export function dxfEsperas(pav: Pavimento, ts: Trecho[], ps: Painel[], es: Espera[], cod: (p: Painel) => string, arq: Prim[] = [], borda = 0.2, espac = 1.2): string {
  const o: string[] = [];
  const tx = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/·/g, '-').replace(/[^\x20-\x7e]/g, '');
  const line = (l: string, x1: number, y1: number, x2: number, y2: number, cor: number) => o.push('0', 'LINE', '8', l, '62', String(cor), '10', x1.toFixed(4), '20', y1.toFixed(4), '11', x2.toFixed(4), '21', y2.toFixed(4));
  const text = (l: string, x: number, y: number, h: number, t: string, cor: number, rot = 0, centro = false) => {
    o.push('0', 'TEXT', '8', l, '62', String(cor), '10', x.toFixed(4), '20', y.toFixed(4), '40', h.toFixed(3), '1', tx(t));
    if (rot) o.push('50', String(rot));
    if (centro) o.push('72', '1', '11', x.toFixed(4), '21', y.toFixed(4));
  };
  for (const p of arq) for (let i = 0; i < p.pts.length - 1; i++) line('ARQUITETURA', p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1], 8);
  for (const t of ts) if (t.o === 'H') line('EIXO-PAREDE', t.s, t.c, t.e, t.c, 1); else line('EIXO-PAREDE', t.c, t.s, t.c, t.e, 1);
  for (const p of ps) {
    const h = 0.06, [x0, y0, x1, y1] = p.o === 'H' ? [p.a, p.c, p.a + p.larg, p.c] : [p.c, p.a, p.c, p.a + p.larg];
    const cor = p.num % 2 ? 5 : 30;
    // painel: faixa fina com risco nas pontas
    if (p.o === 'H') { line('PAINEL', x0, y0 - h, x1, y1 - h, cor); line('PAINEL', x0, y0 + h, x1, y1 + h, cor); line('PAINEL', x0, y0 - .12, x0, y0 + .12, cor); line('PAINEL', x1, y1 - .12, x1, y1 + .12, cor); }
    else { line('PAINEL', x0 - h, y0, x1 - h, y1, cor); line('PAINEL', x0 + h, y0, x1 + h, y1, cor); line('PAINEL', x0 - .12, y0, x0 + .12, y0, cor); line('PAINEL', x1 - .12, y1, x1 + .12, y1, cor); }
    const m = p.a + p.larg / 2;
    if (p.o === 'H') text('PAINEL-NOME', m, p.c + 0.22, .1, cod(p), cor, 0, true); else text('PAINEL-NOME', p.c - 0.22, m, .1, cod(p), cor, 90, true);
    // cotas do início do painel até cada espera
    const ds = es.filter(e => e.painel === p).map(e => e.d);
    const marcos = [0, ...ds, p.larg];
    for (let i = 0; i < marcos.length - 1; i++) {
      const a = p.a + marcos[i], b = p.a + marcos[i + 1]; if (b - a < 0.03) continue;
      const t = (b - a).toFixed(2).replace('.', ',');
      if (p.o === 'H') { const y = p.c - 0.3; line('COTA', a, y, b, y, 5); line('COTA', a, y - .04, a, y + .04, 5); line('COTA', b, y - .04, b, y + .04, 5); text('COTA', (a + b) / 2, y - .13, .07, t, 5, 0, true); }
      else { const x = p.c + 0.3; line('COTA', x, a, x, b, 5); line('COTA', x - .04, a, x + .04, a, 5); line('COTA', x - .04, b, x + .04, b, 5); text('COTA', x + .13, (a + b) / 2, .07, t, 5, 90, true); }
    }
  }
  for (const e of es) {
    o.push('0', 'CIRCLE', '8', 'ESPERA', '62', '1', '10', e.x.toFixed(4), '20', e.y.toFixed(4), '40', '0.035');
    line('ESPERA', e.x - .07, e.y - .07, e.x + .07, e.y + .07, 1); line('ESPERA', e.x - .07, e.y + .07, e.x + .07, e.y - .07, 1);
  }
  const b = pav.box;
  text('TEXTO', b.x0, b.y1 + 1.2, .3, `ESPERAS DOS PAINEIS NA FUNDACAO - ${pav.nome.toUpperCase()}`, 7);
  text('TEXTO', b.x0, b.y1 + 0.8, .14, `${es.length} esperas - ${borda.toFixed(2).replace('.', ',')} m das pontas do painel e no maximo ${espac.toFixed(2).replace('.', ',')} m entre elas - sem espera embaixo de porta - cotas a partir do inicio de cada painel`, 7);
  let ty = b.y1, txx = b.x1 + 2;
  text('TABELA', txx, ty, .16, 'PAINEL     ESPERAS (m a partir do inicio do painel)', 7);
  for (const p of [...ps].sort((a, c) => a.num - c.num)) {
    ty -= 0.26; if (ty < b.y0 - 2) { ty = b.y1 - 0.26; txx += 6; }
    text('TABELA', txx, ty, .12, cod(p), 7); text('TABELA', txx + 1.1, ty, .12, es.filter(e => e.painel === p).map(e => e.d.toFixed(2).replace('.', ',')).join('  '), 7);
  }
  return ['0', 'SECTION', '2', 'ENTITIES', ...o, '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
}

export function csvEsperas(es: Espera[], ox = 0, oy = 0): string {
  const n = (v: number) => v.toFixed(3).replace('.', ',');
  return ['Espera;Painel;Distancia do inicio do painel (m);X a partir da origem (m);Y a partir da origem (m)', ...es.map(e => `E${e.n};${e.cod};${n(e.d)};${n(e.x - ox)};${n(e.y - oy)}`)].join('\r\n');
}

// ---------- detalhamento do bloco de coroamento ----------
// gaiola: n estribos quadrados fechados em cada direção (lado da armadura x altura da armadura), com gancho nas pontas
export interface OpBloco { lado: number; alt: number; armLado: number; armAlt: number; barras: number; bitola: number; barra: number; gancho: number; estaca: number; qtd: number }
export const BLOCO_PADRAO: Omit<OpBloco, 'qtd'> = { lado: 0.5, alt: 0.5, armLado: 0.44, armAlt: 0.44, barras: 4, bitola: 8.0, barra: 12, gancho: 0.08, estaca: 0.30 };
export const pesoBitola = (mm: number) => 0.006165 * mm * mm;   // kg/m (aço CA-50)

export function quantBloco(o: OpBloco) {
  const comp = 2 * o.armLado + 2 * o.armAlt + 2 * (o.gancho ?? 0);   // N1 = N2, estribo fechado com 2 ganchos
  const porBloco = 2 * o.barras, total = porBloco * o.qtd;
  const metros = total * comp, kg = metros * pesoBitola(o.bitola);
  const porBarra = Math.floor(o.barra / comp + 1e-9), barras12 = porBarra ? Math.ceil(total / porBarra) : 0;
  const conc = o.lado * o.lado * o.alt;
  return { comp, porBloco, total, metros, kg, porBarra, barras12, sobra: o.barra - porBarra * comp, conc, concTotal: conc * o.qtd, forma: 4 * o.lado * o.alt * o.qtd, esp: o.barras > 1 ? (o.armLado) / (o.barras - 1) : 0, cob: (o.lado - o.armLado) / 2, cobFundo: (o.alt - o.armAlt) / 2 };
}

// desenho em SVG (unidades em cm): planta, corte A-A e a barra dobrada, com cotas
export function blocoSvg(o: OpBloco): { svg: string; w: number; h: number } {
  const c = (m: number) => m * 100, br = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ','), bit = o.bitola.toFixed(1).replace('.', ',');
  const L = c(o.lado), H = c(o.alt), A = c(o.armLado), AH = c(o.armAlt), cb = (L - A) / 2, cbf = (H - AH) / 2, n = o.barras, e = n > 1 ? A / (n - 1) : 0;
  const s: string[] = [];
  const ln = (x1: number, y1: number, x2: number, y2: number, cor = '#222', w = 0.35, extra = '') => s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${cor}" stroke-width="${w}" ${extra}/>`);
  const tx = (x: number, y: number, t: string, h = 2.4, anc = 'middle', rot = 0, cor = '#222', peso = 'normal') => s.push(`<text x="${x}" y="${y}" font-size="${h}" text-anchor="${anc}" fill="${cor}" font-weight="${peso}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}>${t}</text>`);
  const cotaH = (x1: number, x2: number, y: number, t: string) => { ln(x1, y, x2, y, '#1c7ed6', 0.2); ln(x1, y - 1, x1, y + 1, '#1c7ed6', 0.2); ln(x2, y - 1, x2, y + 1, '#1c7ed6', 0.2); tx((x1 + x2) / 2, y - 0.8, t, 2, 'middle', 0, '#1c7ed6'); };
  const cotaV = (x: number, y1: number, y2: number, t: string) => { ln(x, y1, x, y2, '#1c7ed6', 0.2); ln(x - 1, y1, x + 1, y1, '#1c7ed6', 0.2); ln(x - 1, y2, x + 1, y2, '#1c7ed6', 0.2); tx(x - 0.8, (y1 + y2) / 2, t, 2, 'middle', -90, '#1c7ed6'); };
  const ferro = '#c92a2a', fw = Math.max(0.5, o.bitola / 10);
  // PLANTA (origem em 15,15)
  let X0 = 15, Y0 = 18;
  tx(X0 + L / 2, Y0 - 8, 'PLANTA', 3.2, 'middle', 0, '#222', 'bold');
  s.push(`<rect x="${X0}" y="${Y0}" width="${L}" height="${L}" fill="#f1f3f5" stroke="#222" stroke-width="0.6"/>`);
  for (let i = 0; i < n; i++) { const p = cb + i * e; ln(X0 + cb, Y0 + p, X0 + cb + A, Y0 + p, ferro, fw); ln(X0 + p, Y0 + cb, X0 + p, Y0 + cb + A, ferro, fw, 'stroke-dasharray="2 1"'); }
  tx(X0 + L + 2, Y0 + cb + 1, `N1`, 2.2, 'start', 0, ferro); tx(X0 + cb + 1, Y0 + L + 4, `N2`, 2.2, 'start', 0, ferro);
  cotaH(X0, X0 + L, Y0 + L + 9, br(L)); cotaH(X0 + cb, X0 + cb + A, Y0 + L + 5.5, br(A));
  cotaV(X0 - 8, Y0, Y0 + L, br(L));
  for (let i = 0; i < n - 1; i++) cotaV(X0 - 4, Y0 + cb + i * e, Y0 + cb + (i + 1) * e, br(e));
  // corte A-A indicado
  ln(X0 - 12, Y0 + L / 2, X0 + L + 3, Y0 + L / 2, '#555', 0.25, 'stroke-dasharray="3 1 1 1"'); tx(X0 - 13, Y0 + L / 2 + 1, 'A', 2.4, 'end'); tx(X0 + L + 4, Y0 + L / 2 + 1, 'A', 2.4, 'start');
  // CORTE A-A (ao lado)
  const X1 = X0 + L + 30, Y1 = Y0;
  tx(X1 + L / 2, Y1 - 8, 'CORTE A-A', 3.2, 'middle', 0, '#222', 'bold');
  s.push(`<rect x="${X1}" y="${Y1}" width="${L}" height="${H}" fill="#f1f3f5" stroke="#222" stroke-width="0.6"/>`);
  // U da N1 (fundo embaixo, pernas para cima)
  const yb = Y1 + H - cbf, yt = yb - AH;
  s.push(`<rect x="${X1 + cb}" y="${yt}" width="${A}" height="${AH}" fill="none" stroke="${ferro}" stroke-width="${fw}"/>`);
  // gancho no canto de cima à esquerda
  ln(X1 + cb, yt, X1 + cb + 4, yt + 4, ferro, fw); ln(X1 + cb, yt, X1 + cb + 4.5, yt + 2.5, ferro, fw);
  // N2 cortadas: pontos no fundo e no topo
  for (let i = 0; i < n; i++) for (const yy of [yb - fw, yt + fw]) s.push(`<circle cx="${X1 + cb + i * e}" cy="${yy}" r="${fw * 0.8}" fill="${ferro}"/>`);
  tx(X1 + L / 2, yb - 3, 'N1', 2.2, 'middle', 0, ferro); tx(X1 + L + 2, yb, 'N2', 2.2, 'start', 0, ferro);
  cotaH(X1, X1 + L, Y1 + H + 9, br(L)); cotaH(X1 + cb, X1 + cb + A, Y1 + H + 5.5, br(A));
  cotaV(X1 + L + 8, Y1, Y1 + H, br(H)); cotaV(X1 + L + 4, yt, yb, br(AH));
  if (cbf > 0.1) cotaV(X1 - 3, yb, Y1 + H, br(cbf));
  ln(X1 - 6, Y1 + H, X1 + L + 6, Y1 + H, '#888', 0.25); tx(X1 - 6, Y1 + H + 3, 'fundo do bloco', 1.8, 'start', 0, '#888');
  // BARRA DOBRADA
  const X2 = X1 + L + 30, Y2 = Y0 + 4, k = 0.6;
  tx(X2 + A * k / 2, Y2 - 12, 'ESTRIBO N1 = N2', 3.2, 'middle', 0, '#222', 'bold');
  s.push(`<rect x="${X2}" y="${Y2}" width="${A * k}" height="${AH * k}" fill="none" stroke="${ferro}" stroke-width="${fw * 1.2}"/>`);
  const G = c(o.gancho ?? 0);
  if (G > 0) { ln(X2, Y2, X2 + G * k * 0.7, Y2 + G * k * 0.7, ferro, fw * 1.2); ln(X2, Y2, X2 + G * k * 0.95, Y2 + G * k * 0.3, ferro, fw * 1.2); tx(X2 + G * k + 1, Y2 + G * k * 0.7 + 2, `gancho ${br(G)}`, 1.8, 'start', 0, '#555'); }
  tx(X2 - 1.5, Y2 + AH * k / 2, br(AH), 2.4, 'end'); tx(X2 + A * k + 1.5, Y2 + AH * k / 2, br(AH), 2.4, 'start'); tx(X2 + A * k / 2, Y2 + AH * k + 4, br(A), 2.4); tx(X2 + A * k / 2, Y2 - 1.5, br(A), 2.4);
  const comp = 2 * A + 2 * AH + 2 * G;
  tx(X2 + A * k / 2, Y2 + AH * k + 10, `${o.barras} Ø${bit} C=${br(comp)}`, 2.6, 'middle', 0, ferro, 'bold');
  tx(X2 + A * k / 2, Y2 + AH * k + 14, '(em cada direção: N1 e N2)', 2, 'middle', 0, '#555');
  const w = X2 + A * k + 25, h = Y0 + Math.max(L, H) + 14;
  return { svg: s.join(''), w, h };
}

// ---------- folha técnica do bloco (no padrão do detalhamento do Eberick) ----------
// unidades: mm de papel com o bloco em 1:10 (1 mm de papel = 1 cm do bloco); y para baixo
type Cam = 'CONCRETO' | 'FERRO' | 'FERRO-CORTE' | 'TEXTO' | 'COTA' | 'TITULO' | 'ESTACA' | 'NIVEL' | 'TABELA' | 'CHAMADA';
type Prim2 = { k: 'l'; x1: number; y1: number; x2: number; y2: number; c: Cam; w?: number; tr?: boolean }
  | { k: 'r'; x: number; y: number; w: number; h: number; c: Cam; fill?: boolean }
  | { k: 'c'; x: number; y: number; r: number; c: Cam; fill?: boolean }
  | { k: 'p'; pts: [number, number][]; c: Cam; w?: number }
  | { k: 't'; x: number; y: number; h: number; s: string; c: Cam; anc?: 'start' | 'middle' | 'end'; rot?: number; neg?: boolean };

export function desenhoBloco(o: OpBloco & { nomes?: string }): Prim2[] {
  const P: Prim2[] = [];
  const S = 1;   // escala 1:10 (1 mm de papel por cm)
  const cm = (m: number) => m * 100 * S;
  const L = cm(o.lado), H = cm(o.alt), A = cm(o.armLado), AH = cm(o.armAlt), cb = (L - A) / 2, cbf = (H - AH) / 2;
  const n = o.barras, esp = n > 1 ? A / (n - 1) : 0, G = cm(o.gancho ?? 0);
  const q = quantBloco(o), C = Math.round(q.comp * 100), d1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
  const bit = o.bitola.toFixed(1), espT = Math.round(esp / S);
  const l = (x1: number, y1: number, x2: number, y2: number, c: Cam, w?: number, tr?: boolean) => P.push({ k: 'l', x1, y1, x2, y2, c, w, tr });
  const t = (x: number, y: number, s: string, h = 2.2, c: Cam = 'TEXTO', anc: 'start' | 'middle' | 'end' = 'start', rot = 0, neg = false) => P.push({ k: 't', x, y, h, s, c, anc, rot, neg });
  const r = (x: number, y: number, w: number, h: number, c: Cam, fill = false) => P.push({ k: 'r', x, y, w, h, c, fill });
  // cota no estilo do Eberick: linha, tracinhos a 45° e texto em cima
  const tk = (x: number, y: number) => l(x - 0.8, y + 0.8, x + 0.8, y - 0.8, 'COTA');
  const cH = (x1: number, x2: number, y: number, s: string, de?: number) => { l(x1 - 1, y, x2 + 1, y, 'COTA'); tk(x1, y); tk(x2, y); if (de !== undefined) { l(x1, de, x1, y + 1, 'COTA'); l(x2, de, x2, y + 1, 'COTA'); } t((x1 + x2) / 2, y - 0.7, s, 2, 'COTA', 'middle'); };
  const cV = (x: number, y1: number, y2: number, s: string, de?: number) => { l(x, y1 - 1, x, y2 + 1, 'COTA'); tk(x, y1); tk(x, y2); if (de !== undefined) { l(de, y1, x - 1, y1, 'COTA'); l(de, y2, x - 1, y2, 'COTA'); } t(x - 0.7, (y1 + y2) / 2, s, 2, 'COTA', 'middle', -90); };
  const cham = (x: number, y: number, x2: number, y2: number, s: string, anc: 'start' | 'end' = 'end') => { l(x, y, x2, y2, 'CHAMADA'); l(x2, y2, x2 + (anc === 'end' ? -5 : 5), y2, 'CHAMADA'); t(x2 + (anc === 'end' ? -5.5 : 5.5), y2 + 0.8, s, 2.1, 'TEXTO', anc); };
  const nivel = (x: number, y: number, s: string) => { P.push({ k: 'p', pts: [[x, y], [x - 1.3, y - 2], [x + 1.3, y - 2], [x, y]], c: 'NIVEL' }); l(x - 1.8, y - 2, x + 1.8, y - 2, 'NIVEL'); t(x, y - 2.8, s, 2, 'NIVEL', 'middle'); };
  const titulo = (x: number, y: number, a: string, b: string) => { t(x, y, a, 2.4, 'TEXTO'); t(x, y + 3.2, b, 2.2, 'TEXTO'); };
  // desenho da barra (estribo) com as medidas e a chamada embaixo
  const barra = (x: number, y: number, nn: string, k = 0.55) => {
    const a = A * k, h = AH * k;
    P.push({ k: 'p', pts: [[x, y], [x + a, y], [x + a, y + h], [x, y + h], [x, y]], c: 'FERRO', w: 0.5 });
    if (G) { l(x, y, x + 3, y + 3, 'FERRO', 0.5); l(x, y, x + 3.4, y + 1.2, 'FERRO', 0.5); }
    t(x + a / 2, y - 0.8, d1(o.armLado * 100), 2, 'TEXTO', 'middle'); t(x + a / 2, y + h + 2.8, d1(o.armLado * 100), 2, 'TEXTO', 'middle');
    t(x - 0.8, y + h / 2 + 0.7, d1(o.armAlt * 100), 2, 'TEXTO', 'end'); t(x + a + 0.8, y + h / 2 + 0.7, d1(o.armAlt * 100), 2, 'TEXTO');
    t(x + a / 2, y + h + 6.5, `${n} ${nn} ø${bit} c/${espT} C=${C}`, 2.1, 'TEXTO', 'middle');
  };
  const nome = o.nomes || `B1 a B${o.qtd}`;

  // ===== PLANTA =====
  const PX = 30, PY = 42;
  t(6, 9, nome, 2.8, 'TITULO'); t(6, 12.6, `${d1(o.lado * 100)}x${d1(o.lado * 100)}x${d1(o.alt * 100)} (${o.qtd} blocos)`, 2.2, 'TEXTO');
  titulo(6, 19, 'PLANTA', 'ESC 1:10');
  r(PX, PY, L, L, 'CONCRETO', true);
  if (o.estaca) P.push({ k: 'c', x: PX + L / 2, y: PY + L / 2, r: cm(o.estaca) / 2, c: 'ESTACA' });
  for (let i = 0; i < n; i++) { const p = cb + i * esp; l(PX + cb, PY + p, PX + cb + A, PY + p, 'FERRO', 0.4); l(PX + p, PY + cb, PX + p, PY + cb + A, 'FERRO', 0.4); }
  cham(PX + cb + 2 * esp, PY + cb, PX - 3, PY - 6, 'N1');
  cham(PX + cb + A, PY + cb + 2 * esp, PX + L + 7, PY + L + 5, 'N2', 'start');
  // linhas de corte A e B
  l(PX - 7, PY + L / 2, PX + L + 7, PY + L / 2, 'CHAMADA', 0.15, true); l(PX + L / 2, PY - 5, PX + L / 2, PY + L + 9, 'CHAMADA', 0.15, true);
  t(PX - 8, PY + L / 2 + 0.7, 'A', 2.2, 'TEXTO', 'end'); t(PX + L + 8, PY + L / 2 + 0.7, 'A', 2.2); t(PX + L / 2, PY - 6, 'B', 2.2, 'TEXTO', 'middle'); t(PX + L / 2, PY + L + 12, 'B', 2.2, 'TEXTO', 'middle');
  cH(PX, PX + L, PY + L + 16, d1(o.lado * 100), PY + L + 1);
  cV(PX - 12, PY, PY + L, d1(o.lado * 100), PX - 1);
  for (let i = 0; i < n - 1; i++) cV(PX - 4, PY + cb + i * esp, PY + cb + (i + 1) * esp, String(espT));
  t(PX + L / 2, PY + L + 24, `${n} N1 ø${bit} c/${espT}`, 2.1, 'TEXTO', 'middle');
  t(PX + L / 2, PY + L + 27.5, `${n} N2 ø${bit} c/${espT}`, 2.1, 'TEXTO', 'middle');

  // ===== CORTES =====
  const corte = (X: number, Y: number, tt: string, nn: 'N1' | 'N2') => {
    titulo(X - 14, Y - 23, tt, 'ESC 1:10');
    const outro = nn === 'N1' ? 'N2' : 'N1';
    // linha de nível do topo do bloco, tracejada
    l(X - 16, Y, X + L + 20, Y, 'NIVEL', 0.15, true); nivel(X + L + 12, Y, '0');
    r(X, Y, L, H, 'CONCRETO', true);
    // estaca embaixo, com linha de interrupção
    const eh = 20;
    if (o.estaca) {
      const e = cm(o.estaca), ex = X + L / 2 - e / 2;
      r(ex, Y + H, e, eh, 'ESTACA', true);
      P.push({ k: 'p', pts: [[ex - 2, Y + H + eh], [ex + e * 0.3, Y + H + eh], [ex + e * 0.42, Y + H + eh - 2], [ex + e * 0.58, Y + H + eh + 2], [ex + e * 0.7, Y + H + eh], [ex + e + 2, Y + H + eh]], c: 'CHAMADA' });
      t(ex + e + 3, Y + H + eh / 2, `estaca ø${Math.round(o.estaca * 100)}`, 2, 'TEXTO');
    }
    const x0 = X + cb, y0 = Y + cbf;
    // estribo no plano do corte
    P.push({ k: 'p', pts: [[x0, y0], [x0 + A, y0], [x0 + A, y0 + AH], [x0, y0 + AH], [x0, y0]], c: 'FERRO', w: 0.45 });
    if (G) { l(x0, y0, x0 + 3, y0 + 3, 'FERRO', 0.45); l(x0, y0, x0 + 3.4, y0 + 1.2, 'FERRO', 0.45); }
    // estribos do outro sentido, vistos de lado (em pé)
    for (let i = 1; i < n - 1; i++) l(x0 + i * esp, y0, x0 + i * esp, y0 + AH, 'FERRO', 0.4);
    cham(x0, y0 + AH * 0.25, X - 5, Y + 6, nn);
    cham(x0 + esp, y0 + AH * 0.6, X - 5, Y + H - 6, outro);
    cV(X + L + 5, Y, Y + H, d1(o.alt * 100), X + L + 1);
    cV(X - 11, y0, y0 + AH, d1(o.armAlt * 100), X - 1);
    cH(X, X + L, Y + H + (o.estaca ? eh + 6 : 6), d1(o.lado * 100), Y + H + 1);
    nivel(X + L + 12, Y + H, `-${Math.round(o.alt * 100)}`);
    // desenho do estribo embaixo do corte, com a chamada
    barra(X + cb, Y + H + (o.estaca ? eh + 18 : 18), nn, 1);
  };
  corte(124, PY, 'CORTE A-A', 'N1');
  corte(208, PY, 'CORTE B-B', 'N2');

  // ===== TABELAS (padrão Eberick) =====
  const tab = (X: number, Y: number, tit: string, cab: string[], ws: number[], lin: string[][]) => {
    const h = 3.6, W = ws.reduce((a, b) => a + b, 0), N = lin.length + 2;
    r(X, Y, W, h * N, 'TABELA');
    t(X + W / 2, Y + 2.7, tit, 2, 'TABELA', 'middle'); l(X, Y + h, X + W, Y + h, 'TABELA');
    let x = X; cab.forEach((c, i) => { t(x + ws[i] / 2, Y + h + 2.7, c, 1.8, 'TABELA', 'middle'); x += ws[i]; if (i < cab.length - 1) l(x, Y + h, x, Y + h * N, 'TABELA'); });
    lin.forEach((ln2, j) => { const yy = Y + (j + 2) * h; l(X, yy, X + W, yy, 'TABELA'); let xx = X; ln2.forEach((c, i) => { t(xx + ws[i] / 2, yy + 2.7, c, 1.8, 'TABELA', 'middle'); xx += ws[i]; }); });
    return Y + h * N;
  };
  const TX = 282;
  let y = 14;
  y = tab(TX, y, 'ARMADURA - POR BLOCO', ['N', 'ø (mm)', 'QUANT', 'C.UNIT (cm)', 'C.TOTAL (cm)'], [10, 16, 16, 24, 26],
    [['1', bit, String(n), String(C), String(n * C)], ['2', bit, String(n), String(C), String(n * C)]]) + 5;
  y = tab(TX, y, `ARMADURA - ${o.qtd} BLOCOS`, ['N', 'ø (mm)', 'QUANT', 'C.UNIT (cm)', 'C.TOTAL (m)'], [10, 16, 16, 24, 26],
    [['1', bit, String(n * o.qtd), String(C), d1(q.metros / 2)], ['2', bit, String(n * o.qtd), String(C), d1(q.metros / 2)]]) + 5;
  y = tab(TX, y, 'RESUMO DO AÇO', ['AÇO', 'ø (mm)', 'C.TOTAL (m)', 'PESO+10% (kg)', `BARRAS ${d1(o.barra)}m`], [12, 14, 20, 24, 22],
    [['CA50', bit, d1(q.metros), d1(q.kg * 1.1), String(q.barras12)]]) + 5;
  y = tab(TX, y, 'CONSUMO', ['ITEM', 'POR BLOCO', `TOTAL (${o.qtd})`], [36, 28, 28],
    [['Concreto (m³)', q.conc.toFixed(3).replace('.', ','), q.concTotal.toFixed(2).replace('.', ',')], ['Forma (m²)', (4 * o.lado * o.alt).toFixed(2).replace('.', ','), q.forma.toFixed(2).replace('.', ',')], ['Aço CA50 (kg)', (q.kg / o.qtd).toFixed(2).replace('.', ','), d1(q.kg)]]) + 7;
  t(TX, y, 'NOTAS', 2.2, 'TITULO');
  [`Cobrimento: ${d1(q.cob * 100)} cm (laterais), ${d1(q.cobFundo * 100)} cm (fundo e topo).`,
   `N1 e N2: estribos quadrados fechados ${d1(o.armLado * 100)}x${d1(o.armAlt * 100)},`,
   `gancho de ${d1(G / S)} cm em cada ponta, formando a gaiola.`,
   `Plano de corte: ${q.porBarra} estribos por barra de ${d1(o.barra)} m.`,
   `Concreto e aço conforme o projeto estrutural.`,
   `Medidas em cm. Locação: planta de locação.`].forEach((s2, i) => t(TX, y + 4 + i * 3.3, s2, 1.9));
  return P;
}

const CORES_CAD: Record<Cam, { tela: string; papel: string; branco: string; dxf: number }> = {
  CONCRETO: { tela: '#3b5bdb', papel: '#1c3fa0', branco: '#1a1aff', dxf: 5 }, FERRO: { tela: '#ffd43b', papel: '#c92a2a', branco: '#e6d000', dxf: 2 }, 'FERRO-CORTE': { tela: '#ffd43b', papel: '#c92a2a', branco: '#e6d000', dxf: 2 },
  TEXTO: { tela: '#f8f9fa', papel: '#111', branco: '#111', dxf: 7 }, COTA: { tela: '#f8f9fa', papel: '#111', branco: '#111', dxf: 7 }, TITULO: { tela: '#40c057', papel: '#2b8a3e', branco: '#00b000', dxf: 3 },
  ESTACA: { tela: '#868e96', papel: '#868e96', branco: '#1a1aff', dxf: 5 }, NIVEL: { tela: '#f8f9fa', papel: '#111', branco: '#111', dxf: 7 }, TABELA: { tela: '#f8f9fa', papel: '#111', branco: '#777', dxf: 8 }, CHAMADA: { tela: '#f8f9fa', papel: '#333', branco: '#666', dxf: 8 },
};
const PREENCHE: Record<'tela' | 'papel' | 'branco', { bloco: string; estaca: string; pilar: string }> = {
  tela: { bloco: '#a68a64', estaca: '#868e96', pilar: '#495057' }, papel: { bloco: '#e9dfc9', estaca: '#ced4da', pilar: '#868e96' }, branco: { bloco: '#9c8a3a', estaca: '#b4b4b4', pilar: '#555' },
};

// SVG: tema "tela" = fundo preto como no Eberick; "papel" = fundo branco para imprimir
export function blocoTecnico(o: OpBloco & { nomes?: string }, tema: 'tela' | 'papel' = 'papel'): string { return svgPrims(desenhoBloco(o), tema); }
function svgPrims(P: Prim2[], tema: 'tela' | 'papel' | 'branco'): string {
  const cor = (c: Cam) => CORES_CAD[c][tema], f = (v: number) => v.toFixed(2);
  const out: string[] = [];
  if (tema === 'tela') out.push('<rect x="0" y="0" width="400" height="255" fill="#000"/>');
  if (tema === 'branco') out.push('<rect x="0" y="0" width="400" height="255" fill="#fff"/>');
  for (const p of P) {
    if (p.k === 'l') out.push(`<line x1="${f(p.x1)}" y1="${f(p.y1)}" x2="${f(p.x2)}" y2="${f(p.y2)}" stroke="${cor(p.c)}" stroke-width="${p.w ?? 0.15}"${p.tr ? ' stroke-dasharray="2.5 0.8 0.5 0.8"' : ''}/>`);
    else if (p.k === 'r') out.push(`<rect x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}" fill="${p.fill ? (p.c === 'CONCRETO' ? PREENCHE[tema].bloco : PREENCHE[tema].estaca) : 'none'}" stroke="${cor(p.c)}" stroke-width="${p.c === 'CONCRETO' || p.c === 'ESTACA' ? 0.3 : 0.15}"/>`);
    else if (p.k === 'c') out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(p.r)}" fill="${p.fill ? (p.c === 'ESTACA' ? PREENCHE[tema].estaca : cor(p.c)) : 'none'}" stroke="${cor(p.c)}" stroke-width="${p.c === 'FERRO' ? 0.35 : 0.25}"/>`);
    else if (p.k === 'p') out.push(`<polyline points="${p.pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="none" stroke="${cor(p.c)}" stroke-width="${p.w ?? 0.15}"/>`);
    else out.push(`<text x="${f(p.x)}" y="${f(p.y)}" font-family="Arial, Helvetica, sans-serif" font-size="${p.h}" text-anchor="${p.anc ?? 'start'}" fill="${cor(p.c)}"${p.rot ? ` transform="rotate(${p.rot} ${f(p.x)} ${f(p.y)})"` : ''}>${p.s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
  }
  return out.join('');
}

// DXF (R12) do detalhe do bloco: em cm, no tamanho real do bloco (plotar a 1:10)
export function dxfBloco(o: OpBloco & { nomes?: string }): string { return dxfPrims(desenhoBloco(o)); }
function dxfPrims(P: Prim2[]): string {
  const K = 1, Y = (y: number) => -y * K, X = (x: number) => x * K, out: string[] = [];
  const tx = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, '%%c').replace(/[^\x20-\x7e]/g, '');
  const hdr = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CENTER', '70', '0', '3', 'Center', '72', '65', '73', '4', '40', '4.0', '49', '2.5', '49', '-0.8', '49', '0.5', '49', '-0.8', '0', 'ENDTAB', '0', 'ENDSEC'];
  const ln = (c: Cam, x1: number, y1: number, x2: number, y2: number, tr = false) => out.push('0', 'LINE', '8', c, ...(tr ? ['6', 'CENTER'] : []), '62', String(CORES_CAD[c].dxf), '10', X(x1).toFixed(3), '20', Y(y1).toFixed(3), '11', X(x2).toFixed(3), '21', Y(y2).toFixed(3));
  for (const p of P) {
    if (p.k === 'l') ln(p.c, p.x1, p.y1, p.x2, p.y2, p.tr);
    else if (p.k === 'r') { ln(p.c, p.x, p.y, p.x + p.w, p.y); ln(p.c, p.x + p.w, p.y, p.x + p.w, p.y + p.h); ln(p.c, p.x + p.w, p.y + p.h, p.x, p.y + p.h); ln(p.c, p.x, p.y + p.h, p.x, p.y); }
    else if (p.k === 'c') out.push('0', 'CIRCLE', '8', p.c, '62', String(CORES_CAD[p.c].dxf), '10', X(p.x).toFixed(3), '20', Y(p.y).toFixed(3), '40', (p.r * K).toFixed(3));
    else if (p.k === 'p') for (let i = 0; i < p.pts.length - 1; i++) ln(p.c, p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1]);
    else {
      const a = p.anc === 'middle' ? '1' : p.anc === 'end' ? '2' : '0';
      out.push('0', 'TEXT', '8', p.c, '62', String(CORES_CAD[p.c].dxf), '10', X(p.x).toFixed(3), '20', Y(p.y).toFixed(3), '40', (p.h * 0.75 * K).toFixed(3), '1', tx(p.s));
      if (p.rot) out.push('50', String(-p.rot));
      if (a !== '0') out.push('72', a, '11', X(p.x).toFixed(3), '21', Y(p.y).toFixed(3));
    }
  }
  return [...hdr, '0', 'SECTION', '2', 'ENTITIES', ...out, '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
}


// ---------- estaca escavada (furo) armada no topo ----------
export interface OpEstaca { furo: number; comp: number; armDiam: number; armComp: number; noBloco: number; barras: number; bitLong: number; bitEstr: number; espEstr: number; transpEstr: number; barra: number; qtd: number }
export const ESTACA_PADRAO: Omit<OpEstaca, 'qtd'> = { furo: 0.30, comp: 8, armDiam: 0.25, armComp: 4, noBloco: 0.25, barras: 6, bitLong: 10, bitEstr: 5, espEstr: 0.12, transpEstr: 0.10, barra: 12 };

export function quantEstaca(o: OpEstaca) {
  const nEstr = Math.floor(o.armComp / o.espEstr + 1e-9) + 1;
  const cEstr = Math.PI * o.armDiam + o.transpEstr;                    // estribo circular com transpasse
  const mLong = o.barras * o.armComp, mEstr = nEstr * cEstr;
  const kgLong = mLong * pesoBitola(o.bitLong), kgEstr = mEstr * pesoBitola(o.bitEstr);
  const pbL = Math.floor(o.barra / o.armComp + 1e-9), pbE = Math.floor(o.barra / cEstr + 1e-9);
  const conc = Math.PI * (o.furo / 2) ** 2 * o.comp;
  return { nEstr, cEstr, mLong, mEstr, kgLong, kgEstr, barrasLong: pbL ? Math.ceil(o.barras * o.qtd / pbL) : 0, barrasEstr: pbE ? Math.ceil(nEstr * o.qtd / pbE) : 0, pbL, pbE, conc, concTotal: conc * o.qtd };
}

export function desenhoEstaca(o: OpEstaca, bloco: { lado: number; alt: number }): Prim2[] {
  const P: Prim2[] = [];
  const q = quantEstaca(o), d1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
  const bL = o.bitLong.toFixed(1), bE = o.bitEstr.toFixed(1), cE = Math.round(q.cEstr * 100), cL = Math.round(o.armComp * 100), espT = Math.round(o.espEstr * 100);
  const l = (x1: number, y1: number, x2: number, y2: number, c: Cam, w?: number, tr?: boolean) => P.push({ k: 'l', x1, y1, x2, y2, c, w, tr });
  const t = (x: number, y: number, s: string, h = 2.2, c: Cam = 'TEXTO', anc: 'start' | 'middle' | 'end' = 'start', rot = 0) => P.push({ k: 't', x, y, h, s, c, anc, rot });
  const r = (x: number, y: number, w: number, h: number, c: Cam, fill = false) => P.push({ k: 'r', x, y, w, h, c, fill });
  const tk = (x: number, y: number) => l(x - 0.8, y + 0.8, x + 0.8, y - 0.8, 'COTA');
  const cH = (x1: number, x2: number, y: number, s: string, de?: number) => { l(x1 - 1, y, x2 + 1, y, 'COTA'); tk(x1, y); tk(x2, y); if (de !== undefined) { l(x1, de, x1, y + 1, 'COTA'); l(x2, de, x2, y + 1, 'COTA'); } t((x1 + x2) / 2, y - 0.7, s, 2, 'COTA', 'middle'); };
  const cV = (x: number, y1: number, y2: number, s: string, de?: number) => { l(x, y1 - 1, x, y2 + 1, 'COTA'); tk(x, y1); tk(x, y2); if (de !== undefined) { l(de, y1, x + (de < x ? -1 : 1), y1, 'COTA'); l(de, y2, x + (de < x ? -1 : 1), y2, 'COTA'); } t(x - 0.7, (y1 + y2) / 2, s, 2, 'COTA', 'middle', -90); };
  const cham = (x: number, y: number, x2: number, y2: number, s: string, anc: 'start' | 'end' = 'start') => { l(x, y, x2, y2, 'CHAMADA'); l(x2, y2, x2 + (anc === 'end' ? -6 : 6), y2, 'CHAMADA'); t(x2 + (anc === 'end' ? -6.5 : 6.5), y2 + 0.8, s, 2.1, 'TEXTO', anc); };
  const nivel = (x: number, y: number, s: string) => { P.push({ k: 'p', pts: [[x, y], [x - 1.3, y - 2], [x + 1.3, y - 2], [x, y]], c: 'NIVEL' }); l(x - 1.8, y - 2, x + 1.8, y - 2, 'NIVEL'); t(x, y - 2.8, s, 2, 'NIVEL', 'middle'); };
  const circ = (x: number, y: number, rr: number, c: Cam, fill = false) => P.push({ k: 'c', x, y, r: rr, c, fill });

  t(6, 9, `ESTACAS E1 a E${o.qtd}`, 2.8, 'TITULO'); t(6, 12.6, `${o.qtd} estacas iguais · furo ø${Math.round(o.furo * 100)} · ${d1(o.comp)} m · armadura de ${d1(o.armComp)} m (${Math.round((o.noBloco ?? 0) * 100)} cm dentro do bloco)`, 2.2);

  // ===== ELEVAÇÃO (largura 1:10, altura 1:40) =====
  const hx = 100, vy = 25;   // mm de papel por metro: horizontal 1:10, vertical 1:40
  const EX = 46, EY = 34, bw = bloco.lado * hx, bh = bloco.alt * vy, fw = o.furo * hx, aw = o.armDiam * hx;
  t(6, 20, 'ELEVAÇÃO', 2.4); t(6, 23.2, 'sem escala (larguras 1:10, alturas 1:40)', 2);
  const nb = Math.min(o.noBloco ?? 0, bloco.alt), cx = EX + bw / 2, yTop = EY + bh, yFim = yTop + o.comp * vy, yA0 = yTop - nb * vy, yArm = yA0 + o.armComp * vy;
  l(EX - 16, EY, EX + bw + 18, EY, 'NIVEL', 0.15, true); nivel(EX + bw + 10, EY, '0');
  r(EX, EY, bw, bh, 'CONCRETO', true); t(EX + bw / 2, EY + bh / 2 + 0.8, 'BLOCO', 2, 'TEXTO', 'middle');
  r(cx - fw / 2, yTop, fw, o.comp * vy, 'ESTACA', true);
  // ferros longitudinais (2 aparecem na elevação) e estribos
  const x1 = cx - aw / 2, x2 = cx + aw / 2;
  l(x1, yA0, x1, yArm, 'FERRO', 0.45); l(x2, yA0, x2, yArm, 'FERRO', 0.45);
  for (let i = 0; i < q.nEstr; i++) { const y = yA0 + Math.min(o.armComp, i * o.espEstr) * vy; l(x1, y, x2, y, 'FERRO', 0.2); }
  cham(x2, yTop + 0.3 * o.armComp * vy, EX + bw + 8, yTop + 12, `${o.barras} N3 ø${bL} C=${cL}`);
  cham(x2, yTop + 0.6 * o.armComp * vy, EX + bw + 8, yTop + 0.6 * o.armComp * vy + 6, `${q.nEstr} N4 ø${bE} c/${espT} C=${cE}`);
  cV(EX - 14, yTop, yFim, `${Math.round(o.comp * 100)}`, cx - fw / 2 - 1);
  cV(EX - 6, yA0, yArm, `${cL}`, x1 - 1);
  if (nb > 0) { cV(EX + bw + 3, yA0, yTop, `${Math.round(nb * 100)}`, x2 + 1); t(EX + bw + 5, yA0 + 1.5, 'no bloco', 1.8); }
  cV(EX - 6, yArm, yFim, `${Math.round((o.comp - o.armComp + nb) * 100)}`);
  t(cx + fw / 2 + 3, (yArm + yFim) / 2, 'concreto sem armadura', 2, 'TEXTO');
  cH(cx - fw / 2, cx + fw / 2, yFim + 6, `ø${Math.round(o.furo * 100)}`, yFim + 1);
  nivel(EX + bw + 10, yTop, `-${Math.round(bloco.alt * 100)}`); nivel(EX + bw + 10, yFim, `-${Math.round((bloco.alt + o.comp) * 100)}`);
  t(EX + bw + 13, yFim + 4, 'fundo do furo', 2);
  // corte C-C indicado
  const yC = yTop + 0.15 * o.armComp * vy;
  l(cx - fw / 2 - 5, yC, cx + fw / 2 + 5, yC, 'CHAMADA', 0.15, true); t(cx - fw / 2 - 6, yC + 0.8, 'C', 2.2, 'TEXTO', 'end'); t(cx + fw / 2 + 6, yC + 0.8, 'C', 2.2);

  // ===== SEÇÃO C-C (1:5) =====
  const SX = 160, SY = 70, k = 200;   // 1:5 = 200 mm de papel por metro
  t(SX - 32, 26, 'SEÇÃO C-C', 2.4); t(SX - 32, 29.2, 'ESC 1:5', 2);
  circ(SX, SY, o.furo / 2 * k, 'ESTACA', true);
  circ(SX, SY, o.armDiam / 2 * k, 'FERRO');
  for (let i = 0; i < o.barras; i++) { const a = Math.PI / 4 + i * 2 * Math.PI / o.barras, rr = o.armDiam / 2 * k - 1.2; circ(SX + rr * Math.cos(a), SY + rr * Math.sin(a), 1.0, 'FERRO-CORTE', true); }
  cH(SX - o.furo / 2 * k, SX + o.furo / 2 * k, SY + o.furo / 2 * k + 8, `ø${Math.round(o.furo * 100)} (furo)`, SY);
  cH(SX - o.armDiam / 2 * k, SX + o.armDiam / 2 * k, SY + o.furo / 2 * k + 4, `ø${Math.round(o.armDiam * 100)}`, SY);
  const ra = Math.PI / 4, rr = o.armDiam / 2 * k - 1.2;
  cham(SX + rr * Math.cos(ra), SY - rr * Math.sin(ra), SX + 24, SY - 26, `${o.barras} N3 ø${bL}`);
  cham(SX - o.armDiam / 2 * k, SY, SX - 36, SY - 20, `N4 ø${bE} c/${espT}`, 'end');
  t(SX, SY + o.furo / 2 * k + 15, `cobrimento ${d1((o.furo - o.armDiam) / 2 * 100)} cm`, 2, 'TEXTO', 'middle');

  // ===== ARMADURAS =====
  const AX = 210;
  t(AX, 26, 'ARMADURAS', 2.4); t(AX, 29.2, 'sem escala', 2);
  // N3 reta
  l(AX + 6, 40, AX + 6, 120, 'FERRO', 0.5); t(AX + 4, 80, `${cL}`, 2, 'TEXTO', 'middle', -90);
  t(AX + 9, 82, `${o.barras} N3 ø${bL} C=${cL}`, 2.1, 'TEXTO', 'start', -90);
  // N4 circular
  const ER = o.armDiam / 2 * 120;
  circ(AX + 40, 60, ER, 'FERRO'); l(AX + 40 + ER, 60, AX + 40 + ER, 60 - 4, 'FERRO', 0.45);
  t(AX + 40, 60 + 0.8, `ø${Math.round(o.armDiam * 100)}`, 2.1, 'TEXTO', 'middle');
  t(AX + 40, 60 + ER + 5, `${q.nEstr} N4 ø${bE} c/${espT} C=${cE}`, 2.1, 'TEXTO', 'middle');
  t(AX + 40, 60 + ER + 8.5, `(transpasse ${Math.round(o.transpEstr * 100)} cm)`, 1.9, 'TEXTO', 'middle');

  // ===== TABELAS =====
  const tab = (X: number, Y: number, tit: string, cab: string[], ws: number[], lin: string[][]) => {
    const h = 3.6, W = ws.reduce((a, b) => a + b, 0), N = lin.length + 2;
    r(X, Y, W, h * N, 'TABELA');
    t(X + W / 2, Y + 2.7, tit, 2, 'TABELA', 'middle'); l(X, Y + h, X + W, Y + h, 'TABELA');
    let x = X; cab.forEach((c, i) => { t(x + ws[i] / 2, Y + h + 2.7, c, 1.8, 'TABELA', 'middle'); x += ws[i]; if (i < cab.length - 1) l(x, Y + h, x, Y + h * N, 'TABELA'); });
    lin.forEach((ln2, j) => { const yy = Y + (j + 2) * h; l(X, yy, X + W, yy, 'TABELA'); let xx = X; ln2.forEach((c, i) => { t(xx + ws[i] / 2, yy + 2.7, c, 1.8, 'TABELA', 'middle'); xx += ws[i]; }); });
    return Y + h * N;
  };
  const TX = 282; let y = 14;
  y = tab(TX, y, 'ARMADURA - POR ESTACA', ['N', 'ø (mm)', 'QUANT', 'C.UNIT (cm)', 'C.TOTAL (cm)'], [10, 16, 16, 24, 26],
    [['3', bL, String(o.barras), String(cL), String(o.barras * cL)], ['4', bE, String(q.nEstr), String(cE), String(q.nEstr * cE)]]) + 5;
  y = tab(TX, y, `ARMADURA - ${o.qtd} ESTACAS`, ['N', 'ø (mm)', 'QUANT', 'C.UNIT (cm)', 'C.TOTAL (m)'], [10, 16, 16, 24, 26],
    [['3', bL, String(o.barras * o.qtd), String(cL), d1(q.mLong * o.qtd)], ['4', bE, String(q.nEstr * o.qtd), String(cE), d1(q.mEstr * o.qtd)]]) + 5;
  y = tab(TX, y, 'RESUMO DO AÇO', ['AÇO', 'ø (mm)', 'C.TOTAL (m)', 'PESO+10% (kg)', `BARRAS ${d1(o.barra)}m`], [12, 14, 20, 24, 22],
    [['CA50', bL, d1(q.mLong * o.qtd), d1(q.kgLong * o.qtd * 1.1), String(q.barrasLong)], ['CA60', bE, d1(q.mEstr * o.qtd), d1(q.kgEstr * o.qtd * 1.1), String(q.barrasEstr)]]) + 5;
  y = tab(TX, y, 'CONSUMO', ['ITEM', 'POR ESTACA', `TOTAL (${o.qtd})`], [36, 28, 28],
    [['Concreto (m³)', q.conc.toFixed(3).replace('.', ','), q.concTotal.toFixed(2).replace('.', ',')], ['Escavação (m)', d1(o.comp), d1(o.comp * o.qtd)], ['Aço (kg)', ((q.kgLong + q.kgEstr)).toFixed(2).replace('.', ','), d1((q.kgLong + q.kgEstr) * o.qtd)]]) + 7;
  t(TX, y, 'NOTAS', 2.2, 'TITULO');
  [`Furo ø${Math.round(o.furo * 100)} com ${d1(o.comp)} m a partir do fundo do bloco.`,
   `Armadura de ${d1(o.armComp)} m: ${Math.round((o.noBloco ?? 0) * 100)} cm dentro do bloco e ${d1(o.armComp - (o.noBloco ?? 0))} m no furo;`,
   `${o.barras} N3 ø${bL} e estribos`,
   `circulares N4 ø${bE} c/${espT} com ø${Math.round(o.armDiam * 100)} (transpasse ${Math.round(o.transpEstr * 100)} cm).`,
   `Restante do furo em concreto sem armadura.`,
   `Plano de corte: ${q.pbL} N3 por barra; ${q.pbE} N4 por barra de ${d1(o.barra)} m.`,
   `Ancoragem no bloco e concreto conforme o projeto estrutural.`,
   `Medidas em cm, salvo indicação.`].forEach((s2, i) => t(TX, y + 4 + i * 3.3, s2, 1.9));
  return P;
}
export const estacaTecnico = (o: OpEstaca, bloco: { lado: number; alt: number }, tema: 'tela' | 'papel' = 'papel') => svgPrims(desenhoEstaca(o, bloco), tema);
export const dxfEstaca = (o: OpEstaca, bloco: { lado: number; alt: number }) => dxfPrims(desenhoEstaca(o, bloco));


// ---------- folha da fundação: estaca + bloco juntos (padrão do detalhamento em AutoCAD) ----------
export function desenhoFundacao(ob: OpBloco, oe: OpEstaca, nomes?: { bloco?: string; estaca?: string }): Prim2[] {
  const P: Prim2[] = [];
  const d1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ','), i0 = (v: number) => String(Math.round(v));
  const l = (x1: number, y1: number, x2: number, y2: number, c: Cam, w?: number, tr?: boolean) => P.push({ k: 'l', x1, y1, x2, y2, c, w, tr });
  const t = (x: number, y: number, s: string, h = 2, c: Cam = 'TEXTO', anc: 'start' | 'middle' | 'end' = 'start', rot = 0) => P.push({ k: 't', x, y, h, s, c, anc, rot });
  const r = (x: number, y: number, w: number, h: number, c: Cam, fill = false) => P.push({ k: 'r', x, y, w, h, c, fill });
  const circ = (x: number, y: number, rr: number, c: Cam, fill = false) => P.push({ k: 'c', x, y, r: rr, c, fill });
  // cotas no estilo do AutoCAD: tracinhos a 45° e linhas de chamada
  const tk = (x: number, y: number) => l(x - 0.7, y + 0.7, x + 0.7, y - 0.7, 'COTA', 0.2);
  const cH = (x1: number, x2: number, y: number, s: string, de?: number) => { l(x1 - 1, y, x2 + 1, y, 'COTA', 0.12); tk(x1, y); tk(x2, y); if (de !== undefined) { l(x1, de, x1, y + (de < y ? 1 : -1), 'COTA', 0.1); l(x2, de, x2, y + (de < y ? 1 : -1), 'COTA', 0.1); } t((x1 + x2) / 2, y - 0.8, s, 1.8, 'COTA', 'middle'); };
  const cV = (x: number, y1: number, y2: number, s: string, de?: number) => { l(x, y1 - 1, x, y2 + 1, 'COTA', 0.12); tk(x, y1); tk(x, y2); if (de !== undefined) { const dd = de > x ? 1 : -1; l(de, y1, x - dd, y1, 'COTA', 0.1); l(de, y2, x - dd, y2, 'COTA', 0.1); } t(x - 0.8, (y1 + y2) / 2, s, 1.8, 'COTA', 'middle', -90); };
  const nivel = (x: number, y: number, s: string) => { l(x, y, x + 9, y, 'NIVEL', 0.12); l(x + 4, y, x + 4, y - 3, 'NIVEL', 0.12); l(x + 4, y - 3, x + 9, y - 3, 'NIVEL', 0.12); t(x + 5, y - 3.6, s, 1.8, 'NIVEL'); };
  const titulo = (x: number, y: number, a: string, b: string) => { t(x, y, a, 1.9); t(x, y + 2.8, b, 1.9); };
  const qb = quantBloco(ob), qe = quantEstaca(oe);

  // ===================== ESTACA =====================
  const e50 = 2, e20 = 5, e10 = 10;            // mm de papel por metro... (1:50 = 20 mm/m) -> uso mm por cm abaixo
  void e50; void e20; void e10;
  const S50 = 0.2, S20 = 0.5, S10 = 1;          // mm de papel por cm: 1:50, 1:20, 1:10
  const cmb = (m: number) => m * 100;
  const bl = cmb(ob.lado), bh = cmb(ob.alt), fu = cmb(oe.furo), fd = cmb(oe.armDiam), comp = cmb(oe.comp), arm = cmb(oe.armComp), nb = Math.min(cmb(oe.noBloco ?? 0), bh);
  // CORTE da estaca a 1:50
  const EX = 34, EY = 30;
  t(8, 14, nomes?.estaca ?? `E1 a E${oe.qtd}`, 2.6, 'TITULO'); t(8, 17.4, `estaca ø${i0(fu)} · ${oe.qtd} iguais`, 1.9);
  titulo(EX - 10, EY - 8, 'CORTE', 'ESC 1:50');
  const cx = EX + bl * S50 / 2, yB0 = EY, yB1 = EY + bh * S50, yF = yB1 + comp * S50;
  // bloco em cima e estaca
  r(EX, yB0, bl * S50, bh * S50, 'CONCRETO', true);
  r(cx - fu * S50 / 2, yB1, fu * S50, comp * S50, 'ESTACA', true);
  // armadura da estaca: entra no bloco e desce
  const yA0 = yB1 - nb * S50, yA1 = yA0 + arm * S50;
  l(cx - fd * S50 / 2, yA0, cx - fd * S50 / 2, yA1, 'FERRO', 0.3); l(cx + fd * S50 / 2, yA0, cx + fd * S50 / 2, yA1, 'FERRO', 0.3);
  // níveis e cotas
  nivel(EX + bl * S50 + 3, yB0, '0'); nivel(EX + bl * S50 + 3, yB1, `-${i0(bh)}`); nivel(cx + fu * S50 / 2 + 3, yF, `-${i0(bh + comp)}`);
  t(cx + fu * S50 / 2 + 3, yB1 + 6, `CA : -${i0(bh)}`, 1.8);
  cV(EX - 10, yB1, yF, i0(comp), cx - fu * S50 / 2 - 0.5);
  cV(EX - 5, yA0, yA1, i0(arm), cx - fd * S50 / 2 - 0.5);
  cV(EX - 5, yA1, yF, i0(comp - arm + nb));
  cV(EX + bl * S50 + 2, yA0, yB1, i0(nb), cx + fd * S50 / 2 + 0.5);
  cH(cx - fu * S50 / 2, cx + fu * S50 / 2, yF + 5, i0(fu), yF + 0.5);
  // barra longitudinal ao lado (em pé), com a chamada girada
  const BX = EX + 26;
  l(BX, yA0, BX, yA1, 'FERRO', 0.4);
  cV(BX - 3, yA0, yA1, i0(arm));
  t(BX + 2.6, (yA0 + yA1) / 2, `${oe.barras} N3 ø${oe.bitLong.toFixed(1)} C=${i0(arm)}`, 1.9, 'TEXTO', 'middle', -90);
  // faixa dos estribos
  const DX = BX + 14, espT = i0(oe.espEstr * 100);
  cV(DX, yA0, yA1, i0(arm), DX - 3);
  t(DX + 2.6, (yA0 + yA1) / 2, `${qe.nEstr} N4 c/${espT}`, 1.9, 'TEXTO', 'middle', -90);
  // SEÇÃO a 1:10
  const SX = DX + 30, SY = EY + 12;
  titulo(SX - 10, EY - 8, 'SEÇÃO', 'ESC 1:10');
  circ(SX, SY, fu * S10 / 2, 'ESTACA', true);
  circ(SX, SY, fd * S10 / 2, 'FERRO');
  for (let i = 0; i < oe.barras; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / oe.barras, rr = fd * S10 / 2 - 1; circ(SX + rr * Math.cos(a), SY + rr * Math.sin(a), 0.7, 'FERRO-CORTE', true); }
  cV(SX - fu * S10 / 2 - 4, SY - fu * S10 / 2, SY + fu * S10 / 2, i0(fu), SX - 1);
  // estribo circular
  const RX = SX + 30, RY = SY;
  circ(RX, RY, fd * S10 / 2, 'FERRO'); l(RX, RY - fd * S10 / 2, RX + 3, RY - fd * S10 / 2 - 2, 'FERRO', 0.35);
  cV(RX - fd * S10 / 2 - 4, RY - fd * S10 / 2, RY + fd * S10 / 2, i0(fd), RX - 1);
  t(RX, RY + fd * S10 / 2 + 5, `${qe.nEstr} N4 ø${oe.bitEstr.toFixed(1)} C=${i0(qe.cEstr * 100)}`, 1.9, 'TEXTO', 'middle');

  // ===================== BLOCO =====================
  // gaiola 4x4: N1 = estribos em pé na direção X, N2 = estribos em pé na direção Y (cruzados)
  const S25 = 0.5;   // 1:20 = 0,5 mm por cm
  const A = cmb(ob.armLado), AH = cmb(ob.armAlt), cb = (bl - A) / 2, cbf = (bh - AH) / 2, n = ob.barras;
  const espV = n > 1 ? A / (n - 1) : 0;
  const nBit = ob.bitola.toFixed(1), Cb = i0(qb.comp * 100), espBv = i0(espV);
  const pil = 15;   // coluna no canto das paredes (cm)
  const PX = 192, PY = 34;
  t(PX - 6, 14, nomes?.bloco ?? `B1 a B${ob.qtd}`, 2.6, 'TITULO'); t(PX - 6, 17.4, `1ø${i0(fu)} · ${ob.qtd} iguais`, 1.9);
  titulo(PX - 6, PY - 10, 'PLANTA', 'ESC 1:20');
  const W = bl * S25;
  r(PX, PY, W, W, 'CONCRETO', true);
  // vistos de cima: N1 = linhas na direção X, N2 = linhas na direção Y (grade 4x4)
  for (let i = 0; i < n; i++) { const p = (cb + i * espV) * S25; l(PX + cb * S25, PY + p, PX + (cb + A) * S25, PY + p, 'FERRO', 0.3); l(PX + p, PY + cb * S25, PX + p, PY + (cb + A) * S25, 'FERRO', 0.3); }
  circ(PX + W / 2, PY + W / 2, fu * S25 / 2, 'ESTACA');
  P.push({ k: 'r', x: PX + W / 2 - pil * S25 / 2, y: PY + W / 2 - pil * S25 / 2, w: pil * S25, h: pil * S25, c: 'CHAMADA', fill: true });
  l(PX + (cb + A * 0.6) * S25, PY + cb * S25, PX - 5, PY - 3, 'CHAMADA', 0.12); t(PX - 5.5, PY - 2.4, `${n} N1 c/${espBv}`, 1.8, 'CHAMADA', 'end');
  l(PX + (cb + A) * S25, PY + (cb + A * 0.8) * S25, PX + W + 6, PY + W + 2, 'CHAMADA', 0.12); t(PX + W + 6.5, PY + W + 2.6, `${n} N2 c/${espBv}`, 1.8, 'CHAMADA');
  cH(PX, PX + W, PY + W + 4, i0(bl), PY + W + 0.5);
  cV(PX + W + 4, PY, PY + W, i0(bl), PX + W + 0.5);
  // N1 desenhado embaixo da planta
  const est = (x: number, y: number, w: number, h: number, nn: string, qt: number) => {
    r(x, y, w * S25, h * S25, 'FERRO'); l(x, y, x + 2, y + 2, 'FERRO', 0.3);
    t(x + w * S25 / 2, y + h * S25 + 2.6, i0(w), 1.8, 'TEXTO', 'middle'); t(x + w * S25 + 1.2, y + h * S25 / 2 + 0.7, i0(h), 1.8);
    t(x + w * S25 / 2, y + h * S25 + 6, `${qt} ${nn} ø${nBit} C=${Cb}`, 1.9, 'TEXTO', 'middle');
  };
  est(PX + cb * S25, PY + W + 14, A, AH, 'N1', n);
  // CORTE do bloco a 1:20
  const KX = PX + 50, KY = PY;
  titulo(KX - 6, KY - 10, 'CORTE', 'ESC 1:20');
  const H2 = bh * S25;
  // pilar saindo em cima
  r(KX + W / 2 - pil * S25 / 2, KY - 6, pil * S25, 6, 'CONCRETO');
  l(KX - 4, KY, KX + W + 16, KY, 'NIVEL', 0.12); nivel(KX + W + 6, KY, '0');
  r(KX, KY, W, H2, 'CONCRETO', true);
  const ew = fu * S25, ex = KX + W / 2 - ew / 2;
  r(ex, KY + H2, ew, 14, 'ESTACA', true);
  // N1 no plano do corte = quadrado; N2 (do outro sentido) vistos de lado = linhas em pé
  const x0 = KX + cb * S25, y0 = KY + cbf * S25;
  r(x0, y0, A * S25, AH * S25, 'FERRO'); l(x0, y0, x0 + 2, y0 + 2, 'FERRO', 0.3);
  for (let i = 1; i < n - 1; i++) l(x0 + i * espV * S25, y0, x0 + i * espV * S25, y0 + AH * S25, 'FERRO', 0.3);
  // ferros da estaca entrando no bloco
  for (const sx of [-1, 1]) l(KX + W / 2 + sx * fd * S25 / 2, KY + (bh - nb) * S25, KX + W / 2 + sx * fd * S25 / 2, KY + H2 + 14, 'FERRO', 0.3);
  l(x0 + A * S25, y0 + AH * S25 * 0.4, KX + W + 3, KY + H2 * 0.4, 'CHAMADA', 0.12); t(KX + W + 3.5, KY + H2 * 0.4 + 0.6, `${n} N1 c/${espBv}`, 1.8);
  l(x0 + espV * S25, y0 + AH * S25 * 0.7, KX - 6, KY + H2 + 6, 'CHAMADA', 0.12); t(KX - 6.5, KY + H2 + 6.6, `${n} N2 c/${espBv}`, 1.8, 'CHAMADA', 'end');
  cV(KX - 4, KY, KY + H2, i0(bh), KX - 0.5);
  cV(KX - 8, y0, y0 + AH * S25, i0(AH), x0 - 0.5);
  if (nb > 0) cV(KX + W / 2 + 6, KY + (bh - nb) * S25, KY + H2, i0(nb));
  nivel(KX + W + 6, KY + H2, `-${i0(bh)}`);
  t(KX + W + 6, KY + H2 + 5, `CA : -${i0(bh)}`, 1.8);
  // N2 desenhado ao lado do corte
  est(KX + W + 6, KY + H2 + 14, A, AH, 'N2', n);

  // ===================== TABELAS =====================
  const tab = (X: number, Y: number, tit: string | null, cab: string[], ws: number[], lin: string[][]) => {
    const h = 3.2, W = ws.reduce((a, b) => a + b, 0), N = lin.length + 1 + (tit ? 1 : 0);
    r(X, Y, W, h * N, 'TABELA');
    let yy = Y;
    if (tit) { t(X + W / 2, Y + 2.4, tit, 1.7, 'TABELA', 'middle'); l(X, Y + h, X + W, Y + h, 'TABELA'); yy += h; }
    let x = X; cab.forEach((c, i) => { t(x + ws[i] / 2, yy + 2.4, c, 1.6, 'TABELA', 'middle'); x += ws[i]; if (i < cab.length - 1) l(x, yy, x, Y + h * N, 'TABELA'); });
    lin.forEach((ln2, j) => { const y2 = yy + (j + 1) * h; l(X, y2, X + W, y2, 'TABELA'); let xx = X; ln2.forEach((c, i) => { t(xx + ws[i] / 2, y2 + 2.4, c, 1.6, 'TABELA', 'middle'); xx += ws[i]; }); });
    return Y + h * N;
  };
  const TX = 312; let y = 14;
  const qB = ob.qtd, qE = oe.qtd;
  const linhas = [
    ['CA50', '1', nBit, String(n * qB), Cb, i0(n * qB * qb.comp * 100)],
    ['', '2', nBit, String(n * qB), Cb, i0(n * qB * qb.comp * 100)],
    ['', '3', oe.bitLong.toFixed(1), String(oe.barras * qE), i0(arm), i0(oe.barras * qE * arm)],
    ['CA60', '4', oe.bitEstr.toFixed(1), String(qe.nEstr * qE), i0(qe.cEstr * 100), i0(qe.nEstr * qE * qe.cEstr * 100)],
  ];
  y = tab(TX, y, null, ['AÇO', 'N', 'DIAM (mm)', 'QUANT', 'C.UNIT (cm)', 'C.TOTAL (cm)'], [11, 7, 13, 13, 17, 19], linhas) + 4;
  // resumo por bitola
  const porBit = new Map<string, { aco: string; m: number; kg: number }>();
  const soma = (aco: string, bit: number, m: number) => { const k = bit.toFixed(1), v = porBit.get(k) || { aco, m: 0, kg: 0 }; v.m += m; v.kg += m * pesoBitola(bit); porBit.set(k, v); };
  soma('CA50', ob.bitola, qb.metros); soma('CA50', oe.bitLong, qe.mLong * qE); soma('CA60', oe.bitEstr, qe.mEstr * qE);
  const res = [...porBit.entries()].sort((a, b) => +a[0] - +b[0]);
  t(TX + 40, y + 2, 'RESUMO DO AÇO', 1.8, 'TABELA', 'middle'); y += 4;
  y = tab(TX, y, null, ['AÇO', 'DIAM (mm)', 'C.TOTAL (m)', 'PESO + 10% (kg)'], [14, 18, 22, 26], res.map(([k, v]) => [v.aco, k, d1(v.m), d1(v.kg * 1.1)])) + 2;
  const pesoTotal = res.reduce((a, [, v]) => a + v.kg * 1.1, 0);
  y = tab(TX, y, null, ['PESO TOTAL (kg)', ''], [32, 48], [['CA50 + CA60', d1(pesoTotal)]]) + 5;
  const conc = qb.concTotal + qe.concTotal;
  t(TX, y, `Volume de concreto = ${conc.toFixed(2).replace('.', ',')} m³ (blocos ${qb.concTotal.toFixed(2).replace('.', ',')} + estacas ${qe.concTotal.toFixed(2).replace('.', ',')})`, 1.7, 'TABELA'); y += 3.4;
  t(TX, y, `Área de forma = ${qb.forma.toFixed(2).replace('.', ',')} m² (laterais dos blocos)`, 1.7, 'TABELA'); y += 3.4;
  t(TX, y, `Barras de ${d1(ob.barra)} m: ø${nBit} ${qb.barras12} · ø${oe.bitLong.toFixed(1)} ${qe.barrasLong} · ø${oe.bitEstr.toFixed(1)} ${qe.barrasEstr}`, 1.7, 'TABELA'); y += 6;
  t(TX, y, 'NOTAS', 1.9, 'TITULO'); y += 3.6;
  [`Cobrimento do bloco ${d1(qb.cob * 100)} cm; estribos com gancho de ${d1((ob.gancho ?? 0) * 100)} cm.`,
   `Furo da estaca ø${i0(fu)} com ${d1(oe.comp)} m a partir do fundo do bloco.`,
   `Armadura da estaca entra ${i0(nb)} cm no bloco.`,
   `Estribo da estaca circular ø${i0(fd)}, transpasse ${i0(oe.transpEstr * 100)} cm.`,
   `Medidas em cm. Locação: planta de locação.`].forEach(s2 => { t(TX, y, s2, 1.7, 'TABELA'); y += 3.2; });
  return P;
}
export const fundacaoTecnico = (ob: OpBloco, oe: OpEstaca) => svgPrims(desenhoFundacao(ob, oe), 'branco');
export const dxfFundacaoDetalhe = (ob: OpBloco, oe: OpEstaca) => dxfPrims(desenhoFundacao(ob, oe));
