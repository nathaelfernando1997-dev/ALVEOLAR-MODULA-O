// Pranchas A3 do detalhamento de armação (paredes ou lajes) e caderno da fábrica (corte, dobra e compra do aço).
import type { Painel, Regras } from './model.ts';
import type { PainelLaje } from './lajes.ts';
import { Folha, type Pagina } from './folhaDoc.ts';
import {
  armarParede, armarLaje, betaParede, trelicasDoPainel, alcas, relacao, pesoPeca, verLaje, verParede, manuseio, tgDaEsp, comp, fam, bitDe, kgmDe, kgRel,
  POS, POSL, COB, ALCA_CAP, COEF_ICA, ALCA_KEY, TG_KG, pp, G_REV, Q_USO, GF, lb, type PecaArm, type Relacao, type VigaTrel,
  escolherPositivo,
} from './armacao.ts';

export interface EntradaArm {
  obra: string; resp: string; pavs: { id: string; nome: string }[]; ps: Painel[]; pl: PainelLaje[]; vigas: VigaTrel[]; regras: Regras;
  espLaje: (p: PainelLaje) => number; balanco?: (p: PainelLaje) => [number, number]; travamento?: (p: Painel) => { L: number; n: number } | null; codP: (p: Painel) => string; codL: (p: PainelLaje) => string; liberado: boolean; trelBorda16: boolean; revisao?: string;   // número da revisão das folhas (padrão 00)
}
type Tipo = { g: (Painel | PainelLaje)[]; a: PecaArm; rel: Relacao; kg: number; vol: number; area: number; alc: [number, number, number][]; ntrab: number; tg: string; esp: number };
export interface LinhaAco { pav: string; codigo: string; tipo: string; pos: string; bit: number | string; qtd: number; c: number }   // c em m
export interface Detalhamento { paginas: Pagina[]; linhas: LinhaAco[]; tipos: number; kg: number; avisos: string[]; reforcos: { codigo: string; tipo: string; txt: string; ok: boolean }[] }

const INK = '#111111';
// cores: inferiores em vermelho/laranja, superiores em azuis; pilar, estribo, verga e contraverga à parte
const COR: Record<string, string> = { VI: '#b03a2e', HI: '#d35400', RI1: '#b03a2e', RI2: '#b03a2e', VS: '#1a5276', VS1: '#1a5276', VS2: '#1a5276', VS3: '#1a5276', HS: '#3949ab',
  PL: '#6e2c00', ES: '#6c3483', VG: '#9a7d0a', CV: '#7d6608', T: '#7d3c98', A: '#c0392b' };
const DUAS_FACES = new Set<string>();   // (antes: posições das 2 faces juntas; agora cada camada tem a sua)
const br = (v: number, n = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: n, maximumFractionDigits: n });
const cm = (v: number) => String(Math.round(v * 1000) / 10).replace('.', ',');
const bitTxt = (b: number | string) => typeof b === 'string' ? b : 'ø' + br(b, 1);

function moldura(F: Folha, conteudo: string, titulo: string, folha: number, total: number, escala: string, E: EntradaArm) {
  F.r(10, 10, 400, 277, { lw: 0.9 });
  const x0 = 230, y0 = 10, w = 180, h = 46;
  F.r(x0, y0, w, h, { fill: '#ffffff', lw: 0.7 });
  for (const yy of [34, 23, 12]) F.seg(x0, y0 + yy, x0 + w, y0 + yy, 0.4);
  F.seg(x0 + 120, y0, x0 + 120, y0 + 23, 0.4); F.seg(x0 + 150, y0, x0 + 150, y0 + 12, 0.4);
  F.t(x0 + 3, y0 + 39.5, 'ALVEOLAR ENGENHARIA', 10, { bold: true });
  F.t(x0 + 3, y0 + 35.8, 'Paredes e lajes alveolares pré-fabricadas em concreto armado', 5.2, { color: '#444444' });
  const lab = (x: number, y: number, s: string) => F.t(x, y, s, 4.6, { color: '#555555' });
  lab(x0 + 3, y0 + 30.2, 'OBRA'); F.t(x0 + 3, y0 + 25.5, E.obra, 7.5, { bold: true });
  lab(x0 + 3, y0 + 19.2, 'CONTEÚDO'); F.t(x0 + 3, y0 + 14.6, conteudo, 7, { bold: true });
  lab(x0 + 123, y0 + 19.2, 'ESCALAS'); F.t(x0 + 123, y0 + 14.6, escala, 7);
  lab(x0 + 3, y0 + 8.2, 'RESPONSÁVEL TÉCNICO'); F.t(x0 + 3, y0 + 3.4, E.resp, 6);
  lab(x0 + 123, y0 + 8.2, 'REVISÃO'); F.t(x0 + 123, y0 + 3.4, E.revisao ?? '00', 7);
  lab(x0 + 153, y0 + 8.2, 'FOLHA'); F.t(x0 + 153, y0 + 3.4, `${String(folha).padStart(2, '0')}/${String(total).padStart(2, '0')}`, 8, { bold: true });
  F.t(15, 279, titulo, 11, { bold: true, va: 'center' });
  F.t(405, 279, E.liberado ? 'LIBERADO PARA PRODUÇÃO' : 'PARA CONFERÊNCIA — NÃO LIBERADO PARA PRODUÇÃO', 6.5, { color: E.liberado ? '#1e8449' : '#b03a2e', ha: 'right', va: 'center', bold: true });
  F.seg(10, 273, 410, 273, 0.5);
}
const tick = (F: Folha, x: number, y: number, c = '#333333', s = 0.7, w = 0.35) => F.seg(x - s, y - s, x + s, y + s, w, c);

function vista(F: Folha, a: PecaArm, alc: [number, number, number][], X0: number, Y0: number, esc: number, laje: boolean) {
  const L = a.L, Hx = a.Hx, P = (x: number, y: number): [number, number] => [X0 + x * esc, Y0 + y * esc];
  for (const [p0, p1] of a.slots) F.poly([P(p0, 0), P(p1, 0), P(p1, Hx(p1)), P(p0, Hx(p0))], { fill: '#eef1f6' });
  for (const [z0, z1] of a.zon) F.poly([P(z0, 0), P(z1, 0), P(z1, Hx(z1)), P(z0, Hx(z0))], { fill: '#dfe6ef' });
  F.poly([P(0, 0), P(L, 0), P(L, Hx(L)), P(0, Hx(0))], { stroke: INK, lw: 0.9 });
  for (const rf of a.ref ?? []) {   // faixa / painel maciço (sem isopor)
    const q = rf.macico ? [P(0, 0), P(L, 0), P(L, Hx(L)), P(0, Hx(0))] : rf.modo === 'longo' ? [P(rf.pos - rf.faixa / 2, rf.i0), P(rf.pos + rf.faixa / 2, rf.i0), P(rf.pos + rf.faixa / 2, rf.i1), P(rf.pos - rf.faixa / 2, rf.i1)]
      : [P(Math.max(0, rf.i0), rf.pos - rf.faixa / 2), P(Math.min(L, rf.i1), rf.pos - rf.faixa / 2), P(Math.min(L, rf.i1), rf.pos + rf.faixa / 2), P(Math.max(0, rf.i0), rf.pos + rf.faixa / 2)];
    F.poly(q, { fill: '#fbe3cf', stroke: '#d35400', lw: 0.5 });
    const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2;
    F.t(cx, cy, rf.macico ? 'PAINEL MACIÇO (sem isopor)' : 'MACIÇO', 4.6, { ha: 'center', va: 'center', bold: true, color: '#d35400', rot: rf.modo === 'longo' && !rf.macico ? 90 : 0 });
  }
  for (const v of a.ab) {
    const [x0, y0] = P(v.x0, v.y0), [x1, y1] = P(v.x1, v.y1);
    F.r(x0, y0, x1 - x0, y1 - y0, { fill: '#ffffff', lw: 0.7 }); F.seg(x0, y0, x1, y1, 0.2, '#888888'); F.seg(x0, y1, x1, y0, 0.2, '#888888');
    if (v.tag !== 'recorte') {
      F.t((x0 + x1) / 2, (y0 + y1) / 2 + 2, v.tag, 6, { ha: 'center', va: 'center', bold: true });
      F.t((x0 + x1) / 2, (y0 + y1) / 2 - 2, `${cm(v.x1 - v.x0)} x ${cm(v.y1 - v.y0)}`, 4.8, { ha: 'center', va: 'center', color: '#444444' });
    }
  }
  const vis = new Set<string>(), PD = laje ? POSL : POS;
  for (const b of a.bars) {
    const k = `${b.f}|${b.x0.toFixed(4)}|${b.y0.toFixed(4)}|${b.x1.toFixed(4)}|${b.y1.toFixed(4)}`; if (vis.has(k)) continue; vis.add(k);
    const dx = b.f === 'VS1' || b.f === 'VS3' ? 0.014 : 0, [x0, y0] = P(b.x0 + dx, b.y0), [x1, y1] = P(b.x1 + dx, b.y1), bt = laje && a.bitPos && b.f === 'VI' ? a.bitPos : PD[b.f]?.[0] ?? 4.2;
    F.seg(x0, y0, x1, y1, bt < 5 ? 0.45 : bt < 6 ? 0.6 : 0.85, COR[b.f]);
  }
  for (const t of a.T) {
    const p0 = t.i0 + COB, p1 = t.i1 - COB, n = Math.max(2, Math.floor((p1 - p0) / 0.10)), pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) { const o = i % 2 ? 0.025 : -0.025, s = p0 + (p1 - p0) * i / n; pts.push(t.vert ? P(t.pos + o, s) : P(s, t.pos + o)); }
    F.l(pts, 0.6, COR.T);
  }
  for (const [x, y, sd] of alc) {
    const [cx, cy] = P(x, y);
    if (sd === 0) { F.arco(cx, cy, 1.5, 0, 360, 0.9, COR.A); F.seg(cx - 1.5, cy, cx + 1.5, cy, 0.6, COR.A); }
    else { F.arco(cx, cy, 1.6, sd > 0 ? 0 : 180, sd > 0 ? 180 : 360, 0.9, COR.A); F.seg(cx - 1.6, cy, cx - 1.6, cy - 2.2 * sd, 0.9, COR.A); F.seg(cx + 1.6, cy, cx + 1.6, cy - 2.2 * sd, 0.9, COR.A); }
  }
  const uniq = (v: number[]) => { const s = [...new Set(v)].sort((p, q) => p - q); return s.filter((x, i) => i === 0 || x - s[i - 1] > 0.004); };
  let base = uniq(a.bars.filter(b => ['VI', 'VS', 'PL'].includes(b.f)).map(b => Math.round(b.x0 * 1000) / 1000));
  if (!base.length) base = uniq(a.bars.filter(b => ['VS1', 'VS3', 'VS2'].includes(b.f)).map(b => Math.round(b.x0 * 1000) / 1000));
  const xs = [0, ...base, L], yd = Y0 - 6;
  F.seg(X0, yd, X0 + L * esc, yd, 0.25, '#333333');
  for (const x of xs) { F.seg(X0 + x * esc, yd - 1.1, X0 + x * esc, yd + 1.1, 0.25, '#333333'); tick(F, X0 + x * esc, yd); }
  for (let i = 0; i < xs.length - 1; i++) if (xs[i + 1] - xs[i] > 0.003) F.t(X0 + (xs[i] + xs[i + 1]) / 2 * esc, yd - 1.4, cm(xs[i + 1] - xs[i]), 4.3, { ha: 'center', va: 'top', rot: 90, color: '#222222' });
  const yt = Y0 - 17;
  F.seg(X0, yt, X0 + L * esc, yt, 0.3, '#333333');
  for (const x of [0, L]) { F.seg(X0 + x * esc, yt - 1.3, X0 + x * esc, yt + 1.3, 0.3, '#333333'); tick(F, X0 + x * esc, yt, '#333333', 0.8, 0.45); }
  F.t(X0 + L * esc / 2, yt + 0.8, cm(L), 6, { ha: 'center', va: 'bottom', bold: true });
  const ys = [0, ...uniq(a.bars.filter(b => ['HI', 'HS', 'VG', 'CV'].includes(b.f)).map(b => Math.round(b.y0 * 1000) / 1000)), Math.min(Hx(0), Hx(L))], xd = X0 - 6;
  F.seg(xd, Y0, xd, Y0 + ys[ys.length - 1] * esc, 0.25, '#333333');
  for (const y of ys) { F.seg(xd - 1.1, Y0 + y * esc, xd + 1.1, Y0 + y * esc, 0.25, '#333333'); tick(F, xd, Y0 + y * esc); }
  for (let i = 0; i < ys.length - 1; i++) if (ys[i + 1] - ys[i] > 0.003) F.t(xd - 1.3, Y0 + (ys[i] + ys[i + 1]) / 2 * esc, cm(ys[i + 1] - ys[i]), 4.3, { ha: 'right', va: 'center', rot: 90, color: '#222222' });
  const xt = X0 - 15;
  F.seg(xt, Y0, xt, Y0 + Hx(0) * esc, 0.3, '#333333');
  for (const y of [0, Hx(0)]) { F.seg(xt - 1.3, Y0 + y * esc, xt + 1.3, Y0 + y * esc, 0.3, '#333333'); tick(F, xt, Y0 + y * esc, '#333333', 0.8, 0.45); }
  F.t(xt - 0.8, Y0 + Hx(0) * esc / 2, cm(Hx(0)), 6, { ha: 'center', va: 'bottom', rot: 90, bold: true });
  for (const v of a.ab) {
    if (v.tag === 'recorte') continue;
    const yv = Y0 + Hx(0) * esc + 4;
    F.l([[X0, yv], [X0 + v.x0 * esc, yv]], 0.2, '#777777', [2, 1]);
    F.t(X0 + v.x0 * esc / 2, yv + 0.6, cm(v.x0), 4.5, { ha: 'center', color: '#555555' });
  }
  return P;
}

function espac(v: number[]) {
  const ds = v.slice(1).map((x, i) => Math.round((x - v[i]) * 100)).filter(x => x <= 45), c = new Map<number, number>();
  for (const x of ds) c.set(x, (c.get(x) ?? 0) + 1);
  return ds.length ? [...c].sort((p, q) => q[1] - p[1])[0][0] : null;
}
function nomear(k: string, c: number, Lc: number, esp: number, laje: boolean) {
  const f = fam(k);
  if (f === 'VS1') return c > 0.6 * Lc * 100 ? 'SUPERIOR · corrido (embaixo de parede de cima)' : `SUPERIOR · só nas pontas (${c} cm em cada ponta)`;
  return (laje ? { VI: `INFERIOR · nervuras e bordas · gancho ${cm(esp - 0.05)} cm nas pontas`, HI: 'INFERIOR · atravessado embaixo',
    HS: 'SUPERIOR · atravessado em cima', VS3: 'SUPERIOR · corrido em cada nervura', VS2: 'SUPERIOR · borda (2 em cada lateral)',
    T: 'treliça · em cima dos ferros de baixo', A: 'alça de içamento · pernas de 50 cm',
    RI1: 'INFERIOR · REFORÇO sob parede de cima', RI2: 'INFERIOR · REFORÇO sob parede de cima' }
    : { VI: 'INFERIOR (face na mesa) · em pé em cada nervura', HI: 'INFERIOR (face na mesa) · deitado', VS: 'SUPERIOR (face de cima) · em pé em cada nervura', HS: 'SUPERIOR (face de cima) · deitado',
    PL: 'pilar: pontas e lados das portas', ES: 'estribo do pilar (7 x 9 cm)', VG: 'verga (2 em cada face)', CV: 'contraverga (2 em cada face)',
    A: 'alça · metade em cima, metade embaixo' } as Record<string, string>)[f] ?? '';
}
function chamadas(F: Folha, a: PecaArm, rel: Relacao, alc: [number, number, number][], P: (x: number, y: number) => [number, number], xlab: number, ybot: number, ytop: number, laje: boolean, tg: string) {
  const STEP = 8.6, alvo: { pt: [number, number]; txt: string; f: string; y: number; k: string; c: number }[] = [], idx = new Map<string, number>(), PD = laje ? POSL : POS;
  for (const [k, Lr, fi] of rel) {
    const f = fi ?? fam(k), [c, q] = Lr[0];
    if (f === 'A') { if (!alc.length) continue; const pt = laje ? P(alc[alc.length - 1][0], alc[alc.length - 1][1]) : P(...[...alc].sort((p, r) => r[1] - p[1] || r[0] - p[0])[0].slice(0, 2) as [number, number]); alvo.push({ pt, txt: `${q} ø8,0 CA-25 liso · ${c} cm`, f, y: pt[1], k, c }); continue; }
    if (f === 'T') { const t = a.T.find(t => Math.round((t.i1 - t.i0 - 2 * COB) * 100) === c) ?? a.T[0]; const m = t.i0 + (t.i1 - t.i0) * 0.6, pt = t.vert ? P(t.pos, m) : P(m, t.pos); alvo.push({ pt, txt: `${q} ${tg} · ${c} cm`, f, y: pt[1], k, c }); continue; }
    let bs = a.bars.filter(b => b.f === f && Math.round(comp(b) * 100) === c); if (!bs.length) bs = a.bars.filter(b => b.f === f);
    const bit = 'ø' + br(laje && a.bitPos && f === 'VI' ? a.bitPos : PD[f][0], 1), qtxt = DUAS_FACES.has(f) && q % 2 === 0 && q > 2 ? `2×${q / 2}` : String(q);
    const i = idx.get(f) ?? 0; idx.set(f, i + 1);
    let pt: [number, number], txt: string;
    const xs = [...new Set(bs.map(b => Math.round(b.x0 * 1000) / 1000))].sort((p, r) => p - r), ys = [...new Set(bs.map(b => Math.round(b.y0 * 1000) / 1000))].sort((p, r) => p - r);
    if (['VI', 'VS', 'VS1', 'VS3'].includes(f) && xs.length >= 2) {
      const esp = espac(xs), y0 = Math.max(...bs.map(b => b.y0)), y1 = Math.min(...bs.map(b => b.y1));
      const fr = ({ VI: 0.22, VS: 0.62, VS1: 0.08, VS3: 0.5 } as Record<string, number>)[f] + 0.13 * i, yy = y0 + (y1 - y0) * Math.min(0.92, fr);
      const [ax, ay] = P(xs[0], yy), [bx, by] = P(xs[xs.length - 1], yy);
      F.seg(ax, ay, bx, by, 0.3, COR[f]); for (const x of xs) tick(F, P(x, yy)[0], ay, COR[f], 0.8, 0.4);
      pt = [bx, by]; txt = `${qtxt} ${bit}` + (esp ? ` · a cada ${esp} cm` : '') + ` · ${c} cm`;
    } else if (['HI', 'HS', 'ES'].includes(f) && ys.length >= 2) {
      let bb = bs; if (f === 'ES') { const mx = Math.max(...bs.map(b => b.x0)); bb = bs.filter(b => b.x0 >= mx - 0.01); }
      const yv = [...new Set(bb.map(b => Math.round(b.y0 * 1000) / 1000))].sort((p, r) => p - r), esp = espac(yv);
      const x0_ = Math.max(...bb.map(b => b.x0)), x1_ = Math.min(...bb.map(b => b.x1)), xx = f !== 'ES' ? x1_ - (x1_ - x0_) * ((f === 'HS' ? 0.32 : 0.12) + 0.1 * i) : (x0_ + x1_) / 2;
      const [ax, ay] = P(xx, yv[0]), [, by] = P(xx, yv[yv.length - 1]);
      F.seg(ax, ay, ax, by, 0.3, COR[f]); for (const y of yv) tick(F, ax, P(xx, y)[1], COR[f], 0.8, 0.4);
      pt = [ax, (ay + by) / 2]; txt = `${qtxt} ${bit}` + (esp ? ` · a cada ${esp} cm` : '') + ` · ${c} cm`;
    } else {
      if (['PL', 'VS2'].includes(f)) { const b = bs.filter(b => Math.round(b.x0 * 1000) / 1000 === xs[xs.length - 1])[0]; pt = P(b.x0, b.y0 + (b.y1 - b.y0) * (f !== 'VS2' ? 0.86 : 0.62)); }
      else if (['VI', 'VS', 'VS1', 'VS3'].includes(f)) { const b = bs[bs.length - 1]; pt = P(b.x0, b.y0 + (b.y1 - b.y0) * 0.5); }
      else { const b = [...bs].sort((p, r) => r.x1 - p.x1 || r.y0 - p.y0)[0]; pt = P(b.x1 - 0.05, b.y0); }
      txt = `${qtxt} ${bit} · ${c} cm`;
    }
    alvo.push({ pt, txt, f, y: pt[1], k, c });
  }
  alvo.sort((p, q) => q.pt[1] - p.pt[1]);
  for (const x of alvo) x.y = Math.min(x.y, ytop);
  for (let i = 1; i < alvo.length; i++) alvo[i].y = Math.min(alvo[i].y, alvo[i - 1].y - STEP);
  if (alvo.length && alvo[alvo.length - 1].y < ybot) {
    const dd = ybot - alvo[alvo.length - 1].y; for (const x of alvo) x.y += dd;
    for (let i = alvo.length - 2; i >= 0; i--) alvo[i].y = Math.max(alvo[i].y, alvo[i + 1].y + STEP);
  }
  for (const { pt, txt, f, y, k, c } of alvo) {
    F.c(pt[0], pt[1], 0.7, COR[f]);
    F.l([pt, [xlab - 3, y], [xlab, y]], 0.28, COR[f]);
    F.arco(xlab + 3.4, y, 2.6, 0, 360, 0.6, COR[f]);
    F.t(xlab + 3.4, y, k, k.length > 3 ? 3.7 : k.length > 2 ? 4.4 : 5.2, { ha: 'center', va: 'center', color: COR[f], bold: true });
    F.t(xlab + 7, y + 1.5, txt, 5.6, { va: 'center', color: COR[f], bold: true });
    F.t(xlab + 7, y - 2.0, nomear(f, c, a.Hx(0), a.esp, laje).replace(/^(INFERIOR|SUPERIOR)( \([^)]*\))? · /, ''), 4.3, { va: 'center', color: '#333333' });   // a camada já está no título da vista
  }
}

function corteA(F: Folha, a: PecaArm, X0: number, Y0: number, laje: boolean) {
  const e = a.esp * 100, W = 62;
  F.t(X0 + W / 2, Y0 + e + (laje ? 14 : 4), 'CORTE A-A (parcial) — 1:10', 6.5, { ha: 'center', bold: true });
  F.r(X0, Y0, W, e, { lw: 0.8 });
  for (const [p0, p1] of a.slots) {
    if (p0 * 100 > W) break;
    if (a.zon.some(([z0, z1]) => z0 <= (p0 + p1) / 2 && (p0 + p1) / 2 <= z1)) continue;
    F.r(X0 + p0 * 100, Y0 + (e - 9) / 2, Math.min(p1 * 100, W) - p0 * 100, 9, { fill: '#e3e7ee', stroke: '#9999aa', lw: 0.3 });
  }
  F.l([[X0 + W + 1.5, Y0 - 1], [X0 + W - 1.5, Y0 + e / 3], [X0 + W + 1.5, Y0 + e * 2 / 3], [X0 + W - 1.5, Y0 + e + 1]], 0.3, '#555555');
  const rb = (bit: number) => bit / 10 / 2 * 1.6;
  for (const x of [...new Set(a.bars.filter(b => b.f === 'VI' && !b.borda && b.x0 * 100 < W).map(b => Math.round(b.x0 * 1000) / 1000))]) {
    if (laje) { const sp = a.sobParede.some(q => Math.abs(x - q) < 0.002); F.c(X0 + x * 100, Y0 + 2.9, rb(a.bitPos ?? 6.3), COR.VI); F.c(X0 + x * 100, Y0 + e - 3.0, rb(sp ? 8 : 5), sp ? COR.VS1 : COR.VS3); }
    else { F.c(X0 + x * 100, Y0 + 3.1, rb(4.2), COR.VI); F.c(X0 + x * 100, Y0 + e - 3.1, rb(4.2), COR.VS); }
  }
  const [z0, z1] = a.zon[0], xc = (z0 + z1) / 2 * 100;
  if (!laje) F.r(X0 + z0 * 100 + 2.5, Y0 + 2.5, (z1 - z0) * 100 - 5, e - 5, { stroke: COR.ES, lw: 0.5 });
  for (const dx of [-3, 3]) {
    if (laje) { F.c(X0 + xc + dx, Y0 + 2.9, rb(a.bitPos ?? 6.3), COR.VI); F.c(X0 + xc + dx, Y0 + e - 3.0, rb(8), COR.VS2); }
    else for (const yy of [2.9, e - 2.9]) F.c(X0 + xc + dx, Y0 + yy, rb(6.3), COR.PL);
  }
  if (laje) {
    const nv = a.bars.filter(b => b.f === 'VI' && !b.borda && b.x0 > 0.25 && b.x0 < 0.5).map(b => b.x0).sort((p, q) => p - q), xa = X0 + (nv.length ? nv[0] * 100 : 40);
    F.seg(xa, Y0 + 3, xa, Y0 + e + 7.2, 0.9, COR.A); F.arco(xa, Y0 + e + 7.2, 0.8, 0, 180, 0.9, COR.A);
    F.seg(xa + 6, Y0 + e, xa + 6, Y0 + e + 8, 0.25, '#333333'); F.t(xa + 7, Y0 + e + 4, '8', 4.8, { va: 'center' });
    F.t(xa + 9.5, Y0 + e + 6.5, 'alça na face superior: sai 8 cm, pernas de 50 cm ao longo da nervura', 4.6, { color: COR.A, va: 'center' });
  }
  F.seg(X0 - 3, Y0, X0 - 3, Y0 + e, 0.25, '#333333'); F.t(X0 - 4, Y0 + e / 2, cm(e / 100), 5, { ha: 'center', va: 'bottom', rot: 90 });
  for (const yy of [0, e]) F.seg(X0 - 4, Y0 + yy, X0 - 2, Y0 + yy, 0.25, '#333333');
  if (!laje) {
    // em cada face: horizontal deitado por fora (encostado nos espaçadores) e vertical em pé por dentro, na nervura
    F.seg(X0 + 1, Y0 + 2.7, X0 + W - 1, Y0 + 2.7, 0.45, COR.HI); F.seg(X0 + 1, Y0 + e - 2.7, X0 + W - 1, Y0 + e - 2.7, 0.45, COR.HS);
    F.t(X0 + W + 3, Y0 + e - 1.2, 'FACE DE CIMA', 4.6, { bold: true, va: 'center' });
    F.t(X0 + W + 3, Y0 + e - 4.2, 'SUPERIOR: HS por fora · VS por dentro', 4.2, { va: 'center', color: '#333333' });
    F.t(X0 + W + 3, Y0 + 4.2, 'INFERIOR: HI por fora · VI por dentro', 4.2, { va: 'center', color: '#333333' });
    F.t(X0 + W + 3, Y0 + 1.2, 'FACE DE BAIXO (na mesa)', 4.6, { bold: true, va: 'center' });
  }
  F.t(X0 + W / 2, Y0 - 3, 'cobrimento 2,5 cm' + (laje ? ' · VI e HI embaixo · VS e HS em cima' : ' · faces iguais: VI/HI embaixo, VS/HS em cima · pilar PL + estribo ES'), 4.8, { ha: 'center', va: 'top', color: '#333333' });
}

function tabela(F: Folha, rel: Relacao, qtd: number, X0: number, Ytop: number, laje: boolean, tg: string, esp: number, W = 137, pos?: number) {
  const nl = rel.reduce((s, [, L]) => s + L.length, 0), cols: [string, number][] = [['POS.', 12], ['BIT.', 14], ['QUANT.', 13], ['C. UNIT.', 15], ['C. TOT. (m)', 18], ['PESO (kg)', 17]], h = Math.min(5.2, 66 / Math.max(1, nl));
  F.t(X0 + W / 2, Ytop + 1.6, `RELAÇÃO DO AÇO — POR PEÇA (x ${qtd} peça${qtd > 1 ? 's' : ''})`, 6.8, { ha: 'center', bold: true });
  F.r(X0, Ytop - 4.2, W, 4.2, { fill: '#1f3b57', stroke: '#1f3b57', lw: 0.5 });
  let x = X0;
  for (const [c, w] of cols) { F.t(x + w / 2, Ytop - 2.1, c, 5, { ha: 'center', va: 'center', color: '#ffffff', bold: true }); x += w; }
  F.t(x + (X0 + W - x) / 2, Ytop - 2.1, 'FORMA (cm)', 5, { ha: 'center', va: 'center', color: '#ffffff', bold: true });
  let y = Ytop - 4.2, kgT = 0;
  for (const [k, L, fi] of rel) for (const [c, q] of L) {
    y -= h; const f = fi ?? fam(k), kg = c / 100 * q * kgmDe(f, laje, tg, pos); kgT += kg;
    const bt = bitDe(f, laje, tg, pos), vals = [k, f === 'A' ? 'ø8,0 L' : bitTxt(bt), String(q), String(c), br(c * q / 100), br(kg)];
    x = X0;
    cols.forEach(([cc, w], i) => { F.t(x + w / 2, y + h / 2, vals[i], 5.4, { ha: 'center', va: 'center', color: cc === 'POS.' ? COR[f] : INK, bold: cc === 'POS.' }); x += w; });
    const fx = x + 3, fw = X0 + W - fx - 3, ym = y + h / 2;
    if (f === 'ES') { F.r(fx + fw / 2 - 5, y + 1, 10, h - 2, { stroke: COR[f], lw: 0.6 }); F.t(fx + fw / 2 + 6, ym, '7 x 9 + ganchos 5', 4.4, { va: 'center' }); }
    else if (f === 'T') F.l(Array.from({ length: 11 }, (_, i) => [fx + i * fw / 10, ym + (i % 2 ? 0.9 : -0.9)] as [number, number]), 0.45, COR[f]);
    else if (f === 'A') { const cx = fx + fw / 2; F.arco(cx, ym + 0.6, 1.5, 0, 180, 0.8, COR[f]); F.seg(cx - 1.5, ym + 0.6, cx - 1.5, ym - 1.6, 0.8, COR[f]); F.seg(cx + 1.5, ym + 0.6, cx + 1.5, ym - 1.6, 0.8, COR[f]); F.t(cx + 4, ym, laje ? 'pernas 50 + laço (8 fora)' : 'pernas 35 + laço', 4.4, { va: 'center' }); }
    else if (laje && (f === 'VI' || f === 'RI1' || f === 'RI2')) { const G = Math.round((esp - 0.05) * 100); F.l([[fx + 4, ym + 1.6], [fx + 4, ym - 1.2], [fx + fw - 4, ym - 1.2], [fx + fw - 4, ym + 1.6]], 0.9, COR[f]); F.t(fx + fw / 2, ym - 0.7, `${G} | ${c - 2 * G} | ${G}`, 4.4, { ha: 'center', va: 'bottom' }); }
    else { F.seg(fx + 2, ym - 0.6, fx + fw - 2, ym - 0.6, 0.9, COR[f]); F.t(fx + fw / 2, ym - 0.1, String(c), 4.4, { ha: 'center', va: 'bottom' }); }
    F.seg(X0, y, X0 + W, y, 0.15, '#999999');
  }
  F.r(X0, y, W, Ytop - y, { lw: 0.5 });
  y -= 4.2;
  F.t(X0 + 2, y + 2.1, `AÇO POR PEÇA: ${br(kgT, 1)} kg   ·   ${qtd} peça${qtd > 1 ? 's' : ''}: ${br(kgT * qtd, 1)} kg`, 6, { va: 'center', bold: true });
  return { y, kgT };
}

export function detalhar(E: EntradaArm, laje: boolean): Detalhamento {
  const R = E.regras, PD = laje ? POSL : POS, avisos: string[] = [];
  const idxPav = new Map(E.pavs.map((p, i) => [p.id, i])), nomePav = new Map(E.pavs.map(p => [p.id, p.nome]));
  const espPar = (R.isoporAlt ?? 0.09) + 2 * (R.capeamento ?? 0.025);
  const espDoPav = (pid: string) => Math.max(R.lajeEsp ?? 0.14, ...E.pl.filter(p => p.pav === pid).map(E.espLaje));
  const cargaParede = (i: number, H: number) => {
    const trib = Math.max(3.0, ...E.pl.filter(q => (idxPav.get(q.pav) ?? 0) >= i).map(q => q.comp));
    const lajes = E.pavs.filter(p => (idxPav.get(p.id) ?? 0) >= i).reduce((s, p) => s + pp(espDoPav(p.id)) + G_REV + Q_USO, 0);
    return lajes * trib + (E.pavs.length - 1 - i) * pp(0.14) * H;
  };
  // carga (kN/m) da parede do pavimento de cima que fica em cima da laje do pavimento i (sem parede embaixo)
  const cargaLinha = (pid: string) => {
    const i = (idxPav.get(pid) ?? 0) + 1; if (i >= E.pavs.length) return 0;
    const acima = E.pl.length ? E.pl : [], vs = acima.filter(q => (idxPav.get(q.pav) ?? 0) >= i).map(q => q.comp), trib = vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 3.0;
    const H = 3.0, lajes = E.pavs.filter(p => (idxPav.get(p.id) ?? 0) >= i).reduce((s, p) => s + pp(espDoPav(p.id)) + G_REV + Q_USO, 0);
    return lajes * trib + (E.pavs.length - i) * pp(espPar) * H;
  };
  // tipos (peças iguais)
  const grupos = new Map<string, Tipo>();
  const vigasT = E.vigas;
  if (laje) for (const p of E.pl) {
    const esp = E.espLaje(p), tg = tgDaEsp(esp), T = trelicasDoPainel(p, vigasT, tg), a = armarLaje(p, T, R, esp, E.trelBorda16 && esp >= 0.16 - 1e-6, cargaLinha(p.pav));
    a.bal = E.balanco?.(p) ?? [0, 0];
    a.bitPos = escolherPositivo(a, esp, R.lajeApoio ?? 0.06, a.bal).bit;   // positivo pela verificação (ø6,3 → ø8,0 → ø10,0)
    const k = JSON.stringify([esp, a.bitPos, a.bal.map(v => Math.round(v * 100)), Math.round(p.larg * 100), Math.round(p.comp * 100), p.dente ?? null, a.T.map(t => [t.vert, Math.round(t.pos * 100), Math.round(t.i0 * 100), Math.round(t.i1 * 100)]).sort(), (a.ref ?? []).map(r => r.txt)]);
    const g = grupos.get(k); if (g) { g.g.push(p); continue; }
    const area = p.comp * p.larg - (p.dente ? (p.dente.x1 - p.dente.x0) * (p.dente.y1 - p.dente.y0) : 0), w = pesoPeca(p.larg, p.comp, area, [], esp, R);
    const fIso = (R.isoporLarg ?? 0.12) / ((R.isoporLarg ?? 0.12) + (R.isoporEspaco ?? 0.03)) * (R.isoporAlt ?? 0.09);   // m³ de isopor por m² de laje
    for (const rf of a.ref ?? []) { const ex = (rf.macico ? p.larg * p.comp : rf.modo === 'longo' ? rf.faixa * (rf.i1 - rf.i0) : rf.faixa * Math.min(p.larg, rf.i1 - rf.i0)) * fIso; w.vol += ex; w.kg += ex * (R.densidade ?? 2500); }
    const al = alcas(a, w.kg, true);
    grupos.set(k, { g: [p], a, rel: relacao(a, al.pts.length, true), kg: w.kg, vol: w.vol, area: w.area, alc: al.pts, ntrab: al.ntrab, tg, esp });
  } else for (const p of E.ps) {
    const k = JSON.stringify([Math.round(p.larg * 100), Math.round(p.H * 100), p.chanfro ?? null, p.recortes.map(q => [q.tipo, Math.round(q.dl * 100), Math.round(q.w * 100), Math.round(q.base * 100), Math.round(q.h * 100)])]);
    const g = grupos.get(k); if (g) { g.g.push(p); continue; }
    const a = armarParede(p, R), Hm = p.chanfro ? (p.chanfro.ha + p.chanfro.hb) / 2 : p.H, w = pesoPeca(p.larg, Hm, p.larg * Hm, p.recortes.map(q => ({ w: q.w, h: q.h })), espPar, R);
    const al = alcas(a, w.kg, false);
    grupos.set(k, { g: [p], a, rel: relacao(a, al.pts.length, false), kg: w.kg, vol: w.vol, area: w.area, alc: al.pts, ntrab: al.ntrab, tg: 'TG8', esp: espPar });
  }
  const tipos = [...grupos.values()], pref = laje ? 'LJ' : 'PA', NT = tipos.length, TOTAL = 2 * NT + 3;   // 2 folhas por tipo: jogo inferior (VI · HI) e jogo superior (VS · HS)
  const cod = (p: Painel | PainelLaje) => laje ? E.codL(p as PainelLaje) : E.codP(p as Painel);
  const pags: Pagina[] = [], linhas: LinhaAco[] = [];
  // verificações por tipo
  const ver = tipos.map(t => {
    const L = t.a.L, Lc = t.a.Hx(0);
    if (laje) {
      const nn = new Set(t.a.bars.filter(b => b.f === 'VI' && !b.borda).map(b => Math.round(b.x0 * 1000))).size, c = verLaje(Lc, L, nn, t.esp, t.a.bitPos ?? PD.VI[0], R.lajeApoio ?? 0.06, t.a.bal), mh = manuseio(Lc * 0.6, t.esp);
      return { ok: c.ok_As && c.ok_f && c.ok_V && c.ok_anc && mh.ok, txt: `Md ${br(c.Md)} kN.m · As ${br(c.As_nec)} <= ${br(c.As_ef)} cm² · flecha ${br(c.f)} <= ${br(c.flim)} cm · Vd ${br(c.Vd)} <= ${br(c.VRd)} kN/nerv. · ancoragem ${br(c.ancor_disp / 10, 1)} >= ${br(c.lb_min / 10, 0)} cm · içamento ${br(mh.sigma)} <= ${br(mh.lim)} MPa` };
    }
    const pvi = Math.min(...t.g.map(q => idxPav.get(q.pav) ?? 0)), trav = t.g.map(q => E.travamento?.(q as Painel) ?? null).sort((p, q) => betaParede(Lc, q) - betaParede(Lc, p))[0];   // a peça do tipo menos travada
    const c = verParede(Lc, t.esp, cargaParede(pvi, Lc), trav), mh = manuseio(Lc, t.esp, t.alc.some(p => p[2] === 0) ? 0.21 * Lc : 0);
    return { ok: c.ok_lam && c.ok_N && mh.ok, txt: `esbeltez ${br(c.lam, 0)} <= 86 (le = ${br(c.beta, 2)}·H${trav?.n ? `, travada em ${trav.n} borda${trav.n > 1 ? 's' : ''}, L = ${br(trav.L)} m` : ''}) · Nd ${br(c.Nd, 0)} <= NRd ${br(c.NRd, 0)} kN/m · desforma ${br(mh.sigma)} <= ${br(mh.lim)} MPa` };
  });
  if (laje) tipos.forEach((t, i) => { for (const rf of t.a.ref ?? []) if (!rf.ok) avisos.push(`${pref}-${String(i + 1).padStart(2, '0')} (${t.g.map(cod).join(', ')}): parede de cima ${rf.modo === 'longo' ? 'ao longo do vão' : 'atravessando'} com ${br(rf.q, 1)} kN/m — ${rf.txt}`); });
  tipos.forEach((t, i) => { if (!ver[i].ok) avisos.push(`${pref}-${String(i + 1).padStart(2, '0')}: verificação não atendida (${ver[i].txt})`); if (t.kg * COEF_ICA / t.ntrab > ALCA_CAP) avisos.push(`${pref}-${String(i + 1).padStart(2, '0')}: peso por alça acima do limite`); });
  // ---- folha 01: capa / notas ----
  {
    const F = new Folha(); moldura(F, `NOTAS GERAIS — ${laje ? 'LAJES' : 'PAREDES'}`, `DETALHAMENTO DA ARMAÇÃO — ${laje ? 'LAJES' : 'PAREDES'}`, 1, TOTAL, '—', E);
    const N = laje ? [
      `MATERIAIS: concreto fck 30 MPa · aço CA-50 (ø6,3, ø8,0${tipos.some(t => (t.a.bitPos ?? 0) >= 10) ? ' e ø10,0' : ''}) e CA-60 (ø4,2 e ø5,0) · alças de içamento em aço CA-25 liso ø8,0 · treliças TG conforme espessura.`,
      'COBRIMENTO: 2,5 cm (pastilhas de 2,5 cm embaixo; apoios na camada de cima).',
      `ESPESSURAS: ${[...new Set(tipos.map(t => cm(t.esp)))].join(' / ')} cm · isopor 12 x 9 cm a cada 15 cm · capas de concreto em cima e embaixo do isopor.`,
      `NOMES DAS POSIÇÕES: V = vertical (no comprimento da laje) · H = horizontal (atravessado) · I = inferior (embaixo) · S = superior (em cima). Monte primeiro tudo que é I, depois tudo que é S.`,
      `VI (vertical inferior, positivo nas nervuras e nas 2 bordas): ${[...new Set(tipos.map(t => t.a.bitPos ?? PD.VI[0]))].sort((x, y) => x - y).map(v => 'ø' + br(v, 1)).join(' / ')} conforme o vão (o sistema escolhe o menor que passa na verificação; ver cada folha), com gancho a 90° nas 2 pontas subindo até a capa de cima.`,
      'VS (vertical superior): ø8,0 nas pontas (1/4 do vão) ou corrido nas nervuras embaixo de parede do pavimento de cima · ø5,0 corrido em cada nervura · 2 ø8,0 em cada borda (na folha: VSa, VSb, VSc).',
      'HI e HS (horizontal inferior e superior): ø4,2 atravessado a cada 30 cm, embaixo e em cima.',
      'TRELIÇAS: embaixo das paredes do pavimento de cima, na posição de cada folha' + (E.trelBorda16 ? '; lajes de 16 cm ou mais: treliça também nas 2 laterais de cada painel.' : '.'),
      'REFORÇO SOB PAREDE DE CIMA (VI a mais, ø10 ou ø12,5): onde a parede do pavimento de cima fica em cima da laje sem parede embaixo, faixa maciça (sem isopor) e ferro a mais embaixo, conforme a folha de cada laje.',
      'ALÇAS: 4 na face de cima (6 ou 8 nos painéis pesados, com parte maciça), pernas de 50 cm ao longo da nervura, laço saindo 8 cm.',
      'ORDEM: 1º jogo INFERIOR (VI, HI) → treliças → isopor → 2º jogo SUPERIOR (VS, HS) → alças → conferir → concretar.',
      'DESFORMA / IÇAMENTO: com fcj >= 15 MPa · cura mínima de 3 dias com a peça úmida.',
    ] : [
      'MATERIAIS: concreto fck 30 MPa · aço CA-50 (ø6,3) e CA-60 (ø4,2) · alças de içamento em aço CA-25 liso ø8,0.',
      `COBRIMENTO: 2,5 cm · espessura da parede ${cm(espPar)} cm (isopor 12 x 9 cm a cada 15 cm).`,
      'NOMES DAS POSIÇÕES: V = vertical (em pé) · H = horizontal (deitado) · I = inferior (face de baixo, na mesa) · S = superior (face de cima).',
      'VI e VS: ø4,2 em pé em cada nervura · HI e HS: ø4,2 deitado a cada 25 cm · as 2 faces são iguais · em cada face o H vai por FORA (perto do concreto) e o V por DENTRO, na nervura.',
      'PILAR (PL + estribo ES): 4 ø6,3 + estribo ø4,2 a cada 20 cm nas 2 pontas da parede e dos lados das portas (isopor cortado onde o pilar entra).',
      'VERGA (VG) e CONTRAVERGA (CV): 4 ø6,3 (2 em cada face) em cima das portas/janelas e embaixo das janelas, passando L/5 para cada lado.',
      'ALÇAS: 4 em cima + 4 embaixo (2 + 2 em peça com menos de 1,20 m; mais alças em peça pesada), fora das portas.',
      'PAREDE ALTA (que não pode sair da mesa pelas pontas): + 4 alças de DESFORMA na face de cima, a 21% da altura de cada ponta · tirar da mesa deitada por elas e só depois virar pelas alças da ponta.',
      'ESBELTEZ: comprimento de flambagem pela NBR 16055, com a parede travada nas bordas pelas paredes perpendiculares (ver verificações) · montar e escorar até ligar com as paredes do encontro e a laje.',
      'ORDEM: espaçadores → INFERIOR (HI nos espaçadores, VI por cima) → pilares e vergas → isopor → SUPERIOR (VS, depois HS por fora) → alças → concretar.',
      'DESFORMA / IÇAMENTO: com fcj >= 15 MPa · cura mínima de 3 dias com a peça úmida.',
    ];
    F.t(15, 262, 'NOTAS GERAIS', 8, { bold: true });
    N.forEach((s, i) => F.t(15, 254 - i * 6.2, `${i + 1}. ${s}`, 6.4));
    let y = 254 - N.length * 6.2 - 8;
    F.t(15, y, 'HIPÓTESES DE CÁLCULO (NBR 6118 / NBR 9062 / NBR 6120)', 8, { bold: true }); y -= 7;
    for (const s of [`Concreto fck 30 MPa (γc 1,4) · aço CA-50/CA-60 (γs 1,15) · ações γf ${br(GF, 1)} · revestimento ${br(G_REV, 1)} kN/m² · sobrecarga ${br(Q_USO, 1)} kN/m².`,
      laje ? 'Laje: painel biapoiado, vão = comprimento do painel, seção I por nervura (15 cm); flecha na combinação quase permanente com fluência (L/250).' : 'Parede: compressão com redução simplificada de 0,6 (esbeltez/excentricidade) e carga dos pavimentos de cima (paredes + lajes).',
      `Ancoragem: lb ø4,2 = ${br(lb(4.2, 60) / 10, 0)} cm · ø6,3 = ${br(lb(6.3) / 10, 0)} cm · ø8,0 = ${br(lb(8) / 10, 0)} cm · ø10,0 = ${br(lb(10) / 10, 0)} cm (boa aderência).`,
      'Paredes do pavimento de cima apoiadas na laje: reforço com treliça na posição indicada (e faixa maciça quando indicada no projeto).']) { F.t(15, y, s, 6.2); y -= 6; }
    F.t(15, y - 4, `ÍNDICE: ${NT} tipos (${pref}-01 a ${pref}-${String(NT).padStart(2, '0')}) · ${tipos.reduce((s, t) => s + t.g.length, 0)} peças · folhas 02 a ${String(2 * NT + 1).padStart(2, '0')} (2 por tipo: inferior e superior) · resumo do aço na folha ${String(TOTAL - 1).padStart(2, '0')} · verificações na folha ${String(TOTAL).padStart(2, '0')}.`, 6.6, { bold: true });
    pags.push(F);
  }
  // ---- tipos ----
  tipos.forEach((t, it) => [0, 1].forEach(jogo => {
    const F = new Folha(), a = t.a, g = t.g, qtd = g.length, L = a.L, Hm = Math.max(a.Hx(0), a.Hx(L)), nome = `${pref}-${String(it + 1).padStart(2, '0')}`;
    const esc = [20, 25, 30, 40, 50, 75].find(e => L * 1000 / e <= 97 && Hm * 1000 / e <= 130) ?? 75, m = 1000 / esc;   // 2 vistas por folha
    moldura(F, `ARMAÇÃO ${laje ? 'DA LAJE' : 'DO PAINEL'} ${nome}`, `${laje ? 'LAJE' : 'PAREDE'} TIPO ${nome} — ${cm(L)} x ${cm(Hm)}${laje ? ' x ' + cm(t.esp) : ''} cm — ${qtd} peça${qtd > 1 ? 's' : ''} — ${jogo ? 'FOLHA 2/2: JOGO SUPERIOR (VS · HS)' : 'FOLHA 1/2: JOGO INFERIOR (VI · HI)'}`, 2 + 2 * it + jogo, TOTAL, `vistas 1:${esc} · corte 1:10`, E);
    const cods = g.map(cod).join(', ');
    F.t(15, 267.5, 'PEÇAS DESTE TIPO:', 6.2, { bold: true }); F.t(45, 267.5, cods.length < 150 ? cods : cods.slice(0, 150) + ' …', 6.6, { bold: true, color: '#1f3b57' });
    // 4 vistas, uma para cada camada e direção, na ordem de montagem
    const GR: [string, string[], string][] = laje ? [['1º  VI · VERTICAL INFERIOR + TRELIÇAS', ['VI', 'RI1', 'RI2', 'T'], '#b03a2e'], ['2º  HI · HORIZONTAL INFERIOR', ['HI'], '#d35400'],
      ['3º  VS · VERTICAL SUPERIOR + ALÇAS', ['VS1', 'VS3', 'VS2', 'A'], '#1a5276'], ['4º  HS · HORIZONTAL SUPERIOR', ['HS'], '#3949ab']]
      : [['1º  VI · VERTICAL INFERIOR + PILARES', ['VI', 'PL', 'ES'], '#b03a2e'], ['2º  HI · HORIZONTAL INFERIOR + VERGAS', ['HI', 'VG', 'CV'], '#d35400'],
      ['3º  VS · VERTICAL SUPERIOR + ALÇAS', ['VS', 'A'], '#1a5276'], ['4º  HS · HORIZONTAL SUPERIOR', ['HS'], '#3949ab']];
    const W = L * m, X0 = 36, passo = Math.max(W + 74 + 26, 185), Y0 = 118 + (130 - Hm * m) / 2;
    GR.slice(2 * jogo, 2 * jogo + 2).forEach(([tit, fams, cor], i) => {
      const x0 = X0 + i * passo, as: PecaArm = { ...a, bars: a.bars.filter(b => fams.includes(b.f)), T: fams.includes('T') ? a.T : [] };
      F.r(x0 - 6, Y0 + Hm * m + 7.5, Math.max(W + 70, 120), 6.6, { fill: cor, stroke: cor, lw: 0 }); F.t(x0 - 4, Y0 + Hm * m + 10.8, tit, 7, { va: 'center', color: '#ffffff', bold: true });
      const alc = fams.includes('A') ? t.alc : [], P = vista(F, as, alc, x0, Y0, m, laje);
      const rl: Relacao = t.rel.filter(([k, , fi]) => fams.includes(fi ?? fam(k)));
      chamadas(F, as, rl, alc, P, x0 + W + 6, Y0 - 2, Y0 + Hm * m + 2, laje, t.tg);
    });
    if (!laje) F.t(15, 100.5, 'AS DUAS FACES SÃO IGUAIS: INFERIOR (VI, HI) na mesa e SUPERIOR (VS, HS) em cima · em cada face o H (deitado) vai por FORA e o V (em pé) por DENTRO, na nervura', 5.6, { bold: true, color: '#1e8449' });
    F.seg(15, 97, 405, 97, 0.3, '#999999');
    const { kgT } = tabela(F, t.rel, qtd, 15, 88, laje, t.tg, t.esp, undefined, t.a.bitPos);
    const kpa = t.kg * COEF_ICA / t.ntrab, xd = 158;
    F.t(xd, 91, 'DADOS DA PEÇA', 6.4, { bold: true });
    [`Medida: ${cm(L)} x ${cm(Hm)} x ${cm(t.esp)} cm`, `Peso: ${br(t.kg, 0)} kg · concreto ${br(t.vol, 3)} m³`, `Aço: ${br(kgT, 1)} kg por peça`,
      laje ? `Alças: ${t.alc.length} na face de cima` : (() => { const nf = t.alc.filter(p => p[2] === 0).length, nb = (t.alc.length - nf) / 2; return `Alças: ${nb} em cima + ${nb} embaixo${nf ? ` + ${nf} na face (desforma)` : ''}`; })(), `Espaçadores: ${Math.ceil(t.area * 4)} pastilhas de 2,5 cm`, ...(() => { const f = t.alc.filter(p => p[2] === 0); if (laje || !f.length) return [];
        const ys = [...new Set(f.map(p => Math.round(p[1] * 100)))].sort((p, q) => p - q), xs = [...new Set(f.map(p => Math.round(p[0] * 100)))].sort((p, q) => p - q);
        void xs; const em = (y: number) => f.filter(p => Math.round(p[1] * 100) === y).map(p => Math.round(p[0] * 100)).sort((p, q) => p - q).join(' e ');
        return [`Desforma (face de cima, cm da borda esq.): ${ys[0]} do pé em ${em(ys[0])} · ${Math.round(Hm * 100) - ys[ys.length - 1]} do topo em ${em(ys[ys.length - 1])}`]; })()]
      .forEach((s, i) => F.t(xd, 86.5 - i * 3.9, s, 5.8));
    const dsf = !laje && t.alc.some(p => p[2] === 0) ? 3.9 : 0;   // linha a mais nos dados (alças de desforma)
    F.t(xd, 64 - dsf, 'ORDEM DE MONTAGEM', 6.4, { bold: true });
    (laje ? ['1. Espaçadores de 2,5 cm na forma', '2. Jogo INFERIOR (folha 1/2): VI e HI', '3. Treliças em cima dos ferros de baixo', '4. Isopor entre as nervuras', '5. Jogo SUPERIOR (folha 2/2): VS e HS', '6. Alças na face de cima · conferir e concretar']
      : ['1. Espaçadores de 2,5 cm na forma', '2. INFERIOR: HI deitado nos espaçadores, VI em pé por cima', '3. Pilares (PL + estribos ES) e vergas (VG / CV)', '4. Isopor entre as nervuras (VI fica na nervura)', '5. SUPERIOR: VS nas nervuras, HS deitado por cima', '6. Alças · conferir e concretar'])
      .forEach((s, i) => F.t(xd, 59.5 - dsf - i * (dsf ? 3.5 : 3.9), s, 5.6));
    if (laje && t.a.ref?.length) {
      const wrap = (txt: string, n = 64) => { const o: string[] = []; let c = ''; for (const w of txt.split(' ')) { if ((c + ' ' + w).trim().length > n) { o.push(c); c = w; } else c = (c + ' ' + w).trim(); } if (c) o.push(c); return o; };
      let yy = 30;
      F.t(158, yy, 'REFORÇO EMBAIXO DE PAREDE DO PAVIMENTO DE CIMA', 6, { bold: true, color: '#d35400' });
      for (const rf of t.a.ref.slice(0, 3)) {
        yy -= 3.6; F.t(158, yy, `Parede ${rf.modo === 'longo' ? 'ao longo do vão' : 'atravessando o painel'} · ${br(rf.q, 1)} kN/m · Md ${br(rf.Md, 1)} kN.m${rf.modo === 'atravessa' ? '/m' : ''}`, 5.2);
        for (const ln of wrap(rf.txt)) { yy -= 3.3; F.t(158, yy, ln, 5.4, { bold: true, color: rf.ok ? '#d35400' : '#b03a2e' }); }
      }
    }
    const ok = ver[it].ok && kpa <= ALCA_CAP && (t.a.ref ?? []).every(r => r.ok);
    F.t(xd, 35.5, ok ? `Cálculo conferido ✓ (verificações na folha ${String(TOTAL).padStart(2, '0')})` : 'ATENÇÃO: verificação não atendida — ver folha de verificações', 5.6, { color: ok ? '#1e8449' : '#b03a2e', bold: true });
    corteA(F, a, 262, 64, laje);
    if (jogo === 0) for (const q of g) for (const [k, Lr, fi] of t.rel) for (const [c, n] of Lr) linhas.push({ pav: nomePav.get(q.pav) ?? q.pav, codigo: cod(q), tipo: nome, pos: k, bit: bitDe(fi ?? k, laje, t.tg, t.a.bitPos), qtd: n, c: c / 100 });
    pags.push(F);
  }));
  // ---- resumo do aço ----
  const TB = new Map<string, { b: number | string; m: number; kg: number }>();
  let kgTot = 0, areaTot = 0;
  {
    const F = new Folha(); moldura(F, `RESUMO DO AÇO — ${laje ? 'LAJES' : 'PAREDES'}`, `RESUMO GERAL DO AÇO — ${laje ? 'LAJES' : 'PAREDES'}`, TOTAL - 1, TOTAL, '—', E);
    const cab = (dx: number) => ([[15, 'TIPO'], [35, 'MEDIDAS (cm)'], [70, 'PEÇAS'], [84, 'PESO PEÇA'], [104, 'AÇO/PEÇA'], [124, 'AÇO TOTAL']] as [number, string][]).forEach(([x, s]) => F.t(x + dx, 262, s, 6.2, { bold: true }));
    cab(0); let col = 0, yy = 262;
    tipos.forEach((t, i) => {
      yy -= 3.6; if (yy < 75) { col++; yy = 262 - 3.6; cab(col * 140); }
      const ka = kgRel(t.rel, laje, t.tg, t.a.bitPos), dx = col * 140, Hm = Math.max(t.a.Hx(0), t.a.Hx(t.a.L));
      ([[15, `${pref}-${String(i + 1).padStart(2, '0')}`], [35, `${cm(t.a.L)} x ${cm(Hm)}`], [72, String(t.g.length)], [84, `${br(t.kg, 0)} kg`], [104, `${br(ka, 1)} kg`], [124, `${br(ka * t.g.length, 1)} kg`]] as [number, string][])
        .forEach(([x, s]) => F.t(x + dx, yy, s, 5.6));
      areaTot += t.area * t.g.length;
      for (const [k, Lr, fi] of t.rel) for (const [c, q] of Lr) {
        const b = bitDe(fi ?? k, laje, t.tg, t.a.bitPos), key = String(b), o = TB.get(key) ?? { b, m: 0, kg: 0 };
        o.m += c / 100 * q * t.g.length; o.kg += c / 100 * q * t.g.length * kgmDe(fi ?? k, laje, t.tg, t.a.bitPos); TB.set(key, o);
      }
    });
    const yb = 66, xs = [15, 37, 55, 77, 99];
    F.t(15, yb, 'RESUMO POR BITOLA', 7, { bold: true });
    ['BITOLA', 'AÇO', 'COMPR. (m)', 'PESO (kg)', 'BARRAS 12 m*'].forEach((s, i) => F.t(xs[i], yb - 5, s, 5.6, { bold: true }));
    let yl = yb - 5;
    for (const o of [...TB.values()].sort((p, q) => (typeof p.b === 'string' ? 1 : 0) - (typeof q.b === 'string' ? 1 : 0) || (typeof p.b === 'number' && typeof q.b === 'number' ? p.b - q.b : 0))) {
      yl -= 4; kgTot += o.kg;
      const aco = typeof o.b === 'string' ? (o.b === ALCA_KEY ? 'CA-25 liso' : 'treliça') : o.b < 6 ? 'CA-60' : 'CA-50';
      [bitTxt(o.b), aco, br(o.m, 1), br(o.kg, 1), String(Math.ceil(o.m / 12 * 1.03))].forEach((s, i) => F.t(xs[i], yl, s, 5.8));
    }
    F.t(15, yl - 6, `TOTAL: ${br(kgTot, 1)} kg de aço · ${br(kgTot / Math.max(areaTot, 0.01))} kg/m²`, 7, { bold: true });
    F.t(15, yl - 10.5, '* estimativa; a quantidade exata de barras sai do plano de corte (caderno da fábrica).', 5.2, { color: '#555555' });
    pags.push(F);
  }
  // ---- verificações ----
  {
    const F = new Folha(); moldura(F, 'VERIFICAÇÕES', `VERIFICAÇÕES POR TIPO — ${laje ? 'LAJES' : 'PAREDES'}`, TOTAL, TOTAL, '—', E);
    let y = 262;
    tipos.forEach((t, i) => {
      if (y < 62) return;
      F.t(15, y, `${pref}-${String(i + 1).padStart(2, '0')}`, 5.6, { bold: true, color: ver[i].ok ? INK : '#b03a2e' });
      F.t(30, y, `${cm(t.a.L)} x ${cm(t.a.Hx(0))} · ${ver[i].txt}  ${ver[i].ok ? '✓' : '✗'}`, 5.4, { color: ver[i].ok ? INK : '#b03a2e' });
      y -= 3.5;
    });
    const RF = laje ? tipos.flatMap((t, i) => (t.a.ref ?? []).map(rf => ({ t, i, rf }))) : [];
    if (RF.length) {
      y -= 4; F.t(15, y, 'PAINÉIS COM REFORÇO EMBAIXO DE PAREDE DO PAVIMENTO DE CIMA', 7, { bold: true, color: '#d35400' });
      for (const { t, i, rf } of RF) { if (y < 40) break; y -= 4; F.t(15, y, `${pref}-${String(i + 1).padStart(2, '0')} (${t.g.map(cod).join(', ')}): ${br(rf.q, 1)} kN/m · ${rf.txt}`, 5.6, { color: rf.ok ? INK : '#b03a2e' }); }
    }
    if (avisos.length) { y -= 4; F.t(15, y, 'AVISOS', 7, { bold: true, color: '#b03a2e' }); for (const s of avisos.slice(0, 12)) { y -= 4; F.t(15, y, s, 5.6, { color: '#b03a2e' }); } }
    pags.push(F);
  }
  const reforcos = laje ? tipos.flatMap((t, i) => t.g.flatMap(q => (t.a.ref ?? []).map(rf => ({ codigo: cod(q), tipo: `${pref}-${String(i + 1).padStart(2, '0')}`, txt: rf.txt, ok: rf.ok })))) : [];
  return { paginas: pags, linhas, tipos: NT, kg: kgTot, avisos, reforcos };
}

// ---------- caderno da fábrica (corte e dobra) + compra ----------
function planoBarras(pecas: number[], barra = 1200) {
  const barras: number[][] = [], sob: number[] = [];
  for (const c of [...pecas].sort((p, q) => q - p)) {
    let j = -1, best = Infinity;
    for (let i = 0; i < sob.length; i++) if (sob[i] >= c && sob[i] < best) { best = sob[i]; j = i; }
    if (j < 0) { barras.push([c]); sob.push(barra - c); } else { barras[j].push(c); sob[j] -= c; }
  }
  return barras;
}
const kgmBit = (b: number | string) => typeof b === 'string' ? (b === ALCA_KEY ? 0.395 : TG_KG[b] ?? 0.886) : ({ 4.2: 0.109, 5: 0.154, 6.3: 0.245, 8: 0.395, 10: 0.617, 12.5: 0.963 } as Record<number, number>)[b] ?? 0;
export interface Compra { b: number | string; aco: string; barras: number; kgPecas: number; kgCompra: number }
export function caderno(E: EntradaArm, linhas: LinhaAco[]): { paginas: Pagina[]; compra: Compra[] } {
  type Feixe = { item: string; tipo: string; pos: string; bit: number | string; c: number; q: number; pecas: string[] };
  const feixes = new Map<string, Feixe>();
  for (const l of linhas) {
    const k = `${l.tipo}|${l.pos}`, f = feixes.get(k) ?? { item: l.tipo.startsWith('LJ') ? 'Lajes' : 'Paredes', tipo: l.tipo, pos: l.pos, bit: l.bit, c: Math.round(l.c * 100), q: 0, pecas: [] };
    f.q += l.qtd; if (!f.pecas.includes(l.codigo)) f.pecas.push(l.codigo); feixes.set(k, f);
  }
  const PEC = new Map<string, { b: number | string; v: number[] }>();
  for (const f of feixes.values()) { const k = String(f.bit), o = PEC.get(k) ?? { b: f.bit, v: [] }; for (let i = 0; i < f.q; i++) o.v.push(f.c); PEC.set(k, o); }
  const ordem = [...PEC.values()].sort((p, q) => (typeof p.b === 'string' ? 1 : 0) - (typeof q.b === 'string' ? 1 : 0) || (typeof p.b === 'number' && typeof q.b === 'number' ? p.b - q.b : 0));
  const compra: Compra[] = ordem.map(o => {
    const barras = planoBarras(o.v), cmTot = o.v.reduce((s, x) => s + x, 0);
    return { b: o.b, aco: typeof o.b === 'string' ? (o.b === ALCA_KEY ? 'CA-25 liso' : 'treliça') : o.b < 6 ? 'CA-60' : 'CA-50', barras: barras.length, kgPecas: cmTot / 100 * kgmBit(o.b), kgCompra: barras.length * 12 * kgmBit(o.b) };
  });
  const pags: Pagina[] = [], FS = [...feixes.values()], porFolha = 44, nFolhasT = Math.max(1, Math.ceil(FS.length / porFolha)), TOTAL = 1 + nFolhasT + ordem.length;
  // folha 1: compra
  {
    const F = new Folha(); moldura(F, 'CADERNO DA FÁBRICA', 'CADERNO DA FÁBRICA — LISTA DE COMPRA DO AÇO', 1, TOTAL, '—', E);
    const xs = [15, 45, 75, 105, 140, 175];
    ['BITOLA', 'AÇO', 'BARRAS DE 12 m', 'PESO NAS PEÇAS (kg)', 'PESO COMPRADO (kg)', 'SOBRAS (kg)'].forEach((s, i) => F.t(xs[i], 258, s, 6.4, { bold: true }));
    let y = 258; let a = 0, b = 0;
    for (const c of compra) { y -= 6; a += c.kgPecas; b += c.kgCompra; [bitTxt(c.b), c.aco, String(c.barras), br(c.kgPecas, 1), br(c.kgCompra, 1), br(c.kgCompra - c.kgPecas, 1)].forEach((s, i) => F.t(xs[i], y, s, 6.4)); }
    F.t(15, y - 10, `AÇO NAS PEÇAS: ${br(a, 1)} kg   ·   AÇO COMPRADO: ${br(b, 1)} kg   ·   SOBRAS: ${br(b - a, 1)} kg`, 7.5, { bold: true });
    F.t(15, y - 17, 'Plano de corte em barras de 12 m (melhor encaixe); treliças e alças contadas como barras de 12 m. Conferir pesos com o fornecedor.', 5.6, { color: '#555555' });
    pags.push(F);
  }
  // tabelas de corte e dobra
  for (let fo = 0; fo < nFolhasT; fo++) {
    const F = new Folha(); moldura(F, 'CORTE E DOBRA', `TABELA DE CORTE E DOBRA (${fo + 1}/${nFolhasT})`, 2 + fo, TOTAL, '—', E);
    const xs = [15, 32, 48, 66, 84, 102, 122];
    ['ITEM', 'TIPO', 'POS.', 'BITOLA', 'C (cm)', 'QUANT.', 'PEÇAS'].forEach((s, i) => F.t(xs[i], 262, s, 6, { bold: true }));
    let y = 262;
    for (const f of FS.slice(fo * porFolha, (fo + 1) * porFolha)) {
      y -= 4.4; [f.item, f.tipo, f.pos, bitTxt(f.bit), String(f.c), String(f.q)].forEach((s, i) => F.t(xs[i], y, s, 5.6));
      const p = f.pecas.join(', '); F.t(xs[6], y, p.length > 140 ? p.slice(0, 140) + ' …' : p, 5, { color: '#333333' });
      F.seg(15, y - 1.4, 405, y - 1.4, 0.12, '#bbbbbb');
    }
    pags.push(F);
  }
  // plano de corte por bitola
  ordem.forEach((o, i) => {
    const F = new Folha(), barras = planoBarras(o.v), pad = new Map<string, number>();
    for (const b of barras) { const k = [...b].sort((p, q) => q - p).join(' + '); pad.set(k, (pad.get(k) ?? 0) + 1); }
    moldura(F, 'PLANO DE CORTE', `PLANO DE CORTE — ${bitTxt(o.b)} (${barras.length} barras de 12 m)`, 2 + nFolhasT + i, TOTAL, '—', E);
    let y = 262;
    F.t(15, y, 'QTD. DE BARRAS', 6, { bold: true }); F.t(45, y, 'CORTES EM CADA BARRA (cm)', 6, { bold: true }); F.t(330, y, 'SOBRA (cm)', 6, { bold: true });
    for (const [k, n] of [...pad].sort((p, q) => q[1] - p[1])) {
      y -= 4.6; if (y < 62) { F.t(15, y, '…', 6); break; }
      const usado = k.split(' + ').reduce((s, x) => s + Number(x), 0);
      F.t(15, y, `${n} x`, 6, { bold: true }); F.t(45, y, k.length > 160 ? k.slice(0, 160) + ' …' : k, 5.4); F.t(330, y, String(1200 - usado), 6);
    }
    pags.push(F);
  });
  return { paginas: pags, compra };
}
export const csvCompra = (c: Compra[], obra: string) => '﻿' + [`Lista de compra de aço;${obra}`, 'Bitola;Aço;Barras de 12 m;Peso nas peças (kg);Peso comprado (kg)',
  ...c.map(x => [bitTxt(x.b), x.aco, x.barras, br(x.kgPecas, 1), br(x.kgCompra, 1)].join(';'))].join('\r\n');
export const csvAco = (l: LinhaAco[]) => '﻿' + ['Pavimento;Peça;Tipo;Posição;Bitola;Quantidade;Comprimento (m)',
  ...l.map(x => [x.pav, x.codigo, x.tipo, x.pos, bitTxt(x.bit), x.qtd, br(x.c)].join(';'))].join('\r\n');
