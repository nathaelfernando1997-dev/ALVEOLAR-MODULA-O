// Desenho de folhas em milímetros de papel (origem embaixo à esquerda), com saída em PDF vetorial e em SVG.
// Usado pelo detalhamento de armação. Sem bibliotecas: o PDF é escrito na mão (Helvetica / Helvetica-Bold).

export type XY = [number, number];
export type Prim =
  | { t: 'l'; pts: XY[]; w: number; c: string; dash?: number[] }
  | { t: 'p'; pts: XY[]; fill?: string; stroke?: string; w?: number }
  | { t: 'c'; x: number; y: number; r: number; fill: string }
  | { t: 'tx'; x: number; y: number; s: string; size: number; bold?: boolean; color?: string; ha?: 'left' | 'center' | 'right'; va?: 'base' | 'center' | 'top' | 'bottom'; rot?: number };
export interface Pagina { w: number; h: number; prims: Prim[] }

export class Folha implements Pagina {
  prims: Prim[] = [];
  w: number; h: number;
  constructor(w = 420, h = 297) { this.w = w; this.h = h; }
  l(pts: XY[], w = 0.35, c = '#111111', dash?: number[]) { this.prims.push({ t: 'l', pts, w, c, dash }); }
  seg(x0: number, y0: number, x1: number, y1: number, w = 0.35, c = '#111111') { this.l([[x0, y0], [x1, y1]], w, c); }
  r(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; lw?: number } = {}) {
    this.prims.push({ t: 'p', pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill: o.fill, stroke: o.stroke === undefined ? '#111111' : o.stroke, w: o.lw ?? 0.35 });
  }
  poly(pts: XY[], o: { fill?: string; stroke?: string; lw?: number } = {}) { this.prims.push({ t: 'p', pts, fill: o.fill, stroke: o.stroke, w: o.lw ?? 0.35 }); }
  c(x: number, y: number, r: number, fill: string) { this.prims.push({ t: 'c', x, y, r, fill }); }
  // contorno de círculo / arco (polilinha), ângulos em graus
  arco(x: number, y: number, r: number, a0 = 0, a1 = 360, w = 0.35, c = '#111111') {
    const n = Math.max(8, Math.round(Math.abs(a1 - a0) / 10)), pts: XY[] = [];
    for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
    this.l(pts, w, c);
  }
  t(x: number, y: number, s: string, size = 6.5, o: { bold?: boolean; color?: string; ha?: 'left' | 'center' | 'right'; va?: 'base' | 'center' | 'top' | 'bottom'; rot?: number } = {}) {
    this.prims.push({ t: 'tx', x, y, s, size, ...o });
  }
}

// larguras da Helvetica (1/1000 em), ASCII 32..126
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const PT = 72 / 25.4;   // pontos por mm
export function larguraTexto(s: string, sizePt: number, bold = false) {
  let w = 0; for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? W[c - 32] : 556; }
  return w * sizePt / 1000 / PT * (bold ? 1.06 : 1);   // mm
}
const esc = (s: string) => {
  let o = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') o += '\\' + ch;
    else if (c >= 32 && c <= 126) o += ch;
    else if (c >= 160 && c <= 255) o += '\\' + c.toString(8);
    else if (ch === '·') o += '\\267';
    else if (ch === '—' || ch === '–') o += '-';
    else if (ch === 'ø' || ch === 'Ø') o += '\\370';
    else if (ch === '✓') o += 'OK';
    else if (ch === '✗') o += 'X';
    else if (ch === '≤') o += '<=';
    else if (ch === '≥') o += '>=';
    else if (ch === '→') o += '->';
    else if (ch === '‘' || ch === '’') o += "'";
    else if (ch === '“' || ch === '”') o += '"';
    else o += '?';
  }
  return o;
};
const rgb = (h: string) => { const n = parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => v.toFixed(3)).join(' '); };
const n = (v: number) => (v * PT).toFixed(2);

// deslocamento da linha de base para o alinhamento vertical pedido (mm, no sentido do texto)
const dyBase = (va: string | undefined, sizePt: number) => { const s = sizePt / PT; return va === 'center' ? -0.35 * s : va === 'top' ? -0.74 * s : va === 'bottom' ? 0.22 * s : 0; };

function conteudoPdf(p: Pagina): string {
  const o: string[] = ['1 J 1 j'];
  for (const q of p.prims) {
    if (q.t === 'l') {
      o.push(`${rgb(q.c)} RG ${(q.w * PT).toFixed(2)} w ${q.dash ? `[${q.dash.map(d => (d * PT).toFixed(2)).join(' ')}] 0 d` : '[] 0 d'}`);
      o.push(`${n(q.pts[0][0])} ${n(q.pts[0][1])} m ${q.pts.slice(1).map(([x, y]) => `${n(x)} ${n(y)} l`).join(' ')} S`);
    } else if (q.t === 'p') {
      const path = `${n(q.pts[0][0])} ${n(q.pts[0][1])} m ${q.pts.slice(1).map(([x, y]) => `${n(x)} ${n(y)} l`).join(' ')} h`;
      if (q.fill && q.stroke) o.push(`${rgb(q.fill)} rg ${rgb(q.stroke)} RG ${((q.w ?? 0.35) * PT).toFixed(2)} w [] 0 d ${path} B`);
      else if (q.fill) o.push(`${rgb(q.fill)} rg ${path} f`);
      else if (q.stroke) o.push(`${rgb(q.stroke)} RG ${((q.w ?? 0.35) * PT).toFixed(2)} w [] 0 d ${path} S`);
    } else if (q.t === 'c') {
      const k = 0.5523 * q.r, { x, y, r } = q;
      o.push(`${rgb(q.fill)} rg ${n(x + r)} ${n(y)} m ${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)} c ${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)} c ${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)} c ${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)} c f`);
    } else {
      const w = larguraTexto(q.s, q.size, q.bold), dx = q.ha === 'center' ? -w / 2 : q.ha === 'right' ? -w : 0, dy = dyBase(q.va, q.size);
      const a = (q.rot ?? 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      const px = q.x + dx * co - dy * si, py = q.y + dx * si + dy * co;
      o.push(`${rgb(q.color ?? '#111111')} rg BT /${q.bold ? 'F2' : 'F1'} ${q.size.toFixed(2)} Tf ${co.toFixed(4)} ${si.toFixed(4)} ${(-si).toFixed(4)} ${co.toFixed(4)} ${n(px)} ${n(py)} Tm (${esc(q.s)}) Tj ET`);
    }
  }
  return o.join('\n');
}

export function paginasParaPdf(pags: Pagina[]): Uint8Array {
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pags.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pags.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  for (const p of pags) {
    const c = conteudoPdf(p);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(p.w)} ${n(p.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  }
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const off: number[] = [];
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const b = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i++) b[i] = pdf.charCodeAt(i) & 255;
  return b;
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function paginaParaSvg(p: Pagina): string {
  const Y = (y: number) => (p.h - y).toFixed(2), X = (x: number) => x.toFixed(2);
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${p.w} ${p.h}" style="background:#fff;font-family:Helvetica,Arial,sans-serif">`];
  for (const q of p.prims) {
    if (q.t === 'l') o.push(`<polyline fill="none" stroke="${q.c}" stroke-width="${q.w}"${q.dash ? ` stroke-dasharray="${q.dash.join(' ')}"` : ''} points="${q.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}"/>`);
    else if (q.t === 'p') o.push(`<polygon fill="${q.fill ?? 'none'}" stroke="${q.stroke ?? 'none'}" stroke-width="${q.w ?? 0.35}" points="${q.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}"/>`);
    else if (q.t === 'c') o.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="${q.r}" fill="${q.fill}"/>`);
    else {
      const s = q.size / PT, anchor = q.ha === 'center' ? 'middle' : q.ha === 'right' ? 'end' : 'start', dy = -dyBase(q.va, q.size);
      o.push(`<text x="${X(q.x)}" y="${Y(q.y)}" font-size="${s.toFixed(2)}" fill="${q.color ?? '#111'}" text-anchor="${anchor}"${q.bold ? ' font-weight="bold"' : ''} transform="rotate(${-(q.rot ?? 0)} ${X(q.x)} ${Y(q.y)}) translate(0 ${dy.toFixed(2)})">${xmlEsc(q.s)}</text>`);
    }
  }
  o.push('</svg>');
  return o.join('');
}
