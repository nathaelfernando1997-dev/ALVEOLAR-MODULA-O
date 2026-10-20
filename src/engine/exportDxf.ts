// Exporta a modulação em DXF (R12, só LINE e TEXT) para abrir no AutoCAD.
import type { Painel, Pavimento } from './model.ts';
import type { Prim } from './dxf.ts';
import type { PainelLaje } from './lajes.ts';
import { areaLaje } from './lajes.ts';

class W {
  out: string[] = [];
  line(l: string, x1: number, y1: number, x2: number, y2: number, cor = 7) {
    this.out.push('0', 'LINE', '8', l, '62', String(cor), '10', x1.toFixed(4), '20', y1.toFixed(4), '11', x2.toFixed(4), '21', y2.toFixed(4));
  }
  text(l: string, x: number, y: number, h: number, t: string, cor = 1, rot = 0, centro = false) {
    this.out.push('0', 'TEXT', '8', l, '62', String(cor), '10', x.toFixed(4), '20', y.toFixed(4), '40', h.toFixed(3), '1', t);
    if (rot) this.out.push('50', String(rot));
    if (centro) this.out.push('72', '1', '11', x.toFixed(4), '21', y.toFixed(4));
  }
  rect(l: string, x: number, y: number, w: number, h: number, cor = 7) { this.line(l, x, y, x + w, y, cor); this.line(l, x + w, y, x + w, y + h, cor); this.line(l, x + w, y + h, x, y + h, cor); this.line(l, x, y + h, x, y, cor); }
  dimH(a: number, b: number, y: number, t: string) { this.line('COTA', a, y, b, y, 5); this.line('COTA', a, y - .04, a, y + .04, 5); this.line('COTA', b, y - .04, b, y + .04, 5); this.text('COTA', (a + b) / 2, y + .03, .09, t, 1, 0, true); }
  dimV(x: number, a: number, b: number, t: string) { this.line('COTA', x, a, x, b, 5); this.line('COTA', x - .04, a, x + .04, a, 5); this.line('COTA', x - .04, b, x + .04, b, 5); this.text('COTA', x - .03, (a + b) / 2, .09, t, 1, 90, true); }
  str() { return ['0', 'SECTION', '2', 'ENTITIES', ...this.out, '0', 'ENDSEC', '0', 'EOF'].join('\r\n'); }
}
const br = (v: number) => v.toFixed(2).replace('.', ',');

// arq = planta baixa de cada pavimento (linhas e textos do projeto), desenhada embaixo da modulação em cinza (camada ARQ)
export type ArqPav = { prims: Prim[]; textos: { text: string; x: number; y: number; h: number }[] };
export function exportarDxf(pavs: Pavimento[], ps: Painel[], pl: PainelLaje[] = [], arq: Record<string, ArqPav> = {}): string {
  const w = new W();
  let X = 0;
  const planta = (a: ArqPav | undefined, dx: number, dy: number) => {
    if (!a) return;
    for (const p of a.prims) for (let i = 0; i < p.pts.length - 1; i++) w.line('ARQ', p.pts[i][0] + dx, p.pts[i][1] + dy, p.pts[i + 1][0] + dx, p.pts[i + 1][1] + dy, 8);
    for (const t of a.textos) w.text('ARQ-TEXTO', t.x + dx, t.y + dy, t.h || .1, t.text, 8);
  };
  for (const pav of pavs) {
    const P = ps.filter(p => p.pav === pav.id);
    if (!P.length) continue;
    const b = pav.box, ox = X - b.x0, oy = -b.y0;
    planta(arq[pav.id], ox, oy);
    w.text('TEXTO', X, b.y1 - b.y0 + 1, .35, `MODULAÇÃO PAREDES - ${pav.nome.toUpperCase()}`);
    for (const p of P) {
      const [x1, y1, x2, y2] = p.o === 'H' ? [p.a, p.c, p.a + p.larg, p.c] : [p.c, p.a, p.c, p.a + p.larg];
      w.line('PAINEL', x1 + ox, y1 + oy, x2 + ox, y2 + oy, p.num % 2 ? 5 : 30);
      const m = (p.a + p.b) / 2;
      const [tx, ty] = p.o === 'H' ? [m, p.c - .25] : [p.c + .25, m];
      w.text('NUMERO', tx + ox, ty + oy, .18, String(p.num), 1, 0, true);
    }
    // vistas ao lado
    let vx = X + (b.x1 - b.x0) + 3, vy = b.y1 - b.y0, lx = vx;
    for (const p of P) {
      if (vx + p.larg > lx + 24) { vx = lx; vy -= 4.4; }
      const y = vy - p.H;
      w.rect('PAINEL', vx, y, p.larg, p.H);
      w.text('NUMERO', vx + .06, y + p.H - .22, .14, String(p.num));
      w.dimH(vx, vx + p.larg, y + p.H + .2, br(p.larg)); w.dimV(vx - .22, y, y + p.H, br(p.H));
      for (const r of p.recortes) {
        w.rect('RECORTE', vx + r.dl, y + r.base, r.w, r.h);
        w.text('TEXTO', vx + r.dl + r.w * .42, y + r.base + Math.min(r.h * .25, .22), .08, r.tipo, 1, 0, true);
        w.dimH(vx + r.dl, vx + r.dl + r.w, y + r.base + r.h - .12, br(r.w)); w.dimV(vx + r.dl + r.w - .1, y + r.base, y + r.base + r.h, br(r.h));
        if (r.dl > .02) w.dimH(vx, vx + r.dl, y + r.base + r.h * .35, br(r.dl));
        if (r.base > .005) w.dimV(vx + r.dl + r.w / 2, y, y + r.base, br(r.base));
      }
      vx += p.larg + 1.1;
    }
    // lajes: abaixo da planta
    const L = pl.filter(p => p.pav === pav.id);
    if (L.length) planta(arq[pav.id], ox, oy - (b.y1 - b.y0) - 4);
    for (const p of L) {
      const x0 = p.x0 + ox, y0 = p.y0 + oy - (b.y1 - b.y0) - 4;
      if (p.dente) {
        // painel em L
        const d = p.dente, cx0 = d.x0 <= p.x0 + 1e-6, cy0 = d.y0 <= p.y0 + 1e-6, dx = x0 - p.x0, dy = y0 - p.y0;
        const [ix, iy, ox2, oy2, qx, qy] = [cx0 ? d.x1 : d.x0, cy0 ? d.y1 : d.y0, cx0 ? p.x0 : p.x1, cy0 ? p.y0 : p.y1, cx0 ? p.x1 : p.x0, cy0 ? p.y1 : p.y0];
        const pts = [[ix, oy2], [qx, oy2], [qx, qy], [ox2, qy], [ox2, iy], [ix, iy], [ix, oy2]];
        for (let i = 0; i < pts.length - 1; i++) w.line('LAJE', pts[i][0] + dx, pts[i][1] + dy, pts[i + 1][0] + dx, pts[i + 1][1] + dy, 5);
      } else w.rect('LAJE', x0, y0, p.x1 - p.x0, p.y1 - p.y0, 5);
      w.text('LAJE', x0 + (p.x1 - p.x0) / 2, y0 + (p.y1 - p.y0) / 2, .2, `L${p.num}`, 1, 0, true);
      w.text('LAJE', x0 + (p.x1 - p.x0) / 2, y0 + (p.y1 - p.y0) / 2 - .25, .1, `${br(p.comp)} x ${br(p.larg)}`, 7, 0, true);
    }
    if (L.length) w.text('TEXTO', X, -(b.y1 - b.y0) - 3, .3, `LAJE SOBRE ${pav.nome.toUpperCase()}`);
    X = lx + 30;
  }
  return w.str();
}

export function exportarCsv(ps: Painel[], pavs: Pavimento[], pl: PainelLaje[] = []): string {
  const nome = new Map(pavs.map(p => [p.id, p.nome]));
  const linhas = ['Painel;Pavimento;Largura (m);Altura (m);Área (m²);Recortes;Observação'];
  for (const p of ps) linhas.push([p.num, nome.get(p.pav), br(p.larg), br(p.H), br(p.larg * p.H), p.recortes.map(r => `${r.tipo} ${br(r.w)}x${br(r.h)} (base ${br(r.base)}, lateral ${br(r.dl)})`).join(' | '), p.aviso || ''].join(';'));
  linhas.push('', 'Laje;Sobre o pavimento;Comprimento (m);Largura (m);Área (m²)');
  for (const p of pl) linhas.push([`L${p.num}`, nome.get(p.pav), br(p.comp), br(p.larg), br(areaLaje(p)), p.dente ? `dente ${br(p.dente.x1 - p.dente.x0)} x ${br(p.dente.y1 - p.dente.y0)}` : ''].join(';'));
  return '﻿' + linhas.join('\r\n');
}
