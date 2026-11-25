// Pranchas da fundação em PDF vetorial (preto e branco, padrão de detalhamento): estaca e bloco, locação, base das paredes e bloco em 3D.
// Desenho em mm de papel com y para baixo (como no papel); a Folha guarda com y para cima.
import { Folha, type Pagina } from './folhaDoc.ts';
import type { OpBloco, OpEstaca, Locacao } from './fundacao.ts';

const PT = 72 / 25.4;
const K = '#000000', CZ = '#777777';
type XY = [number, number];
class D {
  F: Folha; H: number;
  constructor(w = 420, h = 297) { this.F = new Folha(w, h); this.H = h; }
  L(x1: number, y1: number, x2: number, y2: number, w = 0.25, c = K, dash?: number[]) { this.F.l([[x1, this.H - y1], [x2, this.H - y2]], w, c, dash); }
  PL(p: XY[], w = 0.25, c = K, fecha = false, dash?: number[]) { const q: XY[] = p.map(([x, y]) => [x, this.H - y]); if (fecha) q.push(q[0]); this.F.l(q, w, c, dash); }
  R(x: number, y: number, w: number, h: number, lw = 0.3, c = K, dash?: number[], fill?: string) {
    if (fill) this.F.poly([[x, this.H - y], [x + w, this.H - y], [x + w, this.H - y - h], [x, this.H - y - h]], { fill });
    this.PL([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], lw, c, true, dash);
  }
  C(x: number, y: number, r: number, w = 0.25, c = K, dash?: number[]) { const p: XY[] = []; for (let i = 0; i < 40; i++) { const a = i / 40 * 2 * Math.PI; p.push([x + r * Math.cos(a), y + r * Math.sin(a)]); } this.PL(p, w, c, true, dash); }
  Cf(x: number, y: number, r: number, c = K) { this.F.c(x, this.H - y, r, c); }
  T(x: number, y: number, s: string, mm = 2.5, o: { b?: boolean; a?: 'start' | 'middle' | 'end'; c?: string; rot?: number } = {}) {
    this.F.t(x, this.H - y, s, mm * PT, { bold: o.b, ha: o.a === 'middle' ? 'center' : o.a === 'end' ? 'right' : 'left', color: o.c ?? K, rot: o.rot });
  }
}
const br = (v: number, n = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: n, maximumFractionDigits: n });
const d1 = (v: number) => v.toFixed(1);
const KG = (mm: number) => 0.006165 * mm * mm;
const aco = (mm: number) => mm <= 5.0 + 1e-6 ? 'CA-60' : 'CA-50';

export interface InfoProj { obra: string; endereco?: string; resp: string; empresa: string; data: string; revisao?: string }
function carimbo(d: D, I: InfoProj, conteudo: string, escala: string, folha: string) {
  const W = d.F.w, Hh = d.H, cw = 150, ch = 48, cx = W - 7 - cw, cy = Hh - 7 - ch;
  d.R(cx, cy, cw, ch, 0.5);
  const rows: [string, string][] = [['OBRA:', I.obra.toUpperCase()], ['ENDEREÇO:', (I.endereco || '—').toUpperCase()], ['CONTEÚDO:', conteudo], ['RESP. TÉCNICO:', I.resp.toUpperCase()], ['EMPRESA:', I.empresa.toUpperCase()]];
  rows.forEach(([a, b], i) => { const y = cy + i * 7; d.L(cx, y + 7, cx + cw, y + 7, 0.25); d.T(cx + 2, y + 3, a, 1.8); d.T(cx + 2, y + 6.2, b, 2.4, { b: true }); });
  const y = cy + 35; d.L(cx + 50, y, cx + 50, cy + ch, 0.25); d.L(cx + 95, y, cx + 95, cy + ch, 0.25);
  for (const [x, a, b] of [[cx + 2, 'DATA:', I.data], [cx + 52, 'ESCALA:', escala], [cx + 97, 'PRANCHA:', folha]] as [number, string, string][]) { d.T(x, y + 3.5, a, 1.8); d.T(x, y + 9.5, b, 3, { b: true }); }
  d.T(cx + 97, y + 12.2, `REV. ${I.revisao ?? '00'}`, 1.8);
  d.R(10, 7, W - 17, Hh - 14, 0.7);
}
const tick = (d: D, x: number, y: number) => d.L(x - 0.8, y + 0.8, x + 0.8, y - 0.8, 0.35);
function cotaH(d: D, x1: number, x2: number, y: number, t: string, off = -1) { d.L(x1, y, x2, y, 0.18); tick(d, x1, y); tick(d, x2, y); d.T((x1 + x2) / 2, y + off, t, 2.2, { a: 'middle' }); }
function cotaV(d: D, x: number, y1: number, y2: number, t: string, off = -1) { d.L(x, y1, x, y2, 0.18); tick(d, x, y1); tick(d, x, y2); d.T(x + off, (y1 + y2) / 2, t, 2.2, { a: 'middle', rot: 90 }); }
function titulo(d: D, x: number, y: number, t: string, esc: string) { d.T(x, y, t, 3.2, { a: 'middle', b: true }); d.L(x - t.length * 0.85, y + 1, x + t.length * 0.85, y + 1, 0.3); d.T(x, y + 4.2, esc, 2.2, { a: 'middle' }); }
function terra(d: D, x1: number, x2: number, y: number) { d.L(x1, y, x2, y, 0.3); for (let x = x1; x < x2 - 1; x += 2.2) d.L(x, y, x - 1.6, y + 1.6, 0.15); }
function tabela(d: D, x: number, y: number, tit: string, linhas: string[][], cols: string[], larg: number[]) {
  const Wt = larg.reduce((a, b) => a + b, 0), h = 4.2;
  d.T(x + Wt / 2, y, tit, 2.6, { a: 'middle', b: true }); y += 2;
  d.R(x, y, Wt, h * (linhas.length + 1), 0.3); d.L(x, y + h, x + Wt, y + h, 0.3);
  let xx = x; larg.slice(0, -1).forEach(w => { xx += w; d.L(xx, y, xx, y + h * (linhas.length + 1), 0.2); });
  xx = x; cols.forEach((c, i) => { d.T(xx + larg[i] / 2, y + 3, c, 2.1, { a: 'middle', b: true }); xx += larg[i]; });
  linhas.forEach((ln, j) => { xx = x; ln.forEach((v, i) => { d.T(xx + larg[i] / 2, y + h * (j + 1) + 3, v, 2.1, { a: 'middle' }); xx += larg[i]; }); });
  return y + h * (linhas.length + 1);
}
const escalaQueCabe = (alturaCm: number, espaco: number) => { for (const e of [20, 25, 50, 75, 100, 125, 150, 200]) if (alturaCm * 10 / e <= espaco) return e; return 250; };

// ---------- quantidades da estaca e do bloco (o mesmo que vai na prancha) ----------
export type BlocoDet = OpBloco & { estrH?: number; bitH?: number };
export function posicoesFund(e: OpEstaca, b: BlocoDet, nE: number, nB: number) {
  const GAN = 0.15;
  const naEstaca = Math.max(0.5, e.armComp - e.noBloco - GAN);
  const nEstr = Math.floor(naEstaca / e.espEstr + 1e-9) + 1;
  const cEstr = Math.round((Math.PI * e.armDiam + e.transpEstr) * 100);
  const cN3 = Math.round((2 * b.armLado + 2 * b.armAlt + 2 * (b.gancho ?? 0)) * 100), cN4 = Math.round((4 * b.armLado + 2 * (b.gancho ?? 0)) * 100);
  const pos = [
    { n: 'N1', bit: e.bitLong, q: e.barras, c: Math.round(e.armComp * 100), peca: 'E' as const, mult: nE, desc: 'estaca — longitudinal' },
    { n: 'N2', bit: e.bitEstr, q: nEstr, c: cEstr, peca: 'E' as const, mult: nE, desc: `estaca — estribo circular c/${Math.round(e.espEstr * 100)}` },
    { n: 'N3', bit: b.bitola, q: 2 * b.barras, c: cN3, peca: 'B' as const, mult: nB, desc: `bloco — estribo em pé ${Math.round(b.armLado * 100)}×${Math.round(b.armAlt * 100)}` },
    ...((b.estrH ?? 0) > 0 ? [{ n: 'N4', bit: b.bitH ?? 6.3, q: b.estrH!, c: cN4, peca: 'B' as const, mult: nB, desc: `bloco — estribo deitado ${Math.round(b.armLado * 100)}×${Math.round(b.armLado * 100)}` }] : []),
  ];
  return { pos, naEstaca, nEstr, cEstr, GAN };
}

// ================= FUND-01: estaca e bloco =================
export function folhaEstacaBloco(I: InfoProj, e: OpEstaca, b: BlocoDet, nE: number, nB: number, comps: { L: number; n: number }[], obs: { baldrame: boolean }, folha: string, b2?: { n: number; comp: number }): Pagina {
  const d = new D(); const { pos, naEstaca, nEstr, GAN } = posicoesFund(e, b, nE, nB);
  const AR = 0.75;
  // ---- elevação da estaca (escala que cabe)
  const esc = escalaQueCabe(e.comp * 100 + 120, 175), k = 10 / esc;   // mm de papel por cm
  const ex = 52, et = 62, Lb = b.lado * 100, Hb = b.alt * 100, emb = 10;
  titulo(d, ex, 24, 'ESTACA E1 — ELEVAÇÃO', `ESC 1:${esc}`);
  d.T(ex, 33.5, `Ø${Math.round(e.furo * 100)} · L=${Math.round(e.comp * 100)} · ${nE} estacas`, 2.2, { a: 'middle' });
  terra(d, ex - 34, ex - Lb / 2 * k - 2, et); terra(d, ex + Lb / 2 * k + 2, ex + 34, et);
  d.R(ex - Lb / 2 * k, et, Lb * k, Hb * k, 0.4);
  d.PL([[ex - 7 * k, et - 30 * k], [ex - 7 * k, et], [ex + 7 * k, et], [ex + 7 * k, et - 30 * k]], 0.3, CZ); d.T(ex + 7 * k + 1, et - 20 * k, 'parede', 2, { c: CZ });
  const eh = et + (Hb - emb) * k, eb = eh + e.comp * 100 * k, rf = e.furo * 50;
  d.R(ex - rf * k, eh, 2 * rf * k, e.comp * 100 * k, 0.4);
  const ra = e.armDiam * 50 - 0.5;
  for (const sx of [-1, 1]) { const x = ex + sx * ra * k; d.PL([[x - sx * GAN * 100 * k * 0.6, et + 5 * k], [x, et + 5 * k], [x, eh + naEstaca * 100 * k]], AR); }
  for (let i = 0; i < nEstr; i++) { const y = eh + 5 * k + i * e.espEstr * 100 * k; if (y < eh + naEstaca * 100 * k + 0.1) d.L(ex - ra * k, y, ex + ra * k, y, 0.3); }
  cotaV(d, ex - Lb / 2 * k - 5, et, et + Hb * k, br(Hb, 0)); cotaV(d, ex - rf * k - 5, eh, eb, br(e.comp * 100, 0));
  cotaV(d, ex + rf * k + 4, eh, eh + naEstaca * 100 * k, br(naEstaca * 100, 0), 2.6); cotaV(d, ex + rf * k + 4, et + 5 * k, eh, br((e.noBloco) * 100, 0), 2.6);
  cotaH(d, ex - rf * k, ex + rf * k, eb + 4, `ø${Math.round(e.furo * 100)}`, 3);
  d.T(ex + rf * k + 7, eh + 0.3 * naEstaca * 100 * k, `N1 - ${e.barras} ø${d1(e.bitLong)} C=${Math.round(e.armComp * 100)}`, 2.4);
  d.T(ex + rf * k + 7, eh + 0.6 * naEstaca * 100 * k, `N2 - ${nEstr} ø${d1(e.bitEstr)} c/${Math.round(e.espEstr * 100)} C=${pos[1].c}`, 2.4);
  if (e.comp - naEstaca > 0.3) { d.T(ex + rf * k + 7, eh + (naEstaca + (e.comp - naEstaca) / 2) * 100 * k, 'trecho sem armadura', 2.2); d.T(ex + rf * k + 7, eh + (naEstaca + (e.comp - naEstaca) / 2) * 100 * k + 3, '(concreto simples)', 2.2); }
  d.T(ex - rf * k - 9, eb - 1, 'fundo limpo', 2.2, { a: 'end', b: true });
  // seção A-A 1:10
  const sx = ex + 2, sy = Math.min(eb + 28, 262);
  titulo(d, sx, sy - 14, 'SEÇÃO A-A', 'ESC 1:10');
  d.C(sx, sy + 3, rf * 0.8, 0.4); d.C(sx, sy + 3, (e.armDiam * 50) * 0.8, 0.35);
  for (let a = 0; a < e.barras; a++) { const th = Math.PI / 4 + a * 2 * Math.PI / e.barras; d.Cf(sx + ra * 0.8 * Math.cos(th), sy + 3 + ra * 0.8 * Math.sin(th), 0.8); }
  // ---- bloco: planta e corte 1:10
  const bx = 120, by = 40, kb = 1, A = b.armLado * 100, cob = (Lb - A) / 2, nb = Math.max(2, b.barras), esp = A / (nb - 1);
  titulo(d, bx + Lb / 2, 24, 'BLOCO B1 — PLANTA', 'ESC 1:10');
  d.T(bx + Lb / 2, 33, `B1 = ${nB} blocos · ${Math.round(Lb)}×${Math.round(Lb)}×${Math.round(Hb)}`, 2.2, { a: 'middle' });
  if (b2?.n) d.T(bx + Lb / 2, 37, `B2 (2 estacas) = ${b2.n} blocos · ${Math.round(Lb)}×${Math.round(b2.comp * 100)}×${Math.round(Hb)} — armação do B1 nas duas estacas, barras longas no comprimento`, 1.9, { a: 'middle' });
  d.R(bx, by, Lb * kb, Lb * kb, 0.45); d.C(bx + Lb / 2, by + Lb / 2, rf, 0.25, K, [1.5, 1]);
  if ((b.estrH ?? 0) > 0) d.R(bx + cob - 1, by + cob - 1, A + 2, A + 2, 0.5);
  for (let i = 0; i < nb; i++) { d.L(bx + cob + i * esp, by + cob, bx + cob + i * esp, by + cob + A, AR); d.L(bx + cob, by + cob + i * esp, bx + cob + A, by + cob + i * esp, AR); }
  for (let a = 0; a < e.barras; a++) { const th = Math.PI / 4 + a * 2 * Math.PI / e.barras; d.Cf(bx + Lb / 2 + ra * Math.cos(th), by + Lb / 2 + ra * Math.sin(th), 0.8); }
  d.L(bx - 6, by + Lb / 2, bx - 1, by + Lb / 2, 0.3); d.T(bx - 6, by + Lb / 2 - 1, 'A', 2.6, { a: 'middle', b: true }); d.L(bx + Lb + 1, by + Lb / 2, bx + Lb + 6, by + Lb / 2, 0.3); d.T(bx + Lb + 6, by + Lb / 2 - 1, 'A', 2.6, { a: 'middle', b: true });
  cotaH(d, bx, bx + Lb, by - 3, br(Lb, 0)); cotaV(d, bx - 9, by, by + Lb, br(Lb, 0));
  let yl = by + 8; const lab = (t: string, b2 = false) => { d.T(bx + Lb + 12, yl, t, b2 ? 2.3 : 2.1, { b: b2 }); yl += b2 ? 3.4 : 3.2; };
  lab(`N3 - ${2 * nb} ø${d1(b.bitola)} C=${pos[2].c}`, true); lab(`(${nb} + ${nb} em pé)`);
  if ((b.estrH ?? 0) > 0) { yl += 2; lab(`N4 - ${b.estrH} ø${d1(b.bitH ?? 6.3)} C=${pos[3].c}`, true); lab('(deitados, por fora)'); }
  yl += 2; lab(`N1 - ${e.barras} ø${d1(e.bitLong)} (esperas)`, true);
  // corte
  const cx0 = bx, cy0 = by + Lb + 36;
  titulo(d, cx0 + Lb / 2, cy0 - 18, 'BLOCO B1 — CORTE A-A', 'ESC 1:10');
  d.PL([[cx0 + Lb / 2 - 7, cy0 - 14], [cx0 + Lb / 2 - 7, cy0], [cx0 + Lb / 2 + 7, cy0], [cx0 + Lb / 2 + 7, cy0 - 14]], 0.3, CZ); d.T(cx0 + Lb / 2 + 8, cy0 - 10, 'parede', 2, { c: CZ });
  d.R(cx0, cy0, Lb, Hb, 0.45); d.PL([[cx0 + Lb / 2 - rf, cy0 + Hb - emb], [cx0 + Lb / 2 - rf, cy0 + Hb + 8], [cx0 + Lb / 2 + rf, cy0 + Hb + 8], [cx0 + Lb / 2 + rf, cy0 + Hb - emb]], 0.4);
  const Aa = b.armAlt * 100, cb2 = (Hb - Aa) / 2;
  d.R(cx0 + cob, cy0 + cb2, A, Aa, AR);
  for (let i = 1; i < nb - 1; i++) d.L(cx0 + cob + i * esp, cy0 + cb2, cx0 + cob + i * esp, cy0 + cb2 + Aa, AR);
  if ((b.estrH ?? 0) > 0) for (let i = 0; i < b.estrH!; i++) { const y = cy0 + cb2 + 1.5 + i * (Aa - 3) / Math.max(1, b.estrH! - 1); d.L(cx0 + cob - 1, y, cx0 + cob + A + 1, y, 0.5); }
  for (const sx2 of [-1, 1]) { const x = cx0 + Lb / 2 + sx2 * ra; d.PL([[x - sx2 * 9, cy0 + 5], [x, cy0 + 5], [x, cy0 + Hb + 8]], AR); }
  cotaV(d, cx0 - 4, cy0, cy0 + Hb, br(Hb, 0)); cotaV(d, cx0 + Lb + 3, cy0 + Hb - emb, cy0 + Hb, String(emb), 2.6); cotaH(d, cx0, cx0 + Lb, cy0 + Hb + 12, br(Lb, 0), 3.2);
  d.T(cx0 + Lb / 2, cy0 + Hb + 20, `estaca embutida ${emb} cm no bloco`, 2.1, { a: 'middle' });
  // ---- formas das barras
  const fx = 220, fy = 22; d.T(fx, fy, 'DETALHAMENTO DAS ARMADURAS', 3.2, { b: true }); d.L(fx, fy + 1, fx + 52, fy + 1, 0.3);
  const kf = 0.25; let y = fy + 10;
  d.T(fx, y, `N1 - ${e.barras} ø${d1(e.bitLong)} C=${pos[0].c}`, 2.4); y += 4;
  const reto = pos[0].c - GAN * 100; d.PL([[fx, y + 1 + GAN * 100 * kf * 1.4], [fx, y + 1], [fx + reto * kf, y + 1]], AR); d.T(fx + reto * kf / 2, y, String(Math.round(reto)), 2.1, { a: 'middle' }); d.T(fx - 1, y + 4.5, String(Math.round(GAN * 100)), 2.1, { a: 'end' });
  y += 14; d.T(fx, y, `N2 - ${nEstr} ø${d1(e.bitEstr)} c/${Math.round(e.espEstr * 100)} C=${pos[1].c}`, 2.4); d.C(fx + 8, y + 9, 6, AR); d.T(fx + 18, y + 10, `ø${Math.round(e.armDiam * 100)} (traspasse ${Math.round(e.transpEstr * 100)})`, 2.1);
  const x3 = fx + 62; let y3 = fy + 10;
  const estribo = (t: string, sub: string) => { d.T(x3, y3, t, 2.4); d.PL([[x3 + 2, y3 + 4], [x3 + 12, y3 + 4], [x3 + 12, y3 + 14], [x3 + 2, y3 + 14]], AR, K, true); d.L(x3 + 2, y3 + 4, x3 + 5, y3 + 7, AR); d.T(x3 + 7, y3 + 3, br(A, 0), 2.1, { a: 'middle' }); d.T(x3 + 15, y3 + 10, br(A, 0), 2.1); d.T(x3 + 18, y3 + 8, sub, 2.0); y3 += 22; };
  estribo(`N3 - ${2 * nb} ø${d1(b.bitola)} C=${pos[2].c}`, 'estribo em pé, fechado');
  if ((b.estrH ?? 0) > 0) estribo(`N4 - ${b.estrH} ø${d1(b.bitH ?? 6.3)} C=${pos[3].c}`, 'estribo deitado, fechado');
  // ---- relação e resumo do aço
  const rx = 205, ry = 95;
  const lin = pos.map(p => [aco(p.bit), p.n, d1(p.bit), String(p.q * p.mult), String(p.c), String(p.q * p.mult * p.c)]);
  const yy = tabela(d, rx, ry, `RELAÇÃO DO AÇO — ESTACAS (${nE}x) E BLOCOS (${nB}x)`, lin, ['AÇO', 'N', 'DIAM', 'QUANT', 'C.UNIT', 'C.TOTAL'], [16, 10, 14, 16, 16, 22]);
  d.T(rx, yy + 3.5, 'DIAM em mm · comprimentos em cm · quantidades já multiplicadas pelo nº de peças', 1.9);
  const res = new Map<string, { a: string; bit: number; m: number }>();
  for (const p of pos) { const kk = aco(p.bit) + p.bit; const r = res.get(kk) ?? { a: aco(p.bit), bit: p.bit, m: 0 }; r.m += p.q * p.mult * p.c / 100; res.set(kk, r); }
  const rr = [...res.values()].sort((a, b2) => (a.a === 'CA-50' ? 0 : 1) - (b2.a === 'CA-50' ? 0 : 1) || a.bit - b2.bit);
  const yy2 = tabela(d, rx + 100, ry, 'RESUMO DO AÇO', rr.map(r => [r.a, d1(r.bit), r.m.toFixed(0), (r.m * KG(r.bit) * 1.1).toFixed(0)]), ['AÇO', 'DIAM', 'C.TOTAL (m)', 'PESO+10% (kg)'], [14, 12, 20, 24]);
  for (const [i, a] of (['CA-50', 'CA-60'] as const).entries()) { const kg = rr.filter(r => r.a === a).reduce((s, r) => s + r.m * KG(r.bit) * 1.1, 0); if (kg > 0) d.T(rx + 100, yy2 + 4 + i * 4, `PESO TOTAL ${a}: ${kg.toFixed(0)} kg`, 2.3, { b: true }); }
  const ve = Math.PI * (e.furo / 2) ** 2, vb = b.lado * b.lado * b.alt;
  const vb2 = b2?.n ? b2.n * b.lado * b2.comp * b.alt : 0;
  const lin3 = [...comps.map(c => [`Estaca E1 L=${Math.round(c.L * 100)}`, String(c.n), (c.n * ve * c.L).toFixed(1)]), ['Bloco B1', String(nB), (nB * vb).toFixed(1)], ...(b2?.n ? [['Bloco B2 (2 estacas)', String(b2.n), vb2.toFixed(1)]] : [])];
  const yy3 = tabela(d, rx, yy + 10, 'CONSUMO DE CONCRETO (C25)', lin3, ['ELEMENTO', 'QUANT', 'VOLUME (m³)'], [40, 16, 22]);
  d.T(rx, yy3 + 4, `Total: ${(comps.reduce((s, c) => s + c.n * ve * c.L, 0) + nB * vb + vb2).toFixed(1)} m³ (sem perdas)`, 2.3, { b: true });
  // ---- notas
  const AsE = e.barras * Math.PI * (e.bitLong / 20) ** 2, AsMin = 0.004 * ve * 1e4;
  const notas = ['1. Medidas em centímetros, exceto onde indicado.', '2. Concreto C25 (estaca e bloco). Estaca: abatimento 100±20 mm, lançamento com funil.',
    '3. Aço CA-50 e CA-60 (ø5.0). Cobrimento: estaca 5 cm · bloco 5 cm (CAA II).',
    `4. Estaca armada nos ${Math.round(naEstaca * 100)} cm do topo: ${e.barras} ø${d1(e.bitLong)} = ${br(AsE)} cm² ${AsE >= AsMin - 1e-6 ? '≥' : '<'} 0,4% (${br(AsMin)} cm²)${naEstaca >= 2 - 1e-6 ? '' : ' · ATENÇÃO: menos de 2,00 m armados'}.`,
    '    O restante em concreto simples. Fundo do furo limpo.', '5. Arrasar a cabeça da estaca, deixando 10 cm dentro do bloco e as esperas N1 inteiras.',
    obs.baldrame ? '6. Viga baldrame 15 × 40 apoiada nos blocos (ver projeto do baldrame).' : '6. Sem viga baldrame: a parede apoia direto no bloco, com argamassa de assentamento (ver FUND-03).',
    '7. Locação, numeração e cargas das estacas: ver FUND-02.'];
  notas.forEach((t, i) => d.T(120, 213 + i * 3.9, t, 2.25)); d.T(120, 207, 'NOTAS', 3, { b: true });
  carimbo(d, I, 'FUNDAÇÃO — DETALHAMENTO DE ESTACAS E BLOCOS', 'INDICADAS', folha);
  return d.F;
}

// ================= FUND-02: locação dos blocos + quadro de cargas =================
export function folhasLocacao(I: InfoProj, loc: Locacao, arq: XY[][], cargas: { n: number; R: number; sit: string }[] | null, cab: string, folha: [string, string]): Pagina[] {
  const xs: number[] = [], ys: number[] = [];
  const txt = loc.d.textos.filter(t => t.l !== 'COTA-ACUMULADA' && t.l !== 'PONTO-COORD' && t.l !== 'ORIGEM' && !t.t.startsWith('numeros em pe'));
  for (const l of loc.d.linhas) { if (l.l === 'ORIGEM') continue; xs.push(l.x1, l.x2); ys.push(l.y1, l.y2); }
  for (const t of txt) { xs.push(t.x); ys.push(t.y); }
  const x0 = Math.min(...xs) - 0.8, x1 = Math.max(...xs) + 1.2, y0 = Math.min(...ys) - 0.8, y1 = Math.max(...ys) + 0.5;
  // papel: A1 em pé ou deitado, a maior escala que cabe
  let best: { w: number; h: number; e: number } | null = null;
  for (const [w, h] of [[594, 841], [841, 594]]) for (const e of [50, 75, 100, 125, 150, 200]) { const k = 1000 / e; if ((x1 - x0) * k <= w - 40 && (y1 - y0) * k <= h - 110) { if (!best || e < best.e) best = { w, h, e }; break; } }
  best ??= { w: 841, h: 594, e: 250 };
  const d = new D(best.w, best.h), k = 1000 / best.e, ox = (best.w - (x1 - x0) * k) / 2, oy = 62;
  const X = (x: number) => ox + (x - x0) * k, Y = (y: number) => oy + (y1 - y) * k;
  // arquitetura só dentro da área dos eixos (corta o resto)
  const ax0 = Math.min(...loc.ex.map(e => e.v)) - 0.6, ax1 = Math.max(...loc.ex.map(e => e.v)) + 0.6, ay0 = Math.min(...loc.ey.map(e => e.v)) - 0.6, ay1 = Math.max(...loc.ey.map(e => e.v)) + 0.6;
  const corta = (a: XY, b: XY): [XY, XY] | null => {   // Liang-Barsky
    let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [pp, q] of [[-dx, a[0] - ax0], [dx, ax1 - a[0]], [-dy, a[1] - ay0], [dy, ay1 - a[1]]]) {
      if (Math.abs(pp) < 1e-12) { if (q < 0) return null; continue; }
      const r = q / pp; if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  };
  for (const p of arq) for (let i = 0; i < p.length - 1; i++) { const c = corta(p[i], p[i + 1]); if (c) d.L(X(c[0][0]), Y(c[0][1]), X(c[1][0]), Y(c[1][1]), 0.18, '#9a9a9a'); }
  for (const l of loc.d.linhas) { if (l.l === 'ORIGEM' || l.l === 'PONTO') continue; d.L(X(l.x1), Y(l.y1), X(l.x2), Y(l.y2), l.tr ? 0.2 : 0.3, K, l.tr ? [6, 1.6, 1, 1.6] : undefined); }
  for (const c of loc.d.circs) { if (c.l === 'PONTO') continue; d.C(X(c.x), Y(c.y), c.r * k, 0.35); }
  for (const p of loc.pts) if (p.par && p.n < p.par) { const q = loc.pts.find(r => r.n === p.par); if (!q) continue;
    const x0 = Math.min(p.x, q.x) - 0.25, x1 = Math.max(p.x, q.x) + 0.25, y0 = Math.min(p.y, q.y) - 0.25, y1 = Math.max(p.y, q.y) + 0.25;
    d.R(X(x0), Math.min(Y(y0), Y(y1)), (x1 - x0) * k, (y1 - y0) * k, 0.45, K, undefined, '#ffffff'); }
  for (const p of loc.pts) if (p.cobre?.length && !p.par) { const xs = [p.x, ...p.cobre.map(c => c[0])], ys = [p.y, ...p.cobre.map(c => c[1])];
    const x0 = Math.min(...xs) - 0.25, x1 = Math.max(...xs) + 0.25, y0 = Math.min(...ys) - 0.25, y1 = Math.max(...ys) + 0.25;
    d.R(X(x0), Math.min(Y(y0), Y(y1)), (x1 - x0) * k, (y1 - y0) * k, 0.45, K, undefined, '#ffffff'); }
  for (const p of loc.pts) { if (!p.par && !p.cobre?.length) d.R(X(p.x) - 0.25 * k, Y(p.y) - 0.25 * k, 0.5 * k, 0.5 * k, 0.35, K, undefined, '#ffffff'); if (p.tipo === 'apoio') { d.T(X(p.x), Y(p.y) + 0.42 * k, 'BA', 0.13 * k * 1.3, { a: 'middle', b: true }); continue; } d.C(X(p.x), Y(p.y), 0.15 * k, 0.35); d.L(X(p.x) - 0.1 * k, Y(p.y), X(p.x) + 0.1 * k, Y(p.y), 0.2); d.L(X(p.x), Y(p.y) - 0.1 * k, X(p.x), Y(p.y) + 0.1 * k, 0.2); }
  for (const t of txt) { const fs = t.h * k * (t.l === 'PONTO-NOME' ? 1.3 : t.l === 'COTA' ? 1.45 : 1.15); d.T(X(t.x), Y(t.y), t.t, fs, { a: t.centro ? 'middle' : 'start', b: t.l === 'PONTO-NOME' || t.l === 'EIXO-NOME', rot: t.rot || 0 }); }
  d.T(24, 30, 'FUND-02 — LOCAÇÃO DE ESTACAS E BLOCOS', 9, { b: true });
  d.T(24, 40, cab, 4.4);
  d.T(24, 48, `Cotas entre eixos em metros · escala 1:${best.e} · os blocos B1 (50 × 50) ficam centrados no ponto da estaca`, 4);
  const nAl = loc.pts.filter(p => p.cobre?.length && !p.par).length;
  if (nAl) d.T(24, 67, `Blocos alongados (${nAl}): 1 estaca no encontro das paredes e o bloco vai até a emenda do painel ao lado (a ponta do painel apoia no bloco)`, 4);
  const nAp = loc.pts.filter(p => p.tipo === 'apoio').length;
  if (nAp) d.T(24, 61, `BA = bloco de apoio sem estaca (${nAp}): coluna no meio de porta larga — as bonecas saem depois da montagem e o vão fica livre`, 4);
  const nDiv = loc.pts.filter(p => p.div).length;
  if (nDiv) {
    for (const p of loc.pts) if (p.div) d.T(X(p.x), Y(p.y) + 0.42 * k, 'BD', 0.13 * k * 1.3, { a: 'middle', b: true });
    const ex = loc.pts.find(p => p.div && p.wx !== undefined), dd = ex ? Math.round(Math.max(Math.abs((ex.wx ?? ex.x) - ex.x), Math.abs((ex.wy ?? ex.y) - ex.y)) * 100) : 0;
    d.T(24, 55, `BD = bloco de divisa (${nDiv}): bloco encostado na divisa e estaca ${dd} cm para dentro do eixo da parede · a parede de concreto equilibra a excentricidade`, 4);
  }
  carimbo(d, I, 'FUNDAÇÃO — LOCAÇÃO DE ESTACAS E BLOCOS', `1:${best.e}`, folha[0]);
  const pags: Pagina[] = [d.F];
  if (cargas) {
    const q = new D(); q.T(22, 22, 'FUND-02 — QUADRO DE ESTACAS E CARGAS', 6, { b: true }); q.T(22, 29, cab, 2.8);
    q.T(22, 34, 'Carga característica no topo da estaca (tf), com a parede redistribuindo entre as estacas · não inclui caixa d\'água', 2.6);
    const nc = cargas.length > 120 ? 5 : cargas.length > 75 ? 4 : 3, por = Math.ceil(cargas.length / nc), larg = [13, 18, 42];
    for (let i = 0; i < nc; i++) { const parte = cargas.slice(i * por, (i + 1) * por); if (!parte.length) continue;
      tabela(q, 22 + i * 78, 44, '', parte.map(c => [`B${c.n}`, br(c.R / 9.81, 1), c.sit]), ['BLOCO', 'CARGA (tf)', 'SITUAÇÃO'], larg); }
    carimbo(q, I, 'FUNDAÇÃO — QUADRO DE ESTACAS E CARGAS', '—', folha[1]);
    pags.push(q.F);
  }
  return pags;
}

// ================= FUND-03: base das paredes e cinta das portas =================
export interface BaseParedes { portas: { nome: string; w: number; q: number }[]; LW: number; tela10: boolean; nTrechosTela: number; nTrechosCinta: number; Tporta: number; Tparede: number; H: number }
export function folhaBaseParedes(I: InfoProj, o: BaseParedes, folha: string): Pagina {
  const d = new D(); const AR = 0.8;
  // cinta: 2 barras com a bitola que dá conta (gancho na boneca)
  const As = 1.4 * o.Tporta / 43.5, bitC = As <= 2 * 0.503 ? 8 : As <= 2 * 0.785 ? 10 : 12.5;
  // ---- elevação típica 1:25
  const k = 0.4, x0 = 24, zb = 150, X = (c: number) => x0 + c * k, Z = (c: number) => zb - c * k;
  titulo(d, X(210), 24, 'ELEVAÇÃO TÍPICA — PAREDE SOBRE OS BLOCOS', 'ESC 1:25');
  const HW = Math.round(o.H * 100) - 14, J0 = 225, J1 = 240, DA = 80, DB = 170, DT = 220;
  d.R(X(-7), Z(HW), (J0 + 7) * k, HW * k, 0.4); d.R(X(J1), Z(HW), (427 - J1) * k, HW * k, 0.4); d.R(X(J0), Z(HW), (J1 - J0) * k, HW * k, 0.25);
  d.T(X(232), Z(150), 'JUNTA', 1.8, { a: 'middle', rot: 90 });
  d.R(X(DA), Z(10), (DB - DA) * k, 10 * k, 0.45); for (let xx = DA; xx < DB - 1; xx += 4) d.L(X(xx), Z(0), X(Math.min(xx + 6, DB)), Z(10), 0.12, CZ);
  d.PL([[X(DA - 7.5), Z(15)], [X(DA - 7.5), Z(5)], [X(DB + 7.5), Z(5)], [X(DB + 7.5), Z(15)]], AR);
  for (const xb of [DA - 10, DB]) d.R(X(xb), Z(25), 10 * k, 25 * k, 0.3);
  d.R(X(DA), Z(DT), (DB - DA) * k, (DT - 10) * k, 0.4, K, undefined, '#ffffff'); d.L(X(DA), Z(10), X(DB), Z(DT), 0.15, CZ); d.L(X(DB), Z(10), X(DA), Z(DT), 0.15, CZ);
  d.T(X((DA + DB) / 2), Z(120), 'PORTA', 2.2, { a: 'middle' }); d.T(X((DA + DB) / 2), Z(DT) - 1.5, 'verga do painel', 1.9, { a: 'middle' });
  if (o.tela10) for (let z = 10; z < 45; z += 10) for (const [a, b] of [[-7, DA - 10], [DB + 10, J0], [J1, 427]]) d.L(X(a), Z(z), X(b), Z(z), 0.18, K, [1.2, 0.8]);
  for (const c of [0, 232, 420]) { d.R(X(c - 25), Z(0), 50 * k, 50 * k, 0.4); d.PL([[X(c - 15), Z(-40)], [X(c - 15), Z(-110)], [X(c + 15), Z(-110)], [X(c + 15), Z(-40)]], 0.35); d.L(X(c - 18), Z(-110), X(c + 18), Z(-110), 0.25, K, [2, 1]); d.T(X(c), Z(-110) + 4, 'estaca (FUND-01)', 1.8, { a: 'middle' }); }
  terra(d, X(-60), X(-28), Z(0)); terra(d, X(450), X(480), Z(0));
  const cham = (x: number, y: number, xt: number, yt: number, t: string) => { d.L(x, y, xt, yt, 0.18); d.Cf(x, y, 0.5); d.T(xt + 1, yt + 0.8, t, 2.2); };
  cham(X(150), Z(5), X(300), Z(80), `CINTA 14×10 no vão — N6 2 ø${d1(bitC)} + N7 ø5.0 c/15`);
  if (o.tela10) cham(X(330), Z(20), X(330), Z(115), 'N9 ø4.2 c/10 nas 2 faces, nos 40 cm de baixo do painel');
  cotaH(d, X(DA - 10), X(DA), Z(-6) + 1, '10'); cotaH(d, X(DA), X(DB), Z(-6) + 1, 'vão da porta'); cotaH(d, X(DB), X(DB + 10), Z(-6) + 1, '10');
  cotaV(d, X(-14), Z(10), Z(0), '10'); if (o.tela10) cotaV(d, X(-14), Z(40), Z(10), '30');
  // ---- corte A-A 1:5 (cinta)
  const k5 = 2, cx = 250, cb = 95, W = (c: number) => cx + c * k5, Hh = (c: number) => cb - c * k5;
  titulo(d, cx + 14, 24, 'CORTE A-A — CINTA NA PORTA', 'ESC 1:5');
  d.R(W(0), Hh(10), 14 * k5, 10 * k5, 0.45); d.R(W(2.5), Hh(7.5), 9 * k5, 5 * k5, 0.5);
  for (const xx of [3.5, 10.5]) d.Cf(W(xx), Hh(3.5), bitC / 10);
  d.L(W(0), Hh(10), W(0), Hh(30), 0.2, K, [1.5, 1]); d.L(W(14), Hh(10), W(14), Hh(30), 0.2, K, [1.5, 1]); d.T(W(7), Hh(20), 'vão da porta', 2, { a: 'middle' });
  d.PL([[W(-6), Hh(0)], [W(20), Hh(0)], [W(20), Hh(-8)], [W(-6), Hh(-8)]], 0.3, K, true); d.T(W(7), Hh(-4) + 0.8, 'terreno / contrapiso', 1.8, { a: 'middle' });
  cotaV(d, W(-4), Hh(10), Hh(0), '10'); d.T(W(7), Hh(10) - 3, '14', 2.2, { a: 'middle' });
  d.T(W(17), Hh(8), 'N7 - ø5.0 c/15 C=38', 2.2, { b: true }); d.T(W(17), Hh(4), `N6 - 2 ø${d1(bitC)}`, 2.2, { b: true }); d.T(W(17), Hh(0.5), 'cobrimento 2,5', 1.9);
  // ---- corte B-B 1:10 (base fora da porta)
  const bx = 252, bb = 198, W2 = (c: number) => bx + c, H2 = (c: number) => bb - c;
  titulo(d, bx + 20, 132, 'CORTE B-B — BASE DO PAINEL FORA DA PORTA', 'ESC 1:10');
  d.R(W2(0), H2(45), 14, 45, 0.45); d.R(W2(2.5), H2(45), 9, 45, 0.25); d.T(W2(7), H2(25), 'isopor', 2, { a: 'middle', rot: 90 });
  for (const z of (o.tela10 ? [5, 15, 25, 35] : [12.5, 37.5])) { d.Cf(W2(1.25), H2(z), 0.45); d.Cf(W2(12.75), H2(z), 0.45); }
  d.PL([[W2(-6), H2(0)], [W2(20), H2(0)], [W2(20), H2(-8)], [W2(-6), H2(-8)]], 0.3, K, true); d.T(W2(7), H2(-4) + 0.8, 'bloco / terreno', 1.8, { a: 'middle' });
  if (o.tela10) { cotaV(d, W2(-4), H2(40), H2(0), '40'); d.T(W2(19), H2(38), 'N9 - ø4.2 c/10', 2.2, { b: true }); d.T(W2(19), H2(34), 'nas 2 capas, 40 cm de baixo', 2); d.T(W2(19), H2(30), '(acima: tela normal c/25)', 2); }
  else d.T(W2(19), H2(38), 'tela normal do painel (c/25)', 2.2, { b: true });
  d.T(W2(19), H2(20), 'capa 2,5 · isopor até a base', 2);
  // ---- detalhe da cinta
  const dx0 = 330, dy0 = 70, kd = 0.32;
  titulo(d, dx0 + 30, 24, 'CINTA — ARMADURA', 'ESC 1:10');
  d.PL([[dx0 + 40 * kd, dy0 - 20 * kd], [dx0 + 40 * kd, dy0], [dx0 + 155 * kd, dy0], [dx0 + 155 * kd, dy0 - 20 * kd]], AR);
  d.T(dx0 + 97 * kd, dy0 - 8, `N6 - 2 ø${d1(bitC)} C = vão + 35`, 2.2, { a: 'middle', b: true }); d.T(dx0 + 97 * kd, dy0 + 4, '(vão + 7,5 em cada boneca + ganchos de 10 para cima)', 1.9, { a: 'middle' });
  d.PL([[dx0 + 20, dy0 + 14], [dx0 + 29, dy0 + 14], [dx0 + 29, dy0 + 19], [dx0 + 20, dy0 + 19]], 0.6, K, true); d.L(dx0 + 20, dy0 + 14, dx0 + 22, dy0 + 16, 0.6);
  d.T(dx0 + 31, dy0 + 16, 'N7 - ø5.0 c/15 C=38', 2.2, { b: true }); d.T(dx0 + 31, dy0 + 19.5, 'estribo 9 × 5', 1.9);
  // ---- quadro
  let N6 = 0, N7 = 0; const nP = o.portas.reduce((s, p) => s + p.q, 0);
  for (const p of o.portas) { N6 += 2 * p.q * (p.w + 35); N7 += p.q * (Math.ceil(p.w / 15) + 1); }
  const N9 = o.tela10 ? 2 * 4 * o.LW * 100 : 0;
  const lin = [['CA-50', 'N6', d1(bitC), String(2 * nP), 'vão+35', N6.toFixed(0)], ['CA-60', 'N7', '5.0', String(N7), '38', (N7 * 38).toFixed(0)], ...(o.tela10 ? [['CA-60', 'N9', '4.2', '4/face', 'var.', N9.toFixed(0)]] : [])];
  const yy = tabela(d, 24, 214, 'RELAÇÃO DO AÇO — CINTAS DAS PORTAS E BASE DOS PAINÉIS', lin, ['AÇO', 'N', 'DIAM', 'QUANT', 'C.UNIT', 'C.TOTAL'], [16, 10, 14, 18, 18, 22]);
  d.T(24, yy + 3.5, `Portas: ${o.portas.map(p => `${p.nome} (${Math.round(p.w)}) ${p.q} un`).join(' · ')}${o.tela10 ? ` · N9 em ${br(o.LW, 1)} m de parede` : ''}`, 1.9);
  tabela(d, 130, 214, 'RESUMO DO AÇO', [['CA-50', d1(bitC), (N6 / 100).toFixed(0), (N6 / 100 * KG(bitC) * 1.1).toFixed(0)], ['CA-60', '5.0', (N7 * 0.38).toFixed(0), (N7 * 0.38 * KG(5) * 1.1).toFixed(0)], ...(o.tela10 ? [['CA-60', '4.2', (N9 / 100).toFixed(0), (N9 / 100 * KG(4.2) * 1.1).toFixed(0)]] : [])], ['AÇO', 'DIAM', 'C.TOTAL (m)', 'PESO+10% (kg)'], [14, 12, 20, 24]);
  const notas = ['1. Medidas em centímetros. Sem viga baldrame: a parede apoia direto nos blocos e trabalha como viga-parede entre as estacas.',
    `2. CINTA SÓ NA BASE DAS PORTAS, na largura do vão: 14 × 10 cm com N6 (2 ø${d1(bitC)}) e N7 (ø5.0 c/15). O N6 entra 7,5 cm em cada boneca`,
    `    (10 cm maciços ao lado da porta, até 25 cm de altura) e sobe 10 cm com gancho. Tração máx. ${br(o.Tporta / 9.81, 1)} tf. Não cortar a cinta.`,
    o.tela10 ? `3. Fora das portas o isopor vai até a base. Tração máx. ${br(o.Tparede / 9.81, 1)} tf: N9 ø4.2 c/10 nas duas capas nos 40 cm de baixo (em vez de c/25).` : `3. Fora das portas o isopor vai até a base. Tração máx. ${br(o.Tparede / 9.81, 1)} tf: a tela normal do painel dá conta.`,
    o.nTrechosCinta ? `    ATENÇÃO: ${o.nTrechosCinta} trecho(s) passam da tela c/10: cinta armada no pé da parede ou baldrame nesses trechos.` : '    Acima de 40 cm, tela normal do painel.',
    As > 2 * 1.227 ? `4. ATENÇÃO: a tração embaixo das portas (${br(o.Tporta / 9.81, 1)} tf) passa do que a cinta 14×10 aguenta: use viga baldrame (ver passo 3 do sistema).` : '4. Junta entre painéis concretada por inteiro. Parede apoiada no bloco com argamassa de assentamento.',
    '5. Concreto da cinta igual ao do painel (mín. C25). Aço CA-50 e CA-60 (ø4.2 e ø5.0).'];
  d.T(24, 246, 'NOTAS', 3, { b: true }); notas.forEach((t, i) => d.T(24, 252 + i * 3.9, t, 2.2));
  carimbo(d, I, 'FUNDAÇÃO — CINTA DAS PORTAS E BASE DAS PAREDES', 'INDICADAS', folha);
  return d.F;
}

// ================= Bloco em 3D: vista geral, peças e montagem =================
const AZ = 28 * Math.PI / 180, EL = 24 * Math.PI / 180;
function vista(ox: number, oy: number, sc: number, cx: number, cy: number) {
  return (x: number, y: number, z: number): XY => { x -= cx; y -= cy; const u = x * Math.cos(AZ) - y * Math.sin(AZ), dep = x * Math.sin(AZ) + y * Math.cos(AZ); return [ox + u * sc, oy + (dep * Math.sin(EL) - z * Math.cos(EL)) * sc]; };
}
type V = ReturnType<typeof vista>;
interface G3 { L: number; Hb: number; A: number; nb: number; nh: number; rf: number; ra: number; nl: number }
const geo = (e: OpEstaca, b: BlocoDet): G3 => ({ L: b.lado * 100, Hb: b.alt * 100, A: b.armLado * 100, nb: Math.max(2, b.barras), nh: b.estrH ?? 0, rf: e.furo * 50, ra: e.armDiam * 50 - 0.5, nl: e.barras });
function pl3(d: D, v: V, p: [number, number, number][], w: number, c = K, fecha = false, dash?: number[]) { d.PL(p.map(q => v(...q)), w, c, fecha, dash); }
function circ3(d: D, v: V, cx: number, cy: number, z: number, r: number, w: number, c = K, dash?: number[]) { const p: [number, number, number][] = []; for (let t = 0; t < 28; t++) p.push([cx + r * Math.cos(t / 28 * 2 * Math.PI), cy + r * Math.sin(t / 28 * 2 * Math.PI), z]); pl3(d, v, p, w, c, true, dash); }
const NOVO = { c: K, w: 0.85 }, VELHO = { c: '#b0b0b0', w: 0.45 };
function p3estaca(d: D, v: V, g: G3, z0: number, c = '#777777', dash: number[] | undefined = [1.2, 0.8]) {
  const m = g.L / 2; circ3(d, v, m, m, 10, g.rf, 0.25, c, dash); circ3(d, v, m, m, z0, g.rf, 0.25, c);
  for (const a of [118, -62]) { const r = a * Math.PI / 180; pl3(d, v, [[m + g.rf * Math.cos(r), m + g.rf * Math.sin(r), z0], [m + g.rf * Math.cos(r), m + g.rf * Math.sin(r), 10]], 0.25, c); }
}
function p3bloco(d: D, v: V, g: G3, c = '#777777', dash: number[] | undefined = [1.2, 0.8]) {
  for (const z of [0, g.Hb]) pl3(d, v, [[0, 0, z], [g.L, 0, z], [g.L, g.L, z], [0, g.L, z]], 0.25, c, true, dash);
  for (const [x, y] of [[0, 0], [g.L, 0], [g.L, g.L], [0, g.L]]) pl3(d, v, [[x, y, 0], [x, y, g.Hb]], 0.25, c, false, dash);
}
function p3N1(d: D, v: V, g: G3, st: { c: string; w: number }, z0: number) {
  const m = g.L / 2;
  for (let i = 0; i < g.nl; i++) { const r = Math.PI / 4 + i * 2 * Math.PI / g.nl, x = m + g.ra * Math.cos(r), y = m + g.ra * Math.sin(r), hx = m + (g.ra - 15) * Math.cos(r), hy = m + (g.ra - 15) * Math.sin(r);
    pl3(d, v, [[x, y, z0], [x, y, g.Hb - 5], [hx, hy, g.Hb - 5]], st.w, st.c); }
}
function p3N2(d: D, v: V, g: G3, st: { c: string; w: number }, z0: number) { for (let z = 5; z > z0; z -= 20) circ3(d, v, g.L / 2, g.L / 2, z, g.ra + 0.5, st.w * 0.6, st.c); }
function p3N3(d: D, v: V, g: G3, st: { c: string; w: number }, dir: 0 | 1) {
  const c0 = (g.L - g.A) / 2, c1 = c0 + g.A, z0 = (g.Hb - g.A) / 2, z1 = z0 + g.A, e = g.A / (g.nb - 1);
  for (let i = 0; i < g.nb; i++) { const s = c0 + i * e;
    pl3(d, v, dir ? [[c0, s, z0], [c1, s, z0], [c1, s, z1], [c0, s, z1]] : [[s, c0, z0], [s, c1, z0], [s, c1, z1], [s, c0, z1]], st.w, st.c, true); }
}
function p3N4(d: D, v: V, g: G3, st: { c: string; w: number }) {
  const c0 = (g.L - g.A) / 2 - 1.7, c1 = g.L - c0, z0 = (g.Hb - g.A) / 2 + 1.5, z1 = z0 + g.A - 3;
  for (let i = 0; i < g.nh; i++) { const z = g.nh > 1 ? z0 + i * (z1 - z0) / (g.nh - 1) : (z0 + z1) / 2; pl3(d, v, [[c0, c0, z], [c1, c0, z], [c1, c1, z], [c0, c1, z]], st.w * 0.8, st.c, true); }
}
function rodape(d: D, I: InfoProj, folha: string) { d.R(10, 7, d.F.w - 17, d.H - 14, 0.7); d.T(d.F.w - 12, d.H - 10, `${I.obra} · ${I.empresa} · ${I.resp} · ${folha}`, 2.5, { a: 'end' }); }

export function folhasBloco3D(I: InfoProj, e: OpEstaca, b: BlocoDet, folhas: [string, string, string]): Pagina[] {
  const g = geo(e, b), m = g.L / 2, pags: Pagina[] = [];
  const temN4 = g.nh > 0, ea = Math.round(e.armComp * 100);
  // ---- 1: vista geral
  { const d = new D(), v = vista(95, 150, 1.0, m, m);
    d.T(22, 22, 'BLOCO B1 + ESTACA — GAIOLA EM 3D', 6, { b: true }); d.T(22, 29, 'Vista em perspectiva · concreto em tracejado cinza · ferros em preto · medidas em cm', 3.2);
    p3estaca(d, v, g, -60); p3N2(d, v, g, { c: K, w: 0.75 }, -60); p3bloco(d, v, g); p3N3(d, v, g, { c: K, w: 0.75 }, 0); p3N3(d, v, g, { c: K, w: 0.75 }, 1); if (temN4) p3N4(d, v, g, { c: K, w: 0.6 }); p3N1(d, v, g, { c: K, w: 0.75 }, -60);
    const lead = (p: [number, number, number], tx: number, ty: number, t: string) => { const [x, y] = v(...p); d.L(x, y, tx, ty, 0.2); d.Cf(x, y, 0.6); d.T(tx + 1, ty + 0.9, t, 2.5, { b: true }); };
    const c0 = (g.L - g.A) / 2;
    lead([c0 + g.A, c0, (g.Hb + g.A) / 2], 160, 82, `N3 — ${2 * g.nb} ø${d1(b.bitola)} estribos em pé ${Math.round(g.A)}×${Math.round(b.armAlt * 100)} (${g.nb} + ${g.nb} cruzados)`);
    if (temN4) lead([c0 + g.A + 1.7, c0 + g.A + 1.7, g.Hb / 2], 160, 118, `N4 — ${g.nh} ø${d1(b.bitH ?? 6.3)} estribos deitados (por fora dos N3)`);
    lead([m + g.ra * Math.cos(Math.PI / 4), m + g.ra * Math.sin(Math.PI / 4), 30], 160, 132, `N1 — ${g.nl} ø${d1(e.bitLong)} esperas da estaca, gancho de 15 cm dentro do bloco`);
    lead([m + g.ra + 0.5, m, -35], 160, 170, `N2 — ø${d1(e.bitEstr)} c/${Math.round(e.espEstr * 100)} estribo circular da estaca`);
    lead([g.L, 0, g.Hb * 0.8], 160, 98, `bloco de concreto ${Math.round(g.L)} × ${Math.round(g.L)} × ${Math.round(g.Hb)} (tracejado)`);
    lead([m, m + g.rf, -50], 160, 190, `estaca Ø${Math.round(e.furo * 100)} (entra 10 cm no bloco)`);
    ['- Cobrimento: 5 cm em todas as faces (a caixa de ferro fica centrada no bloco).', '- Os estribos são amarrados entre si com arame recozido; calços de 5 cm no fundo e nas laterais.', '- As esperas N1 da estaca não podem ser cortadas; ficam por dentro da caixa.', '- A parede apoia direto sobre o bloco com argamassa de assentamento.']
      .forEach((t, i) => d.T(22, 236 + i * 5.2, t, 2.8));
    rodape(d, I, folhas[0]); pags.push(d.F); }
  // ---- 2: peças
  { const d = new D(); d.T(22, 22, 'BLOCO B1 — AS PEÇAS DE FERRO, UMA POR UMA', 6, { b: true }); d.T(22, 29.5, 'Cada ferro como sai da dobra · medidas em cm · quantidade por bloco/estaca', 3.2);
    const cards: XY[] = [[22, 40], [152, 40], [282, 40], [22, 165], [152, 165], [282, 165]];
    const card = (i: number, t: string, q: string, uso: string[]) => { const [x, y] = cards[i]; d.R(x, y, 120, 112, 0.35); d.T(x + 4, y + 8, t, 4, { b: true }); d.T(x + 4, y + 14, q, 3, { b: true }); uso.forEach((l, j) => d.T(x + 4, y + 100 + j * 4.4, l, 2.6)); return [x, y]; };
    const TV = (v: V, p: [number, number, number], t: string, a: 'start' | 'middle' | 'end' = 'middle', dx = 0, dy = 0) => { const [x, y] = v(...p); d.T(x + dx, y + dy, t, 3, { a }); };
    let [x, y] = card(0, `N1 — ø${d1(e.bitLong)}`, `${e.barras} barras por estaca · C = ${ea} cm`, ['Esperas da estaca: ficam em pé dentro da estaca', `e entram ${Math.round(e.noBloco * 100)} cm no bloco, com gancho no topo.`]);
    let v = vista(x + 62, y + 90, 0.33, 0, 0); pl3(d, v, [[0, 0, 0], [0, 0, ea - 15], [15, 0, ea - 15]], 1.0); TV(v, [0, 0, (ea - 15) / 2], String(ea - 15), 'end', -2); TV(v, [7, 0, ea - 15], '15', 'middle', 0, -2);
    [x, y] = card(1, `N2 — ø${d1(e.bitEstr)}`, `${posicoesFund(e, b, 1, 1).nEstr} por estaca · C = ${Math.round((Math.PI * e.armDiam + e.transpEstr) * 100)} cm (anel)`, [`Estribo circular da estaca, de ${Math.round(e.espEstr * 100)} em ${Math.round(e.espEstr * 100)} cm.`, `Diâmetro ${Math.round(e.armDiam * 100)} cm, emenda de ${Math.round(e.transpEstr * 100)}.`]);
    v = vista(x + 62, y + 62, 1.3, 0, 0); circ3(d, v, 0, 0, 0, e.armDiam * 50, 1.0); TV(v, [0, e.armDiam * 50, 0], `ø ${Math.round(e.armDiam * 100)}`, 'middle', 0, 8);
    const A = g.A, Aa = Math.round(b.armAlt * 100);
    [x, y] = card(2, `N3 — ø${d1(b.bitola)}`, `${2 * g.nb} por bloco · C = ${Math.round((2 * b.armLado + 2 * b.armAlt + 2 * (b.gancho ?? 0)) * 100)} cm`, [`Estribo ${Math.round(A)} × ${Aa} que fica EM PÉ.`, `${g.nb} numa direção e ${g.nb} na outra, cruzados.`]);
    v = vista(x + 62, y + 80, 0.95, A / 2, 0); pl3(d, v, [[0, 0, 0], [A, 0, 0], [A, 0, Aa], [0, 0, Aa]], 1.0, K, true); pl3(d, v, [[0, 0, Aa], [5, 0, Aa - 5]], 1.0); TV(v, [A / 2, 0, 0], String(Math.round(A)), 'middle', 0, 5); TV(v, [A, 0, Aa / 2], String(Aa), 'start', 2);
    if (temN4) { [x, y] = card(3, `N4 — ø${d1(b.bitH ?? 6.3)}`, `${g.nh} por bloco · C = ${Math.round((4 * b.armLado + 2 * (b.gancho ?? 0)) * 100)} cm`, [`Estribo ${Math.round(A)} × ${Math.round(A)} que fica DEITADO.`, 'Abraça os N3 por fora: embaixo, meio e em cima.']);
      v = vista(x + 62, y + 62, 0.95, A / 2, A / 2); pl3(d, v, [[0, 0, 0], [A, 0, 0], [A, A, 0], [0, A, 0]], 1.0, K, true); pl3(d, v, [[0, 0, 0], [5, 5, 0]], 1.0); TV(v, [A / 2, 0, 0], String(Math.round(A)), 'middle', 0, 5); TV(v, [A, A / 2, 0], String(Math.round(A)), 'start', 2, 3); }
    [x, y] = card(temN4 ? 4 : 3, 'TUDO JUNTO', 'bloco + estaca montados', ['Caixa de ferro por cima da estaca, com as', 'esperas N1 por dentro.']);
    v = vista(x + 60, y + 66, 0.62, m, m); p3estaca(d, v, g, -35); p3N2(d, v, g, NOVO, -35); p3bloco(d, v, g); p3N3(d, v, g, NOVO, 0); p3N3(d, v, g, NOVO, 1); if (temN4) p3N4(d, v, g, NOVO); p3N1(d, v, g, NOVO, -35);
    [x, y] = card(temN4 ? 5 : 4, 'RESUMO POR BLOCO + ESTACA', '', []);
    const pos = posicoesFund(e, b, 1, 1).pos;
    [...pos.map(p => `${p.n}  ${p.q} ø${d1(p.bit)}  C=${p.c}  (${p.desc.split(' — ')[0]})`), '', `Bloco: concreto ${Math.round(g.L)} × ${Math.round(g.L)} × ${Math.round(g.Hb)}`, `Estaca: Ø${Math.round(e.furo * 100)} × ${Math.round(e.comp * 100)}`, 'Cobrimento: 5 cm'].forEach((l, j) => d.T(x + 6, y + 22 + j * 7, l, 3.2, { b: j < pos.length }));
    rodape(d, I, folhas[1]); pags.push(d.F); }
  // ---- 3: montagem
  { const d = new D(); d.T(22, 22, 'BLOCO B1 — MONTAGEM PASSO A PASSO', 6, { b: true }); d.T(22, 29.5, 'Em cada passo: PRETO GROSSO = o que entra agora · CINZA = o que já estava montado', 3.2);
    type It = [string, boolean];
    const passos: [string, string, string, It[]][] = [
      ['Estaca concretada e arrasada', `As ${e.barras} esperas N1 ficam em pé, saindo`, `${Math.round(e.noBloco * 100)} cm acima da cabeça da estaca.`, [['N1', true], ['N2', true], ['E', false]]],
      [`${g.nb} estribos N3 em pé (direção 1)`, 'Paralelos, distribuídos na largura', 'do bloco.', [['N3a', true]]],
      [`Mais ${g.nb} estribos N3 (direção 2)`, 'Cruzando os primeiros: forma a caixa.', 'Amarrar com arame.', [['N3a', false], ['N3b', true]]],
      ...(temN4 ? [[`${g.nh} estribos N4 deitados, por fora`, 'Embaixo, no meio e em cima,', 'abraçando a caixa. Amarrar.', [['N3a', false], ['N3b', false], ['N4', true]]] as [string, string, string, It[]]] : []),
      ['Gaiola na fôrma, sobre a estaca', `Fôrma ${Math.round(g.L)} × ${Math.round(g.L)} × ${Math.round(g.Hb)}. Calço de 5 cm embaixo`, 'e dos lados. As esperas N1 ficam por dentro.', [['E', false], ['N1', false], ['N3a', false], ['N3b', false], ['N4', false], ['B', true]]],
      ['Concretar o bloco', 'Concreto C25 vibrado. A parede apoia direto', 'em cima do bloco, com argamassa.', [['E', false], ['N1', false], ['N3a', false], ['N3b', false], ['N4', false], ['B', true]]],
    ];
    passos.forEach(([t1, t2, t3, its], i) => {
      const cx = 22 + (i % 3) * 128, cy = 38 + Math.floor(i / 3) * 122;
      d.R(cx, cy, 122, 116, 0.35); d.Cf(cx + 8, cy + 8, 5); d.T(cx + 8, cy + 10, String(i + 1), 5, { a: 'middle', b: true, c: '#ffffff' });
      d.T(cx + 16, cy + 9.5, t1, 3.4, { b: true }); d.T(cx + 4, cy + 105, t2, 2.7); d.T(cx + 4, cy + 110, t3, 2.7);
      const v = vista(cx + 60, cy + 74, 0.85, m, m);
      for (const [nm, nv] of its) { const st = nv ? NOVO : VELHO;
        if (nm === 'E') p3estaca(d, v, g, -35, nv ? K : '#999999'); else if (nm === 'B') p3bloco(d, v, g, nv ? K : '#999999', [1.5, 0.8]);
        else if (nm === 'N1') p3N1(d, v, g, st, -35); else if (nm === 'N2') p3N2(d, v, g, st, -35); else if (nm === 'N3a') p3N3(d, v, g, st, 0); else if (nm === 'N3b') p3N3(d, v, g, st, 1); else if (nm === 'N4' && temN4) p3N4(d, v, g, st); }
    });
    rodape(d, I, folhas[2]); pags.push(d.F); }
  return pags;
}
