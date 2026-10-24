// Sugestão de vigas e rebaixo das paredes por causa delas.
// 1) vão sem parede (porta grande, vão livre) sob a laje: viga sobre o vão;
// 2) laje com vão maior que o painel: viga intermediária no meio do ambiente;
// 3) parede do pavimento de cima sem parede embaixo: sobre a laje, reforço com treliças (sem viga).
import type { Painel, Pavimento, Regras, Trecho, VaoInteiro } from './model.ts';
import type { LajeAmb, PainelLaje } from './lajes.ts';

export interface Viga {
  id: string; pav: string; o: 'H' | 'V'; c: number; a: number; b: number;
  tipo: 'vao' | 'laje' | 'parede-cima' | 'trelica' | 'piso';   // trelica = reforço da laje sob parede de cima (sem viga)
  obrigatoria: boolean; motivo: string; ideia: string;
  rebaixos: { painel: number; de: number; para: number }[];
  altura?: number;  // altura da viga (10% do vão, no mínimo a da regra)
  desconto?: { painel: number; de: number; para: number }[];   // paredes de cima que ficam mais baixas (apoiam em cima da viga)
  apoio?: number;   // quanto de cada ponta fica em cima da parede (o desenho mostra só o vão livre)
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

// trechos das paredes do pavimento de cima (já nas coordenadas da planta de baixo) que não têm parede embaixo,
// cortados em cada parede de baixo que atravessa a linha: cada pedaço fica dentro de um só ambiente
export interface Carga { t: Trecho; o: 'H' | 'V'; c: number; a: number; b: number }
export function cargasDeCima(tb: Trecho[], tc: Trecho[]): Carga[] {
  if (!tb.length || !tc.length) return [];
  const { dx, dy } = alinhar(tb, tc);
  const out: Carga[] = [];
  for (const t of tc) {
    const c = t.c + (t.o === 'V' ? dx : dy), s = t.s + (t.o === 'H' ? dx : dy), e = t.e + (t.o === 'H' ? dx : dy);
    const apoios = tb.filter(x => x.o === t.o && Math.abs(x.c - c) < 0.15 && x.s < e && x.e > s).map(x => [Math.max(s, x.s), Math.min(e, x.e)] as [number, number]).sort((p, q) => p[0] - q[0]);
    let pos = s; const livres: [number, number][] = [];
    for (const [a, b] of apoios) { if (a - pos > 0.3) livres.push([pos, a]); pos = Math.max(pos, b); }
    if (e - pos > 0.3) livres.push([pos, e]);
    for (const [a, b] of livres) {
      // paredes de baixo que cruzam a linha dividem o pedaço (a viga não passa de um ambiente para o outro)
      const cortes = tb.filter(x => x.o !== t.o && x.c > a + 0.1 && x.c < b - 0.1 && x.s <= c + 0.1 && x.e >= c - 0.1).map(x => x.c).sort((p, q) => p - q);
      const pts = [a, ...cortes, b];
      for (let i = 0; i < pts.length - 1; i++) if (pts[i + 1] - pts[i] > 0.3) out.push({ t, o: t.o, c, a: pts[i], b: pts[i + 1] });
    }
  }
  return out;
}

// pisos = vigas indicadas no projeto ("LINHA DE PISO"), como trechos de apoio
export function sugerirVigas(pavs: Pavimento[], ts: Trecho[], ps: Painel[], vaos: VaoInteiro[], lajes: LajeAmb[], r: Regras, pisos: Trecho[] = []): Viga[] {
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
    const pp = pisos.filter(t => t.pav === pav.id);
    const al = tc.length && tb.length ? alinhar(tb, tc) : { dx: 0, dy: 0 };
    // 0) linha de piso do projeto: viga que apoia a laje (e as paredes de cima que estiverem nela).
    // Altura de 10% do vão: uma parte fica abaixo da laje, passa pela laje e o resto sobe; a parede de cima
    // apoia em cima da viga e fica mais baixa
    for (const t of pp) {
      const sobre = cima ? cargasDeCima(tb, tc).filter(k => k.o === t.o && Math.abs(k.c - t.c) < 0.2 && k.a < t.e && k.b > t.s) : [];
      const nums = [...new Set(ps.filter(p => sobre.some(k => k.t.id === p.trecho)).map(p => p.num))];
      const w = t.e - t.s, a = t.s - r.vigaApoio, b = t.e + r.vigaApoio;
      const hV = Math.max(r.vigaAltura, Math.ceil(w * 0.10 / 0.05 - 1e-9) * 0.05);
      const abaixo = Math.max(0, Math.min(hV - r.lajeEsp, r.vigaPisoAbaixo ?? 0.45));
      const naLaje = Math.min(r.lajeEsp, hV - abaixo), sobe = Math.max(0, hV - abaixo - naLaje);
      const off = t.o === 'H' ? al.dx : al.dy;
      const cimaPs = cima ? ps.filter(p => p.pav === cima.id && sobre.some(k => k.t.id === p.trecho) && p.a + off < b && p.b + off > a) : [];
      const pouco = sobe > 0.005 && sobe <= 0.10 + 1e-6;
      const desconto = sobe > 0.005 && !pouco ? cimaPs.map(p => ({ painel: p.num, de: p.H, para: Math.max(0, p.H - sobe) })) : [];
      const partes = pouco
        ? `Viga de ${br(abaixo + naLaje)} m (${br(abaixo)} m abaixo da laje + ${br(naLaje)} m na laje), em vez de ${br(hV)} m (10% do vão): faltam só ${br(sobe)} m, então as paredes de cima não baixam — reforçar a ferragem da viga.`
        : `Viga de ${br(hV)} m de altura (10% do vão${hV > w * 0.1 + 0.05 ? ', mínimo da regra' : ''}): ${br(abaixo)} m abaixo da laje, ${br(naLaje)} m na laje${sobe > 0.005 ? ` e ${br(sobe)} m para cima${desconto.length ? ` — paredes ${desconto.map(d => d.painel).join(', ')} do ${cima!.nome} apoiam em cima da viga e baixam de ${br(desconto[0].de)} para ${br(desconto[0].para)} m` : ''}` : ''}.`;
      V.push({
        id: `${pav.id}-piso-${t.c.toFixed(2)}-${t.s.toFixed(2)}`, pav: pav.id, o: t.o, c: t.c, a, b, tipo: 'piso', obrigatoria: true, apoio: r.vigaApoio,
        motivo: `${t.id.includes('|borda|') ? `Borda da laje embaixo do ${cima?.nome ?? 'pavimento de cima'}, sem parede embaixo (garagem/varanda)` : t.id.includes('|vparede|') ? 'Viga no lugar da parede (muxarabi/esquadria)' : t.id.includes('|gcorpo|') ? 'Borda da laje em cima do guarda-corpo da sacada (o guarda-corpo é feito na obra, não segura a laje)' : 'Linha de piso do projeto'} (${br(w)} m): a laje apoia nessa viga${nums.length ? `, com parede ${nums.join(', ')} do ${cima!.nome} em cima` : ''}.`,
        ideia: `Viga ${t.id.includes('|borda|') ? 'na borda da laje' : t.id.includes('|vparede|') ? 'no lugar da parede' : t.id.includes('|gcorpo|') ? 'na borda da laje da sacada' : 'na linha de piso'}, de ${br(b - a)} m, apoiada em pilares nas pontas (sem parede embaixo da viga). ${partes} Conferir com o engenheiro.`,
        altura: pouco ? abaixo + naLaje : hV, desconto,
        rebaixos: [],
      });
    }
    const cimaNaLinha = (o: 'H' | 'V', c: number, a: number, b: number) => tc.filter(t => t.o === o && Math.abs(t.c + (o === 'V' ? al.dx : al.dy) - c) < 0.15 &&
      t.s + (o === 'H' ? al.dx : al.dy) < b && t.e + (o === 'H' ? al.dx : al.dy) > a);

    // 1) vão sem parede: só precisa de viga se a laje apoia nessa parede ou se tem parede em cima
    for (const v of vaos.filter(x => x.pav === pav.id && !x.sobe)) {   // porta que sobe: a verga fica no painel de cima
      const w = v.b - v.a, a = v.a - r.vigaApoio, b = v.b + r.vigaApoio;
      const apoia = apoioDeLaje(pav.id, v.o, v.c, v.a, v.b);
      const sobre = cimaNaLinha(v.o, v.c, v.a, v.b);
      if (!apoia && !sobre.length) continue;
      const nums = ps.filter(p => sobre.some(t => t.id === p.trecho)).map(p => p.num);
      const obrig = w > r.vaoViga || sobre.length > 0;
      // altura da viga: 10% do vão (de 5 em 5 cm), no mínimo a da regra. Ela ocupa o espaço da parede acima da porta,
      // entra na laje e o que sobrar sobe: a parede de cima apoia em cima da viga e fica mais baixa
      const hV = Math.max(r.vigaAltura, Math.ceil(w * 0.10 / 0.05 - 1e-9) * 0.05);
      const Hb = v.H ?? pav.altura, naParede = Math.max(0, Math.min(hV, Hb - (v.topo ?? Hb)));
      const naLaje = Math.min(r.lajeEsp, hV - naParede), sobe = Math.max(0, hV - naParede - naLaje);
      const cimaPs = cima ? ps.filter(p => p.pav === cima.id && sobre.some(t => t.id === p.trecho) && p.a + (v.o === 'H' ? al.dx : al.dy) < b && p.b + (v.o === 'H' ? al.dx : al.dy) > a) : [];
      // até 10 cm não vale baixar a parede de cima: a viga fica mais baixa e reforça a ferragem
      const pouco = sobe > 0.005 && sobe <= 0.10 + 1e-6;
      const desconto = sobe > 0.005 && !pouco ? cimaPs.map(p => ({ painel: p.num, de: p.H, para: Math.max(0, p.H - sobe) })) : [];
      const partes = pouco
        ? `Viga de ${br(naParede + naLaje)} m (${br(naParede)} m na parede acima da porta + ${br(naLaje)} m na laje), em vez de ${br(hV)} m (10% do vão): faltam só ${br(sobe)} m, então as paredes de cima não baixam — reforçar a ferragem da viga.`
        : `Viga de ${br(hV)} m de altura (10% do vão${hV > w * 0.1 + 0.05 ? ', mínimo da regra' : ''}): ${br(naParede)} m na parede acima da porta, ${br(naLaje)} m na laje${sobe > 0.005 ? ` e ${br(sobe)} m para cima${desconto.length ? ` — paredes ${desconto.map(d => d.painel).join(', ')} do ${cima!.nome} apoiam em cima da viga e baixam de ${br(desconto[0].de)} para ${br(desconto[0].para)} m` : ''}` : ''}.`;
      V.push({
        id: `${pav.id}-vao-${v.a.toFixed(2)}`, pav: pav.id, o: v.o, c: v.c, a, b, tipo: 'vao', obrigatoria: obrig, apoio: r.vigaApoio,
        motivo: `${v.tipo === 'vão livre' ? 'Vão livre' : v.tipo} de ${br(w)} m sem parede${sobre.length ? `, com parede${nums.length ? ` ${nums.join(', ')}` : ''} do ${cima!.nome} em cima` : ''}${apoia ? ', e a laje apoia nesse alinhamento' : ''}${w > r.vaoViga ? ` (vão maior que ${br(r.vaoViga)} m)` : ''}.`,
        ideia: `Viga sobre o vão, de ${br(b - a)} m, entrando ${br(r.vigaApoio)} m em cima das paredes dos lados. ${partes}`,
        altura: pouco ? naParede + naLaje : hV, desconto,
        // nas paredes dos lados a viga ocupa a parte de cima (apoio)
        rebaixos: naParede > 0.005 ? painelEm(pav.id, v.o, v.c, a, b).filter(p => p.a < v.a || p.b > v.b).map(p => ({ painel: p.num, de: p.H, para: Math.max(0, p.H - naParede) })) : [],
      });
    }
    // 2) laje com vão maior que o painel mesmo usando as paredes internas como apoio
    for (const L of lajes.filter(x => x.pav === pav.id && x.incluida && x.vigas.length)) {
      for (const pos of L.vigas) {
        const o: 'H' | 'V' = L.sentido === 'H' ? 'V' : 'H';
        const [a, b] = o === 'V' ? [L.y0, L.y1] : [L.x0, L.x1];
        const sobre = cima ? cargasDeCima([...tb, ...pp], tc).filter(k => k.o === o && Math.abs(k.c - pos) < 0.15 && k.a < b && k.b > a) : [];
        const perto = ts.filter(t => t.pav === pav.id && t.o === o && Math.abs(t.c - pos) < 1.0 && t.s < b && t.e > a).sort((x, y) => Math.abs(x.c - pos) - Math.abs(y.c - pos))[0];
        V.push({
          id: `${pav.id}-laje-${pos.toFixed(2)}`, pav: pav.id, o, c: pos, a, b, tipo: 'laje', obrigatoria: true, apoio: o === 'V' ? (L.esp.s + L.esp.n) / 4 : (L.esp.o + L.esp.l) / 4,
          motivo: `Ambiente ${br(L.x1 - L.x0)} × ${br(L.y1 - L.y0)} m: mesmo apoiando a laje nas paredes, o painel passaria de ${br(r.lajeComp)} m (contando o beiral, se tiver).`,
          ideia: sobre.length ? `Viga embaixo da parede ${[...new Set(ps.filter(p => sobre.some(k => k.t.id === p.trecho)).map(p => p.num))].join(', ')} do ${cima!.nome} (a viga já carrega a parede), apoiada nas paredes das pontas (${br(b - a)} m).`
            : perto ? `Viga no meio do vão, ou estender a parede que está a ${br(Math.abs(perto.c - pos))} m para servir de apoio (sem viga).` : `Viga no meio do vão, apoiada nas paredes das pontas (${br(b - a)} m).`,
          rebaixos: reb([...painelEm(pav.id, o, pos, a, b), ...cruzando(pav.id, o, pos, a, b)]),
        });
      }
    }
    // 3) paredes do pavimento de cima sem parede embaixo (um pedaço por ambiente de baixo)
    if (!cima || !tb.length || !tc.length) return;
    for (const { t, c, a, b } of cargasDeCima([...tb, ...pp], tc)) {
      const nums = ps.filter(p => p.trecho === t.id).map(p => p.num);
      {
        if (vaos.some(v => v.pav === pav.id && v.o === t.o && Math.abs(v.c - c) < 0.15 && v.a <= a + 0.3 && v.b >= b - 0.3)) continue; // já tem viga do vão
        if (V.some(v => v.pav === pav.id && v.tipo === 'laje' && v.o === t.o && Math.abs(v.c - c) < 0.15 && v.a <= a + 0.3 && v.b >= b - 0.3)) continue; // em cima da viga da laje
        const m = (a + b) / 2, [mx, my] = t.o === 'H' ? [m, c] : [c, m];
        const L = lajeEm(pav.id, mx, my);
        if (!L) {
          // fora dos ambientes de baixo: laje em balanço; até o beiral permitido não precisa de viga
          const dist = Math.min(...tb.filter(x => x.o === t.o && x.s < b && x.e > a).map(x => Math.abs(x.c - c)), 99);
          if (dist <= r.beiral + 0.01) continue;
          // parede sobre a laje: treliça; a laje em balanço além do beiral fica como alerta para conferir o apoio
          V.push({
            id: `${pav.id}-tr-${t.id}-${a.toFixed(2)}`, pav: pav.id, o: t.o, c, a, b, tipo: 'trelica', obrigatoria: false,
            motivo: `Parede${nums.length ? ` ${nums.join(', ')}` : ''} do ${cima.nome} sobre a laje, ${br(b - a)} m, fora dos ambientes de baixo (balanço de ${dist < 99 ? br(dist) + ' m' : 'mais de ' + br(r.beiral) + ' m'}; beiral sem apoio até ${br(r.beiral)} m).`,
            ideia: `Reforçar a laje com treliças embaixo da parede — sem viga. Conferir como a laje se apoia nessa área.`,
            rebaixos: [],
          });
          continue;
        }
        // dentro de um ambiente: a parede de cima fica sobre a laje, sem viga; a laje é reforçada com treliças embaixo dela
        const atravessa = (L.sentido === 'H' && t.o === 'V') || (L.sentido === 'V' && t.o === 'H');
        V.push({
          id: `${pav.id}-tr-${t.id}-${a.toFixed(2)}`, pav: pav.id, o: t.o, c, a, b, tipo: 'trelica', obrigatoria: false,
          motivo: `Parede${nums.length ? ` ${nums.join(', ')}` : ''} do ${cima.nome} sobre a laje, ${br(b - a)} m sem parede embaixo (${atravessa ? 'atravessa os painéis' : 'ao longo dos painéis'}).`,
          ideia: `Reforçar a laje com treliças embaixo da parede, ${br(b - a)} m${atravessa ? '' : ', na junta/capa dos painéis sob a parede'} — sem viga.`,
          rebaixos: [],
        });
      }
    }
  });
  // mesma viga sugerida duas vezes (dois pedaços de parede no mesmo ambiente): fica uma só
  const unicas: Viga[] = [];
  for (const v of V) {
    const ig = unicas.find(u => u.pav === v.pav && u.o === v.o && Math.abs(u.c - v.c) < 0.05 && Math.abs(u.a - v.a) < 0.05 && Math.abs(u.b - v.b) < 0.05);
    if (ig) { ig.obrigatoria ||= v.obrigatoria; continue; }
    unicas.push(v);
  }
  return unicas;
}

// onde vai cada treliça em cada painel de laje: distância da borda do painel (como na planta) e comprimento
export interface TrelicaPainel { t: number; painel: number; onde: string; comp: number; ao: 'ao longo' | 'atravessando' }
export function trelicasNasLajes(T: (Viga & { n: number })[], P: PainelLaje[]): TrelicaPainel[] {
  const out: TrelicaPainel[] = [];
  for (const t of T.filter(v => v.tipo === 'trelica')) {
    const n0 = out.length;
    for (const p of P.filter(q => q.pav === t.pav)) {
      const [c0, c1, l0, l1] = t.o === 'H' ? [p.y0, p.y1, p.x0, p.x1] : [p.x0, p.x1, p.y0, p.y1];
      if (t.c <= c0 + 0.01 || t.c >= c1 - 0.01) continue;
      const comp = Math.min(t.b, l1) - Math.max(t.a, l0);
      if (comp < 0.1) continue;
      const lado = t.o === 'H' ? ['de baixo', 'de cima'] : ['da esquerda', 'da direita'];
      const d0 = t.c - c0, d1 = c1 - t.c;
      const ini = Math.max(t.a, l0) - l0;   // onde começa, a partir da ponta esquerda/de baixo do painel
      const onde = `a ${br(Math.min(d0, d1))} m da borda ${d0 <= d1 ? lado[0] : lado[1]}` + (ini > 0.1 ? `, começando a ${br(ini)} m da ponta ${t.o === 'H' ? 'esquerda' : 'de baixo'}` : '');
      out.push({ t: t.n, painel: p.num, onde, comp, ao: t.o === p.sentido ? 'ao longo' : 'atravessando' });
    }
    if (out.length === n0) out.push({ t: t.n, painel: 0, onde: 'sem painel de laje modulado embaixo (área sem ambiente fechado no pavimento de baixo) — conferir o apoio da laje', comp: t.b - t.a, ao: 'ao longo' });
  }
  return out.sort((a, b) => (a.painel || 1e9) - (b.painel || 1e9) || a.t - b.t);
}
