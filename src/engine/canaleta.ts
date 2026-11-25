// Base de canaleta 14 × 19 × 39 embaixo de todas as paredes do térreo: assentada em cima dos blocos de fundação;
// por dentro passa a ferragem e é concretada (vira uma viga corrida); os painéis assentam em cima dela.
// Não passa no vão das portas (as bonecas de baixo são retiradas): para dos dois lados, embaixo da parede; nem nos vãos inteiros (sem parede).
import type { Trecho, Painel } from './model.ts';

export const CANALETA = { larg: 0.14, alt: 0.19, comp: 0.39, vazio: 0.09 * 0.15, peso: 22 };   // vazio interno ≈ 9 × 15 cm; kN/m³ da canaleta concretada

export interface Canaleta { segs: { o: 'H' | 'V'; c: number; a: number; b: number }[]; pecas: { o: 'H' | 'V'; c: number; a: number; b: number; cortada: boolean }[]; L: number; un: number; concreto: number; aco: { barras: number; bit: number; m: number; kg: number }; kNm: number }

export function canaletaBase(ts: Trecho[], ps: Painel[] = [], perdas = 0.05, barras = 2, bit = 10): Canaleta {
  const h = CANALETA.larg / 2;
  const segs: Canaleta['segs'] = [];
  for (const t of ts) {
    // tira os vãos inteiros (não tem parede ali)
    let partes: [number, number][] = [[t.s, t.e]];
    // portas: o vão da porta fica livre (a canaleta para nos dois lados, só embaixo da parede)
    // (recorte de porta do painel, que sai do pé: a boneca de baixo é retirada; as bonecas laterais ficam apoiadas)
    const livres = [...t.vaos.filter(v => v.inteiro).map(v => ({ a: v.a, b: v.b })),
      ...ps.filter(P => P.trecho === t.id && !P.z0).flatMap(P => P.recortes.filter(r => r.base <= 0.15 + 1e-6).map(r => ({ a: Math.min(P.a, P.b) + r.dl, b: Math.min(P.a, P.b) + r.dl + r.w })))];
    for (const v of livres) { partes = partes.flatMap(([a, b]) => v.b <= a || v.a >= b ? [[a, b]] : [...(v.a > a ? [[a, v.a]] : []), ...(v.b < b ? [[v.b, b]] : [])] as [number, number][]); }
    for (let [a, b] of partes) {
      if (b - a < 0.05) continue;
      // ponta que chega em outra parede: a canaleta vai até a face de fora dela (o canto fecha)
      const chega = (u: number) => ts.some(x => x !== t && x.o !== t.o && Math.abs(x.c - u) < h + 0.1 && x.s - 0.1 <= t.c && t.c <= x.e + 0.1);
      if (chega(a)) a -= h; if (chega(b)) b += h;
      segs.push({ o: t.o, c: t.c, a, b });
    }
  }
  // paginação: nos encontros a fiada horizontal passa e a vertical para na face dela; peças de 39 + junta de 1 cm, a última cortada
  const pecas: Canaleta['pecas'] = [];
  for (const s of segs) {
    let { a, b } = s;
    if (s.o === 'V') for (const x of segs) {
      if (x.o !== 'H' || s.c < x.a - 0.01 || s.c > x.b + 0.01) continue;
      if (x.c - h - 0.02 <= a && a < x.c + h) a = Math.max(a, x.c + h);
      if (x.c - h < b && b <= x.c + h + 0.02) b = Math.min(b, x.c - h);
    }
    for (let u = a; u < b - 0.01; u += CANALETA.comp + 0.01) { const u1 = Math.min(b, u + CANALETA.comp); pecas.push({ o: s.o, c: s.c, a: u, b: u1, cortada: u1 - u < CANALETA.comp - 0.005 }); }
  }
  // comprimento pela área da união das faixas (encontros contados uma vez só), em malha de 1 cm
  const cel = new Set<number>(), R = 100;
  for (const s of segs) {
    const [x0, x1, y0, y1] = s.o === 'H' ? [s.a, s.b, s.c - h, s.c + h] : [s.c - h, s.c + h, s.a, s.b];
    for (let i = Math.round(x0 * R); i < Math.round(x1 * R); i++) for (let j = Math.round(y0 * R); j < Math.round(y1 * R); j++) cel.add(i * 100000 + j);
  }
  const L = cel.size / (R * R) / CANALETA.larg;
  const un = Math.ceil(pecas.length * (1 + perdas));   // cada pedaço cortado conta como uma canaleta
  const m = barras * L * 1.1;   // 10% de traspasse e ancoragem nos cantos
  return { segs, pecas, L, un, concreto: L * CANALETA.vazio, aco: { barras, bit, m, kg: m * (bit * bit / 162) }, kNm: CANALETA.larg * CANALETA.alt * CANALETA.peso };
}
