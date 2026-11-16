// Deixa as cores do DXF escuras para fundo branco (AutoCAD claro / impressão):
// amarelo, ciano, verde etc. viram tons fechados da mesma cor; preto/branco (7) fica.
const ESCURO: Record<number, number> = { 1: 14, 2: 54, 3: 94, 4: 134, 5: 174, 6: 214, 8: 251, 9: 8 };
export function corEscura(c: number): number {
  const a = Math.abs(c), s = c < 0 ? -1 : 1; // negativo = camada desligada
  if (ESCURO[a]) return s * ESCURO[a];
  if (a >= 10 && a <= 249 && a % 10 < 4) return s * (Math.floor(a / 10) * 10 + 4 + (a % 2));
  if (a >= 252 && a <= 255) return s * 251;
  return c;
}
export function escurecerDxf(dxf: string): string {
  const L = dxf.split(/\r?\n/);
  for (let i = 0; i + 1 < L.length; i += 2) if (L[i].trim() === '62') {
    const v = parseInt(L[i + 1], 10); if (!isNaN(v)) L[i + 1] = String(corEscura(v));
  }
  return L.join('\r\n');
}
