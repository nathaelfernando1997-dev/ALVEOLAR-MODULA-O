// Cargas na fundação: o peso de cada parede, laje e viga desce pelo prédio até as paredes do térreo
// laje -> parede ou viga do pavimento · viga -> pilares (pontas e paredes que cruzam) · parede -> estrutura de baixo
import type { Painel, Trecho, Pavimento, Regras } from './model.ts';
import type { PainelLaje } from './lajes.ts';
import { pesoParede, pesoLaje } from './producao.ts';

export type CargaPav = 'piso' | 'forro' | 'nada';
export const CARGA_PAV: Record<CargaPav, { rev: number; q: number; nome: string }> = {
  piso: { rev: 1.0, q: 1.5, nome: 'Laje de piso (revestimento 1,0 + uso 1,5 kN/m²)' },
  forro: { rev: 1.0, q: 0.5, nome: 'Laje forro com telhado (1,0 + 0,5 kN/m²)' },
  nada: { rev: 0, q: 0, nome: 'Só o peso da laje' },
};
type Lin = { o: 'H' | 'V'; c: number; s: number; e: number };
export interface Amostra { t: number; u: number; P: number }
export interface Cargas { amostras: Amostra[]; ts: (Lin & { vaos: Trecho['vaos']; H: number })[]; tot: { paredes: number; lajes: number; uso: number; outros: number }; foraKN: number }
interface VigaLin { pav: string; o: 'H' | 'V'; c: number; a: number; b: number; altura?: number; tipo: string }

export function cargasFundacao(o: {
  pavs: Pavimento[]; desloc: Record<string, { dx: number; dy: number }>; ts: Trecho[]; ps: Painel[]; pl: PainelLaje[]; vigas: VigaLin[];
  regras: Regras; espLaje: (p: PainelLaje) => number; pavCarga: Record<string, CargaPav>; baldrame: boolean;
}): Cargas {
  const G = 9.81 / 1000, TOL = 0.12, ordem = o.pavs.map(p => p.id);
  const G2 = (pav: string, or: 'H' | 'V', c: number, a: number, b: number): Lin => { const d = o.desloc[pav] ?? { dx: 0, dy: 0 }; const s = Math.min(a, b), e = Math.max(a, b);
    return or === 'H' ? { o: or, c: c + d.dy, s: s + d.dx, e: e + d.dx } : { o: or, c: c + d.dx, s: s + d.dy, e: e + d.dy }; };
  const tsL: Record<string, Lin[]> = {}, vgL: Record<string, (Lin & { h: number })[]> = {};
  for (const id of ordem) { tsL[id] = o.ts.filter(t => t.pav === id).map(t => G2(id, t.o, t.c, t.s, t.e));
    vgL[id] = o.vigas.filter(v => v.pav === id && v.tipo !== 'trelica').map(v => ({ ...G2(id, v.o, v.c, v.a, v.b), h: v.altura ?? 0.3 })); }
  const base = ordem[0], tB = o.ts.filter(t => t.pav === base);
  const uv = (l: Lin, x: number, y: number) => l.o === 'H' ? [x, y] : [y, x];
  const dist = (l: Lin, x: number, y: number) => { const [u, w] = uv(l, x, y); const du = u < l.s ? l.s - u : u > l.e ? u - l.e : 0; return Math.hypot(du, w - l.c); };
  const proj = (l: Lin, x: number, y: number) => { const [u] = uv(l, x, y); const uu = Math.min(l.e, Math.max(l.s, u)); return l.o === 'H' ? [uu, l.c] : [l.c, uu]; };
  const out: Amostra[] = []; let foraKN = 0;
  const desce = (x: number, y: number, P: number, lvl: number) => {
    while (lvl >= 0) {
      const pav = ordem[lvl];
      const vg = vgL[pav].find(v => dist(v, x, y) < TOL), naParede = tsL[pav].some(t => dist(t, x, y) < TOL);
      if (vg && !naParede) {   // viga: reparte para os apoios (pontas e paredes que cruzam por baixo) e desce pelos pilares
        const [u] = uv(vg, x, y);
        const ap0 = [vg.s, vg.e, ...ordem.slice(0, lvl + 1).flatMap(pv => tsL[pv]).filter(t => t.o !== vg.o && t.c > vg.s + 0.05 && t.c < vg.e - 0.05 && vg.c > t.s - TOL && vg.c < t.e + TOL).map(t => t.c)].sort((a, b) => a - b);
        const ap = ap0.filter((v, i) => !i || v - ap0[i - 1] > 0.3 || v === vg.e);
        let ia = 0; while (ia < ap.length - 2 && u > ap[ia + 1]) ia++;
        const ua = ap[ia], ub = ap[ia + 1], f = Math.min(1, Math.max(0, (u - ua) / (ub - ua)));
        const pA = vg.o === 'H' ? [ua, vg.c] : [vg.c, ua], pB = vg.o === 'H' ? [ub, vg.c] : [vg.c, ub];
        desce(pA[0], pA[1], P * (1 - f), lvl - 1); desce(pB[0], pB[1], P * f, lvl - 1); return;
      }
      if (!naParede) { let best = tsL[pav][0], bd = 1e9; for (const t of tsL[pav]) { const dd = dist(t, x, y); if (dd < bd) { bd = dd; best = t; } } if (best) [x, y] = proj(best, x, y); }
      lvl--;
    }
    let bi = 0, bd = 1e9; tsL[base].forEach((t, i) => { const dd = dist(t, x, y); if (dd < bd) { bd = dd; bi = i; } });
    if (bd > 0.3) foraKN += P;
    const t = tsL[base][bi]; if (!t) return; const [u] = uv(t, x, y);
    out.push({ t: bi, u: Math.min(t.e, Math.max(t.s, u)), P });
  };
  const amostra = (x0: number, y0: number, x1: number, y1: number, Pt: number, lvl: number) => {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 0.1));
    for (let j = 0; j < n; j++) { const f = (j + 0.5) / n; desce(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, Pt / n, lvl); }
  };
  const tot = { paredes: 0, lajes: 0, uso: 0, outros: 0 };
  for (const p of o.ps) { const i = ordem.indexOf(p.pav); if (i < 0) continue; const l = G2(p.pav, p.o, p.c, p.a, p.b), W = pesoParede(p, o.regras) * G; tot.paredes += W;
    const [x0, y0, x1, y1] = l.o === 'H' ? [l.s, l.c, l.e, l.c] : [l.c, l.s, l.c, l.e]; amostra(x0, y0, x1, y1, W, i - 1); }
  for (const p of o.pl) { const i = ordem.indexOf(p.pav); if (i < 0) continue; const d = o.desloc[p.pav] ?? { dx: 0, dy: 0 }, k = CARGA_PAV[o.pavCarga[p.pav] ?? 'piso'];
    const x0 = Math.min(p.x0, p.x1) + d.dx, x1 = Math.max(p.x0, p.x1) + d.dx, y0 = Math.min(p.y0, p.y1) + d.dy, y1 = Math.max(p.y0, p.y1) + d.dy;
    const A = (x1 - x0) * (y1 - y0), g = pesoLaje(p, o.regras, o.espLaje(p)) * G + k.rev * A, q = k.q * A; tot.lajes += g; tot.uso += q;
    const ap = p.sentido === 'H' ? [[x0, y0, x0, y1], [x1, y0, x1, y1]] : [[x0, y0, x1, y0], [x0, y1, x1, y1]];
    for (const [a0, b0, a1, b1] of ap) amostra(a0, b0, a1, b1, (g + q) / 2, i); }
  for (const id of ordem) for (const v of vgL[id]) {
    const W = 0.15 * Math.max(0.15, v.h - 0.14) * 25 * (v.e - v.s); tot.outros += W;
    const [x0, y0, x1, y1] = v.o === 'H' ? [v.s, v.c, v.e, v.c] : [v.c, v.s, v.c, v.e]; amostra(x0, y0, x1, y1, W, ordem.indexOf(id)); }
  if (o.baldrame) tsL[base].forEach((t, i) => { const W = 0.15 * 0.4 * 25 * (t.e - t.s); tot.outros += W; const n = Math.ceil((t.e - t.s) / 0.1);
    for (let j = 0; j < n; j++) out.push({ t: i, u: t.s + (t.e - t.s) * (j + 0.5) / n, P: W / n }); });
  return { amostras: out, ts: tsL[base].map((l, i) => ({ ...l, vaos: tB[i].vaos, H: tB[i].H })), tot, foraKN };
}

// carga em cada ponto sem a parede ajudar (alavanca entre os pontos vizinhos da mesma parede)
export function cargaAlavanca(C: Cargas, pts: { n: number; x: number; y: number }[], bloco = 3.125): Record<number, number> {
  const TOL = 0.15, R: Record<number, number> = Object.fromEntries(pts.map(p => [p.n, bloco]));
  const onT = C.ts.map(t => pts.map(p => ({ u: t.o === 'H' ? p.x : p.y, w: t.o === 'H' ? p.y : p.x, n: p.n })).filter(q => Math.abs(q.w - t.c) < TOL && q.u > t.s - TOL && q.u < t.e + TOL).sort((a, b) => a.u - b.u));
  for (const a of C.amostras) {
    const L = onT[a.t]; if (!L?.length) continue;
    if (a.u <= L[0].u) { R[L[0].n] += a.P; continue; } if (a.u >= L[L.length - 1].u) { R[L[L.length - 1].n] += a.P; continue; }
    for (let i = 0; i < L.length - 1; i++) if (L[i].u <= a.u && a.u <= L[i + 1].u) { const f = (a.u - L[i].u) / (L[i + 1].u - L[i].u); R[L[i].n] += a.P * (1 - f); R[L[i + 1].n] += a.P * f; break; }
  }
  return R;
}
