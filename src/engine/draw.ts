// Desenhos em SVG: planta de montagem e vistas dos painéis.
import type { Prim } from './dxf.ts';
import type { Painel, Pavimento, VaoInteiro, Leitura } from './model.ts';

const br = (v: number) => v.toFixed(2).replace('.', ',');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const AZUL = '#1a3fd6', VERM = '#d11', ROSA = '#c0c', CINZA = '#6b6b6b';

type Caixa = [number, number, number, number]; // x0,y0,x1,y1 (metros, planta)
// área sobreposta (para escolher a posição menos ruim quando nenhuma está livre)
const sobra = (occ: Caixa[], bs: Caixa[]) => bs.reduce((s, b) => s + occ.reduce((t, o) => t + Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1])), 0), 0);

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

export interface Quadro { vb: string; X: (x: number) => number; Y: (y: number) => number; k: number; iX: (px: number) => number; iY: (py: number) => number }
export function quadro(pav: Pavimento, pad = 1.4): Quadro {
  const b = pav.box, x0 = b.x0 - pad, x1 = b.x1 + pad, y0 = b.y0 - pad, y1 = b.y1 + pad, k = 100;
  return { vb: `0 0 ${((x1 - x0) * k).toFixed(0)} ${((y1 - y0) * k).toFixed(0)}`, X: (x: number) => (x - x0) * k, Y: (y: number) => (y1 - y) * k, k, iX: (px: number) => px / k + x0, iY: (py: number) => y1 - py / k };
}
// desenho da planta baixa (paredes, portas, janelas) em cinza escuro
export function arqSvg(q: Quadro, arq: Prim[]): string {
  return arq.map(p => `<polyline points="${p.pts.map(v => `${q.X(v[0]).toFixed(1)},${q.Y(v[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${CINZA}" stroke-width="1.3"/>`).join('');
}
// planta de montagem: planta baixa + número dos painéis + cotas
export function plantaSvg(L: Leitura, pav: Pavimento, ps: Painel[], vaos: VaoInteiro[], arq: Prim[]): string {
  const q = quadro(pav);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${q.vb}">${plantaConteudo(L, pav, ps, vaos, arq, q)}</svg>`;
}
export const AMBIENTE_RE = /^(SALA|COZINHA|QUARTO|SU[IÍ]TE|BANHO|BANHEIRO|WC|LAVABO|GARAGEM|VARANDA|SACADA|[AÁ]REA|SERVI[CÇ]O|LAVANDERIA|DESPENSA|DEP[OÓ]SITO|CLOSET|CIRCULA[CÇ][AÃ]O|CORREDOR|HALL|ESCRIT[OÓ]RIO|OFFICE|GOURMET|ESTAR|JANTAR|COPA|KIT|APTO|APARTAMENTO|LOJA|ESCADA)\b[^0-9]*\d?$/i;
export function plantaConteudo(L: Leitura, pav: Pavimento, ps: Painel[], vaos: VaoInteiro[], arq: Prim[], q: Quadro): string {
  const b = pav.box, { X, Y, k } = q;
  const g: string[] = [arqSvg(q, arq)];
  const tags = L.tags.filter(t => t.x > b.x0 - 0.5 && t.x < b.x1 + 0.5 && t.y > b.y0 - 0.5 && t.y < b.y1 + 0.5);
  const occ: Caixa[] = [];
  for (const t of tags) { occ.push([t.x - 0.25, t.y - 0.13, t.x + 0.25, t.y + 0.13]); g.push(`<text x="${X(t.x)}" y="${Y(t.y) + 7}" font-size="20" fill="${ROSA}" text-anchor="middle">${esc(t.text)}</text>`); }
  // nome dos ambientes do projeto (ajuda a achar a parede na obra), em cinza
  for (const t of L.textos) {
    if (!(t.x > b.x0 && t.x < b.x1 && t.y > b.y0 && t.y < b.y1) || !AMBIENTE_RE.test(t.text.trim()) || t.text.length > 28) continue;
    const w = 0.09 * t.text.length; occ.push([t.x - w / 2, t.y - 0.1, t.x + w / 2, t.y + 0.1]);
    g.push(`<text x="${X(t.x)}" y="${Y(t.y) + 5}" font-size="14" fill="#8a8a8a" text-anchor="middle">${esc(t.text.trim())}</text>`);
  }
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
    let esc_: [number, number, number, Caixa] | null = null, pior = Infinity;
    busca: for (const s of [s0, -s0]) {
      for (const al of [0, -0.25, 0.25, -0.5, 0.5, -0.8, 0.8, -1.1, 1.1]) {
        const mm = m + al; if (al && !(p.a + 0.1 <= mm && mm <= p.b - 0.1)) continue;
        const [bx, by] = p.o === 'H' ? [mm, p.c + s * (0.12 + h / 2)] : [p.c + s * (0.12 + w / 2), mm];
        const cb: Caixa = [bx - w / 2, by - h / 2, bx + w / 2, by + h / 2];
        const sb = sobra(occ, [cb]);
        if (sb < pior) { pior = sb; esc_ = [bx, by, s, cb]; }
        if (sb === 0) break busca;
      }
    }
    occ.push(esc_![3]); lado.set(kk, esc_![2]);
    g.push(`<text x="${X(esc_![0]).toFixed(1)}" y="${(Y(esc_![1]) + 8).toFixed(1)}" font-size="${NUMH * k}" fill="${VERM}" text-anchor="middle" font-weight="bold">${lab}</text>`);
  }
  for (const [kk, gp] of grupos) {
    const p = gp[0], s = lado.get(kk)!, t = br(p.comp), tw = 0.09 * t.length + 0.08;
    // ocupação da cota: linha, texto (do lado de cima/esquerda da linha, como no desenho) e linhas de chamada
    const faixa = (off: number, sg: number): Caixa[] => {
      const lc = p.c + sg * off, lo = Math.min(p.c + sg * 0.1, lc), hi = Math.max(p.c + sg * 0.1, lc), m = (p.a + p.b) / 2;
      if (p.o === 'H') return [[p.a + 0.03, lc - 0.05, p.b - 0.03, lc + 0.05], [m - tw / 2, lc, m + tw / 2, lc + 0.2], [p.a - 0.03, lo, p.a + 0.03, hi], [p.b - 0.03, lo, p.b + 0.03, hi]];
      return [[lc - 0.05, p.a + 0.03, lc + 0.05, p.b - 0.03], [lc - 0.2, m - tw / 2, lc, m + tw / 2], [lo, p.a - 0.03, hi, p.a + 0.03], [lo, p.b - 0.03, hi, p.b + 0.03]];
    };
    const cands: [number, number][] = [0.4, 0.55, 0.7, 0.85, 1.0, 1.2, 1.4].map(o => [o, -s] as [number, number]).concat([0.75, 0.9, 1.05, 1.2, 1.4].map(o => [o, s] as [number, number]));
    let ch = cands[0], pior = Infinity;
    for (const c of cands) { const sb = sobra(occ, faixa(c[0], c[1])); if (sb < pior - 1e-9) { pior = sb; ch = c; } if (sb === 0) break; }
    occ.push(...faixa(ch[0], ch[1]));
    g.push(cotaSvg(X, Y, p.o, p.a, p.b, p.c, ch[0] * ch[1], t, 15));
  }
  void vaos;
  return g.join('');
}

// vista de um painel (unidades: 1 m = 100)
// info: etiqueta da peça, painéis que encostam em cada lado e de que face a vista é vista
export interface InfoVista { codigo: string; esq: string; dir: string; face: string }
export function vistaSvg(p: Painel, info?: InfoVista, escMm = 18): string {
  const f = 18 / escMm, k = 100, w = p.larg, h = p.H, mx = 0.55, my = 0.45;
  const max = Math.max(16, Math.round((w + 0.6) * 18 / f)), linhas: string[] = [];
  for (const pal of (p.aviso || '').split(' ').filter(Boolean)) { const u = linhas.length - 1; if (u >= 0 && (linhas[u] + ' ' + pal).length <= max) linhas[u] += ' ' + pal; else linhas.push(pal); }
  const ext = info ? 0.26 * f : 0;   // duas linhas embaixo: vizinhos e face
  const W = (w + 2 * mx) * k, Hh = (h + my + 0.35 * f + ext + Math.max(0, linhas.length - 1) * 0.13 * f) * k;
  const X = (x: number) => (x + mx) * k, Y = (y: number) => (h + my - y) * k;
  const s: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${Hh.toFixed(0)}" style="width:${(W / 100 * escMm).toFixed(1)}mm">`];
  const L = (x1: number, y1: number, x2: number, y2: number, c = '#000', sw = 1.2) => s.push(`<line x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="${c}" stroke-width="${sw}"/>`);
  const T = (x: number, y: number, t: string, fs = 12, c = VERM, anc = 'middle', rot = false) => s.push(`<text x="${X(x).toFixed(1)}" y="${Y(y).toFixed(1)}" font-size="${(fs * f).toFixed(1)}" fill="${c}" text-anchor="${anc}" paint-order="stroke" stroke="#fff" stroke-width="3"${rot ? ` transform="rotate(-90 ${X(x).toFixed(1)} ${Y(y).toFixed(1)})"` : ''}>${t}</text>`);
  const dimH = (a: number, b: number, y: number, t: string) => { L(a, y, b, y, AZUL, 0.8); L(a, y - 0.04, a, y + 0.04, AZUL, 0.8); L(b, y - 0.04, b, y + 0.04, AZUL, 0.8); T((a + b) / 2, y + 0.03, t, 11); };
  const dimV = (x: number, a: number, b: number, t: string) => { L(x, a, x, b, AZUL, 0.8); L(x - 0.04, a, x + 0.04, a, AZUL, 0.8); L(x - 0.04, b, x + 0.04, b, AZUL, 0.8); T(x - 0.03, (a + b) / 2, t, 11, VERM, 'middle', true); };
  // topo inclinado (chanfro): altura ha na esquerda e hb na direita
  const ha = p.chanfro?.ha ?? h, hb = p.chanfro?.hb ?? h, hEm = (x: number) => ha + (hb - ha) * x / w;
  L(0, 0, w, 0); L(w, 0, w, hb); L(w, hb, 0, ha); L(0, ha, 0, 0); L(-0.3, 0, w + 0.1, 0);
  for (let i = 1; i < 5; i++) { const z = Math.min(ha, hb) * i / 5; L(-0.08, z, 0, z, '#000', 0.8); L(w, z, w + 0.08, z, '#000', 0.8); }
  s.push(`<text x="${X(0.06)}" y="${Y(Math.min(ha, hb) - 0.2 * f)}" font-size="${(16 * f).toFixed(1)}" fill="${VERM}" font-weight="bold">${info ? esc(info.codigo) : p.num}</text>`);
  // topo da peça (não montar de cabeça para baixo)
  if (info) { const largo = w > 0.13 * f * (info.codigo.length + 6); s.push(`<text x="${X(largo ? w - 0.05 : 0.06)}" y="${Y(Math.min(ha, hb) - (largo ? 0.13 : 0.36) * f)}" font-size="${(9 * f).toFixed(1)}" fill="#555" text-anchor="${largo ? 'end' : 'start'}">▲ topo</text>`); }
  dimH(0, w, h + 0.2, br(w)); dimV(-0.22, 0, ha, br(ha));
  if (p.chanfro) { dimV(w + 0.25, 0, hb, br(hb)); T(w / 2, h + 0.2 + 0.16 * f, `topo chanfrado ${br(ha)} → ${br(hb)}`, 10, '#b00'); }
  for (const r of p.recortes) {
    const ox = r.dl, ob = r.base, ow = r.w, oh = r.h;
    s.push(`<rect x="${X(ox).toFixed(1)}" y="${Y(ob + oh).toFixed(1)}" width="${(ow * k).toFixed(1)}" height="${(oh * k).toFixed(1)}" fill="none" stroke="#000" stroke-width="1"/>`);
    T(ox + ow * 0.42, ob + Math.min(oh * 0.25, 0.22), r.tipo, 10, '#900');
    dimH(ox, ox + ow, ob + oh - 0.12, br(ow));
    dimV(ox + ow - 0.1, ob, ob + oh, br(oh));
    if (ox > 0.02) dimH(0, ox, ob + oh * 0.35, br(ox));
    const dr = w - ox - ow; if (dr > 0.02) dimH(ox + ow, w, ob + oh * 0.6, br(dr));
    if (ob > 0.005) dimV(ox + ow * 0.5, 0, ob, br(ob));
    const hl = hEm(ox + ow * 0.5), top = hl - ob - oh; if (top > 0.005) dimV(ox + ow * 0.5, ob + oh, hl, br(top));
  }
  // aviso quebrado em linhas da largura do painel (não invade o painel do lado)
  if (info) {
    // ◄ peça que encosta à esquerda · à direita ► ; e de que lado se olha a peça
    s.push(`<text x="${X(w / 2)}" y="${Y(-0.14 * f)}" font-size="${(9.5 * f).toFixed(1)}" fill="#1a3fd6" text-anchor="middle">◄ ${esc(info.esq)}  |  ${esc(info.dir)} ►</text>`);
    T(w / 2, -0.27 * f, esc(info.face), 9.5, '#333');
  }
  if (p.aviso) {
    linhas.forEach((l, i) => T(w / 2, -0.22 * f - ext - i * 0.13 * f, esc(l), 10, '#b00'));
  }
  s.push('</svg>');
  return s.join('');
}

// planta das lajes: planta baixa + painéis de laje
import type { LajeAmb, PainelLaje } from './lajes.ts';

// painel de laje em coordenadas do painel: u = comprimento (sentido do vão), v = largura
export function lajeLocal(p: PainelLaje) {
  const d = p.dente && (p.sentido === 'H'
    ? { u0: p.dente.x0 - p.x0, u1: p.dente.x1 - p.x0, v0: p.dente.y0 - p.y0, v1: p.dente.y1 - p.y0 }
    : { u0: p.dente.y0 - p.y0, u1: p.dente.y1 - p.y0, v0: p.dente.x0 - p.x0, v1: p.dente.x1 - p.x0 });
  return { L: p.comp, W: p.larg, d };
}

// treliças de reforço dentro do painel, já na vista em pé: x = largura, y = comprimento
export type TrelicaLinha = { n: number; o: 'H' | 'V'; c: number; a: number; b: number; tipo?: string };
export function trelicasNoPainel(p: PainelLaje, T: TrelicaLinha[]) {
  const out: { n: number; vert: boolean; pos: number; i0: number; i1: number; tipo?: string }[] = [];
  for (const t of T) {
    // na planta: H = y constante (x de a a b); V = x constante
    const [cMin, cMax, lMin, lMax] = t.o === 'H' ? [p.y0, p.y1, p.x0, p.x1] : [p.x0, p.x1, p.y0, p.y1];
    if (t.c <= cMin + 0.01 || t.c >= cMax - 0.01) continue;
    const i0 = Math.max(t.a, lMin) - lMin, i1 = Math.min(t.b, lMax) - lMin;
    if (i1 - i0 < 0.1) continue;
    const pos = t.c - cMin;
    // eixo do comprimento do painel = x se sentido H; a treliça corre ao longo dele se t.o === sentido
    const aoLongo = t.o === p.sentido;
    // em pé: comprimento na vertical → treliça ao longo fica vertical (x = pos), atravessando fica horizontal (y = pos)
    out.push({ n: t.n, vert: aoLongo, pos, i0, i1, tipo: t.tipo });
  }
  // duas treliças paralelas a até 6 cm uma da outra: fica só a mais comprida (ela cobre a outra)
  return out.filter(q => !out.some(r => r !== q && r.vert === q.vert && Math.abs(r.pos - q.pos) <= 0.06 && r.i0 <= q.i0 + 0.02 && r.i1 >= q.i1 - 0.02
    && (r.i1 - r.i0 > q.i1 - q.i0 + 1e-6 || (Math.abs((r.i1 - r.i0) - (q.i1 - q.i0)) <= 1e-6 && r.n < q.n))));
}

// vista de produção de um painel de laje (unidades: 1 m = 100), como a vista das paredes:
// em pé — comprimento (alvéolos) na vertical, largura na horizontal
type TrelPainel = ReturnType<typeof trelicasNoPainel>[number];
function trelicasResumo(TT: TrelPainel[], w: number, h: number) {
  const uniq = (v: number[]) => [...v].sort((a, b) => a - b).filter((x, i, a) => !i || x - a[i - 1] > 0.005);
  const PH = uniq(TT.filter(t => !t.vert).map(t => t.pos)), PV = uniq(TT.filter(t => t.vert).map(t => t.pos));
  const NT = TT.filter(t => t.i0 > 0.02 || t.i1 < (t.vert ? h : w) - 0.02)
    .map(t => `T${t.n}: de ${br(t.i0)} a ${br(t.i1)} ${t.vert ? 'de baixo' : 'da esquerda'} (${br(t.i1 - t.i0)} m)`);
  return { PH, PV, NT };
}
// f = aumento das letras quando a vista sai numa escala menor que 18 mm/m (texto do mesmo tamanho no papel)
export const extraVistaLaje = (p: PainelLaje, TR: TrelicaLinha[], f = 1) => { const loc = lajeLocal(p), r = trelicasResumo(trelicasNoPainel(p, TR), loc.W, loc.L);
  return { larg: Math.max(r.PH.length ? 0.08 + r.PH.length * 0.17 * f : 0, Math.max(0, ...r.NT.map(n => n.length * 0.05 * f)) - loc.W - 0.6), alt: (r.PV.length ? 0.1 + r.PV.length * 0.17 * f : 0) + r.NT.length * 0.13 * f }; };
export function vistaLajeSvg(p: PainelLaje, notas: string[] = [], TR: TrelicaLinha[] = [], baixoMin = 0, escMm = 18, codigo?: string): string {
  const f = 18 / escMm, k = 100, loc = lajeLocal(p), w = loc.W, h = loc.L, mx = 0.5, my = 0.45;
  const d = loc.d && { u0: loc.d.v0, u1: loc.d.v1, v0: loc.d.u0, v1: loc.d.u1 };
  const TT = trelicasNoPainel(p, TR), TH = TT.filter(t => !t.vert).sort((a, b) => a.pos - b.pos), TV = TT.filter(t => t.vert).sort((a, b) => a.pos - b.pos);
  // cotas das treliças fora do painel: horizontais à direita, verticais embaixo (uma fileira por treliça, sem sobrepor)
  const { PH, PV, NT } = trelicasResumo(TT, w, h), DT = 0.17 * f, extD = PH.length ? 0.08 + PH.length * DT : 0, extB = PV.length ? 0.1 + PV.length * DT : 0;
  const Hh = (h + my + 0.35 + Math.max(baixoMin, extB + (NT.length + notas.length) * 0.13 * f) + 0.15 * f) * k, Wd = Math.max(w + 2 * mx + extD, Math.max(0, ...NT.map(n => n.length * 0.05 * f + 0.2))) * k;
  const X = (x: number) => (x + mx) * k, Y = (y: number) => (h + my - y) * k;
  const s: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Wd.toFixed(0)} ${Hh.toFixed(0)}" style="width:${(Wd / 100 * escMm).toFixed(1)}mm">`];
  const Ln = (x1: number, y1: number, x2: number, y2: number, c = '#000', sw = 1.2, da = '') => s.push(`<line x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="${c}" stroke-width="${sw}"${da ? ` stroke-dasharray="${da}"` : ''}/>`);
  const T = (x: number, y: number, t: string, fs = 12, c = VERM, rot = false) => s.push(`<text x="${X(x).toFixed(1)}" y="${Y(y).toFixed(1)}" font-size="${(fs * f).toFixed(1)}" fill="${c}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3"${rot ? ` transform="rotate(-90 ${X(x).toFixed(1)} ${Y(y).toFixed(1)})"` : ''}>${t}</text>`);
  const dimH = (a: number, b: number, y: number, t: string) => { Ln(a, y, b, y, AZUL, 0.8); Ln(a, y - 0.04, a, y + 0.04, AZUL, 0.8); Ln(b, y - 0.04, b, y + 0.04, AZUL, 0.8); T((a + b) / 2, y + 0.03, t, 11); };
  const dimV = (x: number, a: number, b: number, t: string) => { Ln(x, a, x, b, AZUL, 0.8); Ln(x - 0.04, a, x + 0.04, a, AZUL, 0.8); Ln(x - 0.04, b, x + 0.04, b, AZUL, 0.8); T(x - 0.03, (a + b) / 2, t, 11, VERM, true); };
  // contorno (com o dente recortado num canto)
  if (d) {
    const iu = d.u0 <= 1e-6 ? d.u1 : d.u0, iv = d.v0 <= 1e-6 ? d.v1 : d.v0, cu = d.u0 <= 1e-6 ? 0 : w, cv = d.v0 <= 1e-6 ? 0 : h, ou = w - cu, ov = h - cv;
    const pts = [[iu, cv], [ou, cv], [ou, ov], [cu, ov], [cu, iv], [iu, iv], [iu, cv]];
    for (let i = 0; i < pts.length - 1; i++) Ln(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    Ln(cu, cv, iu, cv, '#999', 0.8, '4 3'); Ln(cu, cv, cu, iv, '#999', 0.8, '4 3');
    T((d.u0 + d.u1) / 2, (d.v0 + d.v1) / 2 - 0.04, 'dente', 10, '#900');
    dimH(d.u0, d.u1, cv === 0 ? d.v1 + 0.12 : d.v0 - 0.18, br(d.u1 - d.u0)); dimV(cu === 0 ? d.u1 + 0.18 : d.u0 - 0.18, d.v0, d.v1, br(d.v1 - d.v0));
  } else { Ln(0, 0, w, 0); Ln(w, 0, w, h); Ln(w, h, 0, h); Ln(0, h, 0, 0); }
  // sentido do vão (alvéolos ao longo do comprimento, em pé)
  Ln(w / 2, 0.15, w / 2, h - 0.15, '#888', 0.8, '6 4'); Ln(w / 2 - 0.08, h - 0.3, w / 2, h - 0.15, '#888', 0.8); Ln(w / 2 + 0.08, h - 0.3, w / 2, h - 0.15, '#888', 0.8);
  const RX = '#7a2bbf', nome = (t: { n: number; tipo?: string }) => `T${t.n}${t.tipo ? ' ' + t.tipo : ''}`;
  // posição: uma cota por posição diferente, fora do painel (deitadas à direita, medidas de baixo; em pé embaixo, medidas da esquerda)
  PH.forEach((pos, i) => { const xd = w + 0.08 + (i + 1) * DT; Ln(w + 0.03, pos, xd + 0.04, pos, '#aab', 0.5, '2 2'); dimV(xd, 0, pos, br(pos)); });
  PV.forEach((pos, i) => { const yd = -0.1 - (i + 1) * DT; Ln(pos, -0.03, pos, yd - 0.04, '#aab', 0.5, '2 2'); dimH(0, pos, yd, br(pos)); });
  for (const t of TH) { Ln(t.i0, t.pos, t.i1, t.pos, RX, 1.6, '8 4'); T((t.i0 + t.i1) / 2, t.pos + 0.06, nome(t), 10, RX); }
  for (const t of TV) { Ln(t.pos, t.i0, t.pos, t.i1, RX, 1.6, '8 4'); T(t.pos > w - 0.25 ? t.pos - 0.08 : t.pos + 0.12, (t.i0 + t.i1) / 2, nome(t), 10, RX, true); }
  // treliça que não pega o painel inteiro: em texto embaixo (sem encher o desenho de cotas)
  NT.forEach((n, i) => T(Wd / k / 2 - mx, -0.25 * f - extB - i * 0.13 * f, n, 9.5, RX));
  s.push(`<text x="${X(0.06)}" y="${Y(h - 0.2 * f)}" font-size="${(16 * f).toFixed(1)}" fill="${VERM}" font-weight="bold">${codigo ? esc(codigo) : 'L' + p.num}</text>`);
  dimH(0, w, h + 0.2, br(w)); dimV(-0.22, 0, h, br(h));
  notas.forEach((n, i) => T(w / 2, -0.25 * f - extB - (NT.length + i) * 0.13 * f, esc(n), 10, '#b00'));
  s.push('</svg>');
  return s.join('');
}
export function lajesConteudo(lj: LajeAmb[], P: PainelLaje[], q: Quadro, tr: (Viga & { n: number })[] = []): string {
  const { X, Y } = q; const g: string[] = [];
  for (const a of lj) {
    if (!a.incluida) g.push(`<rect x="${X(a.x0)}" y="${Y(a.y1)}" width="${X(a.x1) - X(a.x0)}" height="${Y(a.y0) - Y(a.y1)}" fill="url(#hach)" stroke="none"/>`);
    // viga no meio da laje: de face a face das paredes (não passa por cima delas)
    const fx0 = a.x0 + a.esp.o / 2, fx1 = a.x1 - a.esp.l / 2, fy0 = a.y0 + a.esp.s / 2, fy1 = a.y1 - a.esp.n / 2;
    for (const v of a.vigas) g.push(a.sentido === 'H' ? `<line x1="${X(v)}" y1="${Y(fy0)}" x2="${X(v)}" y2="${Y(fy1)}" stroke="#e67700" stroke-width="6" stroke-dasharray="16 8"/>` : `<line x1="${X(fx0)}" y1="${Y(v)}" x2="${X(fx1)}" y2="${Y(v)}" stroke="#e67700" stroke-width="6" stroke-dasharray="16 8"/>`);
  }
  for (const p of P) {
    const x = X(p.x0), y = Y(p.y1), w = X(p.x1) - X(p.x0), h = Y(p.y0) - Y(p.y1);
    if (p.dente) {
      // painel em L: contorno sem o canto do dente
      const d = p.dente, cx0 = d.x0 <= p.x0 + 1e-6, cy0 = d.y0 <= p.y0 + 1e-6;
      const [ix, iy] = [cx0 ? d.x1 : d.x0, cy0 ? d.y1 : d.y0];   // quina de dentro do dente
      const [ox, oy] = [cx0 ? p.x0 : p.x1, cy0 ? p.y0 : p.y1];   // canto cortado
      const [qx, qy] = [cx0 ? p.x1 : p.x0, cy0 ? p.y1 : p.y0];   // canto oposto
      const pts = [[ix, oy], [qx, oy], [qx, qy], [ox, qy], [ox, iy], [ix, iy]].map(([u, v]) => `${X(u).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      g.push(`<polygon points="${pts}" fill="rgba(31,111,209,.10)" stroke="${AZUL}" stroke-width="1.6"/>`);
    } else g.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(31,111,209,.10)" stroke="${AZUL}" stroke-width="1.6"/>`);
    // seta do sentido do vão
    const cx = x + w / 2, cy = y + h / 2;
    if (p.sentido === 'H') g.push(`<line x1="${cx - w * 0.3}" y1="${cy + 22}" x2="${cx + w * 0.3}" y2="${cy + 22}" stroke="${AZUL}" stroke-width="1" marker-end="url(#seta)" marker-start="url(#seta)"/>`);
    else g.push(`<line x1="${cx + 26}" y1="${cy - h * 0.3}" x2="${cx + 26}" y2="${cy + h * 0.3}" stroke="${AZUL}" stroke-width="1" marker-end="url(#seta)" marker-start="url(#seta)"/>`);
    g.push(`<text x="${cx.toFixed(1)}" y="${(cy - 4).toFixed(1)}" font-size="20" font-weight="bold" fill="${VERM}" text-anchor="middle">L${p.num}</text>`);
    g.push(`<text x="${cx.toFixed(1)}" y="${(cy + 14).toFixed(1)}" font-size="13" fill="#222" text-anchor="middle">${br(p.comp)} × ${br(p.larg)}${p.dente ? ' (dente)' : ''}</text>`);
  }
  // treliças de reforço (paredes de cima sobre a laje): linha roxa em zigue-zague com o número
  for (const t of tr.filter(v => v.tipo === 'trelica')) {
    const L = (t.b - t.a) * q.k, n = Math.max(2, Math.round(L / 14)), pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const al = t.a + (t.b - t.a) * i / n, off = (i % 2 ? 1 : -1) * 0.05;
      const [x, y] = t.o === 'H' ? [al, t.c + off] : [t.c + off, al];
      pts.push(`${X(x).toFixed(1)},${Y(y).toFixed(1)}`);
    }
    g.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#7a3fb0" stroke-width="2.5"/>`);
    const [tx, ty] = t.o === 'H' ? [X(t.a) + 18, Y(t.c) - 10] : [X(t.c) + 16, Y(t.a) - 8];
    g.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="17" font-weight="bold" fill="#7a3fb0" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4">T${t.n}</text>`);
  }
  return g.join('');
}
export const DEFS_LAJE = `<defs><pattern id="hach" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="#ccc" stroke-width="2"/></pattern><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${AZUL}"/></marker></defs>`;

// vigas sugeridas: faixa laranja (vermelha se obrigatória), com o número
import type { Viga } from './vigas.ts';
export function vigasConteudo(V: (Viga & { n: number })[], q: Quadro, sel: string | null = null): string {
  const { X, Y } = q; const g: string[] = [];
  for (const v of V) {
    const tr = v.tipo === 'trelica';
    const cor = sel === v.id ? '#0a0' : tr ? '#7a3fb0' : v.obrigatoria ? '#d11' : '#e67700';
    // desenha só o vão livre (a parte em cima das paredes fica no texto)
    const ap = v.apoio ?? 0, va = v.a + ap, vb = v.b - ap;
    const [x1, y1, x2, y2] = v.o === 'H' ? [va, v.c, vb, v.c] : [v.c, va, v.c, vb];
    // treliça: linha fina em zigue-zague (reforço da laje); viga: faixa tracejada
    g.push(`<line x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="${cor}" stroke-width="${tr ? 6 : 14}" stroke-opacity=".55" stroke-dasharray="${tr ? '4 6' : '22 8'}"/>`);
    const [tx, ty] = v.o === 'H' ? [(X(x1) + X(x2)) / 2, Y(y1) - 14] : [X(x1) + 16, (Y(y1) + Y(y2)) / 2];
    g.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="20" font-weight="bold" fill="${cor}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4">${tr ? 'T' : 'V'}${v.n}</text>`);
  }
  return g.join('');
}

// sequência de montagem: cada painel como uma faixa azul com a ordem num círculo e o número da peça
export function sequenciaConteudo(ps: Painel[], ordem: Map<number, number>, q: Quadro): string {
  const { X, Y } = q, g: string[] = [];
  for (const p of ps) {
    const [x1, y1, x2, y2] = p.o === 'H' ? [p.a, p.c, p.b, p.c] : [p.c, p.a, p.c, p.b];
    g.push(`<line x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="${AZUL}" stroke-width="9" stroke-opacity=".35"/>`);
  }
  for (const p of ps) {
    const m = (p.a + p.b) / 2, [x, y] = p.o === 'H' ? [m, p.c] : [p.c, m], n = ordem.get(p.num) ?? 0;
    g.push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="17" fill="#fff" stroke="${AZUL}" stroke-width="2.5"/>`);
    g.push(`<text x="${X(x).toFixed(1)}" y="${(Y(y) + 6).toFixed(1)}" font-size="17" font-weight="bold" fill="${AZUL}" text-anchor="middle">${n}</text>`);
    const [tx, ty] = p.o === 'H' ? [X(x), Y(y) + 34] : [X(x) + 34, Y(y) + 5];
    g.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="12" fill="${VERM}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">P${p.num}</text>`);
  }
  return g.join('');
}

// escoramento das lajes: linhas tracejadas verdes perpendiculares ao vão, com a distância entre elas
import type { LinhaEscora } from './producao.ts';
export function escorasConteudo(L: LinhaEscora[], V: { o: 'H' | 'V'; ini: number; fim: number; c: number; n: number; passo: number }[], q: Quadro): string {
  const { X, Y } = q, g: string[] = [], VERDE = '#0a7d2c';
  for (const l of L) {
    const [x1, y1, x2, y2] = l.o === 'H' ? [l.a, l.c, l.b, l.c] : [l.c, l.a, l.c, l.b];
    g.push(`<line x1="${X(x1).toFixed(1)}" y1="${Y(y1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(y2).toFixed(1)}" stroke="${VERDE}" stroke-width="4" stroke-dasharray="14 7"/>`);
  }
  // uma cota do espaçamento por ambiente (no meio do vão, entre a parede e a primeira linha)
  for (const v of V) {
    const a = v.ini, b = v.ini + v.passo, t = `${br(v.passo)}`;
    if (v.o === 'H') g.push(cotaSvg(X, Y, 'H', a, b, v.c, 0, t, 15).replace(/#1a3fd6/g, VERDE));
    else g.push(cotaSvg(X, Y, 'V', a, b, v.c, 0, t, 15).replace(/#1a3fd6/g, VERDE));
    const [lx, ly] = v.o === 'H' ? [(v.ini + v.fim) / 2, v.c - 0.25] : [v.c + 0.3, (v.ini + v.fim) / 2];
    g.push(`<text x="${X(lx).toFixed(1)}" y="${Y(ly).toFixed(1)}" font-size="14" fill="${VERDE}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">${v.n} linha${v.n > 1 ? 's' : ''} a cada ${br(v.passo)}</text>`);
  }
  return g.join('');
}

// folha de detalhes típicos (esquemáticos), com as medidas das regras
export function detalhesSvg(r: { esp: number; lajeEsp: number; apoio: number; apoioBorda: number; coluna: number; folga: number; vigaAlt: number; vigaLarg: number }): string {
  const k = 700, BW = 1200, BH = 1050, s: string[] = [];   // 1 m = 700 unidades
  const caixa = (i: number, tit: string, corpo: string) => s.push(`<g transform="translate(${(i % 3) * (BW + 60)},${Math.floor(i / 3) * (BH + 60)})"><rect x="0" y="0" width="${BW}" height="${BH}" fill="#fff" stroke="#999" stroke-width="2"/><text x="24" y="52" font-size="40" font-weight="bold" fill="#c00">${tit}</text>${corpo}<text x="24" y="${BH - 24}" font-size="24" fill="#777">Esquemático · armaduras, grautes e ligações conforme o projeto estrutural</text></g>`);
  const R = (x: number, y: number, w: number, h: number, f = '#d9d9d9', da = '') => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${f}" stroke="#000" stroke-width="3"${da ? ` stroke-dasharray="${da}"` : ''}/>`;
  const T = (x: number, y: number, t: string, fs = 30, c = '#222', anc = 'start') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${fs}" fill="${c}" text-anchor="${anc}">${t}</text>`;
  const cH = (x1: number, x2: number, y: number, t: string, dy = -12) => `<g stroke="${AZUL}" stroke-width="2"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - 14}" x2="${x1}" y2="${y + 14}"/><line x1="${x2}" y1="${y - 14}" x2="${x2}" y2="${y + 14}"/></g>${T((x1 + x2) / 2, y + dy, t, 30, VERM, 'middle')}`;
  const cV = (x: number, y1: number, y2: number, t: string) => `<g stroke="${AZUL}" stroke-width="2"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - 14}" y1="${y1}" x2="${x + 14}" y2="${y1}"/><line x1="${x - 14}" y1="${y2}" x2="${x + 14}" y2="${y2}"/></g><text x="${x - 12}" y="${(y1 + y2) / 2}" font-size="30" fill="${VERM}" text-anchor="middle" transform="rotate(-90 ${x - 12} ${(y1 + y2) / 2})">${t}</text>`;
  const cm = (v: number) => `${Math.round(v * 100)} cm`;
  const alv = (x: number, y: number, w: number, h: number) => { let o = ''; const n = Math.max(1, Math.floor(w / 90)); for (let i = 0; i < n; i++) { const cx = x + w * (i + 0.5) / n; o += `<rect x="${cx - 26}" y="${y + h * 0.22}" width="52" height="${h * 0.56}" fill="#fff" stroke="#999" stroke-width="1.5"/>`; } return o; };
  const e = r.esp * k, le = r.lajeEsp * k;
  // 1. canto em L (planta): as duas paredes param quina com quina e deixam o quadrado do canto (espessura × espessura) para a coluna
  caixa(0, '1 · Canto em L (planta)', R(260 + e, 260, 760 - e, e) + R(260, 260 + e, e, 600) + R(260, 260, e, e, '#9cc3ff', '10 6') +
    T(260 + e / 2 + 380, 240, 'painel', 30, '#222', 'middle') + T(260 + e + 30, 700, 'painel') +
    cH(260, 260 + e, 200, cm(r.esp)) + cV(220, 260, 260 + e, cm(r.esp)) +
    `<line x1="${260 + e + 60}" y1="${260 + e + 60}" x2="${260 + e + 8}" y2="${260 + e + 8}" stroke="${AZUL}" stroke-width="2"/>` +
    T(260 + e + 70, 260 + e + 80, `coluna ${cm(r.esp)} × ${cm(r.esp)} concretada na obra`, 28, AZUL) +
    T(260 + e + 70, 260 + e + 118, 'paredes quina com quina, sem passar uma pela outra', 26, '#444'));
  // 2. encontro em T (planta)
  caixa(1, '2 · Encontro em T (planta)', R(150, 260, 900, e) + R(600 - e / 2, 260 + e, e, 600) + T(600, 240, 'painel contínuo (passa direto)', 30, '#222', 'middle') +
    T(600 + e / 2 + 30, 700, 'painel que chega (encosta)') + cH(600 - e / 2, 600 + e / 2, 920, cm(r.esp), 44) +
    `<line x1="${600 - e / 2}" y1="${260 + e}" x2="${600 + e / 2}" y2="${260 + e}" stroke="#c00" stroke-width="4" stroke-dasharray="10 8"/>`);
  // 3. emenda alinhada com coluna (planta)
  const c = r.coluna * k;
  caixa(2, `3 · Emenda com coluna de ${cm(r.coluna)} (planta)`, R(80, 470, 520 - c / 2, e) + R(600 + c / 2, 470, 520 - c / 2, e) + R(600 - c / 2, 470, c, e, '#9cc3ff', '10 6') +
    cH(600 - c / 2, 600 + c / 2, 420, cm(r.coluna)) + T(600, 470 + e + 60, 'coluna concretada na obra entre os painéis', 30, AZUL, 'middle') + cV(60, 470, 470 + e, cm(r.esp)) +
    T(340, 470 + e + 130, 'painel', 30, '#222', 'middle') + T(860, 470 + e + 130, 'painel', 30, '#222', 'middle'));
  // 4. apoio da laje na parede (corte): parede do meio com laje dos dois lados; parede da borda com laje de um lado
  const ap = r.apoio * k, ab = r.apoioBorda * k, top = 330, w1 = 420, w2 = 950;
  caixa(3, '4 · Apoio da laje na parede (corte)',
    R(w1, top + le, e, 520) + R(w2, top + le, e, 520) +
    R(60, top, w1 + ap - 60, le, '#eee') + alv(60, top, w1 + ap - 60, le) +
    R(w1 + e - ap, top, w2 + ab - (w1 + e - ap), le, '#eee') + alv(w1 + e - ap, top, w2 + ab - (w1 + e - ap), le) +
    cH(w1, w1 + ap, top - 30, cm(r.apoio)) + cH(w1 + e - ap, w1 + e, top + le + 50, cm(r.apoio), 44) + cH(w2 + ab - ab, w2 + ab, top - 30, cm(r.apoioBorda)) +
    T(w1 - 20, top + le + 300, 'parede com laje', 28, '#222', 'end') + T(w1 - 20, top + le + 340, 'dos dois lados', 28, '#222', 'end') + T(w2 - 20, top + le + 300, 'parede de borda', 28, '#222', 'end') +
    cV(w2 + e + 60, top, top + le, cm(r.lajeEsp)));
  // 5. laje apoiada na viga (corte)
  const va = r.vigaAlt * k, vl = r.vigaLarg * k;
  caixa(4, '5 · Laje apoiada na viga (corte)', R(600 - vl / 2, 330 + le, vl, va, '#bdbdbd') +
    R(100, 330, 500 - 6, le, '#eee') + alv(100, 330, 494, le) + R(606, 330, 494, le, '#eee') + alv(606, 330, 494, le) +
    cH(600 - vl / 2, 600 + vl / 2, 330 + le + va + 60, `viga ${cm(r.vigaLarg)}`, 44) + cV(600 + vl / 2 + 60, 330 + le, 330 + le + va, cm(r.vigaAlt)) +
    T(600, 280, 'posição das vigas: folha de vigas · dimensionar com o engenheiro', 28, '#222', 'middle'));
  // 6. treliça embaixo de parede do pavimento de cima (corte)
  caixa(5, '6 · Treliça na laje embaixo de parede (corte)', R(100, 560, 1000, le, '#eee') + alv(100, 560, 1000, le) + R(600 - e / 2, 160, e, 400) +
    `<polyline points="${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => `${600 - 80 + i * 20},${i % 2 ? 560 + 10 : 560 + le - 10}`).join(' ')}" fill="none" stroke="#7a3fb0" stroke-width="6"/>` +
    T(600 + e / 2 + 30, 300, 'parede do pavimento de cima') + T(600, 560 + le + 70, 'treliça centrada no eixo da parede', 30, '#7a3fb0', 'middle') +
    T(600, 560 + le + 115, 'posição e comprimento: folha de treliças', 28, '#7a3fb0', 'middle'));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${3 * BW + 140} ${2 * BH + 80}">${s.join('')}</svg>`;
}
