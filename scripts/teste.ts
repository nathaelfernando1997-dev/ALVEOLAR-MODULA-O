import { readFileSync } from 'node:fs';
import { parseDxf } from '../src/engine/dxf.ts';
import { ler, trechos, paineis, numerar, resumo, REGRAS_PADRAO, AJUSTES_VAZIOS } from '../src/engine/model.ts';
const f = process.argv[2];
const t0 = Date.now();
const d = parseDxf(readFileSync(f, 'latin1'));
console.log('ents', d.ents.length, 'inserts', d.inserts.length, 'blocks', d.blocks.size, 'ms', Date.now() - t0);
const L = ler(d, process.argv[3] || 'PAREDE');
console.log('regioes', L.regioes.map(b => [b.x0, b.x1, b.y0, b.y1].map(v => v.toFixed(1)).join(' ')));
console.log('tags', L.tags.map(t => t.text).join(','));
console.log('quadro', JSON.stringify(L.quadro));
const pavs = [
  { id: 'T', nome: 'Térreo', box: L.regioes.find(b => b.x0 > 12 && b.x0 < 14 && b.y0 > 37)!, altura: 3.09, ativo: true },
  { id: 'S', nome: 'Superior', box: L.regioes.find(b => b.x0 > 36 && b.x0 < 37.5 && b.y0 > 37)!, altura: 2.61, ativo: true },
];
const all = [];
for (const p of pavs) {
  if (!p.box) { console.log('sem regiao', p.nome); continue; }
  const ts = trechos(L, p, L.quadro, REGRAS_PADRAO, AJUSTES_VAZIOS);
  const { paineis: ps, vaos } = paineis(ts, REGRAS_PADRAO, AJUSTES_VAZIOS);
  console.log(p.nome, 'trechos', ts.length, 'paineis', ps.length, 'vaos', vaos.map(v => v.tipo + ':' + (v.b - v.a).toFixed(2)).join(' '));
  all.push(...ps);
}
numerar(all, ['T', 'S']);
for (const p of all) console.log(p.num, p.pav, p.o, p.c.toFixed(2), p.a.toFixed(2), p.b.toFixed(2), 'larg', p.larg.toFixed(2), 'H', p.H, p.recortes.map(r => `${r.tipo} ${r.w.toFixed(2)}x${r.h.toFixed(2)} dl${r.dl.toFixed(2)} b${r.base.toFixed(2)}`).join(';'), p.aviso || '');
console.log(resumo(all));
