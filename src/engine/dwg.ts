// DXF (texto, como o sistema gera) -> DWG (AutoCAD 2004, abre em qualquer AutoCAD/Eberick).
// A biblioteca só é carregada quando alguém baixa um DWG.
export async function dxfParaDwg(dxf: string): Promise<Uint8Array> {
  const { DxfReader, DwgWriter, ACadVersion } = await import('@node-projects/acad-ts');
  const doc = DxfReader.readFromStream(new TextEncoder().encode(dxf), () => { /* avisos de leitura */ });
  // o DXF do sistema é enxuto: o DWG exige as tabelas padrão (estilo de texto e de cota "Standard", camada 0…)
  const d = doc as unknown as Record<string, { createDefaultEntries?: () => void } | undefined>;
  for (const t of ['appIds', 'lineTypes', 'layers', 'textStyles', 'dimensionStyles', 'vPorts', 'blockRecords', 'uCSs', 'views'])
    try { d[t]?.createDefaultEntries?.(); } catch { /* já existe */ }
  if (doc.header) doc.header.version = ACadVersion.AC1018;
  return DwgWriter.writeToBuffer(doc);
}
