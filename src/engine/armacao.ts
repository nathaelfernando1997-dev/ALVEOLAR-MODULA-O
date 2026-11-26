// Armação das paredes e lajes alveolares: ferros de cada peça, alças, relação do aço e verificações.
// Padrão Alveolar:
//  paredes — N1 ø4,2 em cada nervura (2 faces) · N2 ø4,2 deitado c/25 (2 faces) · N3 pilar 4 ø6,3 nas pontas e dos lados das portas
//            · N4 estribo ø4,2 c/20 · N5 verga e N6 contraverga 4 ø6,3, transpasse L/5
//  lajes   — L1 positivo ø6,3 em cada nervura (gancho 90° nas pontas) · L2 ø8,0 em cima nas pontas (L/4) ou corrido sob parede de cima
//            · L7 ø5,0 corrido em cima · L3 ø4,2 atravessado c/30 (2 faces) · L4/L5 borda 2 ø6,3 embaixo + 2 ø8,0 em cima · treliças
// Verificações resumidas (NBR 6118 / 9062): sobrecarga 1,5 kN/m², revestimento 1,0 kN/m², fck 30 MPa, CA-50/60, γc 1,4, γs 1,15, γf 1,4.
import type { Painel, Regras } from './model.ts';
import type { PainelLaje } from './lajes.ts';

export interface Barra { f: string; x0: number; y0: number; x1: number; y1: number; c?: number }
export interface Vao { x0: number; x1: number; y0: number; y1: number; porta: boolean; tag: string }
export interface Trel { n: number; vert: boolean; pos: number; i0: number; i1: number; tipo: string; borda?: boolean }
// reforço da laje embaixo de parede do pavimento de cima (sem parede embaixo): faixa maciça (sem isopor) + ferro extra embaixo
export interface Reforco { modo: 'longo' | 'atravessa'; pos: number; i0: number; i1: number; faixa: number; n: number; bit: number; porNerv: boolean; q: number; Md: number; Vd: number; ok: boolean; macico: boolean; txt: string }
export interface PecaArm { L: number; Hx: (x: number) => number; ab: Vao[]; slots: [number, number][]; zon: [number, number][]; bars: Barra[]; sobParede: number[]; T: Trel[]; esp: number; ref?: Reforco[]; bitPos?: number }   // bitPos: positivo (L1 e L4) escolhido pela verificação
export interface VigaTrel { id: string; pav: string; o: 'H' | 'V'; c: number; a: number; b: number; n?: number }

export const COB = 0.025, PASSO_H = 0.25, PASSO_T = 0.30, ESTR = 0.20, PIL = 0.12, NEG_FRAC = 0.25, FAIXA_PAREDE = 0.20;
export const KG: Record<string, number> = { '4.2': 0.109, '5': 0.154, '6.3': 0.245, '8': 0.395, '10': 0.617, '12.5': 0.963 };
export const TG_KG: Record<string, number> = { TG8: 0.735, TG12: 0.886, TG16: 1.016, TG20: 1.163 };
export const tgDaEsp = (e: number) => e >= 0.25 - 1e-6 ? 'TG20' : e >= 0.20 - 1e-6 ? 'TG16' : e >= 0.16 - 1e-6 ? 'TG12' : 'TG8';
// posições: bitola (mm) e descrição
export const POS: Record<string, [number, string]> = {
  N1: [4.2, 'Vertical nas nervuras (2 faces)'], N2: [4.2, 'Horizontal c/25 (2 faces)'], N3: [6.3, 'Pilar 4 ø6,3'], N4: [4.2, 'Estribo do pilar c/20'],
  N5: [6.3, 'Verga 4 ø6,3 (transpasse L/5)'], N6: [6.3, 'Contraverga 4 ø6,3 (transpasse L/5)'],
};
export const POSL: Record<string, [number, string]> = {
  L1: [6.3, 'Positivo (inferior) nas nervuras, gancho 90° nas pontas'], L2: [8.0, 'Negativo ø8,0 nas pontas (L/4) ou corrido sob parede de cima'],
  L7: [5.0, 'Construtivo superior ø5,0 corrido'], L3: [4.2, 'Transversal c/30 (2 faces)'], L4: [6.3, 'Borda: 2 ø6,3 inferior, gancho 90° nas pontas'], L5: [8.0, 'Borda: 2 ø8,0 superior'],
  L8: [10, 'Reforço sob parede ø10 (embaixo), gancho 90° nas pontas'], L9: [12.5, 'Reforço sob parede ø12,5 (embaixo), gancho 90° nas pontas'],
};
export const comp = (b: Barra) => b.c ?? Math.hypot(b.x1 - b.x0, b.y1 - b.y0);

function armar(L: number, Hx: (x: number) => number, ab: Vao[], P: (string | null)[], r: Regras, portasPilar = true) {
  const IL = r.isoporLarg ?? 0.12, IE = r.isoporEspaco ?? 0.03;
  const n = Math.max(0, Math.floor(L / (IL + IE) + 1e-6)), m = (L - n * (IL + IE) + IE) / 2;
  const slots: [number, number][] = []; for (let i = 0; i < n; i++) slots.push([m + i * (IL + IE), m + i * (IL + IE) + IL]);
  const e0 = slots.length ? slots[0][1] : Math.min(PIL, L / 2), e1 = slots.length ? slots[slots.length - 1][0] : L - Math.min(PIL, L / 2);
  const zon: [number, number][] = [[0, e0], [e1, L]];
  for (const a of ab) {
    if (!(a.porta && portasPilar)) continue;
    for (const z of [[a.x0 - PIL, a.x0], [a.x1, a.x1 + PIL]] as [number, number][]) { if (z[0] < e0 + 0.02 || z[1] > e1 - 0.02) continue; zon.push(z); }
  }
  const bars: Barra[] = [];
  const corta = (fixo: number, a0: number, a1: number, vert: boolean): [number, number][] => {
    let segs: [number, number][] = [[a0, a1]];
    for (const a of ab) {
      const [lo, hi] = vert ? [a.x0, a.x1] : [a.y0, a.y1], [sl, sh] = vert ? [a.y0, a.y1] : [a.x0, a.x1];
      if (lo - 1e-6 < fixo && fixo < hi + 1e-6) {
        const ns: [number, number][] = [];
        for (const [s0, s1] of segs) {
          if (sh <= s0 || sl >= s1) { ns.push([s0, s1]); continue; }
          if (sl - COB - s0 > 0.10) ns.push([s0, sl - COB]);
          if (s1 - (sh + COB) > 0.10) ns.push([sh + COB, s1]);
        }
        segs = ns;
      }
    }
    return segs.filter(s => s[1] - s[0] >= 0.15);
  };
  for (let i = 0; i < slots.length - 1; i++) {
    const x = slots[i][1] + IE / 2;
    if (zon.some(([z0, z1]) => z0 - 0.005 < x && x < z1 + 0.005)) continue;
    for (const [s0, s1] of corta(x, COB, Hx(x) - COB, true)) bars.push({ f: P[0]!, x0: x, y0: s0, x1: x, y1: s1 }, { f: P[1]!, x0: x, y0: s0, x1: x, y1: s1 });
  }
  let y = 0.20; const Hmin = Math.min(Hx(0), Hx(L));
  while (y < Hmin - 0.10) {
    for (const [s0, s1] of corta(y, COB, L - COB, false)) { const b = { f: P[2]!, x0: s0, y0: y, x1: s1, y1: y }; bars.push(b, { ...b }); }
    y += P[2] === 'L3' ? PASSO_T : PASSO_H;
  }
  for (const [z0, z1] of zon) {
    const xc = (z0 + z1) / 2, Hp = Math.min(Hx(z0), Hx(z1));
    for (const dx of [-0.03, 0.03]) bars.push({ f: P[3]!, x0: xc + dx, y0: COB, x1: xc + dx, y1: Hp - COB }, { f: P[4]!, x0: xc + dx, y0: COB, x1: xc + dx, y1: Hp - COB });
    const k = Math.floor((Hp - 2 * COB) / ESTR + 1e-6) + 1;
    for (let j = 0; j < k; j++) { const yy = COB + j * (Hp - 2 * COB) / (k > 1 ? k - 1 : 1); bars.push({ f: P[5]!, x0: z0 + 0.025, y0: yy, x1: z1 - 0.025, y1: yy, c: 0.42 }); }
  }
  if (P[6]) {
    for (const a of ab) {
      const tr = (a.x1 - a.x0) / 5, x0 = Math.max(COB, a.x0 - tr), x1 = Math.min(L - COB, a.x1 + tr);
      for (const yv of [a.y1 + 0.04, a.y1 + 0.09])
        if (yv < Math.min(Hx(a.x0), Hx(a.x1)) - COB) for (const [s0, s1] of corta(yv, x0, x1, false)) { const b = { f: P[6]!, x0: s0, y0: yv, x1: s1, y1: yv }; bars.push(b, { ...b }); }
      if (!a.porta && a.y0 > 0.15)
        for (const yc of [a.y0 - 0.04, a.y0 - 0.09]) if (yc > COB) for (const [s0, s1] of corta(yc, x0, x1, false)) { const b = { f: P[7]!, x0: s0, y0: yc, x1: s1, y1: yc }; bars.push(b, { ...b }); }
    }
  }
  return { L, Hx, ab, slots, zon, bars };
}

export function armarParede(p: Painel, r: Regras): PecaArm {
  const L = p.larg, ch = p.chanfro;
  const Hx = ch ? (x: number) => ch.ha + (ch.hb - ch.ha) * x / L : () => p.H;
  const ab: Vao[] = p.recortes.map(q => ({ x0: q.dl, x1: q.dl + q.w, y0: q.base, y1: q.base + q.h, porta: q.tipo.toUpperCase().startsWith('P'), tag: q.tipo }));
  const esp = (r.isoporAlt ?? 0.09) + 2 * (r.capeamento ?? 0.025);
  return { ...armar(L, Hx, ab, ['N1', 'N1', 'N2', 'N3', 'N3', 'N4', 'N5', 'N6'], r), sobParede: [], T: [], esp };
}

// treliças de um painel: embaixo das paredes do pavimento de cima e as pedidas no painel (-trp-)
export function trelicasDoPainel(p: PainelLaje, vigas: VigaTrel[], tipo: string): Trel[] {
  const out: Trel[] = [];
  for (const t of vigas) {
    if (t.pav !== p.pav) continue;
    const [cMin, cMax, lMin, lMax] = t.o === 'H' ? [p.y0, p.y1, p.x0, p.x1] : [p.x0, p.x1, p.y0, p.y1];
    if (t.c <= cMin + 0.01 || t.c >= cMax - 0.01) continue;
    const i0 = Math.max(t.a, lMin) - lMin, i1 = Math.min(t.b, lMax) - lMin;
    if (i1 - i0 < 0.1) continue;
    out.push({ n: t.n ?? 0, vert: t.o === p.sentido, pos: t.c - cMin, i0, i1, tipo, borda: String(t.id).includes('-trp-') });
  }
  const coberta = (q: Trel) => out.some(o => o !== q && o.vert === q.vert && Math.abs(o.pos - q.pos) <= 0.06 && o.i0 <= q.i0 + 0.02 && o.i1 >= q.i1 - 0.02
    && ((o.i1 - o.i0) > (q.i1 - q.i0) + 1e-6 || (Math.abs((o.i1 - o.i0) - (q.i1 - q.i0)) <= 1e-6 && o.n < q.n)));
  return out.filter(q => !coberta(q));
}

export function armarLaje(p: PainelLaje, Tin: Trel[], r: Regras, esp: number, trelBorda: boolean, carga = 0): PecaArm {
  const W = p.larg, Lc = p.comp, ab: Vao[] = [], d = p.dente;
  if (d) {
    const [u0, u1, v0, v1] = p.sentido === 'H' ? [d.x0 - p.x0, d.x1 - p.x0, d.y0 - p.y0, d.y1 - p.y0] : [d.y0 - p.y0, d.y1 - p.y0, d.x0 - p.x0, d.x1 - p.x0];
    ab.push({ x0: v0, x1: v1, y0: u0, y1: u1, porta: false, tag: 'recorte' });
  }
  const a = armar(W, () => Lc, ab, ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', null, null], r, false);
  const T = [...Tin];
  if (trelBorda) for (let zi = 0; zi < Math.min(2, a.zon.length); zi++) {   // treliça nas duas laterais do painel
    const xc = (a.zon[zi][0] + a.zon[zi][1]) / 2;
    if (!T.some(t => t.vert && Math.abs(t.pos - xc) < 0.10)) T.push({ n: 900 + zi, vert: true, pos: xc, i0: 0, i1: Lc, tipo: tgDaEsp(esp), borda: true });
  }
  const Tp = T.filter(t => !t.borda);   // treliça de borda não é parede de cima
  const atravessa = Tp.some(t => !t.vert);
  const novo: Barra[] = [], sob: number[] = [];
  for (const b of a.bars) {
    if (b.f !== 'L2') { novo.push(b); continue; }
    const x = b.x0;
    if (atravessa || Tp.some(t => t.vert && Math.abs(t.pos - x) <= FAIXA_PAREDE)) { novo.push(b); sob.push(x); continue; }
    const c = NEG_FRAC * Lc;
    if (b.y1 - b.y0 <= 2 * c + 0.15) { novo.push(b); continue; }
    novo.push({ f: 'L2', x0: x, y0: b.y0, x1: x, y1: b.y0 + c }, { f: 'L2', x0: x, y0: b.y1 - c, x1: x, y1: b.y1 }, { f: 'L7', x0: x, y0: b.y0, x1: x, y1: b.y1 });
  }
  const g = esp - 0.05;   // perna do gancho do positivo: sobe até a capa de cima
  const ref = carga > 0 ? reforcos(Tp, Lc, W, esp, carga, a.bars.filter(b => b.f === 'L1').map(b => b.x0)) : [];
  for (const rf of ref) {   // ferro de reforço embaixo, de apoio a apoio, com gancho como o positivo
    const f = rf.bit === 10 ? 'L8' : 'L9';
    const xs = rf.porNerv ? [...new Set(a.bars.filter(b => b.f === 'L1').map(b => b.x0))]
      : rf.modo === 'atravessa' ? Array.from({ length: rf.n }, (_, i) => COB + (W - 2 * COB) * (rf.n > 1 ? i / (rf.n - 1) : 0.5))
      : Array.from({ length: rf.n }, (_, i) => rf.pos - rf.faixa / 2 + COB + (rf.faixa - 2 * COB) * (rf.n > 1 ? i / (rf.n - 1) : 0.5));
    for (const x of xs) novo.push({ f, x0: x + 0.012, y0: COB, x1: x + 0.012, y1: Lc - COB });
  }
  const bars = novo.filter(b => b.f !== 'L6').map(b => ['L1', 'L4', 'L8', 'L9'].includes(b.f) ? { ...b, c: Math.hypot(b.x1 - b.x0, b.y1 - b.y0) + 2 * g } : b);
  return { ...a, bars, sobParede: sob, T, esp, ref };
}

// ---------- reforço embaixo das paredes de cima ----------
// laje biapoiada no comprimento Lc; parede de cima com carga q (kN/m, característica) sem parede embaixo.
// 'longo': parede ao longo do vão (faixa vira viguinha maciça na espessura da laje); 'atravessa': parede atravessando os painéis
// (carga em linha a 'pos' do apoio, distribuída pela largura do painel). A favor da segurança: sem contar a parede de cima trabalhando junto.
const AREA: Record<string, number> = { '10': 0.785, '12.5': 1.227 };
export function reforcos(T: Trel[], Lc: number, W: number, esp: number, q: number, nerv: number[]): Reforco[] {
  const out: Reforco[] = [], d = esp * 100 - 3.5, fcdc = FCK / GC / 10;
  const vrd = (bcm: number, As: number) => 0.25 * fctd * Math.abs(1.6 - d / 100) * (1.2 + 40 * Math.min(0.02, As / (bcm * d))) * bcm * d;   // kN (sem estribo)
  for (const t of T) {
    if (t.vert) {   // ao longo do vão: carga q no trecho i0..i1 de um vão biapoiado
      const a0 = Math.max(0, t.i0), a1 = Math.min(Lc, t.i1), N = 200; let RA = 0, W1 = 0, M = 0, Mm = 0;
      for (let k = 0; k < N; k++) { const x = (k + 0.5) * Lc / N; if (x >= a0 && x <= a1) { W1 += q * Lc / N; RA += q * Lc / N * (Lc - x) / Lc; } }
      let V = RA; const RB = W1 - RA;
      for (let k = 0; k < N; k++) { const x = (k + 0.5) * Lc / N; V -= x >= a0 && x <= a1 ? q * Lc / N : 0; M += V * Lc / N; Mm = Math.max(Mm, M); }
      const Md = GF * Mm, Vd = GF * Math.max(RA, RB);
      let faixa = 0.40; while (faixa < 0.80 && Md * 100 > 0.25 * faixa * 100 * d * d * fcdc) faixa += 0.20;
      const kmdOk = Md * 100 <= 0.25 * faixa * 100 * d * d * fcdc;
      const asExist = nerv.filter(x => Math.abs(x - t.pos) <= faixa / 2).length * 0.312;
      const As = Md * 100 / (fyd50 * 0.85 * d), falta = Math.max(0, As - asExist);
      let bit = 10, n = Math.max(2, Math.ceil(falta / AREA['10'] - 1e-9));
      if (n > 4) { bit = 12.5; n = Math.max(2, Math.ceil(falta / AREA['12.5'] - 1e-9)); }
      const nMax = Math.floor((faixa - 2 * COB) / 0.045) + 1;   // espaço livre mínimo entre barras ~3,2 cm
      // cortante: concreto da faixa maciça + diagonais das 3 treliças da faixa (ø4,2 a cada 20 cm, 2 por treliça)
      const vsw = 3 * (2 * 0.139 / 20) * 0.9 * d * fyd50 * Math.SQRT2;
      const okV = Vd <= vrd(faixa * 100, asExist + n * AREA[String(bit)]) + vsw, ok = kmdOk && okV && n <= nMax;
      out.push({ modo: 'longo', pos: t.pos, i0: a0, i1: a1, faixa, n, bit, porNerv: false, q, Md, Vd, ok, macico: false,
        txt: ok ? `faixa maciça de ${Math.round(faixa * 100)} cm (sem isopor) + ${n} ø${String(bit).replace('.', ',')} embaixo` : 'NÃO RESOLVE NA LAJE: prever viga ou parede embaixo' });
    } else {        // atravessa: carga em linha a t.pos do apoio, por metro de largura
      const x = Math.min(Math.max(t.pos, 0.05), Lc - 0.05), larg = Math.min(W, t.i1 - t.i0), fr = larg / W;   // parte da largura com parede
      const Md = GF * q * fr * x * (Lc - x) / Lc, Vd = GF * q * fr * Math.max(x, Lc - x) / Lc;   // por metro de largura
      const nm = Math.max(1, nerv.length / W), asExist = nm * 0.312, As = Md * 100 / (fyd50 * 0.85 * d), falta = Math.max(0, As - asExist);
      const kmdOk = Md * 100 <= 0.25 * 100 * d * d * fcdc;
      let bit = 10, porNerv = true, n = Math.round(nm * W), esp_ = 0;
      if (falta > nm * AREA['10']) bit = 12.5;
      if (falta > nm * AREA['12.5']) { porNerv = false; bit = 12.5; esp_ = Math.floor(100 * AREA['12.5'] / As); n = Math.ceil(W * 100 / Math.max(esp_, 1)) + 1; }   // painel maciço: ø12,5 em todo o painel
      const okNerv = porNerv && Vd / nm <= vrd(3, 0.312 + AREA[String(bit)]), okMac = Vd <= vrd(100, porNerv ? asExist + nm * AREA[String(bit)] : As);
      const macico = !okNerv, ok = kmdOk && (porNerv ? (okNerv || okMac) : okMac && esp_ >= 8);
      out.push({ modo: 'atravessa', pos: x, i0: t.i0, i1: t.i1, faixa: 0.40, n, bit, porNerv, q, Md, Vd, ok, macico,
        txt: !ok ? 'NÃO RESOLVE NA LAJE: prever viga ou parede embaixo'
          : !porNerv ? `painel MACIÇO (sem isopor) + ø12,5 a cada ${esp_} cm embaixo, em toda a largura`
          : `${falta > 0 ? `+ 1 ø${String(bit).replace('.', ',')} embaixo em cada nervura` : 'ferro de baixo já basta'}; ${macico ? 'painel MACIÇO (sem isopor): o cortante não passa só nas nervuras' : 'faixa maciça de 40 cm (sem isopor) embaixo da parede'}` });
    }
  }
  return out;
}

// ---------- verificações ----------
const FCK = 30, GC = 1.4, GS = 1.15;
export const GF = 1.4, Q_USO = 1.5, G_REV = 1.0;
const PSI2 = 0.3, ALFA_F = 1.32, FCJ = 15;
const fcd = FCK / GC / 10, fyd50 = 50 / GS, fyd60 = 60 / GS, fctm = 0.3 * FCK ** (2 / 3) / 10, fctd = 0.7 * fctm / GC;
const Eci = 5600 * Math.sqrt(FCK) / 10, Ecs = (0.8 + 0.2 * FCK / 80) * Eci, fbd = 2.25 * fctd;
const AS: Record<string, number> = { '4.2': 0.139, '5': 0.196, '6.3': 0.312, '8': 0.503, '10': 0.785, '12.5': 1.227 };
function secao(esp = 14, b = 15, cap = 2.5, bw = 3) {
  const hw = esp - 2 * cap, y = esp / 2;
  return { A: 2 * b * cap + bw * hw, y, I: 2 * (b * cap ** 3 / 12 + b * cap * (y - cap / 2) ** 2) + bw * hw ** 3 / 12 };
}
export const pp = (esp = 0.14, il = 0.12, ia = 0.09, ie = 0.03) => (esp - il / (il + ie) * ia) * 25;   // kN/m² descontando o isopor
export const lb = (phi: number, aco = 50) => phi / 4 * ((aco === 50 ? fyd50 : fyd60) * 10) / (fbd * 10);   // mm
export function verLaje(L: number, W: number, nNerv: number, esp: number, bitPos = 6.3, apoio = 0.06) {
  const gancho = esp - 0.05, g = pp(esp) + G_REV, q = Q_USO, pd = GF * (g + q);
  const Md = pd * W * L ** 2 / 8 * 100, Vd = pd * W * L / 2, d = esp * 100 - 2.5 - bitPos / 20, b = W * 100;
  const aa = 0.85 * fcd * b * 0.8, disc = d * d - 4 * 0.4 * Md / aa, x = disc > 0 ? (d - Math.sqrt(disc)) / 0.8 : 99, z = d - 0.4 * x;
  const As_nec = Md / (fyd50 * z), As_ef = (nNerv + 4) * AS[String(bitPos)];
  const s1 = secao(esp * 100, 15, (esp * 100 - 9) / 2), nfx = Math.max(1, Math.round(W / 0.15)), As_min = 0.0015 * s1.A * nfx;
  const pq = (g + PSI2 * q) * 0.15 / 100, Ma = pq * (L * 100) ** 2 / 8, Mr = 1.3 * fctm * s1.I / s1.y;
  let Ieq = s1.I;
  if (Ma > Mr) {
    const ae = 210000 / (Ecs * 10), As1 = As_ef / nfx, xii = (-ae * As1 + Math.sqrt((ae * As1) ** 2 + 2 * 15 * ae * As1 * d)) / 15;
    const I2 = 15 * xii ** 3 / 3 + ae * As1 * (d - xii) ** 2; Ieq = Math.min(s1.I, (Mr / Ma) ** 3 * s1.I + (1 - (Mr / Ma) ** 3) * I2);
  }
  const f = 5 * pq * (L * 100) ** 4 / (384 * Ecs * Ieq) * (1 + ALFA_F), flim = L * 100 / 250;
  const Vd1 = Vd / nfx, k = Math.abs(1.6 - d / 100), rho = Math.min(0.02, AS[String(bitPos)] / (3 * d)), VRd = 0.25 * fctd * k * (1.2 + 40 * rho) * 3 * d;
  const lbn = Math.max(0.3 * lb(bitPos), 10 * bitPos, 100), disp = (apoio - 0.025) * 1000 + gancho * 1000;
  return { Md: Md / 100, As_nec, As_ef, As_min, ok_As: As_ef >= Math.max(As_nec, As_min), f, flim, ok_f: f <= flim, Vd: Vd1, VRd, ok_V: Vd1 <= VRd, lb_min: lbn, ancor_disp: disp, ok_anc: disp >= lbn };
}
export function verParede(H: number, esp: number, carga: number) {
  const lam = H * Math.sqrt(12) / esp, Ac = (esp - 0.12 / 0.15 * 0.09) * 100 * 100, Nd = GF * (carga + pp(esp) * H), NRd = 0.85 * fcd * Ac * 0.6;
  return { lam, ok_lam: lam <= 86, Nd, NRd, ok_N: Nd <= NRd };
}
export function manuseio(vao: number, esp: number) {
  const w = pp(esp) * 1.3 * 0.15 / 100, M = w * (vao * 100) ** 2 / 8, s1 = secao(esp * 100, 15, (esp * 100 - 9) / 2);
  const s = M * s1.y / s1.I * 10, lim = 0.7 * 0.3 * FCJ ** (2 / 3);
  return { sigma: s, lim, ok: s <= lim };
}

// ---------- alças, peso, relação do aço ----------
export const ALCA_CAP = 2 * 0.503 * 25.0 / 4 * 101.97;   // kg por alça (≈ 641 kg)
export const COEF_ICA = 1.3 * 1.155;                      // coef. dinâmico x cabos a 60°
export function pesoPeca(larg: number, compr: number, area: number, furos: { w: number; h: number }[], esp: number, r: Regras) {
  const il = r.isoporLarg ?? 0.12, ia = r.isoporAlt ?? 0.09, ie = r.isoporEspaco ?? 0.03, n = (w: number) => Math.max(0, Math.floor(w / (il + ie) + 1e-6));
  let iso = n(larg) * compr, ab = 0;
  for (const f of furos) { ab += f.w * f.h; iso -= n(f.w) * f.h; }
  const vol = Math.max(0, (area - ab) * esp - iso * il * ia);
  return { kg: vol * (r.densidade ?? 2500), vol, area: area - ab };
}
export function alcas(a: PecaArm, kg: number, laje: boolean): { pts: [number, number, number][]; ntrab: number } {
  const nerv = [...new Set(a.bars.filter(b => b.f === 'N1' || b.f === 'L1').map(b => Math.round(b.x0 * 1000) / 1000))].sort((p, q) => p - q);
  const L = a.L, Hx = a.Hx;
  if (!nerv.length) nerv.push(L / 2);
  if (laje) {
    const Lc = Hx(0), xs = [nerv[Math.min(1, nerv.length - 1)], nerv[Math.max(0, nerv.length - 2)]];
    // peça pesada (parte maciça): 6 ou 8 alças em vez de 4
    const lin = kg * COEF_ICA / 4 <= ALCA_CAP ? 2 : kg * COEF_ICA / 6 <= ALCA_CAP ? 3 : 4;
    const ys = Array.from({ length: lin }, (_, i) => Lc / 5 + (Lc * 3 / 5) * (lin > 1 ? i / (lin - 1) : 0));
    return { pts: ys.flatMap(y => xs.map(x => [x, y, 0] as [number, number, number])), ntrab: lin * 2 };
  }
  let por = L >= 1.80 - 1e-6 ? 4 : L >= 1.20 - 1e-6 ? 3 : 2;
  if (kg * COEF_ICA / por > ALCA_CAP) por = 5;
  if (kg * COEF_ICA / por > ALCA_CAP) por = 6;
  const alvo = Array.from({ length: por }, (_, i) => L * (2 * i + 1) / (2 * por));
  const livre = (x: number, base: boolean) => !a.ab.some(v => v.x0 - 0.03 < x && x < v.x1 + 0.03 && (base ? v.y0 < 0.2 : v.y1 > Hx(x) - 0.2));
  const zc = a.zon.map(([z0, z1]) => Math.round((z0 + z1) / 2 * 1000) / 1000), pts: [number, number, number][] = [];
  for (const base of [false, true]) {
    const tudo = [...new Set([...nerv, ...zc])].sort((p, q) => p - q), lv = tudo.filter(x => livre(x, base)), cand = lv.length ? lv : tudo, usados: number[] = [];
    for (const x of alvo) {
      const v = cand.filter(c => !usados.includes(c)).sort((p, q) => Math.abs(p - x) - Math.abs(q - x))[0] ?? x;
      usados.push(v); pts.push([v, base ? 0.03 : Hx(v) - 0.03, base ? -1 : 1]);
    }
  }
  return { pts, ntrab: por };
}
export const fam = (k: string) => k.startsWith('T') ? 'T' : k.startsWith('A') ? 'A' : k.slice(0, 2);
export type Relacao = [string, [number, number][]][];   // posição → [(comprimento cm, quantidade)]
export function relacao(a: PecaArm, nal: number, laje: boolean): Relacao {
  const PD = laje ? POSL : POS, g: Relacao = [];
  for (const k of Object.keys(PD)) {
    const c = new Map<number, number>();
    for (const b of a.bars) if (b.f === k) { const cc = Math.round(comp(b) * 100); c.set(cc, (c.get(cc) ?? 0) + 1); }
    if (c.size) g.push([k, [...c].sort((p, q) => q[0] - p[0])]);
  }
  if (a.T.length) {
    const c = new Map<number, number>();
    for (const t of a.T) { const cc = Math.round((t.i1 - t.i0 - 2 * COB) * 100); c.set(cc, (c.get(cc) ?? 0) + 1); }
    g.push(['T', [...c].sort((p, q) => q[0] - p[0])]);
  }
  g.push(['A', [[Math.round((laje ? 1.20 : 0.90) * 100), nal]]]);
  const out: Relacao = [];
  for (const [k, L] of g) { if (L.length === 1) out.push([k, L]); else L.forEach((cq, i) => out.push([k + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i], [cq]])); }
  return out;
}
export const ALCA_KEY = 'ø8,0 CA-25';
// pos: bitola do positivo da laje (L1 e L4) escolhida na verificação; sem ela vale a do padrão (ø6,3)
export const bitDe = (k: string, laje: boolean, tg: string, pos?: number): number | string => fam(k) === 'T' ? tg : fam(k) === 'A' ? ALCA_KEY : laje && pos && (fam(k) === 'L1' || fam(k) === 'L4') ? pos : (laje ? POSL : POS)[fam(k)][0];
export const kgmDe = (k: string, laje: boolean, tg: string, pos?: number) => fam(k) === 'T' ? TG_KG[tg] ?? 0.886 : fam(k) === 'A' ? 0.395 : KG[String(bitDe(k, laje, tg, pos))];
export const kgRel = (rel: Relacao, laje: boolean, tg: string, pos?: number) => rel.reduce((s, [k, L]) => s + L.reduce((t, [c, q]) => t + c / 100 * q * kgmDe(k, laje, tg, pos), 0), 0);
// positivo da laje: o menor entre ø6,3, ø8,0 e ø10,0 que passa na verificação (flexão, flecha, cortante e ancoragem)
export const BITS_POS = [6.3, 8, 10];
export function escolherPositivo(a: PecaArm, esp: number, apoio = 0.06): { bit: number; ok: boolean } {
  const nn = new Set(a.bars.filter(b => b.f === 'L1').map(b => Math.round(b.x0 * 1000))).size, Lc = a.Hx(0);
  for (const bit of BITS_POS) { const c = verLaje(Lc, a.L, nn, esp, bit, apoio); if (c.ok_As && c.ok_f && c.ok_V && c.ok_anc) return { bit, ok: true }; }
  return { bit: BITS_POS[BITS_POS.length - 1], ok: false };
}
