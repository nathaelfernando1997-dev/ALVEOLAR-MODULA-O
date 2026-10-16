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
  pinarAuto: boolean;      // no T, pinar a parede que chega e deixar a contínua sem emenda quando couber num painel
  lajeComp: number;        // comprimento máximo do painel de laje (vão)
  lajeLarg: number;        // largura máxima do painel de laje
  lajeApoio: number;       // quanto a laje entra em cima de cada parede de apoio
  lajeApoioBorda?: number; // apoio onde só uma laje apoia na parede (borda)
  lajeFolga?: number;      // folga entre um painel de laje e o vizinho (encaixe)
  lajeEsp: number;         // espessura da laje (para conferir com os cortes)
  vigaAltura: number;      // altura da viga (rebaixo nas paredes embaixo dela)
  vigaLargura: number;     // largura da viga
  vigaApoio: number;       // quanto a viga entra em cima da parede de apoio
  vaoViga: number;         // vão sem parede a partir do qual a viga é obrigatória
  beiral: number;          // balanço de laje permitido sem viga
}
export const REGRAS_PADRAO: Regras = {
  larguraMax: 3.5, coluna: 0.15, folga: 0.05, boneca: 0.10, acrescimoLargura: 0.10, janelaDesce: 0.05,
  espMin: 0.12, espMax: 0.27, minParede: 0.12, naoFabricar: 0.25,
  pinarAuto: false, lajeComp: 5.0, lajeLarg: 3.0, lajeApoio: 0.06, lajeApoioBorda: 0.10, lajeFolga: 0.02, lajeEsp: 0.15,
  vigaAltura: 0.30, vigaLargura: 0.15, vigaApoio: 0.20, vaoViga: 5.0, beiral: 1.0,
};

export interface Esquadria { tag: string; larg: number; alt: number; peit: number }  // metros
export interface Box { x0: number; x1: number; y0: number; y1: number }
export interface Pavimento { id: string; nome: string; box: Box; altura: number; ativo: boolean; corte?: boolean }

// ---------------- leitura da planta ----------------
export interface Leitura {
  regioes: Box[];                 // agrupamentos de paredes (plantas, cortes, fachadas…)
  tags: { text: string; x: number; y: number }[];
  quadro: Esquadria[];
  textos: { text: string; x: number; y: number; h: number }[];
  prims: Prim[];                  // geometria toda (para desenhar)
  paredes: Prim[];                // geometria da camada de parede
  linhas: LinhaProjeto[];         // "LINHA DE PISO" (viga de apoio) e projeções de laje/beiral
}
export interface LinhaProjeto { tipo: 'piso' | 'proj'; o: 'H' | 'V'; c: number; a: number; b: number; texto: string }

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
  return { regioes, tags, quadro, textos, prims, paredes, linhas: linhasDoProjeto(d, camadaParede, textos) };
}

// linhas indicadas por texto no projeto: "LINHA DE PISO" vira viga de apoio da laje;
// "PROJ. LAJE / COBERTURA / BEIRAL" marca até onde a laje vai (beiral)
function linhasDoProjeto(d: Dxf, camadaParede: string, textos: Leitura['textos']): LinhaProjeto[] {
  const segs: { o: 'H' | 'V'; c: number; a: number; b: number; layer: string }[] = [];
  for (const e of d.ents) {
    if (e.layer === camadaParede) continue;
    for (const p of entPrims(e)) {
      if (p.kind !== 'line') continue;
      for (let i = 0; i < p.pts.length - 1; i++) {
        const [u, w] = [p.pts[i], p.pts[i + 1]];
        if (Math.abs(u[1] - w[1]) < 0.01 && Math.abs(u[0] - w[0]) > 0.3) segs.push({ o: 'H', c: u[1], a: Math.min(u[0], w[0]), b: Math.max(u[0], w[0]), layer: e.layer });
        else if (Math.abs(u[0] - w[0]) < 0.01 && Math.abs(u[1] - w[1]) > 0.3) segs.push({ o: 'V', c: u[0], a: Math.min(u[1], w[1]), b: Math.max(u[1], w[1]), layer: e.layer });
      }
    }
  }
  const out: LinhaProjeto[] = [];
  for (const t of textos) {
    const tx = t.text.toUpperCase().replace(/\s+/g, ' ');
    const tipo = /LINHA DE PISO/.test(tx) ? 'piso' : (/PROJ/.test(tx) && /LAJE|COBERT|BEIRAL|MARQUISE/.test(tx)) || /^BEIRAL/.test(tx) ? 'proj' : null;
    if (!tipo) continue;
    let m: (typeof segs)[number] | null = null, md = 0.4;
    for (const g of segs) {
      const [al, pd] = g.o === 'H' ? [t.x, t.y - g.c] : [t.y, t.x - g.c];
      if (al < g.a - 0.6 || al > g.b + 0.6 || g.b - g.a < 0.8) continue;
      if (Math.abs(pd) < md) { md = Math.abs(pd); m = g; }
    }
    if (!m) continue;
    // segue a linha inteira: pedaços da mesma camada ligados pelas pontas (contorno da projeção, com as quinas)
    const pontas = (g: (typeof segs)[number]): Pt[] => g.o === 'H' ? [[g.a, g.c], [g.b, g.c]] : [[g.c, g.a], [g.c, g.b]];
    const cadeia = [m], fila = [m];
    const raio = tipo === 'proj' ? 0.05 : 0;   // a linha de piso fica só no alinhamento
    while (fila.length) {
      const g = fila.pop()!;
      // ponta de um encostando no outro (quina); outra camada só se for linha longa (o contorno às vezes muda de camada)
      const sobre = (p: Pt, h: (typeof segs)[number]) => h.o === 'H' ? Math.abs(p[1] - h.c) < raio && p[0] >= h.a - raio && p[0] <= h.b + raio : Math.abs(p[0] - h.c) < raio && p[1] >= h.a - raio && p[1] <= h.b + raio;
      for (const h of segs) {
        if (cadeia.includes(h) || (h.layer !== g.layer && h.b - h.a < 3)) continue;
        const liga = (raio > 0 && (pontas(g).some(p => sobre(p, h)) || pontas(h).some(p => sobre(p, g)))) ||
          (h.layer === g.layer && h.o === g.o && Math.abs(h.c - g.c) < 0.01 && h.a <= g.b + 0.05 && h.b >= g.a - 0.05);
        if (liga) { cadeia.push(h); fila.push(h); }
      }
    }
    // junta os pedaços alinhados
    for (const g of cadeia) {
      const ig = out.find(l => l.tipo === tipo && l.o === g.o && Math.abs(l.c - g.c) < 0.02 && l.a <= g.b + 0.05 && l.b >= g.a - 0.05);
      if (ig) { ig.a = Math.min(ig.a, g.a); ig.b = Math.max(ig.b, g.b); } else out.push({ tipo, o: g.o, c: g.c, a: g.a, b: g.b, texto: t.text });
    }
  }
  return out;
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
type Eixo = { c: number; ps: [number, number][]; esp: number };

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
  const pedacos: (Face & { d: number })[] = [];
  for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
    const d = Math.abs(F[i].c - F[j].c);
    if (d < r.espMin || d > r.espMax) continue;
    const lo = Math.max(F[i].a, F[j].a), hi = Math.min(F[i].b, F[j].b);
    // parede grossa (> 22 cm) só com trecho longo: evita juntar linhas de detalhe com a face externa
    if (hi - lo > 0.03 && (d <= 0.22 || hi - lo >= 0.3)) pedacos.push({ c: (F[i].c + F[j].c) / 2, a: lo, b: hi, d });
  }
  pedacos.sort((p, q) => p.c - q.c);
  const grupos: { cs: number[]; ps: [number, number][]; ds: number[] }[] = [];
  for (const p of pedacos) {
    const g = grupos.find(g => Math.abs(g.cs.reduce((s, v) => s + v, 0) / g.cs.length - p.c) < 0.07);
    if (g) { g.cs.push(p.c); g.ps.push([p.a, p.b]); g.ds.push(p.d); } else grupos.push({ cs: [p.c], ps: [[p.a, p.b]], ds: [p.d] });
  }
  return grupos.map(g => {
    const ps = g.ps.sort((a, b) => a[0] - b[0]);
    const m: [number, number][] = [];
    for (const [lo, hi] of ps) { if (m.length && lo <= m[m.length - 1][1] + 0.02) m[m.length - 1][1] = Math.max(m[m.length - 1][1], hi); else m.push([lo, hi]); }
    return { c: g.cs.reduce((s, v) => s + v, 0) / g.cs.length, ps: m.filter(([a, b]) => b - a >= 0.03), esp: g.ds.reduce((s, v) => s + v, 0) / g.ds.length };
  });
}

export interface Vao { a: number; b: number; tag: string | null; tipo: string; w: number; x0: number; x1: number; base: number; h: number; inteiro: boolean;
  continua?: boolean; sobe?: boolean;
  topo?: number }   // altura do topo da abertura a partir do piso (porta = altura do quadro)   // sobe = porta que continua na parede de cima   // continuação de porta mais alta que o pavimento de baixo (começa no pé da parede, sem boneca embaixo)
export interface Trecho { id: string; pav: string; o: 'H' | 'V'; c: number; s: number; e: number; vaos: Vao[]; H: number; esp: number; pinado?: boolean }

export interface Ajustes {
  excluir: string[];                       // ids de trechos excluídos
  juntar: string[];                        // id de trecho que junta com o seguinte no mesmo alinhamento
  naoDividir: string[];                    // não divide automaticamente
  cortes: Record<string, number[]>;        // cortes manuais (distância a partir do início, sem coluna)
  colunas?: Record<string, number[]>;      // cortes manuais com coluna (distância a partir do início)
  altura: Record<string, number>;          // altura manual do trecho
  vaoTipo: Record<string, string>;         // `${trecho}@${posição}` -> tag (ex.: P04) ou "livre"
  naoPinar?: string[];                     // trechos onde a pinagem automática não deve ser feita
  lajeFora?: string[];                     // ambientes sem laje (vazio, área externa)
  lajeGiro?: string[];                     // ambientes com o sentido dos painéis invertido
}
export const AJUSTES_VAZIOS: Ajustes = { excluir: [], juntar: [], naoDividir: [], cortes: {}, colunas: {}, altura: {}, vaoTipo: {}, naoPinar: [], lajeFora: [], lajeGiro: [] };

const idTrecho = (pav: string, o: string, c: number, s: number) => `${pav}|${o}|${c.toFixed(2)}|${s.toFixed(2)}`;

export function trechos(L: Leitura, pav: Pavimento, quadro: Esquadria[], r: Regras, aj: Ajustes): Trecho[] {
  const L0 = L;
  const { H, V } = faces(L.paredes, pav.box);
  const ax = { H: eixos(H, r), V: eixos(V, r) };
  const Q = new Map(quadro.map(q => [q.tag, q]));
  const tags = L.tags.filter(t => t.x > pav.box.x0 - 0.5 && t.x < pav.box.x1 + 0.5 && t.y > pav.box.y0 - 0.5 && t.y < pav.box.y1 + 0.5);
  const out: Trecho[] = [];
  const arcos = L.prims.filter((p): p is Extract<Prim, { kind: 'arc' }> => p.kind === 'arc' && p.c[0] > pav.box.x0 - 0.5 && p.c[0] < pav.box.x1 + 0.5 && p.c[1] > pav.box.y0 - 0.5 && p.c[1] < pav.box.y1 + 0.5);
  for (const o of ['H', 'V'] as const) {
    const perp = ax[o === 'H' ? 'V' : 'H'];
    for (const { c, ps, esp } of ax[o]) {
      if (!ps.length || ps[ps.length - 1][1] - ps[0][0] < 0.25) continue;
      const nos = perp.filter(q => q.ps.length && Math.min(...q.ps.map(p => p[0])) - 0.2 <= c && c <= Math.max(...q.ps.map(p => p[1])) + 0.2).map(q => q.c);
      let cur = { s: ps[0][0], vaos: [] as { a: number; b: number; tag: string | null }[] };
      const fecha = (e: number) => { out.push(montar(pav, o, c, cur.s, e, cur.vaos, esp)); };
      const tagEm = (l: number, h: number) => {
        let best: string | null = null, bd = 1e9;
        for (const t of tags) {
          const along = o === 'H' ? t.x : t.y, pd = o === 'H' ? t.y - c : t.x - c;
          if (Math.abs(pd) < 0.6 && along >= l - 0.1 && along <= h + 0.1) { const d = Math.abs(along - (l + h) / 2); if (d < bd) { bd = d; best = t.text; } }
        }
        return best ?? portaPorArco(l, h);
      };
      // sem etiqueta: se tem a folha da porta desenhada no vão (arco com centro numa ponta), é porta
      // do tamanho mais próximo do quadro
      function portaPorArco(l: number, h: number): string | null {
        const portas = quadro.filter(q => q.tag.startsWith('P'));
        if (!portas.length) return null;
        for (const p of arcos) {
          const [ax, ay] = p.c, al = o === 'H' ? ax : ay, pd = o === 'H' ? ay - c : ax - c;
          if (Math.abs(pd) > esp / 2 + 0.12) continue;
          if (Math.abs(al - l) > 0.15 && Math.abs(al - h) > 0.15) continue;
          if (p.r < 0.5 || p.r > h - l + 0.1) continue;
          return portas.reduce((m, q) => Math.abs(q.larg - p.r) < Math.abs(m.larg - p.r) ? q : m).tag;
        }
        return null;
      }
      for (let i = 0; i < ps.length - 1; i++) {
        const a1 = ps[i][1], b0 = ps[i + 1][0], gp = b0 - a1;
        const inn = nos.filter(n => a1 - 0.03 <= n && n <= b0 + 0.03).sort((x, y) => x - y);
        if (!inn.length) {
          const tag = gp > 0.3 ? tagEm(a1, b0) : null;
          if (gp < 0.2 && !tag) { fecha(a1); cur = { s: b0, vaos: [] }; continue; }
          cur.vaos.push({ a: a1, b: b0, tag });
          continue;
        }
        // o vão tem encontros de parede: cada encontro vira coluna e cada pedaço entre eles pode ser porta/janela
        let l = a1;
        for (const n of inn) {
          const h = Math.max(l, n - r.coluna / 2);
          if (h - l > 0.2) cur.vaos.push({ a: l, b: h, tag: tagEm(l, h) });
          fecha(Math.min(h, Math.max(l, a1)) === a1 && h - l <= 0.2 ? a1 : h);
          l = Math.min(b0, n + r.coluna / 2);
          cur = { s: l, vaos: [] };
        }
        if (b0 - l > 0.2) cur.vaos.push({ a: l, b: b0, tag: tagEm(l, b0) });
        else cur = { s: b0, vaos: [] };
      }
      fecha(ps[ps.length - 1][1]);
    }
  }
  // parede que é só a janela (sem linhas de parede, só o bloco): fica entre as pontas de duas paredes perpendiculares
  // etiqueta já atendida = existe um vão com essa etiqueta perto dela
  const soJanela = new Set<Trecho>();
  const usadas = out.flatMap(t => t.vaos.filter(v => v.tag).map(v => { const m = (v.a + v.b) / 2; return { tag: v.tag, x: t.o === 'H' ? m : t.c, y: t.o === 'H' ? t.c : m }; }));
  for (const t of tags) {
    const q = Q.get(t.text);
    if (!q || !q.tag.startsWith('J') || usadas.some(u => u.tag === q.tag && Math.hypot(u.x - t.x, u.y - t.y) < 0.8 + q.larg / 2)) continue;
    let melhor: { o: 'H' | 'V'; c: number; s: number; e: number; esp: number; d: number } | null = null;
    for (const o of ['H', 'V'] as const) {
      // paredes perpendiculares (eixo constante no outro sentido) que terminam perto da etiqueta
      const along = o === 'H' ? t.x : t.y, across = o === 'H' ? t.y : t.x;
      const pontas: { c: number; fim: number; dir: number; esp: number }[] = [];
      for (const ax2 of ax[o === 'H' ? 'V' : 'H']) for (const [p0, p1] of ax2.ps) {
        if (p1 - p0 < 0.3) continue;
        if (Math.abs(p0 - across) < 0.7) pontas.push({ c: ax2.c, fim: p0, dir: 1, esp: ax2.esp });
        if (Math.abs(p1 - across) < 0.7) pontas.push({ c: ax2.c, fim: p1, dir: -1, esp: ax2.esp });
      }
      for (const a of pontas) for (const b of pontas) {
        if (a.c >= b.c || a.c > along || b.c < along || Math.abs(a.fim - b.fim) > 0.2) continue;
        const s = a.c + a.esp / 2, e = b.c - b.esp / 2, L = e - s;
        if (L < q.larg - 0.1 || L > q.larg + 0.6 || L > r.larguraMax) continue;
        let esp = (a.esp + b.esp) / 2, c = (a.fim + b.fim) / 2 + (a.dir === b.dir ? a.dir * esp / 2 : 0);
        // posição exata pelas linhas do bloco da janela (paralelas à parede, no vão)
        const ls: number[] = [];
        for (const p of L0.prims) if (p.kind === 'line') for (let i = 0; i < p.pts.length - 1; i++) {
          const [u, w] = [p.pts[i], p.pts[i + 1]];
          const [ua, wa, uc, wc] = o === 'H' ? [u[0], w[0], u[1], w[1]] : [u[1], w[1], u[0], w[0]];
          if (Math.abs(uc - wc) > 0.01 || Math.abs(uc - c) > 0.3) continue;
          const lo = Math.min(ua, wa), hi = Math.max(ua, wa);
          if (hi - lo >= 0.5 * L && lo >= s - 0.12 && hi <= e + 0.12) ls.push(uc);
        }
        if (ls.length >= 2 && Math.max(...ls) - Math.min(...ls) >= r.espMin - 0.03 && Math.max(...ls) - Math.min(...ls) <= r.espMax) {
          c = (Math.max(...ls) + Math.min(...ls)) / 2; esp = Math.max(...ls) - Math.min(...ls);
        }
        if (out.some(x => x.pav === pav.id && x.o === o && Math.abs(x.c - c) < 0.1 && x.s < e - 0.05 && x.e > s + 0.05)) continue;
        const d = Math.abs(across - c) + Math.abs(L - q.larg);
        if (!melhor || d < melhor.d) melhor = { o, c, s, e, esp, d };
      }
    }
    if (!melhor) continue;
    const { o, c, s, e, esp } = melhor;
    // a janela ocupa a parede toda: recorte = largura do painel − bonecas de cada lado
    const tj = montar(pav, o, c, s, e, [{ a: s, b: e, tag: q.tag }], esp);
    out.push(tj); soJanela.add(tj);
    usadas.push({ tag: q.tag, x: o === 'H' ? (s + e) / 2 : c, y: o === 'H' ? c : (s + e) / 2 });
  }
  function montar(pav: Pavimento, o: 'H' | 'V', c: number, s: number, e: number, vs: { a: number; b: number; tag: string | null }[], esp: number): Trecho {
    const id = idTrecho(pav.id, o, c, s);
    const Hh = aj.altura[id] ?? pav.altura;
    const vaos = vs.map(v => vao(id, v, Hh));
    return { id, pav: pav.id, o, c, s, e, vaos, H: Hh, esp };
  }
  function vao(id: string, v: { a: number; b: number; tag: string | null }, Hh: number): Vao {
    const key = `${id}@${((v.a + v.b) / 2).toFixed(2)}`;
    const tag = aj.vaoTipo[key] ?? v.tag ?? 'livre';
    const q = tag !== 'livre' ? Q.get(tag) : undefined;
    const m = (v.a + v.b) / 2;
    if (!q) return { a: v.a, b: v.b, tag: tag === 'livre' ? null : tag, tipo: tag === 'livre' ? 'vão livre' : tag, w: v.b - v.a, x0: v.a, x1: v.b, base: 0, h: Hh, inteiro: true, topo: Hh };
    const janela = q.tag.startsWith('J');
    let w = q.larg + r.acrescimoLargura;
    let base: number, h: number;
    if (janela) { base = q.peit - r.janelaDesce; h = q.alt + 2 * r.janelaDesce; }
    else { base = r.boneca; h = q.alt; }   // porta: boneca embaixo + altura do quadro
    const inteiro = (!janela && base + h >= Hh - 1e-6) || w > r.larguraMax - 2 * r.boneca;
    if (inteiro) { w = Math.max(w, v.b - v.a); }
    return { a: inteiro ? m - w / 2 : v.a, b: inteiro ? m + w / 2 : v.b, tag: q.tag, tipo: q.tag, w, x0: m - w / 2, x1: m + w / 2, base, h: Math.min(h, Hh - base), inteiro, topo: janela ? q.peit + q.alt : q.alt };
  }
  // ajustes: excluir e juntar
  let res = out.filter(t => t.e - t.s >= r.minParede && !aj.excluir.includes(t.id));
  const proximo = (t: Trecho) => res.filter(x => x.pav === t.pav && x.o === t.o && Math.abs(x.c - t.c) < 0.05 && x.s > t.s).sort((a, b) => a.s - b.s)[0];
  const junta = (t: Trecho, nx: Trecho) => { t.e = nx.e; t.vaos.push(...nx.vaos); t.pinado = true; res = res.filter(x => x !== nx); };
  // trecho que é só a porta/janela (sem parede dos lados) não vira painel: passa direto pelo encontro e junta com a parede vizinha
  {
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const t of [...res]) {
        if (!res.includes(t) || soJanela.has(t) || !t.vaos.length || t.vaos.some(v => v.inteiro)) continue;
        const solido = (t.e - t.s) - t.vaos.reduce((s, v) => s + (v.b - v.a), 0);
        if (solido > 0.25) continue;
        const mesmos = res.filter(x => x !== t && !soJanela.has(x) && x.pav === t.pav && x.o === t.o && Math.abs(x.c - t.c) < 0.05);
        const ant = mesmos.filter(x => x.e <= t.s + 0.01 && t.s - x.e < 0.35 && !x.vaos.some(v => v.inteiro)).sort((a, b) => b.e - a.e)[0];
        const prox = mesmos.filter(x => x.s >= t.e - 0.01 && x.s - t.e < 0.35 && !x.vaos.some(v => v.inteiro)).sort((a, b) => a.s - b.s)[0];
        const viz = ant ?? prox; if (!viz) continue;
        if (viz === ant) { ant.e = t.e; ant.vaos.push(...t.vaos); ant.pinado = true; }
        else { prox.s = t.s; prox.vaos.unshift(...t.vaos); prox.pinado = true; prox.id = t.id; }
        res = res.filter(x => x !== t); mudou = true;
      }
    }
  }
  // no T, a parede que chega para na face da parede que passa (não entra no espaço da coluna)
  for (const t of res) {
    const perp = res.filter(x => x.pav === t.pav && x.o !== t.o);
    const passa = (c: number) => perp.filter(x => Math.abs(x.c - c) < 0.2);
    for (const ponta of ['s', 'e'] as const) {
      const v = t[ponta];
      for (const c of [...new Set(passa(v).map(x => x.c))]) {
        const ps2 = perp.filter(x => Math.abs(x.c - c) < 0.02);
        const esq = ps2.some(x => x.s <= t.c - 0.05 && x.e >= t.c - 0.35), dir = ps2.some(x => x.e >= t.c + 0.05 && x.s <= t.c + 0.35);
        if (!esq || !dir) continue;
        const face = (ps2[0].esp || r.espMin) / 2;
        if (ponta === 's' && v < c + face && t.e > c + face + 0.3) t.s = c + face;
        if (ponta === 'e' && v > c - face && t.s < c - face - 0.3) t.e = c - face;
      }
    }
  }
  // pedaço curto (sem porta/janela) colado em outro trecho do mesmo alinhamento: pina nele (sem coluna)
  {
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const t of [...res]) {
        if (!res.includes(t) || t.e - t.s >= 0.5 || t.vaos.length || aj.naoPinar?.includes(t.id)) continue;
        const cs = res.filter(x => x !== t && x.pav === t.pav && x.o === t.o && Math.abs(x.c - t.c) < 0.05 && !x.vaos.some(v => v.inteiro) &&
          (Math.abs(x.s - t.e) <= r.coluna + 0.1 || Math.abs(t.s - x.e) <= r.coluna + 0.1) && Math.max(x.e, t.e) - Math.min(x.s, t.s) - r.folga <= r.larguraMax);
        // prefere o lado em que a parede juntada fica do tamanho das paralelas vizinhas (mesmo início e fim)
        const nota = (x: Trecho) => { const a = Math.min(x.s, t.s), b = Math.max(x.e, t.e);
          return res.filter(y => y.pav === t.pav && y.o === t.o && Math.abs(y.c - t.c) > 0.3 && Math.abs(y.s - a) < 0.1 && Math.abs(y.e - b) < 0.1).length; };
        const viz = cs.sort((p, q) => nota(q) - nota(p) || (p.e - p.s) - (q.e - q.s))[0];
        if (!viz) continue;
        if (viz.s > t.s) { viz.s = t.s; viz.id = t.id; } else viz.e = t.e;
        viz.pinado = true; res = res.filter(x => x !== t); mudou = true;
      }
    }
  }
  for (const id of aj.juntar) {
    const t = res.find(x => x.id === id); if (!t) continue;
    const nx = proximo(t); if (nx) junta(t, nx);
  }
  // T pinado automático: a parede contínua passa direto (sem coluna) quando cabe num painel só
  if (r.pinarAuto) {
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const t of [...res].sort((a, b) => a.s - b.s)) {
        if (!res.includes(t)) continue;
        const nx = proximo(t);
        if (!nx || nx.s - t.e > r.coluna + 0.2) continue;
        if (nx.e - t.s - r.folga > r.larguraMax) continue;
        if (t.vaos.some(v => v.inteiro) || nx.vaos.some(v => v.inteiro)) continue;
        if (aj.naoPinar?.includes(t.id)) continue;
        junta(t, nx); mudou = true;
      }
    }
  }
  return res;
}

// porta mais alta que o pavimento de baixo: o vão continua no pé da parede de cima, no mesmo lugar
// (dx, dy levam a planta de cima para a de baixo)
export function continuarVaos(baixo: Trecho[], cima: Trecho[], quadro: Esquadria[], r: Regras, dx: number, dy: number): void {
  const Q = new Map(quadro.map(q => [q.tag, q]));
  for (const t of baixo) for (const v of t.vaos) {
    const q = v.tag ? Q.get(v.tag) : undefined;
    if (!q || q.tag.startsWith('J')) continue;
    const topo = r.boneca + q.alt;
    const resto = topo - (t.H + r.lajeEsp);
    if (resto <= 0.02) continue;
    const off = t.o === 'H' ? dx : dy, offC = t.o === 'H' ? dy : dx;
    const x0 = v.x0 - off, x1 = v.x1 - off;
    const us = cima.filter(u => u.o === t.o && Math.abs(u.c + offC - t.c) < 0.15 && u.s < x1 && u.e > x0);
    if (us.length) v.sobe = true;
    for (const u of us) {
      // a planta de cima costuma repetir o desenho da porta: esse vão é a própria continuação
      u.vaos = u.vaos.filter(w => w.continua || !(w.x0 < x1 - 0.05 && w.x1 > x0 + 0.05) || (w.tag ?? '').startsWith('J'));
      if (u.vaos.some(w => w.continua && Math.abs(w.x0 - x0) < 0.05)) continue;
      u.vaos.push({ a: x0, b: x1, tag: q.tag, tipo: `${q.tag} (continuação)`, w: x1 - x0, x0, x1, base: 0, h: Math.min(resto, u.H), inteiro: false, continua: true });
    }
  }
}

// ---------------- painéis ----------------
export interface Recorte { tipo: string; dl: number; w: number; base: number; h: number }
export interface Painel { num: number; trecho: string; pav: string; o: 'H' | 'V'; c: number; a: number; b: number; larg: number; H: number; comp: number; recortes: Recorte[]; aviso?: string }
export interface VaoInteiro { trecho: string; pav: string; o: 'H' | 'V'; c: number; a: number; b: number; tipo: string; sobe?: boolean; topo?: number; H?: number }

export function paineis(ts: Trecho[], r: Regras, aj: Ajustes): { paineis: Painel[]; vaos: VaoInteiro[] } {
  const P: Painel[] = []; const VI: VaoInteiro[] = [];
  for (const t of ts) {
    const subs: [number, number, Vao[]][] = [];
    let a = t.s;
    for (const v of [...t.vaos].sort((p, q) => p.x0 - q.x0)) {
      if (!v.inteiro) continue;
      subs.push([a, v.a, t.vaos.filter(o => !o.inteiro && a - 0.08 <= o.x0 && o.x0 < v.a)]);
      VI.push({ trecho: t.id, pav: t.pav, o: t.o, c: t.c, a: v.a, b: v.b, tipo: v.tipo, sobe: v.sobe, topo: v.topo, H: t.H });
      a = v.b;
    }
    subs.push([a, t.e, t.vaos.filter(o => !o.inteiro && a - 0.08 <= o.x0 && o.x0 < t.e)]);
    for (const [sa, sb, ops] of subs) {
      const Lr = sb - sa;
      if (Lr < r.minParede) continue;
      let edges: number[];
      const manual = [...(aj.cortes[t.id] || []).map(d => ({ x: t.s + d, col: false })), ...((aj.colunas || {})[t.id] || []).map(d => ({ x: t.s + d, col: true }))]
        .filter(c => c.x > sa + 0.05 && c.x < sb - 0.05).sort((a, b) => a.x - b.x);
      if (manual.length) edges = [sa, ...manual.flatMap(c => c.col ? [c.x - r.coluna / 2, c.x + r.coluna / 2] : [c.x, c.x]), sb];
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
          // cada porta/janela fica no painel onde está o seu centro
          const mo = (o.x0 + o.x1) / 2;
          if (!(pa - 1e-6 <= mo && mo < pb + 1e-6)) continue;
          if (o.x0 < pa - 0.08 || o.x1 > pb + 0.08) aviso = `${o.tipo}: cortada pela divisão da parede — mova o corte`;
          const toda = o.x0 <= t.s + 0.06 && o.x1 >= t.e - 0.06;   // janela ocupando a parede toda
          let w = Math.min(o.w, larg - 2 * r.boneca);
          if (toda) aviso = `${o.tipo} na parede toda: bonecas de ${r.boneca * 100} cm nas laterais (retirar após concretar)`;
          else if (w < o.w - 1e-6) aviso = `${o.tipo}: recorte reduzido para caber as bonecas`;
          let dl = Math.min(Math.max(o.x0 - pa, r.boneca), larg - w - r.boneca);
          if (dl < r.boneca - 1e-6) { dl = (larg - w) / 2; aviso = `${o.tipo}: sem espaço para boneca de ${r.boneca * 100} cm`; }
          let base = o.base, h = o.h;
          if (base < r.boneca && !o.continua) { h -= r.boneca - base; base = r.boneca; }
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
