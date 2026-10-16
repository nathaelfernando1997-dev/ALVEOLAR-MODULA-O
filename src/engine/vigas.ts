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
    ps.filter(p => p.pav === pav && p.o !== o && p.c > a + 0.05 && p.c < b - 0.05 && p.a < c + r.vigaLargura / 2 && p.b > c - r.vigaLargura / 2);
  const reb = (lista: Painel[]) => lista.map(p => ({ painel: p.num, de: p.H, para: Math.max(0, p.H - r.vigaAltura) }));
  // a parede (alinhamento o/c, trecho a..b) é apoio de alguma laje deste pavimento?
  const apoioDeLaje = (pav: string, o: 'H' | 'V', c: number, a: number, b: number) => lajes.some(L => {
    if (L.pav !== pav || !L.incluida || !L.sentido) return false;
    const oApoio: 'H' | 'V' = L.sentido === 'H' ? 'V' : 'H';
    if (o !== oApoio) return false;
    const linhas = L.sentido === 'H' ? [L.x0, L.x1, ...L.apoiosParede] : [L.y0, L.y1, ...L.apoiosParede];
    const [r0, r1] = L.sentido === 'H' ? [L.y0, L.y1] : [L.x0, L.x1];
    return linhas.some(x => Math.abs(x - c) < 0.15) && Math.min(b, r1) - Math.max(a, r0) > 0.1;
  });
  const lajeEm = (pav: string, x: number, y: number) => lajes.find(L => L.pav === pav && L.incluida && x > L.x0 && x < L.x1 && y > L.y0 && y < L.y1);

  pavs.forEach((pav, ip) => {
    const cima = pavs[ip + 1];
    const tb = ts.filter(t => t.pav === pav.id), tc = cima ? ts.filter(t => t.pav === cima.id) : [];
    const al = tc.length && tb.length ? alinhar(tb, tc) : { dx: 0, dy: 0 };
    const cimaNaLinha = (o: 'H' | 'V', c: number, a: number, b: number) => tc.filter(t => t.o === o && Math.abs(t.c + (o === 'V' ? al.dx : al.dy) - c) < 0.15 &&
      t.s + (o === 'H' ? al.dx : al.dy) < b && t.e + (o === 'H' ? al.dx : al.dy) > a);

    // 1) vão sem parede: só precisa de viga se a laje apoia nessa parede ou se tem parede em cima
    for (const v of vaos.filter(x => x.pav === pav.id)) {
      const w = v.b - v.a, a = v.a - r.vigaApoio, b = v.b + r.vigaApoio;
      const apoia = apoioDeLaje(pav.id, v.o, v.c, v.a, v.b);
      const sobre = cimaNaLinha(v.o, v.c, v.a, v.b);
      if (!apoia && !sobre.length) continue;
      const nums = ps.filter(p => sobre.some(t => t.id === p.trecho)).map(p => p.num);
      const obrig = w > r.vaoViga || sobre.length > 0;
      V.push({
        id: `${pav.id}-vao-${v.a.toFixed(2)}`, pav: pav.id, o: v.o, c: v.c, a, b, tipo: 'vao', obrigatoria: obrig,
        motivo: `${v.tipo === 'vão livre' ? 'Vão livre' : v.tipo} de ${br(w)} m sem parede${sobre.length ? `, com parede${nums.length ? ` ${nums.join(', ')}` : ''} do ${cima!.nome} em cima` : ''}${apoia ? ', e a laje apoia nesse alinhamento' : ''}${w > r.vaoViga ? ` (vão maior que ${br(r.vaoViga)} m)` : ''}.`,
        ideia: `Viga sobre o vão, de ${br(b - a)} m, entrando ${br(r.vigaApoio)} m em cima das paredes dos lados.`,
        rebaixos: reb(painelEm(pav.id, v.o, v.c, a, b).filter(p => p.a < v.a || p.b > v.b)),
      });
    }
    // 2) laje com vão maior que o painel mesmo usando as paredes internas como apoio
    for (const L of lajes.filter(x => x.pav === pav.id && x.incluida && x.vigas.length)) {
      for (const pos of L.vigas) {
        const o: 'H' | 'V' = L.sentido === 'H' ? 'V' : 'H';
        const [a, b] = o === 'V' ? [L.y0, L.y1] : [L.x0, L.x1];
        const perto = ts.filter(t => t.pav === pav.id && t.o === o && Math.abs(t.c - pos) < 1.0 && t.s < b && t.e > a).sort((x, y) => Math.abs(x.c - pos) - Math.abs(y.c - pos))[0];
        V.push({
          id: `${pav.id}-laje-${pos.toFixed(2)}`, pav: pav.id, o, c: pos, a, b, tipo: 'laje', obrigatoria: true,
          motivo: `Ambiente ${br(L.x1 - L.x0)} × ${br(L.y1 - L.y0)} m: mesmo apoiando a laje nas paredes, sobra vão maior que ${br(r.lajeComp)} m.`,
          ideia: perto ? `Viga no meio do vão, ou estender a parede que está a ${br(Math.abs(perto.c - pos))} m para servir de apoio (sem viga).` : `Viga no meio do vão, apoiada nas paredes das pontas (${br(b - a)} m).`,
          rebaixos: reb([...painelEm(pav.id, o, pos, a, b), ...cruzando(pav.id, o, pos, a, b)]),
        });
      }
    }
    // 3) paredes do pavimento de cima sem parede embaixo
    if (!cima || !tb.length || !tc.length) return;
    const { dx, dy } = al;
    for (const t of tc) {
      const c = t.c + (t.o === 'V' ? dx : dy), s = t.s + (t.o === 'H' ? dx : dy), e = t.e + (t.o === 'H' ? dx : dy);
      const apoios = tb.filter(x => x.o === t.o && Math.abs(x.c - c) < 0.15 && x.s < e && x.e > s).map(x => [Math.max(s, x.s), Math.min(e, x.e)] as [number, number]).sort((p, q) => p[0] - q[0]);
      let pos = s; const livres: [number, number][] = [];
      for (const [a, b] of apoios) { if (a - pos > 0.3) livres.push([pos, a]); pos = Math.max(pos, b); }
      if (e - pos > 0.3) livres.push([pos, e]);
      const nums = ps.filter(p => p.trecho === t.id).map(p => p.num);
      for (const [a, b] of livres) {
        if (vaos.some(v => v.pav === pav.id && v.o === t.o && Math.abs(v.c - c) < 0.15 && v.a <= a + 0.3 && v.b >= b - 0.3)) continue; // já tem viga do vão
        const m = (a + b) / 2, [mx, my] = t.o === 'H' ? [m, c] : [c, m];
        const L = lajeEm(pav.id, mx, my);
        if (!L) {
          // fora dos ambientes de baixo: laje em balanço; até o beiral permitido não precisa de viga
          const dist = Math.min(...tb.filter(x => x.o === t.o && x.s < b && x.e > a).map(x => Math.abs(x.c - c)), 99);
          if (dist <= r.beiral + 0.01) continue;
          V.push({
            id: `${pav.id}-cima-${t.id}-${a.toFixed(2)}`, pav: pav.id, o: t.o, c, a: a - r.vigaApoio, b: b + r.vigaApoio, tipo: 'parede-cima', obrigatoria: true,
            motivo: `Parede${nums.length ? ` ${nums.join(', ')}` : ''} do ${cima.nome} em balanço de ${dist < 99 ? br(dist) + ' m' : 'mais de ' + br(r.beiral) + ' m'} (beiral permitido sem viga: ${br(r.beiral)} m).`,
            ideia: `Viga sob a parede de cima, de ${br(b - a + 2 * r.vigaApoio)} m, ou trazer a parede para dentro até ${br(r.beiral)} m da parede de baixo.`,
            rebaixos: [],
          });
          continue;
        }
        // dentro de um ambiente: se a parede atravessa os painéis, a laje carrega; se corre ao longo do painel, precisa de viga
        const atravessa = (L.sentido === 'H' && t.o === 'V') || (L.sentido === 'V' && t.o === 'H');
        if (atravessa) {
          V.push({
            id: `${pav.id}-cima-${t.id}-${a.toFixed(2)}`, pav: pav.id, o: t.o, c, a, b, tipo: 'parede-cima', obrigatoria: false,
            motivo: `Parede${nums.length ? ` ${nums.join(', ')}` : ''} do ${cima.nome} apoiada na laje (atravessa os painéis), ${br(b - a)} m sem parede embaixo.`,
            ideia: 'Normalmente a laje alveolar suporta (carga distribuída em vários painéis). Conferir a carga com o engenheiro; se precisar, viga sob ela.',
            rebaixos: [],
          });
        } else {
          V.push({
            id: `${pav.id}-cima-${t.id}-${a.toFixed(2)}`, pav: pav.id, o: t.o, c, a: a - r.vigaApoio, b: b + r.vigaApoio, tipo: 'parede-cima', obrigatoria: true,
            motivo: `Parede${nums.length ? ` ${nums.join(', ')}` : ''} do ${cima.nome} corre ao longo dos painéis da laje, ${br(b - a)} m sem parede embaixo.`,
            ideia: `Girar o sentido da laje deste ambiente (aba Lajes) para a parede atravessar os painéis, ou viga sob ela de ${br(b - a + 2 * r.vigaApoio)} m.`,
            rebaixos: reb(cruzando(pav.id, t.o, c, a, b)),
          });
        }
      }
    }
  });
  return V;
}
