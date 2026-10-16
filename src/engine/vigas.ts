// Sugestão de vigas e rebaixo das paredes por causa delas.
// 1) vão sem parede (porta grande, vão livre) sob a laje: viga sobre o vão;
// 2) laje com vão maior que o painel: viga intermediária no meio do ambiente;
// 3) parede do pavimento de cima sem parede embaixo (ou laje em balanço): viga sob ela.
import type { Painel, Pavimento, Regras, Trecho, VaoInteiro } from './model.ts';
import type { LajeAmb } from './lajes.ts';

export interface Viga {
  id: string; pav: string; o: 'H' | 'V'; c: number; a: number; b: number;
  tipo: 'vao' | 'laje' | 'parede-cima';
  obrigatoria: boolean; motivo: string; ideia: string;
  rebaixos: { painel: number; de: number; para: number }[];
}

const br = (v: number) => v.toFixed(2).replace('.', ',');

// deslocamento entre a planta de baixo e a de cima (as plantas costumam estar lado a lado no DXF)
export function alinhar(baixo: Trecho[], cima: Trecho[]): { dx: number; dy: number } {
  const melhor = (o: 'H' | 'V') => {
    const A = baixo.filter(t => t.o === o).map(t => t.c), B = cima.filter(t => t.o === o).map(t => t.c);
    const votos = new Map<number, number>();
    for (const a of A) for (const b of B) { const d = Math.round((a - b) * 50) / 50; votos.set(d, (votos.get(d) || 0) + 1); }
    let best = 0, n = -1; for (const [d, v] of votos) if (v > n) { n = v; best = d; }
    // refina: média dos pares que batem com o melhor
    const ds: number[] = []; for (const a of A) for (const b of B) if (Math.abs(a - b - best) < 0.05) ds.push(a - b);
    return ds.length ? ds.reduce((s, v) => s + v, 0) / ds.length : best;
  };
  return { dx: melhor('V'), dy: melhor('H') };
}

export function sugerirVigas(pavs: Pavimento[], ts: Trecho[], ps: Painel[], vaos: VaoInteiro[], lajes: LajeAmb[], r: Regras): Viga[] {
  const V: Viga[] = [];
  const painelEm = (pav: string, o: 'H' | 'V', c: number, a: number, b: number, tol = 0.12) =>
    ps.filter(p => p.pav === pav && p.o === o && Math.abs(p.c - c) < tol && p.a < b && p.b > a);
  const cruzando = (pav: string, o: 'H' | 'V', c: number, a: number, b: number) =>
    // painéis perpendiculares à viga que passam embaixo dela
    ps.filter(p => p.pav === pav && p.o !== o && p.c > a + 0.05 && p.c < b - 0.05 && p.a < c + r.vigaLargura / 2 && p.b > c - r.vigaLargura / 2);
  const reb = (lista: Painel[]) => lista.map(p => ({ painel: p.num, de: p.H, para: Math.max(0, p.H - r.vigaAltura) }));

  pavs.forEach((pav, ip) => {
    // 1) vãos sem parede
    for (const v of vaos.filter(x => x.pav === pav.id)) {
      const w = v.b - v.a, a = v.a - r.vigaApoio, b = v.b + r.vigaApoio;
      const obrig = w > r.vaoViga;
      V.push({
        id: `${pav.id}-vao-${v.a.toFixed(2)}`, pav: pav.id, o: v.o, c: v.c, a, b, tipo: 'vao', obrigatoria: obrig,
        motivo: `${v.tipo === 'vão livre' ? 'Vão livre' : v.tipo} de ${br(w)} m sem parede${obrig ? ` (maior que ${br(r.vaoViga)} m)` : ''}: a laje de cima não tem apoio nesse trecho.`,
        ideia: `Viga sobre o vão, de ${br(b - a)} m, entrando ${br(r.vigaApoio)} m em cima das paredes dos lados.`,
        rebaixos: reb(painelEm(pav.id, v.o, v.c, a, b).filter(p => p.a < v.a || p.b > v.b)),
      });
    }
    // 2) lajes com vão maior que o painel
    for (const L of lajes.filter(x => x.pav === pav.id && x.incluida && x.vigas.length)) {
      for (const pos of L.vigas) {
        const o: 'H' | 'V' = L.sentido === 'H' ? 'V' : 'H';
        const [a, b] = o === 'V' ? [L.y0, L.y1] : [L.x0, L.x1];
        // existe parede paralela perto? então dá para apoiar nela
        const perto = ts.filter(t => t.pav === pav.id && t.o === o && Math.abs(t.c - pos) < 0.8 && t.s < b && t.e > a).sort((x, y) => Math.abs(x.c - pos) - Math.abs(y.c - pos))[0];
        const sobre = perto && Math.abs(perto.c - pos) < 0.12;
        V.push({
          id: `${pav.id}-laje-${pos.toFixed(2)}`, pav: pav.id, o, c: pos, a, b, tipo: 'laje', obrigatoria: L.vao > r.vaoViga,
          motivo: `Ambiente com vão de ${br(L.vao)} m, maior que o painel de laje (${br(r.lajeComp)} m com apoios).`,
          ideia: sobre ? 'Viga em cima da parede que já existe nesse alinhamento.'
            : perto ? `Viga no meio do vão, ou a ${br(Math.abs(perto.c - pos))} m daqui, em cima da parede que já existe (aproveita a parede como apoio).`
              : `Viga no meio do vão, apoiada nas paredes das pontas (${br(b - a)} m).`,
          rebaixos: reb([...painelEm(pav.id, o, pos, a, b), ...cruzando(pav.id, o, pos, a, b)]),
        });
      }
    }
    // 3) paredes do pavimento de cima sem apoio embaixo
    const cima = pavs[ip + 1];
    if (!cima) return;
    const tb = ts.filter(t => t.pav === pav.id), tc = ts.filter(t => t.pav === cima.id);
    if (!tb.length || !tc.length) return;
    const { dx, dy } = alinhar(tb, tc);
    for (const t of tc) {
      const c = t.c + (t.o === 'V' ? dx : dy), s = t.s + (t.o === 'H' ? dx : dy), e = t.e + (t.o === 'H' ? dx : dy);
      const apoios = tb.filter(x => x.o === t.o && Math.abs(x.c - c) < 0.15 && x.s < e && x.e > s).map(x => [Math.max(s, x.s), Math.min(e, x.e)] as [number, number]).sort((p, q) => p[0] - q[0]);
      // trechos sem parede embaixo (descontando vãos inteiros da parede de baixo, que já têm viga própria)
      let pos = s; const livres: [number, number][] = [];
      for (const [a, b] of apoios) { if (a - pos > 0.3) livres.push([pos, a]); pos = Math.max(pos, b); }
      if (e - pos > 0.3) livres.push([pos, e]);
      const nums = ps.filter(p => p.trecho === t.id).map(p => p.num);
      for (const [a, b] of livres) {
        if (vaos.some(v => v.pav === pav.id && v.o === t.o && Math.abs(v.c - c) < 0.15 && v.a <= a + 0.3 && v.b >= b - 0.3)) continue;
        const fora = !tb.some(x => x.o !== t.o && x.c > Math.min(a, b) - 0.2 && x.c < Math.max(a, b) + 0.2);
        V.push({
          id: `${pav.id}-cima-${t.id}-${a.toFixed(2)}`, pav: pav.id, o: t.o, c, a: a - r.vigaApoio, b: b + r.vigaApoio, tipo: 'parede-cima', obrigatoria: true,
          motivo: `Parede${nums.length ? ` ${nums.join(', ')}` : ''} do ${cima.nome} tem ${br(b - a)} m sem parede embaixo${fora ? ' (laje em balanço)' : ''}.`,
          ideia: `Viga sob a parede de cima, no ${pav.nome}, de ${br(b - a + 2 * r.vigaApoio)} m${fora ? ', ancorada na laje/parede de dentro' : ', apoiada nas paredes que ela cruza'}.`,
          rebaixos: reb(cruzando(pav.id, t.o, c, a, b)),
        });
      }
    }
  });
  return V;
}
