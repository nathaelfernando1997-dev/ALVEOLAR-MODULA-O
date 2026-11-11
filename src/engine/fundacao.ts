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
  const tx = (t: string) => t.replace(/[^\x20-\x7e]/g, ch => '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
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
