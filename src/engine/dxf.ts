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

export interface Cota { valor: number; x: number; y: number; vertical: boolean; p1: Pt; p2: Pt }
export interface Dxf {
  cotas: Cota[];
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

const GEOM = new Set(['DIMENSION', 'LINE', 'LWPOLYLINE', 'ARC', 'CIRCLE', 'TEXT', 'MTEXT', 'INSERT', 'ATTRIB', 'SOLID', 'POLYLINE', 'VERTEX', 'SEQEND']);

// medida da cota pela geometria (o código 42 pode vir em outra unidade, conforme o fator da cota)
function cotaDe(e: Ent): Cota {
  const p1: Pt = [gn(e, 13), gn(e, 23)], p2: Pt = [gn(e, 14), gn(e, 24)];
  const rot = ((gn(e, 50) % 180) + 180) % 180;
  const vertical = Math.abs(rot - 90) < 1 || (Math.abs(p1[0] - p2[0]) < 1e-6 && Math.abs(p1[1] - p2[1]) > 1e-6);
  const valor = vertical ? Math.abs(p1[1] - p2[1]) : rot < 1 || rot > 179 ? Math.abs(p1[0] - p2[0]) : Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
  return { valor, x: gn(e, 10), y: gn(e, 20), vertical, p1, p2 };
}

// Projetos exportados do Revit/ArchiCAD trazem cada planta e cada corte como um bloco (às vezes espelhado).
// Bloco grande (desenho inteiro) vira entidades soltas no desenho, com as coordenadas já transformadas;
// blocos pequenos (portas, janelas, móveis) continuam como INSERT.
const GRANDE = 150;
type Tf = { bx: number; by: number; x: number; y: number; sx: number; sy: number; r: number };
const tfPt = (m: Tf, x: number, y: number): Pt => {
  const px = (x - m.bx) * m.sx, py = (y - m.by) * m.sy, c = Math.cos(m.r), s = Math.sin(m.r);
  return [m.x + px * c - py * s, m.y + px * s + py * c];
};
const tfAng = (m: Tf, a: number) => { const o = tfPt(m, 0, 0), p = tfPt(m, Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)); return Math.atan2(p[1] - o[1], p[0] - o[0]) * 180 / Math.PI; };
function tfEnt(e: Ent, m: Tf, camada: string): Ent {
  const codes: [number, string][] = e.codes.map(([c, v]) => [c, v]);
  const esp = m.sx * m.sy < 0;
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i][0];
    if (c >= 10 && c <= 14) {
      const j = codes.findIndex((q, k) => k > i && q[0] === c + 10);
      if (j < 0) continue;
      const [x, y] = tfPt(m, parseFloat(codes[i][1]) || 0, parseFloat(codes[j][1]) || 0);
      codes[i][1] = String(x); codes[j][1] = String(y);
    }
  }
  const k = Math.abs(m.sx);
  if (e.type === 'ARC' || e.type === 'CIRCLE') for (const q of codes) if (q[0] === 40) q[1] = String((parseFloat(q[1]) || 0) * k);
  if (e.type === 'TEXT' || e.type === 'MTEXT') for (const q of codes) if (q[0] === 40) q[1] = String((parseFloat(q[1]) || 0) * Math.abs(m.sy));
  if (e.type === 'ARC') {
    const a0 = gn(e, 50), a1 = gn(e, 51);
    const n0 = tfAng(m, esp ? a1 : a0), n1 = tfAng(m, esp ? a0 : a1);
    for (const q of codes) { if (q[0] === 50) q[1] = String(n0); else if (q[0] === 51) q[1] = String(n1); }
  } else if (e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'DIMENSION') {
    for (const q of codes) if (q[0] === 50) q[1] = String(tfAng(m, parseFloat(q[1]) || 0));
  }
  const layer = e.layer === '0' && camada ? camada : e.layer;
  return { ...e, layer, codes: codes.map(([c, v]) => [c, c === 8 ? layer : v]) };
}
function explodirGrandes(d: Dxf, layers: Set<string>) {
  const tamanho = (b: Block) => b.ents.length + b.inserts.length;
  const fila = [...d.inserts], ficam: Insert[] = [];
  for (let n = 0; n < fila.length && n < 20000; n++) {
    const ins = fila[n], b = d.blocks.get(ins.name);
    if (!b || tamanho(b) < GRANDE) { ficam.push(ins); continue; }
    const m: Tf = { bx: b.base[0], by: b.base[1], x: ins.x, y: ins.y, sx: ins.sx, sy: ins.sy, r: ins.rot * Math.PI / 180 };
    const camada = ins.layer !== '0' ? ins.layer : '';
    for (const e of b.ents) {
      const t = tfEnt(e, m, camada);
      if (t.type === 'DIMENSION') { d.cotas.push(cotaDe(t)); continue; }
      d.ents.push(t); layers.add(t.layer);
    }
    const esp = m.sx * m.sy < 0;
    for (const s of b.inserts) {
      const [x, y] = tfPt(m, s.x, s.y);
      fila.push({ ...s, x, y, sx: s.sx * m.sx, sy: s.sy * m.sy, rot: ins.rot + (esp ? -s.rot : s.rot), layer: s.layer === '0' && camada ? camada : s.layer });
    }
  }
  d.inserts = ficam;
}

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
  const cotas: Cota[] = [];
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
    if (e.type === 'DIMENSION') {
      if (!blk && section === 'ENTITIES') cotas.push(cotaDe(e));
      else if (blk) blk.ents.push(e);   // cota dentro de bloco: vale quando o bloco é uma planta/corte inteira (ver explodirGrandes)
      return;
    }
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
  const d: Dxf = { ents, inserts, blocks, cotas, layers: [] };
  explodirGrandes(d, layers);
  d.layers = [...layers].sort();
  return d;
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
