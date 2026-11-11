// Planta para o portal do cliente (sistema de gestão): paredes, lajes e estacas com o
// mesmo código das etiquetas (QR), para o portal pintar o que já foi montado/concretado.
import type { Ajustes, Painel, Pavimento, Regras, Trecho } from './model.ts';
import type { PainelLaje } from './lajes.ts';
import { siglas, codigoParede, codigoLaje } from './producao.ts';
import { pontosFundacao } from './fundacao.ts';

export interface PlantaPortal {
  v: 1;
  obra: string;
  gerado: string;
  pavs: { id: string; nome: string }[];
  paredes: { c: string; p: string; x1: number; y1: number; x2: number; y2: number }[];
  lajes: { c: string; p: string; x0: number; y0: number; x1: number; y1: number }[];
  /** estacas / blocos da fundação (código B1, B2… como na planta de locação) */
  estacas: { c: string; x: number; y: number }[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function plantaPortal(
  obra: string,
  ativos: Pavimento[],
  calc: { ts: Trecho[]; ps: Painel[]; pl: PainelLaje[] },
  regras: Regras,
  aj: Ajustes,
): PlantaPortal {
  const sg = siglas(ativos);
  const pf = ativos[0];
  const doPav = <T extends { pav: string }>(l?: T[]) => (l || []).filter(e => e.pav === pf?.id);
  const pts = pf
    ? pontosFundacao(calc.ts.filter(t => t.pav === pf.id), calc.ps.filter(p => p.pav === pf.id), regras.fundEspac ?? 0,
      { extra: doPav(aj.fundExtra), remover: doPav(aj.fundRemover) })
    : [];
  return {
    v: 1,
    obra,
    gerado: new Date().toISOString(),
    pavs: ativos.map(p => ({ id: p.id, nome: p.nome })),
    paredes: calc.ps.map(p => {
      const [x1, y1, x2, y2] = p.o === 'H' ? [p.a, p.c, p.a + p.larg, p.c] : [p.c, p.a, p.c, p.a + p.larg];
      return { c: codigoParede(p, sg), p: p.pav, x1: r3(x1), y1: r3(y1), x2: r3(x2), y2: r3(y2) };
    }),
    lajes: calc.pl.map(p => ({ c: codigoLaje(p, sg), p: p.pav, x0: r3(p.x0), y0: r3(p.y0), x1: r3(p.x1), y1: r3(p.y1) })),
    estacas: pts.map(p => ({ c: `B${p.n}`, x: r3(p.x), y: r3(p.y) })),
  };
}
