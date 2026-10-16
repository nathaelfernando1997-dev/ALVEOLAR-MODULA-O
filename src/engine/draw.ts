// Desenhos em SVG: planta de montagem e vistas dos painéis.
import type { Prim } from './dxf.ts';
import type { Painel, Pavimento, VaoInteiro, Leitura } from './model.ts';

const br = (v: number) => v.toFixed(2).replace('.', ',');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const AZUL = '#1a3fd6', VERM = '#d11', ROSA = '#c0c', CINZA = '#9a9a9a';

type Caixa = [number, number, number, number]; // x0,y0,x1,y1 (metros, planta)
const livre = (occ: Caixa[], b: Caixa) => occ.every(o => b[2] <= o[0] || b[0] >= o[2] || b[3] <= o[1] || b[1] >= o[3]);

function cotaSvg(X: (x: number) => number, Y: (y: number) => number, o: 'H' | 'V', a: number, b: number, c: number, off: number, txt: string, fs: number): string {
  // linha de cota paralela à parede, a "off" metros dela
  const k = (v: number) => v.toFixed(1);
  if (o === 'H') {
    const y = Y(c + off), y0 = Y(c);
    return `<g stroke="${AZUL}" stroke-width="0.8" fill="none"><line x1="${k(X(a))}" y1="${k(y)}" x2="${k(X(b))}" y2="${k(y)}"/><line x1="${k(X(a))}" y1="${k(y0)}" x2="${k(X(a))}" y2="${k(y)}"/><line x1="${k(X(b))}" y1="${k(y0)}" x2="${k(X(b))}" y2="${k(y)}"/>` +
      `<line x1="${k(X(a) - 4)}" y1="${k(y + 4)}" x2="${k(X(a) + 4)}" y2="${k(y - 4)}"/><line x1="${k(X(b) - 4)}" y1="${k(y + 4)}" x2="${k(X(b) + 4)}" y2="${k(y - 4)}"/></g>` +
      `<text x="${k((X(a) + X(b)) / 2)}" y="${k(y - 2)}" font-size="${fs}" fill="${VERM}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">${txt}</text>`;
  }
  const x = X(c + off), x0 = X(c);
  const m = (Y(a) + Y(b)) / 2;
  return `<g stroke="${AZUL}" stroke-width="0.8" fill="none"><line x1="${k(x)}" y1="${k(Y(a))}" x2="${k(x)}" y2="${k(Y(b))}"/><line x1="${k(x0)}" y1="${k(Y(a))}" x2="${k(x)}" y2="${k(Y(a))}"/><line x1="${k(x0)}" y1="${k(Y(b))}" x2="${k(x)}" y2="${k(Y(b))}"/>` +
    `<line x1="${k(x - 4)}" y1="${k(Y(a) + 4)}" x2="${k(x + 4)}" y2="${k(Y(a) - 4)}"/><line x1="${k(x - 4)}" y1="${k(Y(b) + 4)}" x2="${k(x + 4)}" y2="${k(Y(b) - 4)}"/></g>` +
    `<text x="${k(x - 2)}" y="${k(m)}" font-size="${fs}" fill="${VERM}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3" transform="rotate(-90 ${k(x - 2)} ${k(m)})">${txt}</text>`;
}

// planta de montagem (impressão)
export function plantaSvg(L: Leitura, pav: Pavimento, ps: Painel[], vaos: VaoInteiro[], arq: Prim[]): string {
  const b = pav.box, pad = 1.4;
  const x0 = b.x0 - pad, x1 = b.x1 + pad, y0 = b.y0 - pad, y1 = b.y1 + pad, k = 100;
  const X = (x: number) => (x - x0) * k, Y = (y: number) => (y1 - y) * k;
  const g: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${((x1 - x0) * k).toFixed(0)} ${((y1 - y0) * k).toFixed(0)}">`];
  for (const p of arq) g.push(`<polyline points="${p.pts.map(q => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${CINZA}" stroke-width="1"/>`);
  const tags = L.tags.filter(t => t.x > b.x0 - 0.5 && t.x < b.x1 + 0.5 && t.y > b.y0 - 0.5 && t.y < b.y1 + 0.5);
  const occ: Caixa[] = [];
  for (const t of tags) { occ.push([t.x - 0.25, t.y - 0.13, t.x + 0.25, t.y + 0.13]); g.push(`<text x="${X(t.x)}" y="${Y(t.y) + 7}" font-size="20" fill="${ROSA}" text-anchor="middle">${esc(t.text)}</text>`); }
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  // agrupa painéis no mesmo lugar (ex.: peças sobrepostas)
  const grupos = new Map<string, Painel[]>();
  for (const p of ps) { const kk = `${p.o}|${p.c.toFixed(3)}|${p.a.toFixed(3)}`; grupos.set(kk, [...(grupos.get(kk) || []), p]); }
  const lado = new Map<string, number>();
  const NUMH = 0.22;
  for (const [kk, gp] of grupos) {
    const p = gp[0], lab = gp.map(q => q.num).join('/'), m = (p.a + p.b) / 2;
    const s0 = p.o === 'H' ? (p.c > cy ? -1 : 1) : (p.c > cx ? -1 : 1);
    const w = NUMH * 0.72 * lab.length + 0.08, h = NUMH + 0.08;
    let esc_: [number, number, number, Caixa] | null = null;
    for (const s of [s0, -s0]) {
      for (const al of [0, -0.25, 0.25, -0.5, 0.5]) {
        const mm = m + al; if (al && !(p.a + 0.05 <= mm && mm <= p.b - 0.05)) continue;
        const [bx, by] = p.o === 'H' ? [mm, p.c + s * (0.12 + h / 2)] : [p.c + s * (0.12 + w / 2), mm];
        const cb: Caixa = [bx - w / 2, by - h / 2, bx + w / 2, by + h / 2];
        if (livre(occ, cb)) { esc_ = [bx, by, s, cb]; break; }
      }
      if (esc_) break;
    }
    if (!esc_) { const [bx, by] = p.o === 'H' ? [m, p.c + s0 * 0.24] : [p.c + s0 * (0.12 + w / 2), m]; esc_ = [bx, by, s0, [bx - w / 2, by - h / 2, bx + w / 2, by + h / 2]]; }
    occ.push(esc_[3]); lado.set(kk, esc_[2]);
    g.push(`<text x="${X(esc_[0]).toFixed(1)}" y="${(Y(esc_[1]) + 8).toFixed(1)}" font-size="${NUMH * k}" fill="${VERM}" text-anchor="middle" font-weight="bold">${lab}</text>`);
  }
  for (const [kk, gp] of grupos) {
    const p = gp[0], s = lado.get(kk)!, t = br(p.comp), tw = 0.075 * t.length + 0.06;
    const faixa = (off: number, sg: number): Caixa[] => {
      const lo = Math.min(p.c + sg * 0.12, p.c + sg * (off + 0.09)), hi = Math.max(p.c + sg * 0.12, p.c + sg * (off + 0.09));
      if (p.o === 'H') return [[p.a + 0.03, p.c + sg * off - 0.09, p.b - 0.03, p.c + sg * off + 0.09], [p.a - 0.03, lo, p.a + 0.03, hi], [p.b - 0.03, lo, p.b + 0.03, hi]];
      return [[p.c + sg * off - 0.09, p.a + 0.03, p.c + sg * off + 0.09, p.b - 0.03], [lo, p.a - 0.03, hi, p.a + 0.03], [lo, p.b - 0.03, hi, p.b + 0.03]];
    };
    const cands: [number, number][] = [0.4, 0.55, 0.7, 0.85, 1.0, 1.2].map(o => [o, -s] as [number, number]).concat([0.8, 1.0, 1.2].map(o => [o, s] as [number, number]));
    let ch = cands[0];
    for (const c of cands) if (faixa(c[0], c[1]).every(bb => livre(occ, bb))) { ch = c; break; }
    occ.push(...faixa(ch[0], ch[1]));
    void tw;
    g.push(cotaSvg(X, Y, p.o, p.a, p.b, p.c, ch[0] * ch[1], t, 15));
  }
  void vaos;
  g.push('</svg>');
  return g.join('');
}

// vista de um painel (unidades: 1 m = 100)
export function vistaSvg(p: Painel): string {
  const k = 100, w = p.larg, h = p.H, mx = 0.55, my = 0.45;
  const W = (w + 2 * mx) * k, Hh = (h + my + 0.35) * k;
  const X = (x: number) => (x + mx) * k, Y = (y: number) => (h + my - y) * k;
  const s: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${Hh.toFixed(0)}" style="width:${(W / 100 * 18).toFixed(1)}mm">`];
  const L = (x1: number, y1: number, x2: number, y2: number, c = '#000', sw = 1.2) => s.push(`<line x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="${c}" stroke-width="${sw}"/>`);
  const T = (x: number, y: number, t: string, fs = 12, c = VERM, anc = 'middle', rot = false) => s.push(`<text x="${X(x).toFixed(1)}" y="${Y(y).toFixed(1)}" font-size="${fs}" fill="${c}" text-anchor="${anc}" paint-order="stroke" stroke="#fff" stroke-width="3"${rot ? ` transform="rotate(-90 ${X(x).toFixed(1)} ${Y(y).toFixed(1)})"` : ''}>${t}</text>`);
  const dimH = (a: number, b: number, y: number, t: string) => { L(a, y, b, y, AZUL, 0.8); L(a, y - 0.04, a, y + 0.04, AZUL, 0.8); L(b, y - 0.04, b, y + 0.04, AZUL, 0.8); T((a + b) / 2, y + 0.03, t, 11); };
  const dimV = (x: number, a: number, b: number, t: string) => { L(x, a, x, b, AZUL, 0.8); L(x - 0.04, a, x + 0.04, a, AZUL, 0.8); L(x - 0.04, b, x + 0.04, b, AZUL, 0.8); T(x - 0.03, (a + b) / 2, t, 11, VERM, 'middle', true); };
  L(0, 0, w, 0); L(w, 0, w, h); L(w, h, 0, h); L(0, h, 0, 0); L(-0.3, 0, w + 0.1, 0);
  for (let i = 1; i < 5; i++) { const z = h * i / 5; L(-0.08, z, 0, z, '#000', 0.8); L(w, z, w + 0.08, z, '#000', 0.8); }
  s.push(`<text x="${X(0.06)}" y="${Y(h - 0.2)}" font-size="16" fill="${VERM}" font-weight="bold">${p.num}</text>`);
  dimH(0, w, h + 0.2, br(w)); dimV(-0.22, 0, h, br(h));
  for (const r of p.recortes) {
    const ox = r.dl, ob = r.base, ow = r.w, oh = r.h;
    s.push(`<rect x="${X(ox).toFixed(1)}" y="${Y(ob + oh).toFixed(1)}" width="${(ow * k).toFixed(1)}" height="${(oh * k).toFixed(1)}" fill="none" stroke="#000" stroke-width="1"/>`);
    T(ox + ow * 0.42, ob + Math.min(oh * 0.25, 0.22), r.tipo, 10, '#900');
    dimH(ox, ox + ow, ob + oh - 0.12, br(ow));
    dimV(ox + ow - 0.1, ob, ob + oh, br(oh));
    if (ox > 0.02) dimH(0, ox, ob + oh * 0.35, br(ox));
    const dr = w - ox - ow; if (dr > 0.02) dimH(ox + ow, w, ob + oh * 0.6, br(dr));
    if (ob > 0.005) dimV(ox + ow * 0.5, 0, ob, br(ob));
    const top = h - ob - oh; if (top > 0.005) dimV(ox + ow * 0.5, ob + oh, h, br(top));
  }
  if (p.aviso) T(w / 2, -0.22, esc(p.aviso), 10, '#b00');
  s.push('</svg>');
  return s.join('');
}
