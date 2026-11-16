// Converte o DXF gerado pelo sistema em DWG (AutoCAD 2004), no próprio navegador.
// Atenção: a biblioteca depende dos nomes das classes (vite.config.ts usa keepNames).
export async function dxfParaDwg(dxf: string): Promise<Uint8Array> {
  const { DxfReader, DwgWriter, ACadVersion, XY, XYZ } = await import('@node-projects/acad-ts');
  const doc = DxfReader.readFromStream(new TextEncoder().encode(dxf), () => {});
  const d = doc as unknown as Record<string, { createDefaultEntries?: () => void } | undefined>;
  for (const t of ['appIds', 'lineTypes', 'layers', 'textStyles', 'dimensionStyles', 'vPorts', 'blockRecords', 'uCSs', 'views'])
    try { d[t]?.createDefaultEntries?.(); } catch { /* já existe */ }
  if (doc.header) doc.header.version = ACadVersion.AC1018;
  // limites do desenho: o AutoCAD abre já enquadrado na planta
  try {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (p: { x: number; y: number } | undefined, r = 0) => {
      if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
      x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r); x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
    };
    type P = { x: number; y: number };
    for (const e of doc.entities as Iterable<Record<string, unknown>>) {
      add(e.startPoint as P); add(e.endPoint as P); add(e.insertPoint as P);
      if (e.center) add(e.center as P, Number(e.radius) || 0);
      for (const v of (e.vertices as Iterable<{ location?: P }> | undefined) ?? []) add(v?.location);
      for (const k of ['firstCorner', 'secondCorner', 'thirdCorner', 'fourthCorner']) add(e[k] as P);
    }
    if (isFinite(x0) && doc.header) {
      doc.header.modelSpaceExtMin = new XYZ(x0, y0, 0); doc.header.modelSpaceExtMax = new XYZ(x1, y1, 0);
      doc.header.modelSpaceLimitsMin = new XY(x0, y0); doc.header.modelSpaceLimitsMax = new XY(x1, y1);
      for (const v of doc.vPorts ?? []) if (v.name === '*Active') {
        v.center = new XY((x0 + x1) / 2, (y0 + y1) / 2);
        v.viewHeight = Math.max(y1 - y0, (x1 - x0) / (v.aspectRatio || 1.6)) * 1.05 || 10;
      }
    }
  } catch { /* sem enquadramento, o desenho continua certo */ }
  return DwgWriter.writeToBuffer(doc);
}
