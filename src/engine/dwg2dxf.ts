// DWG: lido no navegador pelo LibreDWG (WebAssembly) e reescrito como um DXF simples
// (linhas, arcos, textos, blocos, cotas) em metros, que segue o mesmo caminho do DXF.
/* eslint-disable @typescript-eslint/no-explicit-any */

type P = { x: number; y: number };
const deg = (r: number) => (r * 180) / Math.PI;

// pedaços de arco de uma polilinha com "bulge" viram pontos
function comBulge(vs: (P & { bulge?: number })[], fechada: boolean): P[] {
  const out: P[] = [];
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = vs[i], b = vs[(i + 1) % n];
    out.push(a);
    if (i === n - 1 && !fechada) break;
    const k = a.bulge || 0;
    if (Math.abs(k) < 1e-9) continue;
    const ang = 4 * Math.atan(k), d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-9) continue;
    const r = d / (2 * Math.sin(ang / 2));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, h = r * Math.cos(ang / 2);
    const nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d;
    const cx = mx + nx * h, cy = my + ny * h;
    const a0 = Math.atan2(a.y - cy, a.x - cx), passos = Math.max(2, Math.round(Math.abs(deg(ang)) / 10));
    for (let s = 1; s < passos; s++) { const t = a0 + (ang * s) / passos; out.push({ x: cx + Math.abs(r) * Math.cos(t), y: cy + Math.abs(r) * Math.sin(t) }); }
  }
  return out;
}

// escala para metros pelas linhas das paredes (as cotas e o INSUNITS do arquivo nem sempre batem com o desenho):
// 20% das linhas de parede mais curtas ficam na espessura da parede — metros ~0,15, centímetros ~15, milímetros ~150
function escalaPelasParedes(ents: any[]): number {
  const L = ents.filter(e => e.type === 'LINE' && /parede|wall|alven/i.test(e.layer || ''))
    .map(e => Math.hypot(e.endPoint.x - e.startPoint.x, e.endPoint.y - e.startPoint.y)).filter(v => v > 1e-6).sort((a, b) => a - b);
  if (L.length < 10) return 1;
  const p20 = L[Math.floor(L.length * 0.2)];
  return p20 < 3 ? 1 : p20 < 60 ? 0.01 : 0.001;
}

export function bancoParaDxf(db: any): { dxf: string; escala: number } {
  const blocos = (db.tables?.BLOCK_RECORD?.entries || []) as any[];
  const modelo = blocos.find(b => /^\*model_space$/i.test(b.name));
  const ents: any[] = modelo?.entities?.length ? modelo.entities : (db.entities || []).filter((e: any) => !e.ownerBlockRecordSoftId || e.ownerBlockRecordSoftId === modelo?.handle);
  const k = escalaPelasParedes(ents);
  const f = (v: number) => (v * k).toFixed(4);
  const out: string[] = [];
  const txt = (s: string) => String(s ?? '').replace(/\r?\n/g, '\\P');
  const ent = (e: any) => {
    const l = e.layer || '0', h = e.handle ? ['5', String(e.handle)] : [];
    switch (e.type) {
      case 'LINE': out.push('0', 'LINE', ...h, '8', l, '10', f(e.startPoint.x), '20', f(e.startPoint.y), '11', f(e.endPoint.x), '21', f(e.endPoint.y)); break;
      case 'LWPOLYLINE': case 'POLYLINE2D': case 'POLYLINE3D': {
        const fechada = !!(e.flag & 1);
        const pts = comBulge((e.vertices || []).filter((v: any) => !(v.flag & 16)), fechada);
        if (pts.length < 2) break;
        out.push('0', 'LWPOLYLINE', ...h, '8', l, '90', String(pts.length), '70', fechada ? '1' : '0');
        for (const p of pts) out.push('10', f(p.x), '20', f(p.y));
        break;
      }
      case 'ARC': out.push('0', 'ARC', ...h, '8', l, '10', f(e.center.x), '20', f(e.center.y), '40', f(e.radius), '50', deg(e.startAngle).toFixed(4), '51', deg(e.endAngle).toFixed(4)); break;
      case 'CIRCLE': out.push('0', 'CIRCLE', ...h, '8', l, '10', f(e.center.x), '20', f(e.center.y), '40', f(e.radius)); break;
      case 'SOLID': out.push('0', 'SOLID', ...h, '8', l, '10', f(e.corner1.x), '20', f(e.corner1.y), '11', f(e.corner2.x), '21', f(e.corner2.y), '12', f(e.corner3.x), '22', f(e.corner3.y), '13', f((e.corner4 || e.corner3).x), '23', f((e.corner4 || e.corner3).y)); break;
      case 'TEXT': {
        const p = (e.halign || e.valign) && e.endPoint && (e.endPoint.x || e.endPoint.y) ? e.endPoint : e.startPoint;
        out.push('0', 'TEXT', ...h, '8', l, '10', f(p.x), '20', f(p.y), '40', f(e.textHeight || 0.1), '50', deg(e.rotation || 0).toFixed(3), '1', txt(e.text));
        break;
      }
      case 'MTEXT': out.push('0', 'MTEXT', ...h, '8', l, '10', f(e.insertionPoint.x), '20', f(e.insertionPoint.y), '40', f(e.textHeight || 0.1), '1', txt(e.text)); break;
      case 'DIMENSION': {
        const p1 = e.subDefinitionPoint1, p2 = e.subDefinitionPoint2, d = e.definitionPoint;
        if (!p1 || !p2) break;
        out.push('0', 'DIMENSION', ...h, '8', l, '10', f(d?.x ?? 0), '20', f(d?.y ?? 0), '13', f(p1.x), '23', f(p1.y), '14', f(p2.x), '24', f(p2.y), '50', deg(e.rotationAngle || 0).toFixed(4), '42', f(e.measurement || 0));
        break;
      }
      case 'INSERT': {
        out.push('0', 'INSERT', ...h, '8', l, '2', e.name, '10', f(e.insertionPoint.x), '20', f(e.insertionPoint.y), '41', String(e.xScale ?? 1), '42', String(e.yScale ?? 1), '50', deg(e.rotation || 0).toFixed(4));
        for (const a of e.attribs || []) {
          const t = a.text || {};
          out.push('0', 'ATTRIB', '8', a.layer || l, '10', f(t.startPoint?.x ?? 0), '20', f(t.startPoint?.y ?? 0), '40', f(t.textHeight || 0.1), '2', a.tag || '', '1', txt(t.text ?? ''));
        }
        if ((e.attribs || []).length) out.push('0', 'SEQEND');
        break;
      }
    }
  };
  out.push('0', 'SECTION', '2', 'BLOCKS');
  for (const b of blocos) {
    if (/^\*(model|paper)_space/i.test(b.name) || /^\*D\d/i.test(b.name) || !b.entities?.length) continue;
    // os blocos ficam na unidade do desenho: a escala vai nas coordenadas, o INSERT continua com a escala original
    out.push('0', 'BLOCK', '8', '0', '2', b.name, '70', '0', '10', f(b.basePoint?.x ?? 0), '20', f(b.basePoint?.y ?? 0));
    for (const e of b.entities) ent(e);
    out.push('0', 'ENDBLK');
  }
  out.push('0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  for (const e of ents) ent(e);
  out.push('0', 'ENDSEC', '0', 'EOF');
  return { dxf: out.join('\n'), escala: k };
}

export async function dwgParaDxf(dados: ArrayBuffer): Promise<{ dxf: string; avisos: string[] }> {
  // o .wasm (10 MB) só é baixado quando abre um DWG
  const [{ LibreDwg, Dwg_File_Type, createModule }, wasm] = await Promise.all([import('@mlightcad/libredwg-web'), import('../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url')]);
  const lib = LibreDwg.createByWasmInstance(await createModule({ locateFile: () => wasm.default } as any) as any);
  const dwg = lib.dwg_read_data(dados, Dwg_File_Type.DWG);
  if (!dwg) throw new Error('Não consegui ler este DWG. No AutoCAD use "Salvar como" > DXF e envie o DXF.');
  const db = lib.convert(dwg);
  lib.dwg_free(dwg);
  const r = bancoParaDxf(db);
  const avisos = [`Projeto lido do DWG${r.escala === 1 ? '' : r.escala === 0.01 ? ' (desenhado em centímetros, convertido para metros)' : ' (desenhado em milímetros, convertido para metros)'}.`];
  return { dxf: r.dxf, avisos };
}
