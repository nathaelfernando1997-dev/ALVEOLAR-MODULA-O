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
export const BLOCO_PADRAO: Omit<OpBloco, 'qtd'> = { lado: 0.5, alt: 0.5, armLado: 0.45, armAlt: 0.45, barras: 4, bitola: 8.0, barra: 12, gancho: 0.08, estaca: 0 };
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

// ---------- folha técnica do bloco (padrão de projeto estrutural) ----------
// desenho em mm de papel, folha A3 (área útil 400 x 255), escala 1:10 (1 cm do bloco = 1 mm no papel)
export function blocoTecnico(o: OpBloco & { nomes?: string }): string {
  const E = 1;   // mm de papel por cm de bloco (1:10)
  const cm = (m: number) => m * 100 * E;
  const L = cm(o.lado), H = cm(o.alt), A = cm(o.armLado), AH = cm(o.armAlt), cb = (L - A) / 2, cbf = (H - AH) / 2;
  const n = o.barras, esp = n > 1 ? A / (n - 1) : 0, fi = o.bitola, G = cm(o.gancho ?? 0);
  const q = quantBloco(o), C = Math.round(q.comp * 100), d1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
  const bit = fi.toFixed(1).replace('.', ','), espT = Math.round((n > 1 ? o.armLado / (n - 1) : 0) * 100);
  const s: string[] = [];
  const PRETO = '#111', FERRO = '#c92a2a', COTA = '#1c4fa0', CONC = '#ece6d8';
  const ln = (x1: number, y1: number, x2: number, y2: number, cor = PRETO, w = 0.25, dash = '') => s.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${cor}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`);
  const tx = (x: number, y: number, t: string, h = 2.5, anc = 'start', rot = 0, cor = PRETO, peso = 'normal') => s.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial, Helvetica, sans-serif" font-size="${h}" text-anchor="${anc}" fill="${cor}" font-weight="${peso}"${rot ? ` transform="rotate(${rot} ${x.toFixed(2)} ${y.toFixed(2)})"` : ''}>${t}</text>`);
  const rect = (x: number, y: number, w: number, h: number, fill = 'none', cor = PRETO, sw = 0.35, dash = '') => s.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}" stroke="${cor}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  // cota com tracinho a 45°
  const tick = (x: number, y: number) => ln(x - 0.9, y + 0.9, x + 0.9, y - 0.9, COTA, 0.3);
  const cotaH = (x1: number, x2: number, y: number, t: string, ext0?: number) => {
    ln(x1 - 1, y, x2 + 1, y, COTA, 0.18); tick(x1, y); tick(x2, y);
    if (ext0 !== undefined) { ln(x1, ext0, x1, y + 1, COTA, 0.12); ln(x2, ext0, x2, y + 1, COTA, 0.12); }
    tx((x1 + x2) / 2, y - 0.8, t, 2.2, 'middle', 0, COTA);
  };
  const cotaV = (x: number, y1: number, y2: number, t: string, ext0?: number) => {
    ln(x, y1 - 1, x, y2 + 1, COTA, 0.18); tick(x, y1); tick(x, y2);
    if (ext0 !== undefined) { ln(ext0, y1, x - 1, y1, COTA, 0.12); ln(ext0, y2, x - 1, y2, COTA, 0.12); }
    tx(x - 0.8, (y1 + y2) / 2, t, 2.2, 'middle', -90, COTA);
  };
  const titulo = (x: number, y: number, t: string, esc = 'ESC 1:10') => { tx(x, y, t, 3.2, 'start', 0, PRETO, 'bold'); ln(x, y + 0.9, x + t.length * 2.1, y + 0.9, PRETO, 0.3); tx(x, y + 4.2, esc, 2.2); };
  const chamada = (x: number, y: number, x2: number, y2: number, t: string, anc = 'start') => { ln(x, y, x2, y2, PRETO, 0.15); s.push(`<circle cx="${x}" cy="${y}" r="0.45" fill="${PRETO}"/>`); tx(x2 + (anc === 'start' ? 0.8 : -0.8), y2 + 0.8, t, 2.2, anc); };
  const nivel = (x: number, y: number, t: string) => { s.push(`<polygon points="${x},${y} ${x - 1.4},${y - 2.2} ${x + 1.4},${y - 2.2}" fill="none" stroke="${PRETO}" stroke-width="0.2"/>`); ln(x - 4, y, x + 4, y, PRETO, 0.15); tx(x + 2, y - 2.6, t, 2.1); };
  const nome = o.nomes || `B1 a B${o.qtd}`;

  // ===== PLANTA =====
  const PX = 22, PY = 36;
  tx(8, 14, `${nome}`, 3.4, 'start', 0, '#2b8a3e', 'bold');
  tx(8, 18.5, `${o.qtd} blocos iguais · ${d1(o.lado * 100)} x ${d1(o.lado * 100)} x ${d1(o.alt * 100)} cm`, 2.4);
  titulo(PX, PY - 8, 'PLANTA');
  rect(PX, PY, L, L, CONC, PRETO, 0.45);
  if (o.estaca) { const r = cm(o.estaca) / 2; s.push(`<circle cx="${PX + L / 2}" cy="${PY + L / 2}" r="${r}" fill="none" stroke="${PRETO}" stroke-width="0.25" stroke-dasharray="1.5 0.8"/>`); }
  for (let i = 0; i < n; i++) {
    const p = cb + i * esp;
    ln(PX + cb, PY + p, PX + cb + A, PY + p, FERRO, 0.6);                    // N1 (direção x)
    ln(PX + p, PY + cb, PX + p, PY + cb + A, FERRO, 0.6, '1.6 0.7');         // N2 (direção y), embaixo
  }
  chamada(PX + cb + A * 0.8, PY + cb, PX + L + 6, PY - 3, `${n} N1 ø${bit} c/${espT}`);
  chamada(PX + cb + A, PY + cb + A * 0.75, PX + L + 6, PY + L + 3, `${n} N2 ø${bit} c/${espT}`);
  cotaH(PX, PX + L, PY + L + 8, d1(o.lado * 100), PY + L + 1);
  cotaH(PX + cb, PX + cb + A, PY + L + 4.5, d1(o.armLado * 100));
  cotaV(PX - 8, PY, PY + L, d1(o.lado * 100), PX - 1);
  for (let i = 0; i < n - 1; i++) cotaV(PX - 4, PY + cb + i * esp, PY + cb + (i + 1) * esp, String(espT));
  // linhas de corte
  const corte = (x1: number, y1: number, x2: number, y2: number, l: string, horiz: boolean) => {
    ln(x1, y1, x2, y2, PRETO, 0.2, '4 1 1 1');
    for (const [x, y] of [[x1, y1], [x2, y2]]) { ln(x, y, horiz ? x : x, horiz ? y - 0 : y, PRETO, 0.5); tx(horiz ? x : x, horiz ? y - 1.5 : y, l, 2.6, 'middle', 0, PRETO, 'bold'); }
  };
  corte(PX - 13, PY + L / 2 + 6, PX + L + 4, PY + L / 2 + 6, 'A', true);
  corte(PX + L / 2 + 6, PY - 4, PX + L / 2 + 6, PY + L + 14, 'B', false);

  // ===== CORTES =====
  const desenhaCorte = (X: number, Y: number, t: string, plano: 'N1' | 'N2') => {
    titulo(X, Y - 8, t);
    const outro = plano === 'N1' ? 'N2' : 'N1';
    rect(X, Y, L, H, CONC, PRETO, 0.45);
    if (o.estaca) { const r = cm(o.estaca) / 2; ln(X + L / 2 - r, Y + H, X + L / 2 - r, Y + H + 14, PRETO, 0.3); ln(X + L / 2 + r, Y + H, X + L / 2 + r, Y + H + 14, PRETO, 0.3); ln(X + L / 2 - r - 2, Y + H + 14, X + L / 2 + r + 2, Y + H + 14, PRETO, 0.2, '1 1'); tx(X + L / 2, Y + H + 18, `estaca ø${Math.round(o.estaca * 100)}`, 2.1, 'middle'); }
    const x0 = X + cb, y0 = Y + cbf;
    // estribo no plano do corte, com gancho no canto de cima à esquerda
    rect(x0, y0, A, AH, 'none', FERRO, 0.6);
    ln(x0, y0, x0 + 3.5, y0 + 3.5, FERRO, 0.6); ln(x0, y0, x0 + 4, y0 + 1.5, FERRO, 0.6);
    // barras do outro sentido, cortadas (fundo e topo)
    for (let i = 0; i < n; i++) for (const yy of [y0 + AH - 0.9, y0 + 0.9]) s.push(`<circle cx="${(x0 + i * esp).toFixed(2)}" cy="${yy.toFixed(2)}" r="0.55" fill="${FERRO}"/>`);
    chamada(x0 + A * 0.45, y0 + AH, X + L + 6, Y + H + 4, `${n} N${plano.slice(1)} ø${bit} c/${espT} C=${C}`);
    chamada(x0 + A, y0 + 0.9, X + L + 6, Y - 3, `${n} ${outro} (cortadas)`);
    cotaH(X, X + L, Y + H + 9, d1(o.lado * 100), Y + H + 1);
    cotaH(x0, x0 + A, Y + H + 5.5, d1(o.armLado * 100));
    cotaV(X - 4, y0, y0 + AH, d1(o.armAlt * 100));
    cotaV(X - 8, Y, Y + H, d1(o.alt * 100), X - 1);
    if (cbf > 0.05) { cotaV(X + L + 3, y0 + AH, Y + H, d1(cbf)); cotaV(X + L + 3, Y, y0, d1(cbf)); }
    nivel(X + L + 30, Y, '0'); nivel(X + L + 30, Y + H, `-${Math.round(o.alt * 100)}`);
  };
  desenhaCorte(118, PY, 'CORTE A-A', 'N1');
  desenhaCorte(222, PY, 'CORTE B-B', 'N2');

  // ===== DETALHE DAS ARMADURAS =====
  const DX = 318, DY = PY;
  titulo(DX, DY - 8, 'ARMADURAS', 'ESC 1:10');
  const estribo = (X: number, Y: number, nn: string) => {
    rect(X, Y, A, AH, 'none', FERRO, 0.6);
    ln(X, Y, X + Math.min(G, 8) * 0.7, Y + Math.min(G, 8) * 0.7, FERRO, 0.6); ln(X, Y, X + Math.min(G, 8) * 0.95, Y + Math.min(G, 8) * 0.3, FERRO, 0.6);
    tx(X + A / 2, Y - 1.2, d1(o.armLado * 100), 2.2, 'middle'); tx(X + A / 2, Y + AH + 3, d1(o.armLado * 100), 2.2, 'middle');
    tx(X - 1.2, Y + AH / 2 + 0.8, d1(o.armAlt * 100), 2.2, 'end'); tx(X + A + 1.2, Y + AH / 2 + 0.8, d1(o.armAlt * 100), 2.2, 'start');
    if (G) tx(X + 6.5, Y + 6.5, `gancho ${d1(G)}`, 1.8, 'start', 0, '#555');
    tx(X + A / 2, Y + AH + 8, `${n} ${nn} ø${bit} C=${C}`, 2.6, 'middle', 0, PRETO, 'bold');
  };
  estribo(DX + 6, DY + 2, 'N1');
  estribo(DX + 6, DY + AH + 22, 'N2');

  // ===== TABELAS =====
  const tabela = (X: number, Y: number, tit: string, cab: string[], ws: number[], linhas: string[][], neg: number[] = []) => {
    const h = 5, W = ws.reduce((a, b) => a + b, 0);
    rect(X, Y, W, h * (linhas.length + 2), 'none', PRETO, 0.3);
    tx(X + W / 2, Y + 3.6, tit, 2.5, 'middle', 0, PRETO, 'bold'); ln(X, Y + h, X + W, Y + h, PRETO, 0.25);
    let x = X; cab.forEach((c, i) => { tx(x + ws[i] / 2, Y + h + 3.5, c, 2.1, 'middle', 0, PRETO, 'bold'); x += ws[i]; if (i < cab.length - 1) ln(x, Y + h, x, Y + h * (linhas.length + 2), PRETO, 0.15); });
    ln(X, Y + 2 * h, X + W, Y + 2 * h, PRETO, 0.25);
    linhas.forEach((l, j) => { let xx = X; const yy = Y + (j + 2) * h; if (j) ln(X, yy, X + W, yy, PRETO, 0.1); l.forEach((c, i) => { tx(xx + ws[i] / 2, yy + 3.5, c, 2.1, 'middle', 0, PRETO, neg.includes(j) ? 'bold' : 'normal'); xx += ws[i]; }); });
  };
  const TY = 150;
  tabela(8, TY, 'RELAÇÃO DO AÇO - POR BLOCO', ['POS', 'AÇO', 'ø (mm)', 'QUANT', 'C.UNIT (cm)', 'C.TOTAL (cm)'], [12, 14, 14, 14, 22, 24],
    [['N1', 'CA-50', bit, String(n), String(C), String(n * C)], ['N2', 'CA-50', bit, String(n), String(C), String(n * C)]]);
  const kg = q.kg, kg10 = kg * 1.1;
  tabela(8, TY + 26, `RELAÇÃO DO AÇO - ${o.qtd} BLOCOS`, ['POS', 'ø (mm)', 'QUANT', 'C.UNIT (cm)', 'C.TOTAL (m)'], [12, 16, 20, 26, 26],
    [['N1', bit, String(n * o.qtd), String(C), d1(q.metros / 2)], ['N2', bit, String(n * o.qtd), String(C), d1(q.metros / 2)]]);
  tabela(118, TY, 'RESUMO DO AÇO', ['AÇO', 'ø (mm)', 'C.TOTAL (m)', 'PESO + 10% (kg)', `BARRAS ${d1(o.barra)} m`], [16, 16, 24, 28, 26],
    [['CA-50', bit, d1(q.metros), d1(kg10), String(q.barras12)], ['', '', '', `peso sem perda: ${d1(kg)}`, '']], [0]);
  tabela(118, TY + 26, 'CONSUMO', ['ITEM', 'POR BLOCO', `TOTAL (${o.qtd})`], [40, 30, 40],
    [['Concreto (m³)', q.conc.toFixed(3).replace('.', ','), q.concTotal.toFixed(2).replace('.', ',')], ['Forma - laterais (m²)', (4 * o.lado * o.alt).toFixed(2).replace('.', ','), q.forma.toFixed(2).replace('.', ',')], ['Aço CA-50 (kg)', (kg / o.qtd).toFixed(2).replace('.', ','), d1(kg)]]);
  // notas
  const NX = 240, NY = TY + 3;
  tx(NX, NY, 'NOTAS', 2.8, 'start', 0, PRETO, 'bold');
  const notas = [
    `1. Medidas em centímetros e níveis em centímetros, salvo indicação.`,
    `2. Cobrimento: ${d1(q.cob * 100)} cm nas laterais e ${d1(q.cobFundo * 100)} cm no fundo e no topo.`,
    `3. Estribos N1 (direção X) e N2 (direção Y) quadrados fechados de ${d1(o.armLado * 100)} x ${d1(o.armAlt * 100)},`,
    `    com gancho de ${d1(G)} cm em cada ponta, amarrados formando a gaiola.`,
    `4. Comprimento dos estribos pelas medidas externas, com os ganchos.`,
    `5. Concreto (fck), aço e ligação com a estaca conforme o projeto estrutural.`,
    `6. Locação dos blocos: planta de locação (folhas 1 e 2).`,
    `7. Plano de corte: ${q.porBarra} estribos por barra de ${d1(o.barra)} m (sobra ${q.sobra.toFixed(2).replace('.', ',')} m).`,
  ];
  notas.forEach((t, i) => tx(NX, NY + 5 + i * 4.2, t, 2.2));
  return s.join('');
}
