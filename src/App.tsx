import { useEffect, useMemo, useState } from 'react';
import { parseDxf } from './engine/dxf.ts';
import type { Dxf, Prim } from './engine/dxf.ts';
import { ler, trechos, paineis, numerar, resumo, REGRAS_PADRAO, AJUSTES_VAZIOS } from './engine/model.ts';
import type { Ajustes, Esquadria, Pavimento, Regras, Painel, Trecho, VaoInteiro, Box } from './engine/model.ts';
import { plantaSvg, vistaSvg } from './engine/draw.ts';
import { exportarDxf, exportarCsv } from './engine/exportDxf.ts';

type Aba = 'arquivo' | 'pavimentos' | 'esquadrias' | 'regras' | 'modulacao' | 'impressao';
const br = (v: number, n = 2) => v.toFixed(n).replace('.', ',');
const baixar = (nome: string, conteudo: string, tipo: string) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome; a.click();
};
interface Salvo { camada: string; pavs: Pavimento[]; quadro: Esquadria[]; regras: Regras; ajustes: Ajustes }
const chave = (n: string) => `modulacao:${n}`;

export default function App() {
  const [aba, setAba] = useState<Aba>('arquivo');
  const [nome, setNome] = useState('');
  const [dxf, setDxf] = useState<Dxf | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState('');
  const [camada, setCamada] = useState('PAREDE');
  const [pavs, setPavs] = useState<Pavimento[]>([]);
  const [quadro, setQuadro] = useState<Esquadria[]>([]);
  const [regras, setRegras] = useState<Regras>(REGRAS_PADRAO);
  const [aj, setAj] = useState<Ajustes>(AJUSTES_VAZIOS);
  const [pavSel, setPavSel] = useState('');
  const [sel, setSel] = useState<{ trecho: string; num?: number } | null>(null);
  const [vaoSel, setVaoSel] = useState<string | null>(null);

  const leitura = useMemo(() => (dxf ? ler(dxf, camada) : null), [dxf, camada]);

  // abre arquivo
  const abrir = async (f: File) => {
    setLendo(true); setErro('');
    try {
      const txt = await f.text();
      if (!/SECTION/.test(txt.slice(0, 5000))) throw new Error('O arquivo não parece um DXF. No AutoCAD use "Salvar como" > DXF.');
      const d = parseDxf(txt);
      setDxf(d); setNome(f.name);
      const s = (() => { try { return JSON.parse(localStorage.getItem(chave(f.name)) || 'null') as Salvo | null; } catch { return null; } })();
      const cam = s?.camada ?? (d.layers.find(l => /parede|wall|alven/i.test(l)) || 'PAREDE');
      setCamada(cam);
      const L = ler(d, cam);
      if (s) { setPavs(s.pavs); setQuadro(s.quadro); setRegras({ ...REGRAS_PADRAO, ...s.regras }); setAj({ ...AJUSTES_VAZIOS, ...s.ajustes }); }
      else {
        setPavs(L.regioes.map((b, i) => ({ id: `R${i + 1}`, nome: `Região ${i + 1}`, box: b, altura: 2.8, ativo: false })));
        setQuadro(L.quadro); setRegras(REGRAS_PADRAO); setAj(AJUSTES_VAZIOS);
      }
      setAba('pavimentos');
    } catch (e) { setErro((e as Error).message); }
    setLendo(false);
  };
  // salva automaticamente no navegador
  useEffect(() => {
    if (!nome) return;
    try { localStorage.setItem(chave(nome), JSON.stringify({ camada, pavs, quadro, regras, ajustes: aj } satisfies Salvo)); } catch { /* sem espaço */ }
  }, [nome, camada, pavs, quadro, regras, aj]);

  const ativos = pavs.filter(p => p.ativo);
  const calc = useMemo(() => {
    if (!leitura) return { ts: [] as Trecho[], ps: [] as Painel[], vaos: [] as VaoInteiro[] };
    const ts: Trecho[] = [], ps: Painel[] = [], vaos: VaoInteiro[] = [];
    for (const p of ativos) {
      const t = trechos(leitura, p, quadro, regras, aj);
      const r = paineis(t, regras, aj);
      ts.push(...t); ps.push(...r.paineis); vaos.push(...r.vaos);
    }
    numerar(ps, ativos.map(p => p.id));
    return { ts, ps, vaos };
  }, [leitura, pavs, quadro, regras, aj]);

  const arqDe = (box: Box): Prim[] => leitura ? leitura.prims.filter(p => p.pts.every(q => q[0] > box.x0 - 0.6 && q[0] < box.x1 + 0.6 && q[1] > box.y0 - 0.6 && q[1] < box.y1 + 0.6)) : [];

  const tabs: [Aba, string][] = [['arquivo', '1. Arquivo'], ['pavimentos', '2. Pavimentos'], ['esquadrias', '3. Portas e janelas'], ['regras', '4. Regras'], ['modulacao', '5. Modulação'], ['impressao', '6. Impressão e arquivos']];
  return (
    <div className="app">
      <header className="topo noprint">
        <h1>Alveolar Modulação</h1>
        <span className="arq">{nome || 'nenhum projeto aberto'}</span>
        {calc.ps.length > 0 && <Resumo ps={calc.ps} />}
      </header>
      <nav className="abas noprint">{tabs.map(([k, t]) => <button key={k} className={aba === k ? 'on' : ''} disabled={k !== 'arquivo' && !dxf} onClick={() => setAba(k)}>{t}</button>)}</nav>
      <main>
        {aba === 'arquivo' && (
          <section className="card">
            <h2>Abrir planta</h2>
            <p>Envie o projeto em <b>DXF</b>. No AutoCAD, use <i>Salvar como → DXF</i>. O arquivo é lido no seu computador e não é enviado para nenhum servidor.</p>
            <input type="file" accept=".dxf" onChange={e => e.target.files?.[0] && abrir(e.target.files[0])} />
            {lendo && <p>Lendo o arquivo…</p>}
            {erro && <p className="erro">{erro}</p>}
            {dxf && <div className="campo"><label>Camada das paredes</label>
              <select value={camada} onChange={e => setCamada(e.target.value)}>{dxf.layers.map(l => <option key={l}>{l}</option>)}</select>
              <small>{leitura?.paredes.length} linhas nessa camada · {leitura?.regioes.length} desenhos encontrados</small></div>}
          </section>
        )}

        {aba === 'pavimentos' && leitura && (
          <section className="card">
            <h2>Escolha as plantas a modular</h2>
            <p>O sistema separou os desenhos que têm paredes (plantas, cortes, fachadas). Marque só as <b>plantas baixas</b>, dê o nome e o pé-direito (altura do painel). A ordem da lista é a ordem da numeração.</p>
            <div className="regioes">
              {pavs.map((p, i) => (
                <div key={p.id} className={'regiao' + (p.ativo ? ' on' : '')}>
                  <Miniatura prims={leitura.paredes} box={p.box} />
                  <label><input type="checkbox" checked={p.ativo} onChange={e => setPavs(pavs.map(q => q.id === p.id ? { ...q, ativo: e.target.checked } : q))} /> modular</label>
                  <input value={p.nome} onChange={e => setPavs(pavs.map(q => q.id === p.id ? { ...q, nome: e.target.value } : q))} />
                  <label>Pé-direito (m) <input type="number" step="0.01" value={p.altura} onChange={e => setPavs(pavs.map(q => q.id === p.id ? { ...q, altura: parseFloat(e.target.value) || 0 } : q))} /></label>
                  <div className="ordem">
                    <button disabled={i === 0} onClick={() => { const a = [...pavs];[a[i - 1], a[i]] = [a[i], a[i - 1]]; setPavs(a); }}>↑</button>
                    <button disabled={i === pavs.length - 1} onClick={() => { const a = [...pavs];[a[i + 1], a[i]] = [a[i], a[i + 1]]; setPavs(a); }}>↓</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {aba === 'esquadrias' && (
          <section className="card">
            <h2>Quadro de portas e janelas</h2>
            <p>Lido do quadro de aberturas do projeto. Confira e corrija. Medidas em metros. Portas começam com <b>P</b>, janelas com <b>J</b>.</p>
            <table className="tab"><thead><tr><th>Código</th><th>Largura</th><th>Altura</th><th>Peitoril</th><th></th></tr></thead><tbody>
              {quadro.map((q, i) => (
                <tr key={i}>
                  <td><input value={q.tag} onChange={e => setQuadro(quadro.map((x, j) => j === i ? { ...x, tag: e.target.value.toUpperCase() } : x))} /></td>
                  {(['larg', 'alt', 'peit'] as const).map(k => <td key={k}><input type="number" step="0.01" value={q[k]} disabled={k === 'peit' && !q.tag.startsWith('J')} onChange={e => setQuadro(quadro.map((x, j) => j === i ? { ...x, [k]: parseFloat(e.target.value) || 0 } : x))} /></td>)}
                  <td><button onClick={() => setQuadro(quadro.filter((_, j) => j !== i))}>remover</button></td>
                </tr>))}
            </tbody></table>
            <button onClick={() => setQuadro([...quadro, { tag: 'P0' + (quadro.length + 1), larg: 0.8, alt: 2.1, peit: 0 }])}>+ adicionar</button>
            <p className="dica">Etiquetas encontradas nas plantas: {[...new Set(leitura?.tags.map(t => t.text))].join(', ') || 'nenhuma'}</p>
          </section>
        )}

        {aba === 'regras' && (
          <section className="card">
            <h2>Regras de modulação</h2>
            <div className="grade">
              {([
                ['larguraMax', 'Largura máxima do painel (m)'], ['coluna', 'Coluna entre painéis (m)'], ['folga', 'Desconto em cada painel (m)'],
                ['boneca', 'Boneca de transporte, lateral e embaixo (m)'], ['acrescimoLargura', 'Acréscimo na largura do recorte (m)'],
                ['janelaDesce', 'Janela: recorte desce e sobe (m)'], ['espMin', 'Espessura mínima de parede (m)'], ['espMax', 'Espessura máxima de parede (m)'],
                ['minParede', 'Trecho mínimo de parede (m)'], ['naoFabricar', 'Marcar "n fabricar" abaixo de (m)'],
              ] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={regras[k]} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
            </div>
            <ul className="dica">
              <li>Paredes acima da largura máxima são divididas em partes iguais, com coluna entre elas.</li>
              <li>No encontro em T, a coluna fica só na parede que segue alinhada.</li>
              <li>Porta: boneca embaixo + altura do quadro (ex.: 0,10 + 2,10 = 2,20).</li>
              <li>Janela: recorte começa abaixo do peitoril e termina acima da janela pelo valor acima.</li>
            </ul>
            <button onClick={() => setRegras(REGRAS_PADRAO)}>Voltar ao padrão</button>
          </section>
        )}

        {aba === 'modulacao' && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta na aba Pavimentos.</p></section> :
          <section className="mod">
            <div className="lado">
              <div className="pavsel">{ativos.map(p => <button key={p.id} className={(pavSel || ativos[0].id) === p.id ? 'on' : ''} onClick={() => { setPavSel(p.id); setSel(null); }}>{p.nome}</button>)}</div>
              <Acoes sel={sel} vaoSel={vaoSel} calc={calc} aj={aj} setAj={setAj} quadro={quadro} limpar={() => { setSel(null); setVaoSel(null); }} />
              <details><summary>Desfazer ajustes</summary>
                <button onClick={() => { if (confirm('Apagar todos os ajustes manuais desta obra?')) setAj(AJUSTES_VAZIOS); }}>Apagar todos os ajustes</button>
              </details>
            </div>
            <PlantaInterativa pav={ativos.find(p => p.id === (pavSel || ativos[0].id))!} calc={calc} arq={arqDe(ativos.find(p => p.id === (pavSel || ativos[0].id))!.box)}
              sel={sel} vaoSel={vaoSel} onPainel={(t, n) => { setSel({ trecho: t, num: n }); setVaoSel(null); }} onVao={k => { setVaoSel(k); setSel(null); }} />
          </section>
        )}

        {aba === 'impressao' && leitura && (
          <section>
            <div className="card noprint">
              <h2>Impressão e arquivos</h2>
              <p>As folhas abaixo saem em <b>A4 deitado</b>. Use <i>Imprimir → Salvar como PDF</i>.</p>
              <div className="botoes">
                <button onClick={() => window.print()}>Imprimir / salvar PDF</button>
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-modulacao.dxf', exportarDxf(ativos, calc.ps), 'application/dxf')}>Baixar DXF da modulação</button>
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-paineis.csv', exportarCsv(calc.ps, ativos), 'text/csv')}>Baixar lista de painéis (CSV)</button>
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-ajustes.json', JSON.stringify({ camada, pavs, quadro, regras, ajustes: aj }, null, 1), 'application/json')}>Salvar ajustes (JSON)</button>
                <label className="botao">Abrir ajustes (JSON)<input type="file" accept=".json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const s = JSON.parse(await f.text()) as Salvo; setCamada(s.camada); setPavs(s.pavs); setQuadro(s.quadro); setRegras({ ...REGRAS_PADRAO, ...s.regras }); setAj({ ...AJUSTES_VAZIOS, ...s.ajustes }); }} /></label>
              </div>
            </div>
            <Folhas ativos={ativos} calc={calc} leitura={leitura} arqDe={arqDe} nome={nome} />
          </section>
        )}
      </main>
    </div>
  );
}

function Resumo({ ps }: { ps: Painel[] }) {
  const r = resumo(ps);
  return <span className="resumo">{r.qtd} painéis · {br(r.bruta)} m² brutos · {br(r.liquida)} m² sem recortes</span>;
}

function Miniatura({ prims, box }: { prims: Prim[]; box: Box }) {
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  const ps = prims.filter(p => p.pts.every(q => q[0] >= box.x0 - 0.1 && q[0] <= box.x1 + 0.1 && q[1] >= box.y0 - 0.1 && q[1] <= box.y1 + 0.1));
  return <svg viewBox={`${box.x0} ${-box.y1} ${w} ${h}`} className="mini">{ps.map((p, i) => <polyline key={i} points={p.pts.map(q => `${q[0]},${-q[1]}`).join(' ')} fill="none" stroke="#333" strokeWidth={w / 300} />)}</svg>;
}

function PlantaInterativa({ pav, calc, arq, sel, vaoSel, onPainel, onVao }: {
  pav: Pavimento; calc: { ts: Trecho[]; ps: Painel[]; vaos: VaoInteiro[] }; arq: Prim[]; sel: { trecho: string } | null; vaoSel: string | null;
  onPainel: (t: string, n: number) => void; onVao: (k: string) => void;
}) {
  const b = pav.box, pad = 0.8, W = b.x1 - b.x0 + 2 * pad, H = b.y1 - b.y0 + 2 * pad;
  const ps = calc.ps.filter(p => p.pav === pav.id), ts = calc.ts.filter(t => t.pav === pav.id);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return (
    <div className="planta">
      <svg viewBox={`${b.x0 - pad} ${-(b.y1 + pad)} ${W} ${H}`}>
        {arq.map((p, i) => <polyline key={i} points={p.pts.map(q => `${q[0]},${-q[1]}`).join(' ')} fill="none" stroke="#bbb" strokeWidth={0.015} />)}
        {ps.map(p => {
          const on = sel?.trecho === p.trecho;
          const [x1, y1, x2, y2] = p.o === 'H' ? [p.a, p.c, p.a + p.larg, p.c] : [p.c, p.a, p.c, p.a + p.larg];
          const m = (p.a + p.b) / 2, s = p.o === 'H' ? (p.c > cy ? -1 : 1) : (p.c > cx ? -1 : 1);
          const [tx, ty] = p.o === 'H' ? [m, p.c + s * 0.3] : [p.c + s * 0.3, m];
          return <g key={p.num} className="pn" onClick={() => onPainel(p.trecho, p.num)}>
            <line x1={x1} y1={-y1} x2={x2} y2={-y2} stroke={on ? '#e00' : p.num % 2 ? '#1f6fd1' : '#f08c00'} strokeWidth={0.16} />
            <text x={tx} y={-ty + 0.08} fontSize={0.24} textAnchor="middle" fill={on ? '#e00' : '#222'} fontWeight="bold">{p.num}</text>
          </g>;
        })}
        {ts.flatMap(t => t.vaos.map(v => {
          const key = `${t.id}@${((v.a + v.b) / 2).toFixed(2)}`;
          const [x, y, w, h] = t.o === 'H' ? [v.x0, t.c - 0.13, v.x1 - v.x0, 0.26] : [t.c - 0.13, v.x0, 0.26, v.x1 - v.x0];
          const on = vaoSel === key;
          return <g key={key} className="pn" onClick={() => onVao(key)}>
            <rect x={x} y={-(y + h)} width={w} height={h} fill={on ? '#fce' : '#fff'} stroke={v.tag ? '#c0c' : '#999'} strokeWidth={0.03} strokeDasharray={v.tag ? '' : '0.06 0.04'} />
            <text x={t.o === 'H' ? v.x0 + w / 2 : t.c + 0.3} y={-(t.o === 'H' ? t.c - 0.35 : v.x0 + h / 2)} fontSize={0.2} textAnchor="middle" fill="#c0c">{v.tag || '?'}</text>
          </g>;
        }))}
      </svg>
      <p className="dica">Clique numa parede para ajustar. Clique num vão (rosa ou tracejado) para dizer se é porta, janela ou vão livre.</p>
    </div>
  );
}

function Acoes({ sel, vaoSel, calc, aj, setAj, quadro, limpar }: {
  sel: { trecho: string; num?: number } | null; vaoSel: string | null; calc: { ts: Trecho[]; ps: Painel[] }; aj: Ajustes; setAj: (a: Ajustes) => void; quadro: Esquadria[]; limpar: () => void;
}) {
  const [cortes, setCortes] = useState('');
  const t = sel ? calc.ts.find(x => x.id === sel.trecho) : null;
  useEffect(() => { setCortes(t ? (aj.cortes[t.id] || []).map(v => br(v)).join('; ') : ''); }, [sel?.trecho]);
  if (vaoSel) {
    const atual = aj.vaoTipo[vaoSel];
    return <div className="card acoes"><h3>Vão</h3>
      <label>O que é este vão?<select value={atual ?? ''} onChange={e => { const v = { ...aj.vaoTipo }; if (e.target.value) v[vaoSel] = e.target.value; else delete v[vaoSel]; setAj({ ...aj, vaoTipo: v }); }}>
        <option value="">(automático pela etiqueta)</option><option value="livre">vão livre (sem painel)</option>{quadro.map(q => <option key={q.tag} value={q.tag}>{q.tag} — {br(q.larg)} × {br(q.alt)}</option>)}
      </select></label><button onClick={limpar}>Fechar</button></div>;
  }
  if (!t) return <div className="card acoes"><p>Selecione uma parede ou um vão na planta.</p></div>;
  const P = calc.ps.filter(p => p.trecho === t.id);
  const tog = (k: 'excluir' | 'juntar' | 'naoDividir') => setAj({ ...aj, [k]: aj[k].includes(t.id) ? aj[k].filter(x => x !== t.id) : [...aj[k], t.id] });
  return <div className="card acoes">
    <h3>Parede {P.map(p => p.num).join(', ')}</h3>
    <p>Comprimento {br(t.e - t.s)} m · {P.length} painel(is): {P.map(p => `${p.num} (${br(p.larg)} × ${br(p.H)})`).join(', ')}</p>
    {P.some(p => p.aviso) && <p className="erro">{P.filter(p => p.aviso).map(p => `${p.num}: ${p.aviso}`).join(' · ')}</p>}
    <button onClick={() => tog('excluir')}>Não modular esta parede (shaft, platibanda…)</button>
    <button onClick={() => tog('juntar')}>{aj.juntar.includes(t.id) ? 'Desfazer junção' : 'Juntar com a próxima parede alinhada (sem coluna)'}</button>
    <button onClick={() => tog('naoDividir')}>{aj.naoDividir.includes(t.id) ? 'Dividir automaticamente' : 'Não dividir (um painel só)'}</button>
    <label>Cortes manuais (m a partir do início, separados por ;)
      <input value={cortes} onChange={e => setCortes(e.target.value)} placeholder="ex.: 2,82" />
    </label>
    <button onClick={() => { const v = cortes.split(';').map(s => parseFloat(s.replace(',', '.'))).filter(n => isFinite(n) && n > 0); const c = { ...aj.cortes }; if (v.length) c[t.id] = v; else delete c[t.id]; setAj({ ...aj, cortes: c }); }}>Aplicar cortes</button>
    <label>Altura desta parede (m)
      <input type="number" step="0.01" defaultValue={aj.altura[t.id] ?? t.H} key={t.id} onBlur={e => { const v = parseFloat(e.target.value); const a = { ...aj.altura }; if (isFinite(v) && v > 0) a[t.id] = v; else delete a[t.id]; setAj({ ...aj, altura: a }); }} />
    </label>
    <button onClick={limpar}>Fechar</button>
  </div>;
}

function Folhas({ ativos, calc, leitura, arqDe, nome }: { ativos: Pavimento[]; calc: { ps: Painel[]; vaos: VaoInteiro[] }; leitura: NonNullable<ReturnType<typeof ler>>; arqDe: (b: Box) => Prim[]; nome: string }) {
  const folhas: JSX.Element[] = [];
  for (const pav of ativos) {
    const ps = calc.ps.filter(p => p.pav === pav.id);
    if (!ps.length) continue;
    folhas.push(<div className="folha" key={pav.id + 'p'}>
      <div className="cab">PLANTA DE MONTAGEM DAS PAREDES — {pav.nome.toUpperCase()}</div>
      <div className="desenho" dangerouslySetInnerHTML={{ __html: plantaSvg(leitura, pav, ps, calc.vaos.filter(v => v.pav === pav.id), arqDe(pav.box)) }} />
      <div className="rod"><span><b style={{ color: '#d11' }}>■</b> número do painel <b style={{ color: '#1a3fd6' }}>■</b> cota da parede (painel = cota − desconto) <b style={{ color: '#c0c' }}>■</b> porta / janela</span><span>{nome}</span></div>
    </div>);
    // vistas: até ~14 m de largura por linha, 2 linhas por folha
    let pg: Painel[][] = [[]], w = 0, linhas = 1;
    const paginas: Painel[][][] = [];
    for (const p of ps) {
      if (w + p.larg + 1.1 > 13.8) { if (linhas === 2) { paginas.push(pg); pg = [[]]; linhas = 1; } else { pg.push([]); linhas++; } w = 0; }
      pg[pg.length - 1].push(p); w += p.larg + 1.1;
    }
    paginas.push(pg);
    paginas.forEach((pgx, i) => folhas.push(<div className="folha" key={pav.id + 'v' + i}>
      <div className="cab">MODULAÇÃO DAS PAREDES — {pav.nome.toUpperCase()} — folha {i + 1}/{paginas.length}</div>
      <div className="vistas">{pgx.map((linha, j) => <div className="linha" key={j}>{linha.map(p => <div key={p.num} className="vista" style={{ flexGrow: p.larg + 1.1 }} dangerouslySetInnerHTML={{ __html: vistaSvg(p) }} />)}</div>)}</div>
      <div className="rod"><span>Recortes com acréscimo · boneca nas laterais e embaixo (retirar na obra) · medidas em metros</span><span>{nome}</span></div>
    </div>));
  }
  return <div className="folhas">{folhas}</div>;
}
