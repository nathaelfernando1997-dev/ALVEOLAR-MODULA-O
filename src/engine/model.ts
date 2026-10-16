// Modulação de paredes alveolares a partir da planta (DXF).
import { entPrims, entText, insertPrims } from './dxf.ts';
import type { Dxf, Pt, Prim } from './dxf.ts';

// ---------------- configuração ----------------
export interface Regras {
  larguraMax: number;      // 3,50
  coluna: number;          // 0,15 entre painéis
  folga: number;           // 0,05 tirado de cada painel
  boneca: number;          // 0,10 lateral e embaixo
  acrescimoLargura: number;// +0,10 nos recortes
  janelaDesce: number;     // 0,05 (recorte desce e sobe 5 cm)
  espMin: number; espMax: number; // espessura de parede reconhecida (m)
  minParede: number;       // trecho mínimo para virar painel
  naoFabricar: number;     // abaixo disso marca "n fabricar"
}
export const REGRAS_PADRAO: Regras = {
  larguraMax: 3.5, coluna: 0.15, folga: 0.05, boneca: 0.10, acrescimoLargura: 0.10, janelaDesce: 0.05,
  espMin: 0.12, espMax: 0.27, minParede: 0.12, naoFabricar: 0.25,
};

export interface Esquadria { tag: string; larg: number; alt: number; peit: number }  // metros
export interface Box { x0: number; x1: number; y0: number; y1: number }
export interface Pavimento { id: string; nome: string; box: Box; altura: number; ativo: boolean }

// ---------------- leitura da planta ----------------
export interface Leitura {
  regioes: Box[];                 // agrupamentos de paredes (plantas, cortes, fachadas…)
  tags: { text: string; x: number; y: number }[];
  quadro: Esquadria[];
  textos: { text: string; x: number; y: number; h: number }[];
  prims: Prim[];                  // geometria toda (para desenhar)
  paredes: Prim[];                // geometria da camada de parede
}

const TAG_RE = /^[PJ]\s?-?\d{1,2}[A-Z]?$/i;
const normTag = (t: string) => t.toUpperCase().replace(/[\s-]/g, '');

export function ler(d: Dxf, camadaParede: string): Leitura {
  const prims: Prim[] = [];
  for (const e of d.ents) prims.push(...entPrims(e));
  const paredes = d.ents.filter(e => e.layer === camadaParede).flatMap(entPrims);
  const textos = d.ents.map(entText).filter((t): t is NonNullable<typeof t> => !!t && !!t.text);
  const tags: Leitura['tags'] = [];
  for (const ins of d.inserts) for (const a of ins.attribs) if (TAG_RE.test(a.text.trim())) tags.push({ text: normTag(a.text.trim()), x: ins.x, y: ins.y });
  const regioes = agrupar(paredes);
  const dentro = (x: number, y: number) => regioes.some(b => x > b.x0 - 0.3 && x < b.x1 + 0.3 && y > b.y0 - 0.3 && y < b.y1 + 0.3);
  for (const t of textos) if (TAG_RE.test(t.text) && dentro(t.x, t.y)) tags.push({ text: normTag(t.text), x: t.x, y: t.y });
  const quadro = lerQuadro(textos, regioes);
  const Q = new Map(quadro.map(q => [q.tag, q]));
  // blocos de porta dinâmicos trazem várias folhas (arcos); fica só a do tamanho da porta
  for (const ins of d.inserts) {
    const pr = insertPrims(d, ins);
    const arcs = pr.filter(p => p.kind === 'arc') as Extract<Prim, { kind: 'arc' }>[];
    if (arcs.length < 3) { prims.push(...pr); continue; }
    const tg = tags.reduce<{ t: Leitura['tags'][number] | null; d: number }>((m, t) => { const dd = Math.hypot(t.x - ins.x, t.y - ins.y); return dd < m.d ? { t, d: dd } : m; }, { t: null, d: 1.2 }).t;
    const q = tg ? Q.get(tg.text) : undefined;
    const alvo = q ? (q.larg > 1.2 ? q.larg / 2 : q.larg) - 0.01 : 0.79;
    const rr = arcs.reduce((m, a) => Math.abs(a.r - alvo) < Math.abs(m - alvo) ? a.r : m, arcs[0].r);
    const sel = arcs.filter(a => Math.abs(a.r - rr) < 0.02);
    prims.push(...sel);
    for (const p of pr) {
      if (p.kind !== 'line') continue;
      const comp = p.pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p.pts[i][0], q[1] - p.pts[i][1]), 0);
      const doCentro = sel.some(a => [p.pts[0], p.pts[p.pts.length - 1]].some(q => Math.hypot(q[0] - a.c[0], q[1] - a.c[1]) < 0.03));
      if (comp < 0.2 || (doCentro && Math.abs(comp - rr) < 0.06)) prims.push(p);
    }
  }
  return { regioes, tags, quadro, textos, prims, paredes };
}

// agrupa as linhas de parede em regiões (cada planta/corte vira uma região)
function agrupar(ps: Prim[]): Box[] {
  const bx = ps.map(p => { const xs = p.pts.map(q => q[0]), ys = p.pts.map(q => q[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
  const par = bx.map((_, i) => i);
  const f = (i: number): number => (par[i] === i ? i : (par[i] = f(par[i])));
  const gap = 0.6;
  const ord = bx.map((b, i) => i).sort((a, b) => bx[a].x0 - bx[b].x0);
  for (let a = 0; a < ord.length; a++) {
    const A = bx[ord[a]];
    for (let b = a + 1; b < ord.length; b++) {
      const B = bx[ord[b]];
      if (B.x0 > A.x1 + gap) break;
      if (B.y0 <= A.y1 + gap && A.y0 <= B.y1 + gap) par[f(ord[a])] = f(ord[b]);
    }
  }
  const grupos = new Map<number, Box & { comp: number }>();
  bx.forEach((b, i) => {
    const r = f(i); const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
    const g = grupos.get(r);
    if (!g) grupos.set(r, { ...b, comp: len });
    else { g.x0 = Math.min(g.x0, b.x0); g.x1 = Math.max(g.x1, b.x1); g.y0 = Math.min(g.y0, b.y0); g.y1 = Math.max(g.y1, b.y1); g.comp += len; }
  });
  return [...grupos.values()].filter(g => g.comp > 15 && (g.x1 - g.x0) > 3 && (g.y1 - g.y0) > 3)
    .sort((a, b) => a.x0 - b.x0).map(({ x0, x1, y0, y1 }) => ({ x0, x1, y0, y1 }));
}

// quadro de aberturas: "P01 … 150 CM … 365 CM" / "J01 … 80 CM 70 CM 160 CM"
function lerQuadro(textos: Leitura['textos'], regioes: Box[]): Esquadria[] {
  const dentro = (x: number, y: number) => regioes.some(b => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1);
  const out = new Map<string, Esquadria>();
  for (const t of textos) {
    if (!TAG_RE.test(t.text) || dentro(t.x, t.y)) continue;
    const linha = textos.filter(o => o !== t && Math.abs(o.y - t.y) < Math.max(0.06, t.h * 0.6) && o.x > t.x && o.x < t.x + 15 && /\d+([.,]\d+)?\s*CM/i.test(o.text))
      .sort((a, b) => a.x - b.x).map(o => parseFloat(o.text.replace(',', '.')) / 100);
    if (linha.length < 2) continue;
    const tag = normTag(t.text);
    out.set(tag, { tag, larg: linha[0], alt: linha[1], peit: tag.startsWith('J') ? (linha[2] ?? 1.1) : 0 });
  }
  return [...out.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

// ---------------- paredes ----------------
type Face = { c: number; a: number; b: number };
type Eixo = { c: number; ps: [number, number][] };

function faces(ps: Prim[], box: Box) {
  const H: Face[] = [], V: Face[] = [];
  const inn = (p: Pt) => p[0] > box.x0 - 0.05 && p[0] < box.x1 + 0.05 && p[1] > box.y0 - 0.05 && p[1] < box.y1 + 0.05;
  for (const p of ps) {
    if (p.kind !== 'line') continue;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [a, b] = [p.pts[i], p.pts[i + 1]];
      if (!inn(a) || !inn(b)) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (Math.hypot(dx, dy) < 0.03) continue;
      if (Math.abs(dy) <= 0.05 * Math.abs(dx)) H.push({ c: (a[1] + b[1]) / 2, a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]) });
      else if (Math.abs(dx) <= 0.05 * Math.abs(dy)) V.push({ c: (a[0] + b[0]) / 2, a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]) });
    }
  }
  const junta = (F: Face[]) => {
    F.sort((p, q) => p.c - q.c || p.a - q.a);
    const out: Face[] = [];
    for (const f of F) {
      const m = out.find(o => Math.abs(o.c - f.c) < 0.012 && f.a <= o.b + 0.04 && o.a <= f.b + 0.04);
      if (m) { m.a = Math.min(m.a, f.a); m.b = Math.max(m.b, f.b); } else out.push({ ...f });
    }
    return out;
  };
  return { H: junta(H), V: junta(V) };
}

function eixos(F: Face[], r: Regras): Eixo[] {
  const pedacos: Face[] = [];
  for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
    const d = Math.abs(F[i].c - F[j].c);
    if (d < r.espMin || d > r.espMax) continue;
    const lo = Math.max(F[i].a, F[j].a), hi = Math.min(F[i].b, F[j].b);
    // parede grossa (> 22 cm) só com trecho longo: evita juntar linhas de detalhe com a face externa
    if (hi - lo > 0.03 && (d <= 0.22 || hi - lo >= 0.3)) pedacos.push({ c: (F[i].c + F[j].c) / 2, a: lo, b: hi });
  }
  pedacos.sort((p, q) => p.c - q.c);
  const grupos: { cs: number[]; ps: [number, number][] }[] = [];
  for (const p of pedacos) {
    const g = grupos.find(g => Math.abs(g.cs.reduce((s, v) => s + v, 0) / g.cs.length - p.c) < 0.07);
    if (g) { g.cs.push(p.c); g.ps.push([p.a, p.b]); } else grupos.push({ cs: [p.c], ps: [[p.a, p.b]] });
  }
  return grupos.map(g => {
    const ps = g.ps.sort((a, b) => a[0] - b[0]);
    const m: [number, number][] = [];
    for (const [lo, hi] of ps) { if (m.length && lo <= m[m.length - 1][1] + 0.02) m[m.length - 1][1] = Math.max(m[m.length - 1][1], hi); else m.push([lo, hi]); }
    return { c: g.cs.reduce((s, v) => s + v, 0) / g.cs.length, ps: m.filter(([a, b]) => b - a >= 0.03) };
  });
}

export interface Vao { a: number; b: number; tag: string | null; tipo: string; w: number; x0: number; x1: number; base: number; h: number; inteiro: boolean }
export interface Trecho { id: string; pav: string; o: 'H' | 'V'; c: number; s: number; e: number; vaos: Vao[]; H: number }

export interface Ajustes {
  excluir: string[];                       // ids de trechos excluídos
  juntar: string[];                        // id de trecho que junta com o seguinte no mesmo alinhamento
  naoDividir: string[];                    // não divide automaticamente
  cortes: Record<string, number[]>;        // cortes manuais (distância a partir do início, sem coluna)
  altura: Record<string, number>;          // altura manual do trecho
  vaoTipo: Record<string, string>;         // `${trecho}@${posição}` -> tag (ex.: P04) ou "livre"
}
export const AJUSTES_VAZIOS: Ajustes = { excluir: [], juntar: [], naoDividir: [], cortes: {}, altura: {}, vaoTipo: {} };

const idTrecho = (pav: string, o: string, c: number, s: number) => `${pav}|${o}|${c.toFixed(2)}|${s.toFixed(2)}`;

export function trechos(L: Leitura, pav: Pavimento, quadro: Esquadria[], r: Regras, aj: Ajustes): Trecho[] {
  const { H, V } = faces(L.paredes, pav.box);
  const ax = { H: eixos(H, r), V: eixos(V, r) };
  const Q = new Map(quadro.map(q => [q.tag, q]));
  const tags = L.tags.filter(t => t.x > pav.box.x0 - 0.5 && t.x < pav.box.x1 + 0.5 && t.y > pav.box.y0 - 0.5 && t.y < pav.box.y1 + 0.5);
  const out: Trecho[] = [];
  for (const o of ['H', 'V'] as const) {
    const perp = ax[o === 'H' ? 'V' : 'H'];
    for (const { c, ps } of ax[o]) {
      if (!ps.length || ps[ps.length - 1][1] - ps[0][0] < 0.25) continue;
      const nos = perp.filter(q => q.ps.length && Math.min(...q.ps.map(p => p[0])) - 0.2 <= c && c <= Math.max(...q.ps.map(p => p[1])) + 0.2).map(q => q.c);
      let cur = { s: ps[0][0], vaos: [] as { a: number; b: number; tag: string | null }[] };
      const fecha = (e: number) => { out.push(montar(pav, o, c, cur.s, e, cur.vaos)); };
      for (let i = 0; i < ps.length - 1; i++) {
        const a1 = ps[i][1], b0 = ps[i + 1][0], gp = b0 - a1;
        const inn = nos.filter(n => a1 - 0.03 <= n && n <= b0 + 0.03);
        let tag: string | null = null;
        for (const t of tags) {
          const along = o === 'H' ? t.x : t.y, pd = o === 'H' ? t.y - c : t.x - c;
          if (Math.abs(pd) < 0.6 && along >= a1 - 0.1 && along <= b0 + 0.1 && gp > 0.3) tag = t.text;
        }
        if ((inn.length && gp <= 0.32) || (gp < 0.2 && !tag)) { fecha(a1); cur = { s: b0, vaos: [] }; continue; }
        let lo = a1, hi = b0;
        if (inn.length) {
          const n = inn[0];
          if (n - a1 < b0 - n) { fecha(a1); cur = { s: n + r.coluna / 2, vaos: [] }; lo = n + r.coluna / 2; }
          else hi = n - r.coluna / 2;
        }
        cur.vaos.push({ a: lo, b: hi, tag });
        if (inn.length && hi < b0) { fecha(hi); cur = { s: b0, vaos: [] }; }
      }
      fecha(ps[ps.length - 1][1]);
    }
  }
  function montar(pav: Pavimento, o: 'H' | 'V', c: number, s: number, e: number, vs: { a: number; b: number; tag: string | null }[]): Trecho {
    const id = idTrecho(pav.id, o, c, s);
    const Hh = aj.altura[id] ?? pav.altura;
    const vaos = vs.map(v => vao(id, v, Hh));
    return { id, pav: pav.id, o, c, s, e, vaos, H: Hh };
  }
  function vao(id: string, v: { a: number; b: number; tag: string | null }, Hh: number): Vao {
    const key = `${id}@${((v.a + v.b) / 2).toFixed(2)}`;
    const tag = aj.vaoTipo[key] ?? v.tag ?? 'livre';
    const q = tag !== 'livre' ? Q.get(tag) : undefined;
    const m = (v.a + v.b) / 2;
    if (!q) return { a: v.a, b: v.b, tag: tag === 'livre' ? null : tag, tipo: tag === 'livre' ? 'vão livre' : tag, w: v.b - v.a, x0: v.a, x1: v.b, base: 0, h: Hh, inteiro: true };
    const janela = q.tag.startsWith('J');
    let w = q.larg + r.acrescimoLargura;
    let base: number, h: number;
    if (janela) { base = q.peit - r.janelaDesce; h = q.alt + 2 * r.janelaDesce; }
    else { base = r.boneca; h = q.alt; }   // porta: boneca embaixo + altura do quadro
    const inteiro = (!janela && base + h >= Hh - 1e-6) || w > r.larguraMax - 2 * r.boneca;
    if (inteiro) { w = Math.max(w, v.b - v.a); }
    return { a: inteiro ? m - w / 2 : v.a, b: inteiro ? m + w / 2 : v.b, tag: q.tag, tipo: q.tag, w, x0: m - w / 2, x1: m + w / 2, base, h: Math.min(h, Hh - base), inteiro };
  }
  // ajustes: excluir e juntar
  let res = out.filter(t => t.e - t.s >= r.minParede && !aj.excluir.includes(t.id));
  for (const id of aj.juntar) {
    const t = res.find(x => x.id === id); if (!t) continue;
    const nx = res.filter(x => x.pav === t.pav && x.o === t.o && Math.abs(x.c - t.c) < 0.05 && x.s > t.s).sort((a, b) => a.s - b.s)[0];
    if (!nx) continue;
    t.e = nx.e; t.vaos.push(...nx.vaos); res = res.filter(x => x !== nx);
  }
  return res;
}

// ---------------- painéis ----------------
export interface Recorte { tipo: string; dl: number; w: number; base: number; h: number }
export interface Painel { num: number; trecho: string; pav: string; o: 'H' | 'V'; c: number; a: number; b: number; larg: number; H: number; comp: number; recortes: Recorte[]; aviso?: string }
export interface VaoInteiro { trecho: string; pav: string; o: 'H' | 'V'; c: number; a: number; b: number; tipo: string }

export function paineis(ts: Trecho[], r: Regras, aj: Ajustes): { paineis: Painel[]; vaos: VaoInteiro[] } {
  const P: Painel[] = []; const VI: VaoInteiro[] = [];
  for (const t of ts) {
    const subs: [number, number, Vao[]][] = [];
    let a = t.s;
    for (const v of [...t.vaos].sort((p, q) => p.x0 - q.x0)) {
      if (!v.inteiro) continue;
      subs.push([a, v.a, t.vaos.filter(o => !o.inteiro && a - 0.08 <= o.x0 && o.x0 < v.a)]);
      VI.push({ trecho: t.id, pav: t.pav, o: t.o, c: t.c, a: v.a, b: v.b, tipo: v.tipo });
      a = v.b;
    }
    subs.push([a, t.e, t.vaos.filter(o => !o.inteiro && a - 0.08 <= o.x0 && o.x0 < t.e)]);
    for (const [sa, sb, ops] of subs) {
      const Lr = sb - sa;
      if (Lr < r.minParede) continue;
      let edges: number[];
      const manual = (aj.cortes[t.id] || []).map(d => t.s + d).filter(x => x > sa + 0.05 && x < sb - 0.05);
      if (manual.length) edges = [sa, ...manual.flatMap(x => [x, x]), sb];
      else {
        let n = 1;
        if (!aj.naoDividir.includes(t.id)) while ((Lr - (n - 1) * r.coluna) / n - r.folga > r.larguraMax) n++;
        const cuts: number[] = [];
        for (let i = 1; i < n; i++) {
          let m = sa + i * (Lr - (n - 1) * r.coluna) / n + (i - 1) * r.coluna + r.coluna / 2;
          for (const o of ops) if (o.x0 - r.coluna / 2 < m && m < o.x1 + r.coluna / 2) m = m - o.x0 < o.x1 - m ? o.x0 - r.coluna / 2 : o.x1 + r.coluna / 2;
          cuts.push(m);
        }
        edges = [sa, ...cuts.flatMap(m => [m - r.coluna / 2, m + r.coluna / 2]), sb];
      }
      for (let i = 0; i < edges.length; i += 2) {
        const pa = edges[i], pb = edges[i + 1], larg = pb - pa - r.folga;
        const rec: Recorte[] = []; let aviso: string | undefined;
        for (const o of ops) {
          if (!(pa - 0.08 <= o.x0 && o.x1 <= pb + 0.08)) continue;
          let w = Math.min(o.w, larg - 2 * r.boneca); if (w < o.w - 1e-6) aviso = `${o.tipo}: recorte reduzido para caber as bonecas`;
          let dl = Math.min(Math.max(o.x0 - pa, r.boneca), larg - w - r.boneca);
          if (dl < r.boneca - 1e-6) { dl = (larg - w) / 2; aviso = `${o.tipo}: sem espaço para boneca de ${r.boneca * 100} cm`; }
          let base = o.base, h = o.h;
          if (base < r.boneca) { h -= r.boneca - base; base = r.boneca; }
          rec.push({ tipo: o.tipo, dl, w, base, h });
        }
        if (larg < r.naoFabricar) aviso = 'n fabricar';
        P.push({ num: 0, trecho: t.id, pav: t.pav, o: t.o, c: t.c, a: pa, b: pb, larg, H: t.H, comp: pb - pa, recortes: rec, aviso });
      }
    }
  }
  return { paineis: P, vaos: VI };
}

export function numerar(P: Painel[], ordemPav: string[]) {
  let n = 0;
  for (const pav of ordemPav) {
    const ps = P.filter(p => p.pav === pav).sort((p, q) => {
      const cy = (x: Painel) => x.o === 'H' ? x.c : (x.a + x.b) / 2, cx = (x: Painel) => x.o === 'H' ? (x.a + x.b) / 2 : x.c;
      return Math.round(-cy(p)) - Math.round(-cy(q)) || cx(p) - cx(q);
    });
    for (const p of ps) p.num = ++n;
  }
  return P.sort((a, b) => a.num - b.num);
}

export function resumo(P: Painel[]) {
  const bruta = P.reduce((s, p) => s + p.larg * p.H, 0);
  const rec = P.reduce((s, p) => s + p.recortes.reduce((t, r) => t + r.w * r.h, 0), 0);
  return { qtd: P.length, bruta, recortes: rec, liquida: bruta - rec };
}
