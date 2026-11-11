// Planta de locação dos pontos de fundação (blocos) para levar ao Eberick:
// um ponto em cada canto de parede (L), encontro (T, cruz), ponta solta, coluna no meio da parede
// e, se pedido, pontos intermediários para não passar do espaçamento máximo.
// Sai em DXF (metros), nas mesmas coordenadas do projeto de arquitetura.
import type { Trecho, Painel, Pavimento } from './model.ts';
import type { Prim } from './dxf.ts';

export type TipoPonto = 'L' | 'T' | 'X' | 'ponta' | 'emenda' | 'coluna' | 'intermediário';
export interface PontoFund { n: number; x: number; y: number; tipo: TipoPonto; esp: number }

const TOL = 0.15;

export function pontosFundacao(ts: Trecho[], ps: Painel[], espacMax = 0): PontoFund[] {
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
  // numeração: de cima para baixo, da esquerda para a direita
  qs.sort((p, q) => Math.abs(p.y - q.y) > TOL ? q.y - p.y : p.x - q.x);
  return qs.map((q, i) => ({ n: i + 1, x: q.x, y: q.y, tipo: q.tipo!, esp: q.esp }));
}

const DESC: Record<TipoPonto, string> = { L: 'canto (L)', T: 'encontro (T)', X: 'cruzamento', ponta: 'ponta de parede', emenda: 'emenda de parede', coluna: 'coluna no meio da parede', 'intermediário': 'intermediário (espaçamento)' };

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

export function locacao(pts: PontoFund[]): Locacao {
  const d: DesenhoLoc = { linhas: [], circs: [], textos: [] };
  const agr = (vs: number[]) => { const s = [...vs].sort((a, b) => a - b), o: number[] = []; for (const v of s) if (!o.length || v - o[o.length - 1] > 0.05) o.push(v); return o; };
  const xs = agr(pts.map(p => p.x)), ys = agr(pts.map(p => p.y));
  if (!xs.length) return { ox: 0, oy: 0, ex: [], ey: [], pts: [], d };
  const ox = xs[0], oy = ys[0], X1 = xs[xs.length - 1], Y1 = ys[ys.length - 1];
  const ex = xs.map((v, i) => ({ nome: String(i + 1), v })), ey = ys.map((v, i) => ({ nome: letra(i), v }));
  const R = 0.3, M = 1.2;   // raio da bolinha do eixo e distância das linhas além da obra
  const L = (x1: number, y1: number, x2: number, y2: number, l: string, cor: number, tr = false) => d.linhas.push({ x1, y1, x2, y2, l, cor, tr });
  const T = (x: number, y: number, h: number, t: string, l: string, cor: number, rot = 0, centro = true) => d.textos.push({ x, y, h, t, l, cor, rot, centro });
  // eixos com bolinha nas duas pontas; eixos muito juntos: a bolinha sobe um nível (não fica uma em cima da outra)
  const niveis = (vs: number[]) => { const lv: number[] = []; vs.forEach((v, i) => { let n = 0; while (vs.slice(0, i).some((u, j) => lv[j] === n && v - u < 2 * R + 0.06)) n++; lv.push(n); }); return lv; };
  const nx = niveis(xs), ny = niveis(ys), PASSO = 2 * R + 0.25;
  const topo = Y1 + M + R + Math.max(0, ...nx) * PASSO, esq = ox - M - R - Math.max(0, ...ny) * PASSO;
  ex.forEach((e, i) => {
    const yb = oy - M - R - nx[i] * PASSO, yt = Y1 + M + R + nx[i] * PASSO;
    L(e.v, yb + R, e.v, yt - R, 'EIXO-LOCACAO', 1, true);
    for (const y of [yb, yt]) { d.circs.push({ x: e.v, y, r: R, l: 'EIXO-LOCACAO', cor: 1 }); T(e.v, y - 0.09, 0.22, e.nome, 'EIXO-NOME', 1); }
    // distância acumulada desde a origem, em pé ao lado da linha do eixo
    T(e.v - 0.05, topo + R + 0.2, .13, brl(e.v - ox), 'COTA-ACUMULADA', 5, 90, false);
  });
  ey.forEach((e, i) => {
    const xl = ox - M - R - ny[i] * PASSO, xr = X1 + M + R + ny[i] * PASSO;
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
  cotaH(ox, X1, yP + 0.55, brl(X1 - ox), 0); cotaV(xP - 0.55, oy, Y1, brl(Y1 - oy), 0);
  T(ox, yP + 1.0, .13, 'numeros em pe junto dos eixos = distancia acumulada desde a origem', 'COTA', 5, 0, false);
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

export function dxfLocacao(pav: Pavimento, loc: Locacao, arq: Prim[] = []): string {
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
  const xMax = Math.max(...loc.ex.map(e => e.v)), yMax = Math.max(...loc.ey.map(e => e.v));
  text('TEXTO', loc.ox - 2.5, yMax + 7, .35, `PLANTA DE LOCACAO - ${pav.nome.toUpperCase()}`, 7);
  text('TEXTO', loc.ox - 2.5, yMax + 6.5, .14, `${loc.pts.length} pontos - coordenadas em metros a partir da ORIGEM (eixo 1 / eixo A)`, 7);
  let ty = yMax + 1.5, txx = xMax + 3.5;
  text('TABELA', txx, ty, .16, 'PONTO   EIXO     X (m)     Y (m)', 7);
  for (const p of loc.pts) {
    ty -= 0.28;
    if (ty < loc.oy - 2) { ty = yMax + 1.5 - 0.28; txx += 4.5; }
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
