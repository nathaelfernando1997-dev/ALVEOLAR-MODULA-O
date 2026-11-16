// Gera um PDF vetorial (folha A3 com carimbo) direto do DXF simples que o sistema exporta
// (LINE, CIRCLE, ARC, TEXT). Sem bibliotecas: escreve o PDF na mão.
import { corEscura } from './cores.ts';

export interface InfoFolha { titulo: string; sub?: string; obs?: string }

// cores ACI usadas nas plantas (já escurecidas) → RGB 0..1
const ACI: Record<number, [number, number, number]> = {
  7: [0, 0, 0], 14: [0.5, 0, 0], 54: [0.5, 0.5, 0], 94: [0, 0.5, 0], 134: [0, 0.45, 0.45], 174: [0, 0, 0.55], 214: [0.5, 0, 0.5],
  8: [0.5, 0.5, 0.5], 250: [0.2, 0.2, 0.2], 251: [0.31, 0.31, 0.31], 1: [0.8, 0, 0], 2: [0.6, 0.55, 0], 3: [0, 0.6, 0], 4: [0, 0.55, 0.55], 5: [0, 0, 0.8], 6: [0.7, 0, 0.7],
};
const rgb = (c: number) => ACI[corEscura(Math.abs(c))] ?? (() => { // tom genérico pela matiz do ACI
  const a = corEscura(Math.abs(c)); if (a < 10 || a > 249) return [0, 0, 0] as [number, number, number];
  const h = ((Math.floor(a / 10) - 1) * 15) / 360 * 6, v = 0.5, f = h - Math.floor(h);
  const s = [[v, v * f, 0], [v * (1 - f), v, 0], [0, v, v * f], [0, v * (1 - f), v], [v * f, 0, v], [v, 0, v * (1 - f)]][Math.floor(h) % 6];
  return s as [number, number, number];
})();

// larguras da Helvetica (1/1000 em), ASCII 32..126
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const largura = (s: string, tam: number) => { let w = 0; for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? W[c - 32] : 556; } return w * tam / 1000; };
const txtPdf = (s: string) => {
  let o = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') o += '\\' + ch;
    else if (c >= 32 && c <= 126) o += ch;
    else if (c >= 160 && c <= 255) o += '\\' + c.toString(8);
    else if (ch === '·' ) o += '\\267';
    else if (ch === '—' || ch === '–') o += '-';
  }
  return o;
};
const dxfTexto = (s: string) => s.replace(/%%[cC]/g, 'ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');

type Ent = { t: string; cor: number; tr: boolean; x: number; y: number; x2: number; y2: number; r: number; a0: number; a1: number; h: number; s: string; rot: number; al: number };

function lerDxf(dxf: string): Ent[] {
  const L = dxf.split(/\r?\n/), out: Ent[] = [];
  let sec = '', e: Ent | null = null;
  for (let i = 0; i + 1 < L.length; i += 2) {
    const g = parseInt(L[i], 10), v = L[i + 1];
    if (g === 0) {
      if (e) out.push(e); e = null;
      const t = v.trim();
      if (t === 'SECTION') { sec = (L[i + 3] || '').trim(); continue; }
      if (sec === 'ENTITIES' && ['LINE', 'CIRCLE', 'ARC', 'TEXT'].includes(t)) e = { t, cor: 7, tr: false, x: 0, y: 0, x2: NaN, y2: NaN, r: 0, a0: 0, a1: 360, h: 0.1, s: '', rot: 0, al: 0 };
      continue;
    }
    if (!e) continue;
    const n = parseFloat(v);
    switch (g) {
      case 62: e.cor = n; break; case 6: e.tr = /CENTER|DASH/i.test(v); break;
      case 10: e.x = n; break; case 20: e.y = n; break; case 11: e.x2 = n; break; case 21: e.y2 = n; break;
      case 40: if (e.t === 'TEXT') e.h = n; else e.r = n; break;
      case 50: if (e.t === 'TEXT') e.rot = n; else e.a0 = n; break; case 51: e.a1 = n; break;
      case 1: e.s = dxfTexto(v); break; case 72: e.al = n; break;
    }
  }
  if (e) out.push(e);
  return out;
}

export function dxfParaPdf(dxf: string, info: InfoFolha): Uint8Array {
  const es = lerDxf(dxf);
  // limites
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { if (isFinite(x) && isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
  for (const e of es) {
    if (e.t === 'LINE') { add(e.x, e.y); add(e.x2, e.y2); }
    else if (e.t === 'TEXT') { const w = e.s.length * e.h * 0.75, ax = e.al === 1 ? e.x - w / 2 : e.al === 2 ? e.x - w : e.x; add(ax, e.y); add(ax + w, e.y + e.h); }
    else { add(e.x - e.r, e.y - e.r); add(e.x + e.r, e.y + e.r); }
  }
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
  // folha A3: deitada ou em pé conforme o desenho
  const dw = x1 - x0 || 1, dh = y1 - y0 || 1;
  const deitada = dw / dh >= 1100 / 760 * 0.75;
  const PW = deitada ? 1190.55 : 841.89, PH = deitada ? 841.89 : 1190.55;
  const M = 28, CAR = 52; // margem e altura do carimbo (pt)
  const aw = PW - 2 * M, ah = PH - 2 * M - CAR - 8;
  const k = Math.min(aw / dw, ah / dh);
  const ox = M + (aw - dw * k) / 2 - x0 * k, oy = M + CAR + 8 + (ah - dh * k) / 2 - y0 * k;
  const P = (x: number, y: number) => `${(ox + x * k).toFixed(2)} ${(oy + y * k).toFixed(2)}`;
  const c: string[] = ['1 J 1 j 0.35 w'];
  let corAtual = '', trAtual = false;
  const cor = (n: number, fill = false) => { const [r, g, b] = rgb(n); const s = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`; const op = fill ? 'rg' : 'RG'; const key = op + s; if (key !== corAtual || fill) { c.push(`${s} ${op}`); if (!fill) corAtual = key; } };
  const tracejado = (t: boolean) => { if (t !== trAtual) { c.push(t ? '[9 2.5 1.5 2.5] 0 d' : '[] 0 d'); trAtual = t; } };
  const arco = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    if (a1 <= a0) a1 += 360;
    const n = Math.max(8, Math.ceil((a1 - a0) / 6)), pts: string[] = [];
    for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
    c.push(`${pts[0]} m ${pts.slice(1).map(p => p + ' l').join(' ')} S`);
  };
  for (const e of es) if (e.t !== 'TEXT') {
    cor(e.cor); tracejado(e.tr);
    if (e.t === 'LINE') c.push(`${P(e.x, e.y)} m ${P(e.x2, e.y2)} l S`);
    else if (e.t === 'CIRCLE') arco(e.x, e.y, e.r, 0, 360);
    else arco(e.x, e.y, e.r, e.a0, e.a1);
  }
  tracejado(false);
  for (const e of es) if (e.t === 'TEXT' && e.s.trim()) {
    const tam = Math.max(e.h * k / 0.718, 1.2);
    const ax = e.al && isFinite(e.x2) ? e.x2 : e.x, ay = e.al && isFinite(e.y2) ? e.y2 : e.y;
    const w = largura(e.s, tam), dx = e.al === 1 ? -w / 2 : e.al === 2 ? -w : 0;
    const a = e.rot * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    const px = ox + ax * k + dx * co, py = oy + ay * k + dx * si;
    cor(e.cor, true);
    c.push(`BT /F1 ${tam.toFixed(2)} Tf ${co.toFixed(4)} ${si.toFixed(4)} ${(-si).toFixed(4)} ${co.toFixed(4)} ${px.toFixed(2)} ${py.toFixed(2)} Tm (${txtPdf(e.s)}) Tj ET`);
  }
  // moldura e carimbo
  c.push('[] 0 d 0 0 0 RG 0 0 0 rg 1 w', `${M - 10} ${M - 10} ${PW - 2 * M + 20} ${PH - 2 * M + 20} re S`, '0.6 w', `${M - 10} ${M + CAR - 10} m ${PW - M + 10} ${M + CAR - 10} l S`);
  const c1 = M - 10 + (PW - 2 * M + 20) * 0.55;
  c.push(`${c1} ${M - 10} m ${c1} ${M + CAR - 10} l S`);
  c.push(`BT /F2 13 Tf ${M} ${M + CAR - 30} Td (${txtPdf(info.titulo)}) Tj ET`);
  if (info.sub) c.push(`BT /F1 9 Tf ${M} ${M + CAR - 46} Td (${txtPdf(info.sub)}) Tj ET`);
  c.push(`BT /F1 9 Tf ${c1 + 10} ${M + CAR - 30} Td (${txtPdf(info.obs ?? 'Medidas em metros - sem escala: use as cotas')}) Tj ET`);
  c.push(`BT /F1 9 Tf ${c1 + 10} ${M + CAR - 46} Td (Folha A3) Tj ET`);

  const conteudo = c.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const off: number[] = [];
  objs.forEach((o, i) => { off.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const b = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i++) b[i] = pdf.charCodeAt(i) & 255;
  return b;
}
