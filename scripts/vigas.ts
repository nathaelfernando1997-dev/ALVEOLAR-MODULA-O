import { readFileSync } from 'node:fs';
import { parseDxf } from '../src/engine/dxf.ts';
import { ler, trechos, paineis, numerar, REGRAS_PADRAO, AJUSTES_VAZIOS } from '../src/engine/model.ts';
import { ambientes, modularLajes } from '../src/engine/lajes.ts';
import { sugerirVigas, alinhar } from '../src/engine/vigas.ts';
const d = parseDxf(readFileSync(process.argv[2], 'latin1'));
const L = ler(d, 'PAREDE');
const pavs = [
  { id: 'T', nome: 'Térreo', box: L.regioes.find(b => b.x0 > 12 && b.x0 < 14 && b.y0 > 37)!, altura: 3.09, ativo: true },
  { id: 'S', nome: 'Superior', box: L.regioes.find(b => b.x0 > 36 && b.x0 < 37.5 && b.y0 > 37)!, altura: 2.61, ativo: true },
];
const ts = [], ps = [], vs = [], lj = [];
for (const p of pavs) { const t = trechos(L, p, L.quadro, REGRAS_PADRAO, AJUSTES_VAZIOS); const r = paineis(t, REGRAS_PADRAO, AJUSTES_VAZIOS); ts.push(...t); ps.push(...r.paineis); vs.push(...r.vaos); lj.push(...modularLajes(ambientes(p, t), REGRAS_PADRAO, AJUSTES_VAZIOS, t).ambs); }
numerar(ps, ['T', 'S']);
console.log('alinhamento', alinhar(ts.filter(t => t.pav === 'T'), ts.filter(t => t.pav === 'S')));
for (const v of sugerirVigas(pavs, ts, ps, vs, lj, REGRAS_PADRAO)) console.log(v.pav, v.tipo, v.obrigatoria ? 'OBRIG' : '', v.o, v.c.toFixed(2), v.a.toFixed(2), v.b.toFixed(2), '|', v.motivo, '|', v.ideia, '|', v.rebaixos.map(r => `${r.painel}:${r.de}->${r.para.toFixed(2)}`).join(' '));
