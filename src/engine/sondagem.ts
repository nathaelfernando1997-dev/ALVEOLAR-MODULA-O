// Capacidade de carga de estaca a partir do SPT (NBR 6122): Aoki-Velloso (1975) e Décourt-Quaresma (1978/1996)
// Valores em kN e metros. O SPT de cada furo é dado metro a metro (N do metro z = camada z-1 a z).

export const SOLOS = ['argila', 'argila siltosa', 'argila arenosa', 'silte', 'silte argiloso', 'silte arenoso', 'silte areno-argiloso', 'areia', 'areia siltosa', 'areia argilosa'] as const;
export type Solo = typeof SOLOS[number];
export type TipoEstaca = 'escavada' | 'helice';
export const TIPOS_ESTACA: [TipoEstaca, string][] = [['escavada', 'Escavada mecanicamente (trado)'], ['helice', 'Hélice contínua']];

export interface Furo { nome: string; n: number[]; solo: Solo[] }
export interface DadosFund {
  furos: Furo[];
  tipo: TipoEstaca;
  pavCarga?: Record<string, 'piso' | 'forro' | 'nada'>;   // tipo de carga em cima de cada pavimento
  baldrame?: boolean;                                      // tem viga baldrame 15×40 embaixo das paredes
  criterio?: 'norma' | 'rt';
  canaleta?: boolean;                                      // base de canaleta 14×19×39 grauteada embaixo de todas as paredes (em cima dos blocos)
  auto2E?: boolean;                                        // opcional: bloco de 2 estacas onde a carga passa de uma estaca                               // 'rt' = comprimento escolhido pelo responsável técnico mesmo sem atender a regra da ponta
}
export const FUND_VAZIA: DadosFund = { furos: [], tipo: 'escavada', baldrame: false };

// Aoki-Velloso: K (kPa) e alfa
const AV: Record<Solo, [number, number]> = {
  'argila': [200, 0.060], 'argila siltosa': [220, 0.040], 'argila arenosa': [350, 0.024],
  'silte': [400, 0.030], 'silte argiloso': [230, 0.034], 'silte arenoso': [550, 0.022], 'silte areno-argiloso': [450, 0.028],
  'areia': [1000, 0.014], 'areia siltosa': [800, 0.020], 'areia argilosa': [600, 0.030],
};
const F12: Record<TipoEstaca, [number, number]> = { escavada: [3.0, 6.0], helice: [2.0, 4.0] };
// Décourt-Quaresma: C (kPa) e alfa/beta por grupo de solo e tipo de estaca
const grupo = (s: Solo) => s.startsWith('argila') ? 0 : s.startsWith('silte') ? 1 : 2;   // argila / intermediário / areia
const DQC = (s: Solo) => s.startsWith('argila') ? 120 : s.startsWith('areia') ? 400 : (s === 'silte arenoso' || s === 'silte areno-argiloso') ? 250 : 200;
const DQab: Record<TipoEstaca, [number, number][]> = {
  escavada: [[0.85, 0.80], [0.60, 0.65], [0.50, 0.50]],
  helice: [[0.30, 1.00], [0.30, 1.00], [0.30, 1.00]],
};
const TOPO = 1;   // o primeiro metro (bloco, solo mexido) não conta no atrito

export interface Capac { Rl: number; Rp: number; Rult: number; Pfs: number; Ppt: number; Padm: number }
export interface LinhaCap { L: number; furo: string; AV: Capac; DQ: Capac }

const cap = (Rp: number, Rl: number, tipo: TipoEstaca): Capac => {
  const Pfs = (Rp + Rl) / 2;                                  // NBR 6122: fator de segurança global 2,0 (métodos semiempíricos)
  const Ppt = tipo === 'escavada' ? 1.25 * Rl : Infinity;     // escavada: ponta no máximo 20% da carga admissível
  return { Rl, Rp, Rult: Rp + Rl, Pfs, Ppt, Padm: Math.min(Pfs, Ppt) };
};

export function capacidade(f: Furo, L: number, D: number, tipo: TipoEstaca): LinhaCap | null {
  const n = f.n.length;
  if (L < 2 || L > n) return null;
  const Ap = Math.PI * D * D / 4, U = Math.PI * D, N = (i: number) => Math.min(50, f.n[i] ?? 0), S = (i: number) => f.solo[i] ?? 'argila';
  const zs: number[] = []; for (let z = TOPO + 1; z <= L; z++) zs.push(z);
  const sp = S(L - 1), [F1, F2] = F12[tipo];
  const [K, a] = AV[sp];
  const RpAV = K * N(L - 1) / F1 * Ap;
  const RlAV = zs.reduce((s, z) => s + AV[S(z - 1)][1] * AV[S(z - 1)][0] * N(z - 1) / F2 * U, 0);
  const jan = [L - 2, L - 1, L].filter(i => i >= 0 && i < n).map(N), Npd = jan.reduce((s, v) => s + v, 0) / jan.length;
  const [al, be] = DQab[tipo][grupo(sp)];
  const RpDQ = al * DQC(sp) * Npd * Ap;
  const RlDQ = zs.reduce((s, z) => s + DQab[tipo][grupo(S(z - 1))][1] * 10 * (Math.min(50, Math.max(3, N(z - 1))) / 3 + 1) * U, 0);
  void a; void be;
  return { L, furo: f.nome, AV: cap(RpAV, RlAV, tipo), DQ: cap(RpDQ, RlDQ, tipo) };
}

// resumo por comprimento: o pior furo e o pior método (a favor da segurança)
export interface ResumoL { L: number; Padm: number; Pfs: number; Rult: number; Rl: number; Rp: number; governa: string; linhas: LinhaCap[] }
export function resumo(furos: Furo[], D: number, tipo: TipoEstaca): ResumoL[] {
  const maxL = Math.min(...furos.map(f => f.n.length));
  const out: ResumoL[] = [];
  for (let L = 2; L <= maxL; L++) {
    const linhas = furos.map(f => capacidade(f, L, D, tipo)).filter((x): x is LinhaCap => !!x);
    if (!linhas.length) continue;
    let best: { c: Capac; g: string } | null = null;
    for (const l of linhas) for (const m of ['AV', 'DQ'] as const) if (!best || l[m].Padm < best.c.Padm) best = { c: l[m], g: `${m === 'AV' ? 'Aoki-Velloso' : 'Décourt-Quaresma'} · ${l.furo}` };
    out.push({ L, Padm: best!.c.Padm, Pfs: Math.min(...linhas.flatMap(l => [l.AV.Pfs, l.DQ.Pfs])), Rult: best!.c.Rult, Rl: best!.c.Rl, Rp: best!.c.Rp, governa: best!.g, linhas });
  }
  return out;
}

// leitura rápida do laudo: "4 12 10 7 13" ou "4;12;10" -> números
export const lerNs = (t: string) => t.split(/[^0-9]+/).filter(Boolean).map(Number);
