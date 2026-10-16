import { useEffect, useMemo, useState } from 'react';
import { parseDxf } from './engine/dxf.ts';
import type { Dxf, Prim } from './engine/dxf.ts';
import { ler, trechos, paineis, numerar, resumo, REGRAS_PADRAO, AJUSTES_VAZIOS } from './engine/model.ts';
import type { Ajustes, Esquadria, Pavimento, Regras, Painel, Trecho, VaoInteiro, Box, Leitura } from './engine/model.ts';
import { plantaSvg, vistaSvg, quadro as quadroDe, plantaConteudo, arqSvg, lajesConteudo, DEFS_LAJE, vigasConteudo } from './engine/draw.ts';
import { ambientes, modularLajes, numerarLajes } from './engine/lajes.ts';
import type { LajeAmb, PainelLaje } from './engine/lajes.ts';
import { lerCortes, conferir } from './engine/cortes.ts';
import { sugerirVigas } from './engine/vigas.ts';
import type { Viga } from './engine/vigas.ts';
import { exportarDxf, exportarCsv } from './engine/exportDxf.ts';
import { ZoomSvg } from './Zoom.tsx';
import * as db from './db.ts';
import * as cloud from './cloud.ts';
import type { Session } from '@supabase/supabase-js';
import { Login } from './Login.tsx';
import type { Projeto, Config } from './db.ts';

type Aba = 'arquivo' | 'pavimentos' | 'esquadrias' | 'regras' | 'modulacao' | 'lajes' | 'vigas' | 'cortes' | 'impressao';
const br = (v: number, n = 2) => v.toFixed(n).replace('.', ',');
const baixar = (nome: string, conteudo: string, tipo: string) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome; a.click();
};
interface Salvo { camada: string; pavs: Pavimento[]; quadro: Esquadria[]; regras: Regras; ajustes: Ajustes }
const chave = (n: string) => `modulacao:${n}`;
type VigaN = Viga & { n: number };
interface Calc { ts: Trecho[]; ps: Painel[]; vaos: VaoInteiro[]; lajes: LajeAmb[]; pl: PainelLaje[]; vigas: VigaN[] }

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
  const [sel, setSel] = useState<{ trecho: string } | null>(null);
  const [vaoSel, setVaoSel] = useState<string | null>(null);
  const [ambSel, setAmbSel] = useState<string | null>(null);
  const [cortando, setCortando] = useState<{ trecho: string; coluna: boolean } | null>(null);
  const [vigaSel, setVigaSel] = useState<string | null>(null);
  const [projId, setProjId] = useState<string | null>(null);
  const [projNome, setProjNome] = useState('');
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [pronto, setPronto] = useState(false);
  const [sess, setSess] = useState<Session | null>(null);
  const [checou, setChecou] = useState(!cloud.nuvemConfigurada);
  const [recuperando, setRecuperando] = useState(false);
  const [locais, setLocais] = useState<Projeto[]>([]);
  useEffect(() => {
    if (!cloud.nuvemConfigurada) return;
    cloud.sessao().then(s => { setSess(s); setChecou(true); });
    return cloud.aoMudarSessao((s, ev) => { setSess(s); if (ev === 'PASSWORD_RECOVERY') setRecuperando(true); });
  }, []);
  // na nuvem quando houver login; senão, no navegador
  const repo = cloud.nuvemConfigurada && sess ? cloud : db;
  const atualizarLista = () => repo.listar().then(setProjetos).catch(e => { setProjetos([]); setErro('Não foi possível listar os projetos: ' + (e as Error).message); });
  useEffect(() => { atualizarLista(); db.pedirPersistencia(); if (sess) db.listar().then(setLocais).catch(() => setLocais([])); }, [sess?.user.id]);
  const enviarLocais = async () => {
    setLendo(true);
    try {
      for (const l of locais) { const c = await db.carregar(l.id); if (c) { await cloud.criar(c.nome, c.arquivo, c.dxf, c.config); await db.apagar(l.id); } }
      setLocais([]); atualizarLista();
    } catch (e) { setErro('Erro ao enviar: ' + (e as Error).message); }
    setLendo(false);
  };

  const leitura = useMemo(() => (dxf ? ler(dxf, camada) : null), [dxf, camada]);

  // carrega um DXF (texto) com a configuração salva, ou monta a configuração inicial
  const carregarTexto = (txt: string, arquivo: string, cfg: Config | null) => {
    if (!/SECTION/.test(txt.slice(0, 5000))) throw new Error('O arquivo não parece um DXF. No AutoCAD use "Salvar como" > DXF.');
    const d = parseDxf(txt);
    setPronto(false);
    setDxf(d); setNome(arquivo); setSel(null); setVaoSel(null); setAmbSel(null); setCortando(null); setPavSel('');
    const cam = cfg?.camada ?? (d.layers.find(l => /parede|wall|alven/i.test(l)) || 'PAREDE');
    setCamada(cam);
    if (cfg) { setPavs(cfg.pavs); setQuadro(cfg.quadro); setRegras({ ...REGRAS_PADRAO, ...cfg.regras }); setAj({ ...AJUSTES_VAZIOS, ...cfg.ajustes }); }
    else {
      const L = ler(d, cam);
      setPavs(L.regioes.map((b, i) => ({ id: `R${i + 1}`, nome: `Desenho ${i + 1}`, box: b, altura: 2.8, ativo: false, corte: false })));
      setQuadro(L.quadro); setRegras(REGRAS_PADRAO); setAj(AJUSTES_VAZIOS);
    }
    setTimeout(() => setPronto(true), 0);
  };
  const novo = async (f: File) => {
    setLendo(true); setErro('');
    try {
      const txt = await f.text();
      // aproveita ajustes da versão antiga (salvos pelo nome do arquivo)
      const antigo = (() => { try { return JSON.parse(localStorage.getItem(chave(f.name)) || 'null') as Salvo | null; } catch { return null; } })();
      carregarTexto(txt, f.name, antigo);
      const p = await repo.criar(f.name.replace(/\.dxf$/i, ''), f.name, new Blob([txt], { type: 'application/dxf' }), antigo);
      setProjId(p.id); setProjNome(p.nome); atualizarLista();
      setAba(antigo ? 'modulacao' : 'pavimentos');
    } catch (e) { setErro((e as Error).message); }
    setLendo(false);
  };
  const abrirProjeto = async (id: string) => {
    setLendo(true); setErro('');
    try {
      const p = await repo.carregar(id); if (!p) throw new Error('Projeto não encontrado.');
      carregarTexto(await p.dxf.text(), p.arquivo, p.config);
      setProjId(p.id); setProjNome(p.nome);
      setAba(p.config && p.config.pavs.some(x => x.ativo) ? 'modulacao' : 'pavimentos');
    } catch (e) { setErro((e as Error).message); }
    setLendo(false);
  };
  // salva sozinho a cada alteração
  useEffect(() => {
    if (!projId || !pronto) return;
    const t = setTimeout(() => { repo.salvarConfig(projId, { camada, pavs, quadro, regras, ajustes: aj }).then(atualizarLista).catch(() => setErro('Não foi possível salvar o projeto. Verifique a internet.')); }, 500);
    return () => clearTimeout(t);
  }, [projId, pronto, camada, pavs, quadro, regras, aj]);
  const ativos = pavs.filter(p => p.ativo);
  const calc: Calc = useMemo(() => {
    const vazio: Calc = { ts: [], ps: [], vaos: [], lajes: [], pl: [], vigas: [] };
    if (!leitura) return vazio;
    for (const p of ativos) {
      const t = trechos(leitura, p, quadro, regras, aj);
      const r = paineis(t, regras, aj);
      vazio.ts.push(...t); vazio.ps.push(...r.paineis); vazio.vaos.push(...r.vaos);
      const m = modularLajes(ambientes(p, t), regras, aj);
      vazio.lajes.push(...m.ambs); vazio.pl.push(...m.paineis);
    }
    numerar(vazio.ps, ativos.map(p => p.id));
    numerarLajes(vazio.pl, ativos.map(p => p.id));
    vazio.vigas = sugerirVigas(ativos, vazio.ts, vazio.ps, vazio.vaos, vazio.lajes, regras).map((v, i) => ({ ...v, n: i + 1 }));
    return vazio;
  }, [leitura, pavs, quadro, regras, aj]);

  const cortes = useMemo(() => dxf ? lerCortes(dxf, pavs.filter(p => p.corte)) : [], [dxf, pavs]);
  const avisos = useMemo(() => conferir(cortes, ativos, quadro, regras, calc.ps), [cortes, pavs, quadro, regras, calc]);

  const arqDe = (box: Box): Prim[] => leitura ? leitura.prims.filter(p => p.pts.every(q => q[0] > box.x0 - 0.6 && q[0] < box.x1 + 0.6 && q[1] > box.y0 - 0.6 && q[1] < box.y1 + 0.6)) : [];
  const pavAtual = ativos.find(p => p.id === pavSel) || ativos[0];

  if (cloud.nuvemConfigurada && (!checou || !sess || recuperando)) return <Login carregando={!checou} recuperando={recuperando} fimRecuperacao={() => setRecuperando(false)} />;
  const tabs: [Aba, string][] = [['arquivo', '1. Arquivo'], ['pavimentos', '2. Desenhos'], ['esquadrias', '3. Portas e janelas'], ['regras', '4. Regras'], ['modulacao', '5. Paredes'], ['lajes', '6. Lajes'], ['vigas', '7. Vigas'], ['cortes', '8. Cortes'], ['impressao', '9. Impressão e arquivos']];
  const erros = avisos.filter(a => a.nivel === 'erro').length;
  return (
    <div className="app">
      <header className="topo noprint">
        <h1>Alveolar Modulação</h1>
        <span className="arq">{projNome ? `${projNome} · salvo automaticamente` : 'nenhum projeto aberto'}</span>
        {calc.ps.length > 0 && <Resumo ps={calc.ps} pl={calc.pl} />}
        {sess && <span className="usuario">{sess.user.email} <button onClick={() => { cloud.sair(); setProjId(null); setDxf(null); setNome(''); setProjNome(''); setAba('arquivo'); }}>Sair</button></span>}
      </header>
      <nav className="abas noprint">{tabs.map(([k, t]) => <button key={k} className={aba === k ? 'on' : ''} disabled={k !== 'arquivo' && !dxf} onClick={() => setAba(k)}>{t}{k === 'cortes' && erros > 0 ? ` (${erros})` : ''}</button>)}</nav>
      <main>
        {aba === 'arquivo' && (
          <>
          <section className="card">
            <h2>Novo projeto</h2>
            <p>Envie o projeto em <b>DXF</b> (no AutoCAD: <i>Salvar como → DXF</i>). {sess ? 'O arquivo e todos os ajustes ficam salvos na sua conta, na nuvem.' : 'O arquivo e todos os ajustes ficam salvos neste navegador.'}</p>
            <input type="file" accept=".dxf" onChange={e => { const f = e.target.files?.[0]; if (f) novo(f); e.target.value = ''; }} />
            {lendo && <p>Lendo o arquivo…</p>}
            {erro && <p className="erro">{erro}</p>}
            {dxf && <div className="campo"><label>Camada das paredes do projeto aberto</label>
              <select value={camada} onChange={e => setCamada(e.target.value)}>{dxf.layers.map(l => <option key={l}>{l}</option>)}</select>
              <small>{leitura?.paredes.length} linhas nessa camada · {leitura?.regioes.length} desenhos encontrados</small></div>}
          </section>
          <section className="card">
            <h2>Meus projetos</h2>
            {projetos.length === 0 ? <p className="dica">Nenhum projeto salvo ainda.</p> :
            <table className="tab projetos"><thead><tr><th>Projeto</th><th>Arquivo</th><th>Atualizado</th><th></th></tr></thead><tbody>
              {projetos.map(p => <tr key={p.id} className={p.id === projId ? 'atual' : ''}>
                <td><input defaultValue={p.nome} onBlur={e => { const v = e.target.value.trim(); if (v && v !== p.nome) { repo.renomear(p.id, v).then(atualizarLista); if (p.id === projId) setProjNome(v); } }} /></td>
                <td className="dica">{p.arquivo}</td>
                <td className="dica">{new Date(p.atualizado).toLocaleString('pt-BR')}</td>
                <td className="botoes">
                  <button onClick={() => abrirProjeto(p.id)}>{p.id === projId ? 'Aberto' : 'Abrir'}</button>
                  <button onClick={async () => { const c = await repo.carregar(p.id); const bl = c ? new Blob([JSON.stringify({ formato: 'alveolar-modulacao', versao: 1, nome: c.nome, arquivo: c.arquivo, config: c.config, dxf: await c.dxf.text() })], { type: 'application/json' }) : null; if (bl) { const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = p.nome + '.modulacao.json'; a.click(); } }}>Baixar cópia</button>
                  <button onClick={async () => { if (confirm(`Apagar o projeto "${p.nome}"? Isso não pode ser desfeito.`)) { await repo.apagar(p.id); if (p.id === projId) { setProjId(null); setDxf(null); setNome(''); } atualizarLista(); } }}>Apagar</button>
                </td></tr>)}
            </tbody></table>}
            <label className="botao">Abrir cópia de projeto (.json)<input type="file" accept=".json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (j.formato !== 'alveolar-modulacao' || !j.dxf) throw new Error('Arquivo de projeto inválido.'); const p = await repo.criar(j.nome, j.arquivo, new Blob([j.dxf], { type: 'application/dxf' }), j.config ?? null); await atualizarLista(); abrirProjeto(p.id); } catch (er) { setErro((er as Error).message); } e.target.value = ''; }} /></label>
            <p className="dica">{sess ? 'Os projetos ficam salvos na nuvem: entre com o mesmo e-mail em qualquer computador ou celular.' : 'Os projetos ficam guardados neste navegador e neste computador. Para usar em outro computador, use "Baixar cópia" e depois "Abrir cópia de projeto".'}</p>
            {sess && locais.length > 0 && <div className="aviso-local">Há {locais.length} projeto(s) salvo(s) só neste computador ({locais.map(l => l.nome).join(', ')}). <button onClick={enviarLocais} disabled={lendo}>Enviar para a nuvem</button></div>}
          </section>
          </>
        )}

        {aba === 'pavimentos' && leitura && (
          <section className="card">
            <h2>O que é cada desenho</h2>
            <p>Para cada desenho com paredes, diga se é uma <b>planta baixa</b> (vai ser modulada), um <b>corte</b> (usado para conferir alturas) ou se não deve ser usado. Nas plantas, informe o nome e o pé-direito. A ordem da lista é a ordem da numeração.</p>
            <div className="regioes">
              {pavs.map((p, i) => (
                <div key={p.id} className={'regiao' + (p.ativo ? ' on' : p.corte ? ' corte' : '')}>
                  <Miniatura prims={leitura.paredes} box={p.box} />
                  <select value={p.ativo ? 'planta' : p.corte ? 'corte' : 'nao'} onChange={e => setPavs(pavs.map(q => q.id === p.id ? { ...q, ativo: e.target.value === 'planta', corte: e.target.value === 'corte' } : q))}>
                    <option value="nao">Não usar</option><option value="planta">Planta baixa (modular)</option><option value="corte">Corte (conferir alturas)</option>
                  </select>
                  <input value={p.nome} onChange={e => setPavs(pavs.map(q => q.id === p.id ? { ...q, nome: e.target.value } : q))} />
                  {p.ativo && <label>Pé-direito (m) <input type="number" step="0.01" value={p.altura} onChange={e => setPavs(pavs.map(q => q.id === p.id ? { ...q, altura: parseFloat(e.target.value) || 0 } : q))} /></label>}
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
            <p>Lido do quadro de aberturas do projeto. Confira e corrija. Medidas do <b>vão do projeto</b> em metros; o sistema acrescenta a folga dos recortes. Portas começam com <b>P</b>, janelas com <b>J</b>.</p>
            <table className="tab"><thead><tr><th>Código</th><th>Largura</th><th>Altura</th><th>Peitoril</th><th>Recorte no painel</th><th></th></tr></thead><tbody>
              {quadro.map((q, i) => {
                const jan = q.tag.startsWith('J');
                const rec = jan ? `${br(q.larg + regras.acrescimoLargura)} × ${br(q.alt + 2 * regras.janelaDesce)} · de ${br(q.peit - regras.janelaDesce)} a ${br(q.peit + q.alt + regras.janelaDesce)}`
                  : `${br(q.larg + regras.acrescimoLargura)} × ${br(q.alt)} · boneca ${br(regras.boneca)} + ${br(q.alt)} = ${br(regras.boneca + q.alt)}`;
                return <tr key={i}>
                  <td><input value={q.tag} onChange={e => setQuadro(quadro.map((x, j) => j === i ? { ...x, tag: e.target.value.toUpperCase() } : x))} /></td>
                  {(['larg', 'alt', 'peit'] as const).map(k => <td key={k}><input type="number" step="0.01" value={q[k]} disabled={k === 'peit' && !jan} onChange={e => setQuadro(quadro.map((x, j) => j === i ? { ...x, [k]: parseFloat(e.target.value) || 0 } : x))} /></td>)}
                  <td className="dica">{rec}</td>
                  <td><button onClick={() => setQuadro(quadro.filter((_, j) => j !== i))}>remover</button></td>
                </tr>;
              })}
            </tbody></table>
            <button onClick={() => setQuadro([...quadro, { tag: 'P0' + (quadro.length + 1), larg: 0.8, alt: 2.1, peit: 0 }])}>+ adicionar</button>
            <p className="dica">Etiquetas encontradas nas plantas: {[...new Set(leitura?.tags.map(t => t.text))].join(', ') || 'nenhuma'}</p>
          </section>
        )}

        {aba === 'regras' && (
          <section className="card">
            <h2>Regras</h2>
            <h3>Paredes</h3>
            <div className="grade">
              {([
                ['larguraMax', 'Largura máxima do painel (m)'], ['coluna', 'Coluna entre painéis (m)'], ['folga', 'Diminuir de cada painel (m)'],
                ['boneca', 'Boneca de transporte nas laterais e embaixo (m)'], ['acrescimoLargura', 'Vão de porta/janela maior em (m)'],
                ['janelaDesce', 'Janela: recorte desce e sobe (m)'], ['espMin', 'Espessura mínima de parede (m)'], ['espMax', 'Espessura máxima de parede (m)'],
                ['minParede', 'Trecho mínimo de parede (m)'], ['naoFabricar', 'Marcar "n fabricar" abaixo de (m)'],
              ] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={regras[k] as number} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
              <label className="chk"><input type="checkbox" checked={regras.pinarAuto} onChange={e => setRegras({ ...regras, pinarAuto: e.target.checked })} /> No encontro em T, pinar a parede que chega e deixar a parede contínua sem emenda quando ela couber num painel só</label>
            </div>
            <h3>Lajes</h3>
            <div className="grade">
              {([['lajeComp', 'Comprimento máximo do painel (m)'], ['lajeLarg', 'Largura máxima do painel (m)'], ['lajeApoio', 'Apoio em cima de cada parede (m)'], ['lajeEsp', 'Espessura da laje (m)']] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={regras[k] as number} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
            </div>
            <h3>Vigas</h3>
            <div className="grade">
              {([['vigaAltura', 'Altura da viga (rebaixo nas paredes) (m)'], ['vigaLargura', 'Largura da viga (m)'], ['vigaApoio', 'Apoio da viga em cima da parede (m)'], ['vaoViga', 'Vão sem parede a partir do qual a viga é obrigatória (m)']] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={regras[k] as number} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
            </div>
            <ul className="dica">
              <li>Paredes acima da largura máxima são divididas em partes iguais, com coluna entre elas. No T, a coluna fica só na parede que segue alinhada (ou nenhuma, se a parede for pinada).</li>
              <li>Porta: boneca embaixo + altura do quadro (0,10 + 2,10 = 2,20). Janela: o peitoril baixa e o topo sobe pelo valor acima. Largura sempre maior pelo acréscimo.</li>
              <li>Boneca nas laterais de toda porta/janela que chega no fim da parede, e embaixo das portas.</li>
              <li>Laje: o painel vence o menor vão entre paredes e entra o apoio em cima de cada uma. A largura é dividida em partes iguais até a largura máxima.</li>
            </ul>
            <button onClick={() => setRegras(REGRAS_PADRAO)}>Voltar ao padrão</button>
          </section>
        )}

        {(aba === 'modulacao' || aba === 'lajes') && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta baixa na aba Desenhos.</p></section> :
          <section className="mod">
            <div className="lado">
              <div className="pavsel">{ativos.map(p => <button key={p.id} className={pavAtual.id === p.id ? 'on' : ''} onClick={() => { setPavSel(p.id); setSel(null); setVaoSel(null); setAmbSel(null); }}>{p.nome}</button>)}</div>
              {aba === 'modulacao'
                ? <Acoes sel={sel} vaoSel={vaoSel} calc={calc} aj={aj} setAj={setAj} quadro={quadro} regras={regras} cortando={cortando} setCortando={setCortando} limpar={() => { setSel(null); setVaoSel(null); setCortando(null); }} />
                : <AcoesLaje amb={calc.lajes.find(a => a.id === ambSel) || null} calc={calc} aj={aj} setAj={setAj} pav={pavAtual} />}
              <details><summary>Desfazer ajustes</summary>
                <button onClick={() => { if (confirm('Apagar todos os ajustes manuais deste projeto?')) setAj(AJUSTES_VAZIOS); }}>Apagar todos os ajustes</button>
              </details>
            </div>
            {aba === 'modulacao'
              ? <PlantaParedes L={leitura} pav={pavAtual} calc={calc} arq={arqDe(pavAtual.box)} sel={sel} vaoSel={vaoSel} cortando={cortando}
                  onCorte={(t, along) => { const tr = calc.ts.find(x => x.id === t); if (!tr || !cortando) return; const d = Math.round((along - tr.s) * 100) / 100; const k = cortando.coluna ? 'colunas' : 'cortes'; const m = { ...(aj[k] || {}) }; m[t] = [...(m[t] || []), d].sort((a, b) => a - b); setAj({ ...aj, [k]: m }); setCortando(null); }}
                  onPainel={t => { setSel({ trecho: t }); setVaoSel(null); }} onVao={k => { setVaoSel(k); setSel(null); setCortando(null); }} />
              : <PlantaLajes pav={pavAtual} calc={calc} arq={arqDe(pavAtual.box)} ambSel={ambSel} onAmb={setAmbSel} />}
          </section>
        )}

        {aba === 'vigas' && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta baixa na aba Desenhos.</p></section> :
          <section className="mod">
            <div className="lado">
              <div className="pavsel">{ativos.map(p => <button key={p.id} className={pavAtual.id === p.id ? 'on' : ''} onClick={() => { setPavSel(p.id); setVigaSel(null); }}>{p.nome}</button>)}</div>
              <ListaVigas V={calc.vigas.filter(v => v.pav === pavAtual.id)} sel={vigaSel} onSel={setVigaSel} />
            </div>
            <div className="planta">
              <ZoomSvg vb={quadroDe(pavAtual).vb}>
                <g dangerouslySetInnerHTML={{ __html: plantaConteudo(leitura, pavAtual, calc.ps.filter(p => p.pav === pavAtual.id), [], arqDe(pavAtual.box), quadroDe(pavAtual)) + vigasConteudo(calc.vigas.filter(v => v.pav === pavAtual.id), quadroDe(pavAtual), vigaSel) }} />
              </ZoomSvg>
              <p className="dica">Vigas sugeridas na estrutura sobre este pavimento (abaixo da laje). Vermelho = obrigatória · laranja = recomendada · verde = selecionada. Sugestões para o engenheiro conferir e dimensionar.</p>
            </div>
          </section>
        )}

        {aba === 'cortes' && (
          <section className="card">
            <h2>Conferência com os cortes</h2>
            <p>Marque os cortes na aba Desenhos. O sistema lê as cotas verticais e confere com os pés-direitos, a espessura da laje e as alturas de portas e janelas.</p>
            <ul className="avisos">{avisos.map((a, i) => <li key={i} className={a.nivel}>{a.nivel === 'ok' ? '✔' : a.nivel === 'erro' ? '✖' : '!'} {a.msg}</li>)}</ul>
            {cortes.map(c => <div key={c.id}><h3>{c.nome}</h3>
              <p className="dica">Cotas verticais (de baixo para cima):</p>
              <ul>{c.pilhas.filter(p => p.cotas.length > 1 || p.cotas[0].valor > 1).map((p, i) => <li key={i}>{p.cotas.map(k => br(k.valor)).join(' → ')}</li>)}</ul>
            </div>)}
            <p className="dica">A conferência compara alturas. Interferências que só aparecem em 3D (viga passando por recorte, tubulação) ainda precisam ser vistas no corte.</p>
          </section>
        )}

        {aba === 'impressao' && leitura && (
          <section>
            <div className="card noprint">
              <h2>Impressão e arquivos</h2>
              <p>As folhas abaixo saem em <b>A4 deitado</b>. Use <i>Imprimir → Salvar como PDF</i>.</p>
              <div className="botoes">
                <button onClick={() => window.print()}>Imprimir / salvar PDF</button>
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-modulacao.dxf', exportarDxf(ativos, calc.ps, calc.pl), 'application/dxf')}>Baixar DXF da modulação</button>
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-paineis.csv', exportarCsv(calc.ps, ativos, calc.pl), 'text/csv')}>Baixar lista de painéis (CSV)</button>
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

function Resumo({ ps, pl }: { ps: Painel[]; pl: PainelLaje[] }) {
  const r = resumo(ps);
  const al = pl.reduce((s, p) => s + p.comp * p.larg, 0);
  return <span className="resumo">Paredes: {r.qtd} painéis · {br(r.bruta)} m² · Lajes: {pl.length} painéis · {br(al)} m² · Total {br(r.bruta + al)} m²</span>;
}

function Miniatura({ prims, box }: { prims: Prim[]; box: Box }) {
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  const ps = prims.filter(p => p.pts.every(q => q[0] >= box.x0 - 0.1 && q[0] <= box.x1 + 0.1 && q[1] >= box.y0 - 0.1 && q[1] <= box.y1 + 0.1));
  return <svg viewBox={`${box.x0} ${-box.y1} ${w} ${h}`} className="mini">{ps.map((p, i) => <polyline key={i} points={p.pts.map(q => `${q[0]},${-q[1]}`).join(' ')} fill="none" stroke="#333" strokeWidth={w / 300} />)}</svg>;
}

// tela de paredes no layout da planta baixa, com áreas clicáveis por cima
function PlantaParedes({ L, pav, calc, arq, sel, vaoSel, cortando, onCorte, onPainel, onVao }: {
  L: Leitura; pav: Pavimento; calc: Calc; arq: Prim[]; sel: { trecho: string } | null; vaoSel: string | null;
  cortando: { trecho: string; coluna: boolean } | null; onCorte: (t: string, along: number) => void; onPainel: (t: string) => void; onVao: (k: string) => void;
}) {
  const q = quadroDe(pav);
  const ps = calc.ps.filter(p => p.pav === pav.id), ts = calc.ts.filter(t => t.pav === pav.id);
  const base = useMemo(() => plantaConteudo(L, pav, ps, calc.vaos.filter(v => v.pav === pav.id), arq, q), [L, pav, calc, arq]);
  return (
    <div className="planta">
      <ZoomSvg vb={q.vb}>
        <g dangerouslySetInnerHTML={{ __html: base }} />
        {ps.map(p => {
          const on = sel?.trecho === p.trecho;
          const [x1, y1, x2, y2] = p.o === 'H' ? [p.a, p.c, p.a + p.larg, p.c] : [p.c, p.a, p.c, p.a + p.larg];
          return <line key={p.num} className="hit" x1={q.X(x1)} y1={q.Y(y1)} x2={q.X(x2)} y2={q.Y(y2)} stroke={on ? 'rgba(230,0,0,.55)' : 'transparent'} strokeWidth={26}
            onClick={e => {
              if (cortando && cortando.trecho === p.trecho) {
                const svg = (e.target as SVGElement).ownerSVGElement!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
                const v = pt.matrixTransform(svg.getScreenCTM()!.inverse());
                onCorte(p.trecho, p.o === 'H' ? q.iX(v.x) : q.iY(v.y));
              } else onPainel(p.trecho);
            }}><title>Painel {p.num} · {br(p.larg)} × {br(p.H)}</title></line>;
        })}
        {ts.flatMap(t => t.vaos.map(v => {
          const key = `${t.id}@${((v.a + v.b) / 2).toFixed(2)}`;
          const [x, y, w, h] = t.o === 'H' ? [v.x0, t.c - 0.13, v.x1 - v.x0, 0.26] : [t.c - 0.13, v.x0, 0.26, v.x1 - v.x0];
          const on = vaoSel === key;
          return <rect key={key} className="hit" x={q.X(x)} y={q.Y(y + h)} width={w * q.k} height={h * q.k} fill={on ? 'rgba(204,0,204,.35)' : v.tag ? 'rgba(204,0,204,.08)' : 'rgba(255,170,0,.25)'} stroke={v.tag ? '#c0c' : '#e80'} strokeWidth={2} strokeDasharray={v.tag ? '' : '8 5'} onClick={() => onVao(key)}><title>{v.tag ? `${v.tag}` : 'vão sem etiqueta — clique para definir'}</title></rect>;
        }))}
      </ZoomSvg>
      <p className="dica">{cortando ? 'Clique no ponto da parede selecionada onde ela deve ser dividida.' : 'Roda do mouse ou + / − para zoom, arraste para mover. Clique numa parede para ajustar. Os vãos em laranja não têm etiqueta no projeto: clique para dizer se é porta, janela ou vão livre.'}</p>
    </div>
  );
}

function PlantaLajes({ pav, calc, arq, ambSel, onAmb }: { pav: Pavimento; calc: Calc; arq: Prim[]; ambSel: string | null; onAmb: (id: string) => void }) {
  const q = quadroDe(pav);
  const lj = calc.lajes.filter(a => a.pav === pav.id), P = calc.pl.filter(p => p.pav === pav.id);
  return (
    <div className="planta">
      <ZoomSvg vb={q.vb}>
        <g dangerouslySetInnerHTML={{ __html: DEFS_LAJE + arqSvg(q, arq) + lajesConteudo(lj, P, q) }} />
        {lj.map(a => <rect key={a.id} className="hit" x={q.X(a.x0)} y={q.Y(a.y1)} width={(a.x1 - a.x0) * q.k} height={(a.y1 - a.y0) * q.k} fill={ambSel === a.id ? 'rgba(230,0,0,.12)' : 'transparent'} stroke={a.aviso ? '#e80' : 'transparent'} strokeWidth={a.aviso ? 4 : 0} onClick={() => onAmb(a.id)}><title>{a.aviso || 'clique para ajustar'}</title></rect>)}
      </ZoomSvg>
      <p className="dica">Laje sobre este pavimento. Clique num ambiente para tirar a laje (vazio, área externa) ou girar o sentido dos painéis. Contorno laranja = precisa de atenção.</p>
    </div>
  );
}

function ListaVigas({ V, sel, onSel }: { V: VigaN[]; sel: string | null; onSel: (id: string) => void }) {
  if (!V.length) return <div className="card acoes"><p>Nenhuma viga necessária neste pavimento pelas regras atuais.</p></div>;
  const reb = V.flatMap(v => v.rebaixos);
  return <div className="card acoes vigas">
    <h3>{V.length} viga(s) sugerida(s) · {V.filter(v => v.obrigatoria).length} obrigatória(s)</h3>
    {reb.length > 0 && <p className="erro">Paredes que diminuem de altura: {[...new Map(reb.map(r => [r.painel, r])).values()].sort((a, b) => a.painel - b.painel).map(r => `${r.painel} (${br(r.de)} → ${br(r.para)})`).join(', ')}</p>}
    {V.map(v => <div key={v.id} className={'viga' + (sel === v.id ? ' on' : '') + (v.obrigatoria ? ' obrig' : '')} onClick={() => onSel(v.id)}>
      <b>V{v.n}</b> {v.obrigatoria ? '· obrigatória' : '· recomendada'} · {br(v.b - v.a)} m
      <div>{v.motivo}</div>
      <div className="dica">Ideia: {v.ideia}</div>
      {v.rebaixos.length > 0 && <div className="dica">Paredes rebaixadas: {v.rebaixos.map(r => `${r.painel} (${br(r.de)} → ${br(r.para)})`).join(', ')}</div>}
    </div>)}
  </div>;
}

function Acoes({ sel, vaoSel, calc, aj, setAj, quadro, regras, cortando, setCortando, limpar }: {
  sel: { trecho: string } | null; vaoSel: string | null; calc: Calc; aj: Ajustes; setAj: (a: Ajustes) => void; quadro: Esquadria[]; regras: Regras;
  cortando: { trecho: string; coluna: boolean } | null; setCortando: (c: { trecho: string; coluna: boolean } | null) => void; limpar: () => void;
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
  if (!t) return <div className="card acoes"><p>Clique numa parede ou num vão na planta.</p></div>;
  const P = calc.ps.filter(p => p.trecho === t.id);
  const tog = (k: 'excluir' | 'juntar' | 'naoDividir' | 'naoPinar') => setAj({ ...aj, [k]: (aj[k] || []).includes(t.id) ? (aj[k] || []).filter(x => x !== t.id) : [...(aj[k] || []), t.id] });
  return <div className="card acoes">
    <h3>Parede {P.map(p => p.num).join(', ')}</h3>
    <p>Comprimento {br(t.e - t.s)} m · espessura {br(t.esp)} m{t.pinado ? ' · pinada (sem emenda)' : ''}<br />{P.map(p => `${p.num}: ${br(p.larg)} × ${br(p.H)}`).join(' · ')}</p>
    {P.some(p => p.aviso) && <p className="erro">{P.filter(p => p.aviso).map(p => `${p.num}: ${p.aviso}`).join(' · ')}</p>}
    <button onClick={() => tog('excluir')}>Não modular esta parede (shaft, platibanda, torre…)</button>
    <button onClick={() => tog('juntar')}>{aj.juntar.includes(t.id) ? 'Desfazer pinagem/junção' : 'Pinar no T: passar direto pela próxima parede (sem coluna, sem emenda)'}</button>
    {regras.pinarAuto && <button onClick={() => tog('naoPinar')}>{(aj.naoPinar || []).includes(t.id) ? 'Permitir pinagem automática' : 'Não pinar automaticamente aqui'}</button>}
    <button onClick={() => tog('naoDividir')}>{aj.naoDividir.includes(t.id) ? 'Dividir automaticamente' : 'Não dividir (um painel só)'}</button>
    <h3>Dividir a parede</h3>
    <button className={cortando?.trecho === t.id && !cortando.coluna ? 'on' : ''} onClick={() => setCortando(cortando?.trecho === t.id && !cortando.coluna ? null : { trecho: t.id, coluna: false })}>Dividir clicando na planta — sem coluna (emenda)</button>
    <button className={cortando?.trecho === t.id && cortando.coluna ? 'on' : ''} onClick={() => setCortando(cortando?.trecho === t.id && cortando.coluna ? null : { trecho: t.id, coluna: true })}>Dividir clicando na planta — com coluna de {br(regras.coluna)} m</button>
    {[...(aj.cortes[t.id] || []).map(d => ({ d, k: 'cortes' as const })), ...((aj.colunas || {})[t.id] || []).map(d => ({ d, k: 'colunas' as const }))].sort((a, b) => a.d - b.d).map(c =>
      <div key={c.k + c.d} className="corte-item">a {br(c.d)} m do início · {c.k === 'colunas' ? 'com coluna' : 'sem coluna'}
        <button onClick={() => { const m = { ...(aj[c.k] || {}) }; m[t.id] = (m[t.id] || []).filter(x => x !== c.d); if (!m[t.id].length) delete m[t.id]; setAj({ ...aj, [c.k]: m }); }}>remover</button></div>)}
    <label>Ou digite as distâncias a partir do início (m, separadas por ;)
      <input value={cortes} onChange={e => setCortes(e.target.value)} placeholder="ex.: 2,82" />
    </label>
    <button onClick={() => { const v = cortes.split(';').map(s => parseFloat(s.replace(',', '.'))).filter(n => isFinite(n) && n > 0); const c = { ...aj.cortes }; if (v.length) c[t.id] = v; else delete c[t.id]; setAj({ ...aj, cortes: c }); }}>Aplicar (sem coluna)</button>
    <label>Altura desta parede (m)
      <input type="number" step="0.01" defaultValue={aj.altura[t.id] ?? t.H} key={t.id} onBlur={e => { const v = parseFloat(e.target.value); const a = { ...aj.altura }; if (isFinite(v) && v > 0) a[t.id] = v; else delete a[t.id]; setAj({ ...aj, altura: a }); }} />
    </label>
    <button onClick={limpar}>Fechar</button>
  </div>;
}

function AcoesLaje({ amb, calc, aj, setAj, pav }: { amb: LajeAmb | null; calc: Calc; aj: Ajustes; setAj: (a: Ajustes) => void; pav: Pavimento }) {
  const lj = calc.lajes.filter(a => a.pav === pav.id && a.incluida), P = calc.pl.filter(p => p.pav === pav.id);
  const area = P.reduce((s, p) => s + p.comp * p.larg, 0);
  const tog = (k: 'lajeFora' | 'lajeGiro', id: string) => setAj({ ...aj, [k]: (aj[k] || []).includes(id) ? (aj[k] || []).filter(x => x !== id) : [...(aj[k] || []), id] });
  return <div className="card acoes">
    <h3>Laje sobre {pav.nome}</h3>
    <p>{P.length} painéis · {br(area)} m² · {lj.length} ambientes</p>
    {lj.filter(a => a.aviso).map(a => <p key={a.id} className="erro">{a.aviso}</p>)}
    {amb ? <>
      <h3>Ambiente selecionado</h3>
      <p>{br(amb.x1 - amb.x0)} × {br(amb.y1 - amb.y0)} m (eixos) · vão {br(amb.vao)} m</p>
      {P.filter(p => p.amb === amb.id).map(p => <div key={p.num} className="dica">L{p.num}: {br(p.comp)} × {br(p.larg)}</div>)}
      <button onClick={() => tog('lajeFora', amb.id)}>{(aj.lajeFora || []).includes(amb.id) ? 'Colocar laje neste ambiente' : 'Sem laje aqui (vazio, área externa)'}</button>
      <button onClick={() => tog('lajeGiro', amb.id)}>Girar o sentido dos painéis</button>
    </> : <p className="dica">Clique num ambiente na planta.</p>}
  </div>;
}

function Folhas({ ativos, calc, leitura, arqDe, nome }: { ativos: Pavimento[]; calc: Calc; leitura: Leitura; arqDe: (b: Box) => Prim[]; nome: string }) {
  const folhas: JSX.Element[] = [];
  const rod = (t: string) => <div className="rod"><span>{t}</span><span>{nome}</span></div>;
  for (const pav of ativos) {
    const ps = calc.ps.filter(p => p.pav === pav.id);
    if (!ps.length) continue;
    folhas.push(<div className="folha" key={pav.id + 'p'}>
      <div className="cab">PLANTA DE MONTAGEM DAS PAREDES — {pav.nome.toUpperCase()}</div>
      <div className="desenho" dangerouslySetInnerHTML={{ __html: plantaSvg(leitura, pav, ps, calc.vaos.filter(v => v.pav === pav.id), arqDe(pav.box)) }} />
      {rod('■ vermelho: número do painel · azul: cota da parede (painel = cota − desconto) · rosa: porta / janela')}
    </div>);
    let pg: Painel[][] = [[]], w = 0, linhas = 1;
    const paginas: Painel[][][] = [];
    for (const p of ps) {
      if (w + p.larg + 1.1 > 13.8) { if (linhas === 2) { paginas.push(pg); pg = [[]]; linhas = 1; } else { pg.push([]); linhas++; } w = 0; }
      pg[pg.length - 1].push(p); w += p.larg + 1.1;
    }
    paginas.push(pg);
    paginas.forEach((pgx, i) => folhas.push(<div className="folha" key={pav.id + 'v' + i}>
      <div className="cab">MODULAÇÃO DAS PAREDES — {pav.nome.toUpperCase()} — folha {i + 1}/{paginas.length}</div>
      <div className="vistas">{pgx.map((linha, j) => <div className="linha" key={j}>{linha.map(p => <div key={p.num} className="vista" dangerouslySetInnerHTML={{ __html: vistaSvg(p) }} />)}</div>)}</div>
      {rod('Vãos de portas e janelas maiores pelo acréscimo · boneca nas laterais e embaixo (retirar na obra) · medidas em metros')}
    </div>));
    const VG = calc.vigas.filter(v => v.pav === pav.id);
    if (VG.length) {
      const q = quadroDe(pav);
      folhas.push(<div className="folha" key={pav.id + 'g'}>
        <div className="cab">VIGAS SUGERIDAS — {pav.nome.toUpperCase()}</div>
        <div className="desenho lajes"><svg viewBox={q.vb} dangerouslySetInnerHTML={{ __html: arqSvg(q, arqDe(pav.box)) + vigasConteudo(VG, q) }} />
          <div className="tvigas">{VG.map(v => <p key={v.id}><b>V{v.n}</b> ({v.obrigatoria ? 'obrigatória' : 'recomendada'}, {br(v.b - v.a)} m): {v.motivo} <i>{v.ideia}</i>{v.rebaixos.length ? ` Rebaixo: ${v.rebaixos.map(r => `${r.painel} (${br(r.de)}→${br(r.para)})`).join(', ')}.` : ''}</p>)}</div></div>
        {rod('Sugestões para o engenheiro conferir e dimensionar · vermelho = obrigatória · laranja = recomendada')}
      </div>);
    }
    const P = calc.pl.filter(p => p.pav === pav.id);
    if (P.length) {
      const q = quadroDe(pav);
      folhas.push(<div className="folha" key={pav.id + 'l'}>
        <div className="cab">MODULAÇÃO DA LAJE SOBRE O {pav.nome.toUpperCase()}</div>
        <div className="desenho lajes"><svg viewBox={q.vb} dangerouslySetInnerHTML={{ __html: DEFS_LAJE + arqSvg(q, arqDe(pav.box)) + lajesConteudo(calc.lajes.filter(a => a.pav === pav.id), P, q) }} />
          <table className="tlaje"><thead><tr><th>Painel</th><th>Comp.</th><th>Larg.</th><th>m²</th></tr></thead><tbody>
            {P.map(p => <tr key={p.num}><td>L{p.num}</td><td>{br(p.comp)}</td><td>{br(p.larg)}</td><td>{br(p.comp * p.larg)}</td></tr>)}
            <tr className="tot"><td>Total</td><td></td><td></td><td>{br(P.reduce((s, p) => s + p.comp * p.larg, 0))}</td></tr>
          </tbody></table></div>
        {rod('Comprimento = vão + apoio em cima de cada parede · seta = sentido do vão · tracejado laranja = viga sugerida (conferir)')}
      </div>);
    }
  }
  return <div className="folhas">{folhas}</div>;
}
