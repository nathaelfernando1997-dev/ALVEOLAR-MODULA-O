// Conferência com os cortes: lê as cotas verticais de cada corte e compara
// com os pés-direitos, a espessura da laje e as alturas de portas e janelas.
import type { Dxf } from './dxf.ts';
import type { Box, Esquadria, Pavimento, Regras, Painel } from './model.ts';

export interface Pilha { x: number; cotas: { y: number; valor: number }[] }
export interface Corte { id: string; nome: string; pilhas: Pilha[]; valores: number[] }
export interface Aviso { nivel: 'ok' | 'atencao' | 'erro'; msg: string }

export function lerCortes(d: Dxf, cortes: { id: string; nome: string; box: Box }[]): Corte[] {
  return cortes.map(c => {
    const v = d.cotas.filter(k => k.vertical && k.x > c.box.x0 - 2 && k.x < c.box.x1 + 2 && k.y > c.box.y0 - 1 && k.y < c.box.y1 + 1 && k.valor > 0.05);
    const pilhas: Pilha[] = [];
    for (const k of v.sort((a, b) => a.x - b.x)) {
      const yb = Math.min(k.p1[1], k.p2[1]);
      const p = pilhas.find(p => Math.abs(p.x - k.x) < 0.12);
      if (p) p.cotas.push({ y: yb, valor: k.valor }); else pilhas.push({ x: k.x, cotas: [{ y: yb, valor: k.valor }] });
    }
    for (const p of pilhas) p.cotas.sort((a, b) => a.y - b.y);
    const valores = [...new Set(v.map(k => Math.round(k.valor * 100) / 100))].sort((a, b) => a - b);
    return { id: c.id, nome: c.nome, pilhas: pilhas.filter(p => p.cotas.length), valores };
  });
}

const br = (v: number) => v.toFixed(2).replace('.', ',');
const tem = (vs: number[], x: number, tol = 0.015) => vs.some(v => Math.abs(v - x) <= tol);

export function conferir(cs: Corte[], pavs: Pavimento[], quadro: Esquadria[], r: Regras, ps: Painel[]): Aviso[] {
  const A: Aviso[] = [];
  const todos = cs.flatMap(c => c.valores);
  if (!cs.length) { A.push({ nivel: 'atencao', msg: 'Nenhum corte marcado. Marque os cortes na aba Pavimentos para conferir as alturas.' }); return A; }
  if (!todos.length) A.push({ nivel: 'atencao', msg: 'Não encontrei cotas verticais nos cortes marcados.' });
  for (const p of pavs) {
    if (tem(todos, p.altura)) A.push({ nivel: 'ok', msg: `${p.nome}: pé-direito ${br(p.altura)} m confere com os cortes.` });
    else A.push({ nivel: 'erro', msg: `${p.nome}: pé-direito ${br(p.altura)} m não aparece nos cortes (cotas encontradas: ${todos.filter(v => v > 2 && v < 7).map(br).join(', ') || '—'}).` });
    if (tem(todos, p.altura + r.lajeEsp)) A.push({ nivel: 'ok', msg: `${p.nome}: piso a piso ${br(p.altura + r.lajeEsp)} m (pé-direito + laje ${br(r.lajeEsp)}) confere.` });
  }
  if (!tem(todos, r.lajeEsp, 0.005)) A.push({ nivel: 'atencao', msg: `Espessura da laje ${br(r.lajeEsp)} m não aparece nos cortes.` });
  // portas e janelas x pé-direito
  for (const p of pavs) {
    for (const q of quadro) {
      const topo = q.tag.startsWith('J') ? q.peit + q.alt + r.janelaDesce : r.boneca + q.alt;
      if (topo > p.altura + 1e-6) {
        const usada = ps.some(x => x.pav === p.id && x.recortes.some(rc => rc.tipo === q.tag));
        A.push({ nivel: usada ? 'erro' : 'atencao', msg: `${q.tag} (topo do recorte a ${br(topo)} m) é mais alta que o pé-direito do ${p.nome} (${br(p.altura)} m)${usada ? ' e está em painel deste pavimento' : ' — se estiver neste pavimento, vira vão entre painéis'}.` });
      }
    }
  }
  // recortes que encostam no topo (sem verga)
  for (const x of ps) for (const rc of x.recortes) if (x.H - rc.base - rc.h < 0.1) A.push({ nivel: 'atencao', msg: `Painel ${x.num}: ${rc.tipo} fica a menos de 10 cm do topo (${br(x.H - rc.base - rc.h)} m) — conferir viga/verga no corte.` });
  return A;
}

// Pés-direitos lidos dos cortes: em cada pilha de cotas verticais (de baixo para cima),
// um valor de pé-direito (2,20–4,50) seguido da laje (0,08–0,30) é um pavimento.
export function detectarPes(d: Dxf, boxes: Box[]): number[] {
  const cs = lerCortes(d, boxes.map((b, i) => ({ id: String(i), nome: '', box: b })));
  const seqs: number[][] = [];
  for (const c of cs) for (const p of c.pilhas) {
    const v = p.cotas.map(k => Math.round(k.valor * 100) / 100);
    const s: number[] = [];
    for (let i = 0; i < v.length - 1; i++) if (v[i] >= 2.2 && v[i] <= 4.5 && v[i + 1] >= 0.08 && v[i + 1] <= 0.3) s.push(v[i]);
    if (s.length) seqs.push(s);
  }
  if (!seqs.length) return [];
  // a sequência mais longa; empate: a que mais se repete
  const cont = new Map<string, number>();
  for (const s of seqs) cont.set(s.join('|'), (cont.get(s.join('|')) || 0) + 1);
  const melhor = [...cont.entries()].sort((a, b) => b[0].split('|').length - a[0].split('|').length || b[1] - a[1])[0][0];
  return melhor.split('|').map(Number);
}

// tenta adivinhar o papel de cada desenho: com etiquetas de porta/janela = planta; com cotas verticais = corte
export function adivinharPapeis(d: Dxf, regioes: Box[], tags: { x: number; y: number }[]): ('planta' | 'corte' | 'nao')[] {
  return regioes.map(b => {
    const nTags = tags.filter(t => t.x > b.x0 - 0.3 && t.x < b.x1 + 0.3 && t.y > b.y0 - 0.3 && t.y < b.y1 + 0.3).length;
    if (nTags >= 2) return 'planta';
    const nV = d.cotas.filter(k => k.vertical && k.x > b.x0 - 2 && k.x < b.x1 + 2 && k.y > b.y0 - 1 && k.y < b.y1 + 1 && k.valor > 2 && k.valor < 4.6).length;
    return nV >= 1 ? 'corte' : 'nao';
  });
}
