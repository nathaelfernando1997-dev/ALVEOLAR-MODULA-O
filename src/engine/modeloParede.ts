// Modelo "parede sobre estacas": grelha com as paredes do térreo (e o baldrame, se houver) apoiada em molas não lineares (estacas).
// A parede trabalha como viga-parede e redistribui a carga entre as estacas. Resultado: carga e recalque de cada estaca e
// a tração na base da parede (armadura de amarração). Unidades: kN, m.
import type { Cargas } from './cargasFund.ts';

export interface OpModelo { baldrame: boolean; Ec?: number; tw?: number; Rl: number; Rp: number; L: number; D?: number; fatSolo?: number }
export interface ResModelo {
  R: Record<number, number>; rec: Record<number, number>;              // carga (kN) e recalque (mm) por ponto
  trechos: { t: number; Tparede: number; Tporta: number; Ttopo: number }[];   // maior tração (kN) na base fora das portas, embaixo das portas e no topo
  iter: number; ok: boolean;
}

export function modeloParede(C: Cargas, pts: { n: number; x: number; y: number }[], o: OpModelo): ResModelo {
  const TS = C.ts, TOL = 0.15, Ec = o.Ec ?? 24e6, G = Ec / 2.4, tw = o.tw ?? 0.05, D = o.D ?? 0.3;
  // ---- estações ao longo de cada trecho
  const st: number[][] = TS.map((t, i) => {
    const us = new Set<number>([t.s, t.e]);
    const n = Math.max(2, Math.ceil((t.e - t.s) / 0.25) + 1); for (let k = 0; k < n; k++) us.add(t.s + (t.e - t.s) * k / (n - 1));
    for (const v of t.vaos) for (const z of [v.a, v.b]) if (t.s < z && z < t.e) us.add(z);
    for (const p of pts) { const u = t.o === 'H' ? p.x : p.y, w = t.o === 'H' ? p.y : p.x; if (Math.abs(w - t.c) < TOL && u > t.s - TOL && u < t.e + TOL) us.add(Math.min(t.e, Math.max(t.s, u))); }
    TS.forEach((q, j) => { if (j !== i && q.o !== t.o && q.c > t.s - TOL && q.c < t.e + TOL && t.c > q.s - TOL && t.c < q.e + TOL) us.add(Math.min(t.e, Math.max(t.s, q.c))); });
    const a = [...us].sort((x, y) => x - y), m = [a[0]];
    for (const u of a.slice(1)) { if (u - m[m.length - 1] > 0.03) m.push(u); else if (u === t.e) m[m.length - 1] = u; }
    return m;
  });
  // ---- nós (une encontros, emendas e pontos de estaca)
  const id: number[][] = []; const par: number[] = [];
  st.forEach((m, i) => { id[i] = m.map(() => { par.push(par.length); return par.length - 1; }); });
  const find = (a: number): number => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const uni = (a: number, b: number) => { par[find(a)] = find(b); };
  const near = (i: number, u: number) => { let b = 0; st[i].forEach((v, k) => { if (Math.abs(v - u) < Math.abs(st[i][b] - u)) b = k; }); return b; };
  TS.forEach((t, i) => TS.forEach((q, j) => {
    if (j <= i) return;
    if (q.o !== t.o) { if (q.c > t.s - TOL && q.c < t.e + TOL && t.c > q.s - TOL && t.c < q.e + TOL) uni(id[i][near(i, q.c)], id[j][near(j, t.c)]); }
    else if (Math.abs(q.c - t.c) < 0.05) { for (const [a, b] of [[t.e, q.s], [q.e, t.s]]) if (Math.abs(a - b) < TOL) uni(id[i][near(i, a)], id[j][near(j, b)]); }
  }));
  const estN: Record<number, number> = {};
  for (const p of pts) {
    const ns: number[] = [];
    TS.forEach((t, i) => { const u = t.o === 'H' ? p.x : p.y, w = t.o === 'H' ? p.y : p.x; if (Math.abs(w - t.c) < TOL && u > t.s - TOL && u < t.e + TOL) ns.push(id[i][near(i, u)]); });
    if (!ns.length) continue; ns.slice(1).forEach(a => uni(a, ns[0])); estN[p.n] = ns[0];
  }
  const raiz = [...new Set(par.map((_, a) => find(a)))]; const gi = new Map(raiz.map((r, k) => [r, k])); const NN = raiz.length;
  for (const n of Object.keys(estN)) estN[+n] = gi.get(find(estN[+n]))!;   // ponto de estaca -> nó da malha
  const node = (i: number, k: number) => gi.get(find(id[i][k]))!;
  // ---- seção de cada elemento
  const props = (parts: [number, number, number][]) => { const A = parts.reduce((s, [b, z0, z1]) => s + b * (z1 - z0), 0); const zc = parts.reduce((s, [b, z0, z1]) => s + b * (z1 - z0) * (z0 + z1) / 2, 0) / A;
    return { A, I: parts.reduce((s, [b, z0, z1]) => s + b * (z1 - z0) ** 3 / 12 + b * (z1 - z0) * ((z0 + z1) / 2 - zc) ** 2, 0) }; };
  const secao = (i: number, u: number) => {
    const t = TS[i], hw = Math.max(1, (t.H ?? 3) - 0.14);
    const parts: [number, number, number][] = o.baldrame ? [[0.15, -0.4, 0]] : []; let lint: [number, number, number] | null = null, tipo = 'baldrame';
    const v = t.vaos.find(v => v.a < u && u < v.b);
    if (!v) { parts.push([tw, 0, hw]); tipo = 'parede'; }
    else { const topo = v.topo ?? v.base + v.h; if (v.base > 0.02) parts.push([tw, 0, v.base]); if (hw - topo > 0.05) lint = [tw, topo, hw]; tipo = v.tipo?.startsWith('P') || v.base < 0.15 ? 'porta' : 'janela'; }
    const extra = o.baldrame ? 0.4 : 0;
    if (!parts.length) { if (!lint) return { I: 0.15 * 0.3 ** 3 / 12, A: 0.045, z: 0.25, tipo: 'livre' }; /* passagem sem parede: a laje/viga em cima segura como uma viga 15×30 */ const p = props([lint]); return { ...p, z: 0.8 * (lint[2] - lint[1]), tipo: 'verga' }; }
    let { A, I } = props(parts);
    if (lint) { const p2 = props([...parts, lint]); I = I + 0.3 * (p2.I - I); A = p2.A; }
    const h = (tipo === 'parede' ? hw : lint ? lint[2] : Math.max(...parts.map(p => p[2]))) + extra;
    return { I, A, z: tipo === 'baldrame' ? 0.32 : Math.min(0.8 * h, 1.8), tipo };
  };
  // ---- elementos e ordem dos nós (Cuthill-McKee reverso, para a matriz ficar em faixa estreita)
  type El = { i: number; k: number; L: number; a: number; b: number; bend: number; tors: number; s: ReturnType<typeof secao> };
  const els: El[] = [];
  TS.forEach((t, i) => { const bend = t.o === 'H' ? 1 : 2, tors = t.o === 'H' ? 2 : 1;
    for (let k = 0; k < st[i].length - 1; k++) { const L = st[i][k + 1] - st[i][k]; if (L < 1e-6) continue; els.push({ i, k, L, a: node(i, k), b: node(i, k + 1), bend, tors, s: secao(i, (st[i][k] + st[i][k + 1]) / 2) }); } });
  const viz: number[][] = Array.from({ length: NN }, () => []);
  for (const e of els) if (e.a !== e.b) { viz[e.a].push(e.b); viz[e.b].push(e.a); }
  const perm = new Int32Array(NN).fill(-1); let cnt = 0;
  const graus = (a: number) => viz[a].length;
  for (const s0 of [...Array(NN).keys()].sort((a, b) => graus(a) - graus(b))) {
    if (perm[s0] >= 0) continue; const fila = [s0]; perm[s0] = cnt++;
    for (let h = 0; h < fila.length; h++) for (const w of viz[fila[h]].slice().sort((a, b) => graus(a) - graus(b))) if (perm[w] < 0) { perm[w] = cnt++; fila.push(w); }
  }
  for (let a = 0; a < NN; a++) perm[a] = NN - 1 - perm[a];
  const nd = 3 * NN; let B = 3;
  for (const e of els) B = Math.max(B, Math.abs(perm[e.a] - perm[e.b]) * 3 + 2);
  const W = B + 1, K = new Float64Array(nd * W);
  const dof = (n: number, k: number) => 3 * perm[n] + k;
  const add = (r: number, c: number, v: number) => { if (c > r) [r, c] = [c, r]; K[r * W + (c - r + B)] += v; };
  const J = 0.229 * 0.15 ** 3 * 0.4 * 0.15;
  const kels: { e: El; d: number[]; kb: number[][] }[] = [];
  for (const e of els) {
    const EI = Ec * e.s.I, GA = G * e.s.A * 0.83, L = e.L, ph = 12 * EI / (GA * L * L), f = EI / ((1 + ph) * L ** 3);
    const kb = [[12, 6 * L, -12, 6 * L], [6 * L, (4 + ph) * L * L, -6 * L, (2 - ph) * L * L], [-12, -6 * L, 12, -6 * L], [6 * L, (2 - ph) * L * L, -6 * L, (4 + ph) * L * L]].map(r => r.map(v => v * f));
    const d = [dof(e.a, 0), dof(e.a, e.bend), dof(e.b, 0), dof(e.b, e.bend)];
    for (let p = 0; p < 4; p++) for (let q = 0; q < 4; q++) if (d[q] <= d[p]) add(d[p], d[q], kb[p][q]);   // guarda só a metade de baixo (simétrica)
    const kt = G * J / L, t1 = dof(e.a, e.tors), t2 = dof(e.b, e.tors); add(t1, t1, kt); add(t2, t2, kt); if (t1 !== t2) add(t1, t2, -kt); else add(t1, t1, -2 * kt);
    kels.push({ e, d, kb });
  }
  for (let r = 0; r < nd; r++) K[r * W + B] += (r % 3 === 0 ? 1 : 0.1);   // molinha de segurança (trecho sem estaca não fica solto)
  // ---- cargas
  const F = new Float64Array(nd);
  for (const a of C.amostras) { const us = st[a.t]; if (!us) continue; let k = 0; while (k < us.length - 2 && a.u > us[k + 1]) k++;
    const L = us[k + 1] - us[k], f = L > 0 ? Math.min(1, Math.max(0, (a.u - us[k]) / L)) : 0; F[dof(node(a.t, k), 0)] += a.P * (1 - f); F[dof(node(a.t, k + 1), 0)] += a.P * f; }
  for (const n of Object.keys(estN)) F[dof(estN[+n], 0)] += 3.125;   // peso do bloco
  // ---- estaca: R(δ) = Rl·δ/(δ+al) + Rp·δ/(δ+ap) + encurtamento elástico
  const fs = o.fatSolo ?? 1, al = 0.001 * fs, apn = 0.010 * fs, Ap = Math.PI * D * D / 4, ce = o.L * 0.6 / (25e6 * Ap);
  const solo = (ds: number) => [o.Rl * ds / (ds + al) + o.Rp * ds / (ds + apn), o.Rl * al / (ds + al) ** 2 + o.Rp * apn / (ds + apn) ** 2];
  const estaca = (d: number) => { let ds = Math.max(1e-7, d * 0.5); for (let k = 0; k < 40; k++) { const [R, kr] = solo(ds); ds = Math.max(1e-9, ds - (ds + R * ce - d) / (1 + kr * ce)); } const [R, kr] = solo(ds); return [R, kr / (1 + kr * ce)]; };
  const pd = Object.entries(estN).map(([n, nn]) => [+n, dof(nn, 0)] as const);
  // ---- Newton com fatoração de Cholesky em faixa
  const u = new Float64Array(nd); let iter = 0, ok = false;
  const Kt = new Float64Array(K.length);
  const mult = (x: Float64Array) => { const y = new Float64Array(nd);
    for (let r = 0; r < nd; r++) for (let c = Math.max(0, r - B); c <= r; c++) { const v = K[r * W + (c - r + B)]; if (!v) continue; y[r] += v * x[c]; if (c !== r) y[c] += v * x[r]; } return y; };
  for (iter = 0; iter < 60; iter++) {
    Kt.set(K); const Rv = new Float64Array(nd);
    for (const [, d] of pd) { const [R, kt] = estaca(Math.max(u[d], 0)); Rv[d] += R; Kt[d * W + B] += kt; }
    const Ku = mult(u), res = new Float64Array(nd); let mx = 0;
    for (let r = 0; r < nd; r++) { res[r] = F[r] - Ku[r] - Rv[r]; mx = Math.max(mx, Math.abs(res[r])); }
    if (mx < 1e-3) { ok = true; break; }
    // Cholesky em faixa (Kt = L·Lᵀ)
    for (let i = 0; i < nd; i++) {
      for (let j = Math.max(0, i - B); j <= i; j++) {
        let s = Kt[i * W + (j - i + B)];
        for (let k = Math.max(0, i - B, j - B); k < j; k++) s -= Kt[i * W + (k - i + B)] * Kt[j * W + (k - j + B)];
        if (i === j) Kt[i * W + B] = Math.sqrt(Math.max(s, 1e-12)); else Kt[i * W + (j - i + B)] = s / Kt[j * W + B];
      }
    }
    const y = new Float64Array(nd);
    for (let i = 0; i < nd; i++) { let s = res[i]; for (let k = Math.max(0, i - B); k < i; k++) s -= Kt[i * W + (k - i + B)] * y[k]; y[i] = s / Kt[i * W + B]; }
    for (let i = nd - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(nd - 1, i + B); k++) s -= Kt[k * W + (i - k + B)] * y[k]; y[i] = s / Kt[i * W + B]; }
    for (let r = 0; r < nd; r++) u[r] += y[r];
  }
  const R: Record<number, number> = {}, rec: Record<number, number> = {};
  for (const [n, d] of pd) { R[n] = estaca(Math.max(u[d], 0))[0]; rec[n] = u[d] * 1000; }
  // ---- esforços: momento (+ = traciona embaixo) e tração no tirante = M / z
  const trechos = TS.map((_, t) => ({ t, Tparede: 0, Tporta: 0, Ttopo: 0 }));
  for (const { e, d, kb } of kels) {
    const ue = d.map(x => u[x]); const f = kb.map(r => r.reduce((s, v, k) => s + v * ue[k], 0));
    for (const M of [f[1], -f[3]]) { const T = Math.abs(M) / e.s.z, tr = trechos[e.i];
      if (M > 0) { if (e.s.tipo === 'porta') tr.Tporta = Math.max(tr.Tporta, T); else if (e.s.tipo === 'parede' || e.s.tipo === 'janela' || e.s.tipo === 'baldrame') tr.Tparede = Math.max(tr.Tparede, T); }
      else tr.Ttopo = Math.max(tr.Ttopo, T); }
  }
  return { R, rec, trechos, iter, ok };
}
