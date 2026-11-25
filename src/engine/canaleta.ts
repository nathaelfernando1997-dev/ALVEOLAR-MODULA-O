// Base de canaleta (bloco canaleta de concreto 14 × 19 × 39) embaixo de todas as paredes do térreo:
// assentada em cima dos blocos de fundação, grauteada e armada; os painéis assentam em cima dela.
// Corre por baixo das portas (não para no vão); não passa nos vãos inteiros (sem parede, ex.: frente da garagem).
import type { Trecho } from './model.ts';

export const CANALETA = { larg: 0.14, alt: 0.19, comp: 0.39, vazio: 0.09 * 0.15, peso: 22 };   // vazio interno ≈ 9 × 15 cm; kN/m³ do conjunto grauteado

export interface Canaleta { segs: { o: 'H' | 'V'; c: number; a: number; b: number }[]; L: number; un: number; graute: number; aco: { barras: number; bit: number; m: number; kg: number }; kNm: number }

export function canaletaBase(ts: Trecho[], perdas = 0.05, barras = 2, bit = 10): Canaleta {
  const h = CANALETA.larg / 2;
  const segs: Canaleta['segs'] = [];
  for (const t of ts) {
    // tira os vãos inteiros (não tem parede ali)
    let partes: [number, number][] = [[t.s, t.e]];
    for (const v of t.vaos.filter(v => v.inteiro)) partes = partes.flatMap(([a, b]) => v.b <= a || v.a >= b ? [[a, b]] : [...(v.a > a ? [[a, v.a]] : []), ...(v.b < b ? [[v.b, b]] : [])] as [number, number][]);
    for (let [a, b] of partes) {
      if (b - a < 0.05) continue;
      // ponta que chega em outra parede: a canaleta vai até a face de fora dela (o canto fecha)
      const chega = (u: number) => ts.some(x => x !== t && x.o !== t.o && Math.abs(x.c - u) < h + 0.1 && x.s - 0.1 <= t.c && t.c <= x.e + 0.1);
      if (chega(a)) a -= h; if (chega(b)) b += h;
      segs.push({ o: t.o, c: t.c, a, b });
    }
  }
  // comprimento pela área da união das faixas (encontros contados uma vez só), em malha de 1 cm
  const cel = new Set<number>(), R = 100;
  for (const s of segs) {
    const [x0, x1, y0, y1] = s.o === 'H' ? [s.a, s.b, s.c - h, s.c + h] : [s.c - h, s.c + h, s.a, s.b];
    for (let i = Math.round(x0 * R); i < Math.round(x1 * R); i++) for (let j = Math.round(y0 * R); j < Math.round(y1 * R); j++) cel.add(i * 100000 + j);
  }
  const L = cel.size / (R * R) / CANALETA.larg;
  const un = Math.ceil(L / CANALETA.comp * (1 + perdas));
  const m = barras * L * 1.1;   // 10% de traspasse e ancoragem nos cantos
  return { segs, L, un, graute: L * CANALETA.vazio, aco: { barras, bit, m, kg: m * (bit * bit / 162) }, kNm: CANALETA.larg * CANALETA.alt * CANALETA.peso };
}
