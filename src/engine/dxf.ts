// Leitor de DXF tolerante (AutoCAD e conversores como o LibreDWG).
// Lê pares (código, valor); linhas com código inválido são puladas.

export type Pt = [number, number];

export interface Ent {
  type: string;
  layer: string;
  handle: string;
  codes: [number, string][];
}

export interface Insert {
  name: string;
  layer: string;
  handle: string;
  x: number; y: number; sx: number; sy: number; rot: number;
  attribs: { tag: string; text: string }[];
}

export interface Block { name: string; base: Pt; ents: Ent[]; inserts: Insert[] }

export interface Dxf {
  ents: Ent[];          // entidades do model space (sem INSERT)
  inserts: Insert[];    // INSERTs do model space, com atributos
  blocks: Map<string, Block>;
  layers: string[];
}

function pairs(text: string): [number, string][] {
  const L = text.split(/\r?\n/);
  const out: [number, string][] = [];
  let i = 0;
  while (i < L.length - 1) {
    const c = L[i].trim();
    if (!/^-?\d+$/.test(c)) { i += 1; continue; }
    out.push([parseInt(c, 10), L[i + 1].replace(/\r$/, '').trim()]);
    i += 2;
  }
  return out;
}

const num = (v: string | undefined, d = 0) => { const n = v === undefined ? NaN : parseFloat(v); return isFinite(n) ? n : d; };
export const g = (e: { codes: [number, string][] }, c: number) => { for (const [cc, v] of e.codes) if (cc === c) return v; return undefined; };
export const gn = (e: { codes: [number, string][] }, c: number, d = 0) => num(g(e, c), d);
export const gall = (e: { codes: [number, string][] }, c: number) => e.codes.filter(([cc]) => cc === c).map(([, v]) => v);

const GEOM = new Set(['LINE', 'LWPOLYLINE', 'ARC', 'CIRCLE', 'TEXT', 'MTEXT', 'INSERT', 'ATTRIB', 'SOLID', 'POLYLINE', 'VERTEX', 'SEQEND']);

export function parseDxf(text: string): Dxf {
  const P = pairs(text);
  // 1) mapa handle do INSERT -> nome do bloco (blocos dinâmicos anônimos *U)
  const refs = new Map<string, string>();
  {
    let inRec = false, name = '', inRefs = false;
    for (const [c, v] of P) {
      if (c === 0) { inRec = v === 'BLOCK_RECORD'; name = ''; inRefs = false; continue; }
      if (!inRec) continue;
      if (c === 2) name = v;
      else if (c === 102 && v === '{BLKREFS') inRefs = true;
      else if (c === 102 && v === '}') inRefs = false;
      else if (c === 331 && inRefs && name) refs.set(v.toUpperCase(), name);
    }
  }
  // 2) entidades e blocos
  const blocks = new Map<string, Block>();
  const ents: Ent[] = [];
  const inserts: Insert[] = [];
  const layers = new Set<string>();
  let section = '';
  let blk: Block | null = null;
  let blkHdr = false;
  let cur: Ent | null = null;
  let lastInsert: Insert | null = null;
  let polyline: Ent | null = null;

  const toInsert = (e: Ent): Insert => {
    let name = g(e, 2) || '';
    if (name.startsWith('*U') || name === '*U') name = refs.get(e.handle.toUpperCase()) || name;
    return {
      name, layer: e.layer, handle: e.handle,
      x: gn(e, 10), y: gn(e, 20), sx: gn(e, 41, 1), sy: gn(e, 42, gn(e, 41, 1)), rot: gn(e, 50),
      attribs: [],
    };
  };
  const close = () => {
    if (!cur) return;
    const e = cur; cur = null;
    if (e.type === 'ATTRIB') {
      if (lastInsert) lastInsert.attribs.push({ tag: g(e, 2) || '', text: g(e, 1) || '' });
      return;
    }
    if (e.type === 'SEQEND') { lastInsert = null; if (polyline) { finishPolyline(); } return; }
    if (e.type === 'POLYLINE') { polyline = { ...e, type: 'LWPOLYLINE', codes: e.codes.filter(([c]) => c === 70 || c === 8) }; return; }
    if (e.type === 'VERTEX') { if (polyline) polyline.codes.push([10, g(e, 10) || '0'], [20, g(e, 20) || '0']); return; }
    layers.add(e.layer);
    if (e.type === 'INSERT') {
      const ins = toInsert(e); lastInsert = ins;
      if (blk) blk.inserts.push(ins); else if (section === 'ENTITIES') inserts.push(ins);
      return;
    }
    lastInsert = null;
    if (blk) blk.ents.push(e); else if (section === 'ENTITIES') ents.push(e);
  };
  const finishPolyline = () => {
    const e = polyline!; polyline = null;
    if (blk) blk.ents.push(e); else if (section === 'ENTITIES') ents.push(e);
  };

  for (let i = 0; i < P.length; i++) {
    const [c, v] = P[i];
    if (c === 0) {
      close();
      if (v === 'SECTION') { const nx = P[i + 1]; section = nx && nx[0] === 2 ? nx[1] : ''; continue; }
      if (v === 'ENDSEC') { section = ''; continue; }
      if (section === 'BLOCKS' && v === 'BLOCK') { blk = { name: '', base: [0, 0], ents: [], inserts: [] }; blkHdr = true; continue; }
      if (section === 'BLOCKS' && v === 'ENDBLK') { if (blk && blk.name) blocks.set(blk.name, blk); blk = null; blkHdr = false; continue; }
      if ((section === 'ENTITIES' || section === 'BLOCKS') && GEOM.has(v)) { blkHdr = false; cur = { type: v, layer: '0', handle: '', codes: [] }; continue; }
      blkHdr = false;
      continue;
    }
    if (blk && blkHdr) {
      if (c === 2 && !blk.name) blk.name = v;
      else if (c === 10) blk.base[0] = num(v);
      else if (c === 20) blk.base[1] = num(v);
      continue;
    }
    if (cur) {
      if (c === 8) cur.layer = v;
      else if (c === 5) cur.handle = v;
      cur.codes.push([c, v]);
    }
  }
  close();
  return { ents, inserts, blocks, layers: [...layers].sort() };
}

// ---------- geometria das entidades ----------
export type Prim = { kind: 'line'; pts: Pt[]; layer: string } | { kind: 'arc'; c: Pt; r: number; pts: Pt[]; layer: string };

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  if (a1 < a0) a1 += 360;
  const n = Math.max(4, Math.round((a1 - a0) / 5));
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

export function entPrims(e: Ent): Prim[] {
  const layer = e.layer;
  switch (e.type) {
    case 'LINE': return [{ kind: 'line', layer, pts: [[gn(e, 10), gn(e, 20)], [gn(e, 11), gn(e, 21)]] }];
    case 'LWPOLYLINE': {
      const xs = gall(e, 10).map(Number), ys = gall(e, 20).map(Number);
      const pts: Pt[] = xs.map((x, i) => [x, ys[i] ?? 0]);
      if ((gn(e, 70) & 1) && pts.length) pts.push(pts[0]);
      return pts.length > 1 ? [{ kind: 'line', layer, pts }] : [];
    }
    case 'ARC': {
      const cx = gn(e, 10), cy = gn(e, 20), r = gn(e, 40);
      return [{ kind: 'arc', layer, c: [cx, cy], r, pts: arcPts(cx, cy, r, gn(e, 50), gn(e, 51)) }];
    }
    case 'CIRCLE': {
      const cx = gn(e, 10), cy = gn(e, 20), r = gn(e, 40);
      return [{ kind: 'line', layer, pts: arcPts(cx, cy, r, 0, 360) }];
    }
    default: return [];
  }
}

type M = { bx: number; by: number; x: number; y: number; sx: number; sy: number; r: number };
const tf = (p: Pt, m: M): Pt => {
  const px = (p[0] - m.bx) * m.sx, py = (p[1] - m.by) * m.sy;
  return [m.x + px * Math.cos(m.r) - py * Math.sin(m.r), m.y + px * Math.sin(m.r) + py * Math.cos(m.r)];
};

// explode um INSERT em primitivas no sistema da planta
export function insertPrims(d: Dxf, ins: Insert, depth = 0): Prim[] {
  const b = d.blocks.get(ins.name);
  if (!b || depth > 5) return [];
  const m: M = { bx: b.base[0], by: b.base[1], x: ins.x, y: ins.y, sx: ins.sx, sy: ins.sy, r: ins.rot * Math.PI / 180 };
  const out: Prim[] = [];
  const push = (p: Prim) => {
    if (p.kind === 'line') out.push({ ...p, pts: p.pts.map(q => tf(q, m)) });
    else out.push({ ...p, c: tf(p.c, m), r: p.r * Math.abs(m.sx), pts: p.pts.map(q => tf(q, m)) });
  };
  for (const e of b.ents) for (const p of entPrims(e)) push(p);
  for (const sub of b.inserts) for (const p of insertPrims(d, sub, depth + 1)) push(p);
  return out;
}

export function entText(e: Ent): { text: string; x: number; y: number; h: number } | null {
  if (e.type !== 'TEXT' && e.type !== 'MTEXT') return null;
  let t = (gall(e, 3).join('') + (g(e, 1) || ''));
  t = t.replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/\\P/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  return { text: t, x: gn(e, 10), y: gn(e, 20), h: gn(e, 40, 0.1) };
}
