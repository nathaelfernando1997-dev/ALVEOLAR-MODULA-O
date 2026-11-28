import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDxf } from './engine/dxf.ts';
import type { Dxf, Prim } from './engine/dxf.ts';
import { areaPainel, larguraMaxDe, meiaEncontro, aplicarTelhado, somaAltura, ler, camadaDasParedes, trechos, paineis, numerar, chaveNumParede, resumo, continuarVaos, quantitativos, orcamentoAreas, regrasDoSalvo, REGRAS_PADRAO, AJUSTES_VAZIOS } from './engine/model.ts';
import type { Ajustes, Esquadria, Pavimento, Regras, Painel, Trecho, VaoInteiro, Box, Leitura } from './engine/model.ts';
import { vistaSvg, vistaLajeSvg, extraVistaLaje, quadro as quadroDe, plantaConteudo, arqSvg, semLetras, lajesConteudo, DEFS_LAJE, vigasConteudo, sequenciaConteudo, escorasConteudo, detalhesSvg, AMBIENTE_RE } from './engine/draw.ts';
import type { InfoVista } from './engine/draw.ts';
import { gerarIfc } from './engine/ifc.ts';
const Vista3D = lazy(() => import('./Vista3D.tsx'));
import type { InfoPeca, Props3D } from './Vista3D.tsx';
import { siglas, codigoParede, codigoLaje, vizinhos, faceDaVista, ordemMontagem, pesoParede, pesoLaje, planoCarga, escoras, conferencia, paredesIguais, lajesIguais, planoCorte, isoporDaPeca, planoMesas } from './engine/producao.ts';
import { ambientes, modularLajes, numerarLajes, chaveNumLaje, vaziosDeCima, escadas, escadasContorno, segsEscada, circsEscada, type Escada, areaLaje, caixaDoPonto, guardaCorpos, areaConstruida } from './engine/lajes.ts';
import type { LajeAmb, PainelLaje } from './engine/lajes.ts';
import { lerCortes, conferir, detectarPes, adivinharPapeis } from './engine/cortes.ts';
import { sugerirVigas, cargasDeCima, trelicasNasLajes, alinhar, encaixeManual } from './engine/vigas.ts';
import type { Viga, TrelicaPainel } from './engine/vigas.ts';
import { gerarProposta } from './engine/proposta.ts';
import { numeroPorExtenso, reaisPorExtenso } from './engine/extenso.ts';
import { exportarDxf, exportarCsv } from './engine/exportDxf.ts';
import { pontosFundacao, blocosDivisa, dxfFundacao, csvFundacao, locacao, dxfLocacao, csvLocacao, svgLocacao, esperasPaineis, dxfEsperas, csvEsperas, BLOCO_PADRAO, quantBloco, pesoBitola, ESTACA_PADRAO, quantEstaca, fundacaoTecnico, dxfFundacaoDetalhe } from './engine/fundacao.ts';
import { SOLOS, TIPOS_ESTACA, FUND_VAZIA, resumo as resumoCap, lerNs } from './engine/sondagem.ts';
import type { DadosFund, Solo, Furo } from './engine/sondagem.ts';
import { cargasFundacao, cargaAlavanca, CARGA_PAV } from './engine/cargasFund.ts';
import { canaletaBase, CANALETA } from './engine/canaleta.ts';
import type { CargaPav } from './engine/cargasFund.ts';
import { modeloParede } from './engine/modeloParede.ts';
import { ZoomSvg, alternarPainel } from './Zoom.tsx';
import { plantaPortal } from './engine/portal.ts';
import * as db from './db.ts';
import { pastaDe, configValida } from './db.ts';
import * as cloud from './cloud.ts';
import type { Session } from '@supabase/supabase-js';
import { Login } from './Login.tsx';
import qrcode from 'qrcode-generator';
import { escurecerDxf } from './engine/cores.ts';
import type { Projeto, Config, Pasta } from './db.ts';

type Aba = 'arquivo' | 'pavimentos' | 'esquadrias' | 'regras' | 'modulacao' | 'lajes' | 'vigas' | 'cortes' | 'impressao' | 'fundacao' | 'orcamento' | 'acompanhamento' | 'v3d';
const br = (v: number, n = 2) => v.toFixed(n).replace('.', ',');
// mesma planta em DWG (converte o DXF gerado)
const baixarDwg = async (nome: string, dxf: string) => {
  try {
    const { dxfParaDwg } = await import('./engine/dwg.ts');
    const bin = await dxfParaDwg(escurecerDxf(dxf));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bin as BlobPart], { type: 'application/acad' })); a.download = nome.replace(/\.dxf$/i, '') + '.dwg'; a.click();
  } catch (e) { alert('Não consegui gerar o DWG: ' + (e as Error).message + '. Baixe o DXF e abra no AutoCAD.'); }
};
// planta em PDF (A3 vetorial com carimbo), feita do mesmo desenho do DXF
const baixarPdf = async (nome: string, dxf: string, info: { titulo: string; sub?: string; obs?: string }, separar = false) => {
  try {
    const { dxfParaPdf } = await import('./engine/pdf.ts');
    const bin = dxfParaPdf(escurecerDxf(dxf), info, separar);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bin as BlobPart], { type: 'application/pdf' })); a.download = nome.replace(/\.dxf$/i, '') + '.pdf'; a.click();
  } catch (e) { alert('Não consegui gerar o PDF: ' + (e as Error).message); }
};
const baixar = (nome: string, conteudo: string, tipo: string) => {
  if (tipo === 'application/dxf') conteudo = escurecerDxf(conteudo);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome; a.click();
};
const baixarBin = (nome: string, bin: Uint8Array, tipo: string) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bin as BlobPart], { type: tipo })); a.download = nome; a.click();
};
interface Salvo { camada: string; pavs: Pavimento[]; quadro: Esquadria[]; regras: Regras; ajustes: Ajustes }
const chave = (n: string) => `modulacao:${n}`;
type VigaN = Viga & { n: number; ini?: number; fim?: number };   // ini/fim: pontas da viga de concreto (face de fora do pilar, dentro da parede de apoio, face da viga que recebe)
// pontas reais da viga: em cada ponta, o que ela encontra no eixo do apoio — pilar (vai até a face de fora), parede perpendicular
// (entra na espessura dela: apoio), outra viga (para na face dela) ou nada (meio pilar de 15 cm)
function pontasViga(v: VigaN, ts: Trecho[], pilares: { x0: number; x1: number; y0: number; y1: number }[], vigas: VigaN[], larg: number) {
  const ap = v.apoio ?? 0, paredes: { t: Trecho; lado: -1 | 1 }[] = [];
  const ponta = (u: number, dir: -1 | 1) => {
    const [px, py] = v.o === 'H' ? [u, v.c] : [v.c, u];
    const pl = pilares.find(q => px > q.x0 - 0.2 && px < q.x1 + 0.2 && py > q.y0 - 0.05 && py < q.y1 + 0.05 && (v.o === 'H' ? Math.max(q.y0, v.c - larg / 2) < Math.min(q.y1, v.c + larg / 2) : Math.max(q.x0, v.c - larg / 2) < Math.min(q.x1, v.c + larg / 2)));
    if (pl) return v.o === 'H' ? (dir > 0 ? pl.x1 : pl.x0) : (dir > 0 ? pl.y1 : pl.y0);
    const w = vigas.find(x => x !== v && x.tipo !== 'trelica' && x.o !== v.o && Math.abs(x.c - u) <= 0.25 && x.a - 0.05 <= v.c && v.c <= x.b + 0.05);
    if (w) return w.c - dir * larg / 2;
    const t = ts.find(x => x.o !== v.o && Math.abs(x.c - u) <= 0.25 && x.s - 0.1 <= v.c && v.c <= x.e + 0.1);
    if (t) { paredes.push({ t, lado: dir }); return t.c + dir * t.esp / 2; }
    return u + dir * 0.075;
  };
  return { a: ponta(v.a + ap, -1), b: ponta(v.b - ap, 1), paredes };
}
interface Calc { ts: Trecho[]; ps: Painel[]; vaos: VaoInteiro[]; lajes: LajeAmb[]; pl: PainelLaje[]; vigas: VigaN[]; muros: Trecho[]; vigasParede: Trecho[]; guardas: Trecho[]; escadas: { pav: string; chave: string; e: Escada; ligada: boolean; viga?: { o: 'H' | 'V'; c: number; s: number; e: number } }[]; orcExtra: { pav: string; area: number }[]; areaPav: { pav: string; area: number }[]; encaixes: Record<string, { x: number; y: number }> }

// desenhos do arquivo (plantas, cortes) e seus papéis, pela camada das paredes escolhida
function desenhosAuto(d: Dxf, cam: string): { auto: Pavimento[]; L: Leitura } {
  const L = ler(d, cam);
  // papéis e pés-direitos automáticos: plantas da esquerda para a direita / de cima para baixo recebem os pés-direitos dos cortes em ordem
  const papeis = adivinharPapeis(d, L.regioes, L.tags);
  // planta repetida no arquivo (cópia do mesmo desenho em outra prancha, às vezes com as etiquetas um pouco deslocadas):
  // mesmas etiquetas na mesma arrumação (tolerância de 1 m) e tamanho parecido = mesma planta
  const etq = (b: Box) => {
    const tg = L.tags.filter(t => t.x > b.x0 - 0.3 && t.x < b.x1 + 0.3 && t.y > b.y0 - 0.3 && t.y < b.y1 + 0.3);
    const mx = Math.min(...tg.map(t => t.x)), my = Math.min(...tg.map(t => t.y));
    return tg.map(t => ({ s: t.text, x: t.x - mx, y: t.y - my })).sort((p, q) => p.s.localeCompare(q.s) || p.y - q.y || p.x - q.x);
  };
  const mesma = (i: number, j: number) => {
    const A = L.regioes[i], B = L.regioes[j];
    if (Math.abs((A.x1 - A.x0) - (B.x1 - B.x0)) > 1.5 || Math.abs((A.y1 - A.y0) - (B.y1 - B.y0)) > 4) return false;
    const a = etq(A), b = etq(B);
    return a.length >= 2 && a.length === b.length && a.every((t, k) => t.s === b[k].s && Math.abs(t.x - b[k].x) < 1 && Math.abs(t.y - b[k].y) < 1);
  };
  // entre as cópias fica a que está junto dos cortes (o jogo original de desenhos)
  const cortesC = L.regioes.filter((_, i) => papeis[i] === 'corte').map(b => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
  const distC = (b: Box) => cortesC.length ? Math.min(...cortesC.map(([x, y]) => Math.hypot((b.x0 + b.x1) / 2 - x, (b.y0 + b.y1) / 2 - y))) : 0;
  const plantasI = L.regioes.map((_, i) => i).filter(i => papeis[i] === 'planta');
  const visto = new Set<number>();
  for (const i of plantasI) {
    if (visto.has(i)) continue;
    const ids = plantasI.filter(j => j === i || (!visto.has(j) && mesma(i, j)));
    ids.forEach(j => visto.add(j));
    if (ids.length < 2) continue;
    const fica = ids.reduce((m, k) => distC(L.regioes[k]) < distC(L.regioes[m]) ? k : m, ids[0]);
    for (const k of ids) if (k !== fica) papeis[k] = 'nao';
  }
  const pes = detectarPes(d, L.regioes.filter((_, i) => papeis[i] !== 'planta'));
  const nomes = ['Térreo', 'Pavimento superior', '2º pavimento', '3º pavimento'];
  let k = 0;
  const auto: Pavimento[] = L.regioes.map((b, i) => {
    const planta = papeis[i] === 'planta', corte = papeis[i] === 'corte';
    const n = planta ? k++ : -1;
    return { id: `R${i + 1}`, nome: planta ? (nomes[n] ?? `Pavimento ${n + 1}`) : corte ? `Corte ${i + 1}` : `Desenho ${i + 1}`, box: b, altura: planta ? (pes[n] ?? pes[pes.length - 1] ?? 2.8) : 2.8, ativo: planta, corte };
  });
  return { auto, L };
}

export default function App() {
  const [aba, setAbaEstado] = useState<Aba>('arquivo');
  const [verFund, setVerFund] = useState<'pontos' | 'locacao' | 'esperas' | 'bloco' | 'estaca' | 'folhas' | 'cargas'>('pontos');
  const [passoFund, setPassoFund] = useState<1 | 2 | 3 | 4>(1);
  // resultado do cálculo da fundação (cargas + modelo parede sobre estacas); a chave diz com que dados foi feito
  const [resFund, setResFund] = useState<null | { chave: string; R: Record<number, number>; lev: Record<number, number>; rec: Record<number, number>; trechos: { t: number; Tparede: number; Tporta: number; Ttopo: number }[]; tot: { paredes: number; lajes: number; uso: number; outros: number }; portas: number; ok: boolean }>(null);
  const [calcFund, setCalcFund] = useState(false);
  const [papelFund, setPapelFund] = useState<'a3' | 'a2'>('a2');
  const [parteFund, setParteFund] = useState<'todas' | 'plantas' | 'detalhe'>('todas');
  const [modoFund, setModoFund] = useState<null | 'add' | 'rem' | 'mover' | 'origem' | { x: number; y: number }>(null);
  // aba atual também num ref: o carregamento (que demora) só troca de aba se o usuário não tiver saído dela
  const abaRef = useRef<Aba>('arquivo');
  const setAba = (a: Aba) => { abaRef.current = a; setAbaEstado(a); };
  const irSeParado = (de: Aba, para: Aba) => { if (abaRef.current === de) setAba(para); };
  const [nome, setNome] = useState('');
  const [dxf, setDxf] = useState<Dxf | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState('');
  const [camada, setCamada] = useState('PAREDE');
  const [pavs, setPavs] = useState<Pavimento[]>([]);
  const [quadro, setQuadro] = useState<Esquadria[]>([]);
  const [regras, setRegras] = useState<Regras>(REGRAS_PADRAO);
  const [aj, setAjBase] = useState<Ajustes>(AJUSTES_VAZIOS);
  // desfazer / refazer: cada mudança de ajuste guarda o estado anterior (até 60 passos)
  const hist = useRef<{ antes: Ajustes[]; depois: Ajustes[] }>({ antes: [], depois: [] });
  const ajRef = useRef(aj); ajRef.current = aj;
  const [, setVerHist] = useState(0);
  const setAj = (n: Ajustes) => { const h = hist.current, atual = ajRef.current; if (atual === n) return; h.antes = [...h.antes.slice(-59), atual]; h.depois = []; ajRef.current = n; setAjBase(n); setVerHist(v => v + 1); };
  const desfazer = () => { const h = hist.current, prev = h.antes.pop(); if (!prev) return; h.depois = [ajRef.current, ...h.depois]; ajRef.current = prev; setAjBase(prev); setVerHist(v => v + 1); };
  const refazer = () => { const h = hist.current, prox = h.depois.shift(); if (!prox) return; h.antes = [...h.antes, ajRef.current]; ajRef.current = prox; setAjBase(prox); setVerHist(v => v + 1); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (!(e.ctrlKey || e.metaKey) || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); desfazer(); } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); refazer(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const [pavSel, setPavSel] = useState('');
  const [sel, setSel] = useState<{ trecho: string } | null>(null);
  const [vaoSel, setVaoSel] = useState<string | null>(null);
  const [ambSel, setAmbSel] = useState<string | null>(null);
  const [lajeSel, setLajeSel] = useState<string | null>(null);   // painel de laje clicado (chaveLaje)
  const [modoViga, setModoViga] = useState<{ x: number; y: number } | null | 'ok'>(null);
  const [modoPilar, setModoPilar] = useState(false);
  const [modoParede, setModoParede] = useState<{ x: number; y: number } | null | 'ok'>(null);   // desenhar parede (2 cliques)   // adicionar viga: null = desligado, 'ok' = esperando o 1º clique
  const [cortando, setCortando] = useState<{ trecho: string; coluna: boolean } | null>(null);
  const [vigaSel, setVigaSel] = useState<string | null>(null);
  const [projId, setProjId] = useState<string | null>(null);
  useEffect(() => { hist.current = { antes: [], depois: [] }; setVerHist(v => v + 1); }, [projId, nome]);   // outro projeto: histórico novo
  const [pasta, setPasta] = useState<Pasta>('modulacao');            // pasta mostrada na aba Arquivo
  const [projPasta, setProjPasta] = useState<Pasta>('modulacao');    // pasta do projeto aberto
  const [projNome, setProjNome] = useState('');
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [pronto, setPronto] = useState(false);
  const [sess, setSess] = useState<Session | null>(null);
  const [checou, setChecou] = useState(!cloud.nuvemConfigurada);
  const [recuperando, setRecuperando] = useState(false);
  const [locais, setLocais] = useState<Projeto[]>([]);
  const [colar, setColar] = useState('');
  const [avisoPdf, setAvisoPdf] = useState<string[]>([]);
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
  // arquitetura sem as letras explodidas em linhas (texto do projeto vira só sujeira na planta)
  const arqLimpa = useMemo(() => (leitura ? semLetras(leitura.prims, camada) : []), [leitura, camada]);

  // carrega um DXF (texto) com a configuração salva, ou monta a configuração inicial
  // mescla ajustes salvos de outra versão do mesmo arquivo: cada desenho é reconhecido pela posição (não pelo número),
  // os pés-direitos e papéis automáticos valem onde o salvo ainda estava no padrão
  const mesclar = (auto: Pavimento[], salvo: Config): { pavs: Pavimento[]; aj: Ajustes } => {
    const igual = (a: Box, b: Box) => Math.abs(a.x0 - b.x0) < 0.5 && Math.abs(a.x1 - b.x1) < 0.5 && Math.abs(a.y0 - b.y0) < 0.5 && Math.abs(a.y1 - b.y1) < 0.5;
    const mapa = new Map<string, string>();
    const pavs = auto.map(p => {
      const s = salvo.pavs.find(q => igual(q.box, p.box));
      if (!s) return p;
      mapa.set(s.id, p.id);
      const padrao = !s.ativo && !s.corte && Math.abs(s.altura - 2.8) < 1e-6;   // o salvo nem tinha mexido neste desenho
      if (padrao) return p;
      return { ...p, ativo: s.ativo, corte: s.corte, nome: /^Desenho \d+$/.test(s.nome) && p.ativo ? p.nome : s.nome,
        altura: Math.abs(s.altura - 2.8) < 1e-6 && p.ativo ? p.altura : s.altura };
    });
    // ids dos ajustes começam pelo id do desenho
    const troca = (id: string) => { const i = id.indexOf('|'); const n = mapa.get(i > 0 ? id.slice(0, i) : id); return n ? n + (i > 0 ? id.slice(i) : '') : null; };
    const lista = (v?: string[]) => (v || []).map(troca).filter((x): x is string => !!x);
    const reg = <T,>(v?: Record<string, T>) => Object.fromEntries(Object.entries(v || {}).map(([k, x]) => [troca(k), x] as const).filter(([k]) => !!k)) as Record<string, T>;
    const a = { ...AJUSTES_VAZIOS, ...salvo.ajustes };
    return { pavs, aj: { ...a, excluir: lista(a.excluir), juntar: lista(a.juntar), naoDividir: lista(a.naoDividir), naoPinar: lista(a.naoPinar), lajeFora: lista(a.lajeFora), lajeGiro: lista(a.lajeGiro), laje16: lista(a.laje16), lajeEspAmb: reg(a.lajeEspAmb), lajeEspPav: reg(a.lajeEspPav), arm: a.arm ? { ...a.arm, pavs: a.arm.pavs ? lista(a.arm.pavs) : undefined } : undefined, peAmb: reg(a.peAmb),
      cortes: reg(a.cortes), colunas: reg(a.colunas), altura: reg(a.altura), vaoTipo: reg(a.vaoTipo) } };
  };
  const carregarTexto = (txt: string, arquivo: string, cfg: Config | null, deOutraVersao = false) => {
    if (!/SECTION/.test(txt.slice(0, 5000))) throw new Error('O arquivo não parece um DXF. No AutoCAD use "Salvar como" > DXF.');
    const d = parseDxf(txt);
    setPronto(false);
    setDxf(d); setNome(arquivo); setSel(null); setVaoSel(null); setAmbSel(null); setCortando(null); setPavSel('');
    const cam = cfg?.camada ?? camadaDasParedes(d);
    setCamada(cam);
    if (cfg && !deOutraVersao) { setPavs(cfg.pavs); setQuadro(cfg.quadro); setRegras(regrasDoSalvo(cfg.regras)); setAj({ ...AJUSTES_VAZIOS, ...cfg.ajustes }); }
    else {
      const { auto, L } = desenhosAuto(d, cam);
      if (cfg) {
        const m = mesclar(auto, cfg);
        setPavs(m.pavs); setQuadro(cfg.quadro?.length ? cfg.quadro : L.quadro); setRegras(regrasDoSalvo(cfg.regras)); setAj(m.aj);
      } else { setPavs(auto); setQuadro(L.quadro); setRegras(REGRAS_PADRAO); setAj(AJUSTES_VAZIOS); }
    }
    setTimeout(() => setPronto(true), 0);
  };
  const novo = async (f: File) => {
    setLendo(true); setErro('');
    try {
      let txt: string;
      if (/\.pdf$/i.test(f.name)) {
        // PDF vetorial: vira um DXF simples (linhas, arcos e textos em metros) e segue o mesmo caminho
        const [lib, w, conv] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'), import('./engine/pdf2dxf.ts')]);
        lib.GlobalWorkerOptions.workerSrc = w.default;
        const r = await conv.pdfParaDxf(lib as unknown as Parameters<typeof conv.pdfParaDxf>[0], new Uint8Array(await f.arrayBuffer()));
        txt = r.dxf;
        setAvisoPdf([`Projeto lido do PDF na escala 1:${Math.round(r.escala / (0.0254 / 72))}.`, ...r.avisos, 'Confira as medidas das paredes com as cotas do projeto: o PDF não separa parede de mobília e hachura como o DXF.']);
      } else if (/\.dwg$/i.test(f.name)) {
        const conv = await import('./engine/dwg2dxf.ts');
        const r = await conv.dwgParaDxf(await f.arrayBuffer());
        txt = r.dxf; setAvisoPdf(r.avisos);
      } else { txt = await f.text(); setAvisoPdf([]); }
      // aproveita ajustes da versão antiga (salvos pelo nome do arquivo)
      const antigo = (() => { try { return JSON.parse(localStorage.getItem(chave(f.name)) || 'null') as Salvo | null; } catch { return null; } })();
      const de = abaRef.current;
      carregarTexto(txt, f.name, antigo, true);
      irSeParado(de, antigo ? 'modulacao' : 'pavimentos');
      const cfg0 = (antigo ? { ...antigo, pasta } : pasta === 'orcamento' ? { pasta } : null) as Config | null;
      const p = await repo.criar(f.name.replace(/\.(dxf|dwg|pdf)$/i, ''), f.name, new Blob([txt], { type: 'application/dxf' }), cfg0);
      setProjId(p.id); setProjNome(p.nome); setProjPasta(pasta); atualizarLista();
    } catch (e) { setErro((e as Error).message); }
    setLendo(false);
  };
  const abrirProjeto = async (id: string) => {
    setLendo(true); setErro('');
    try {
      const de = abaRef.current;
      const p = await repo.carregar(id); if (!p) throw new Error('Projeto não encontrado.');
      const cfg = configValida(p.config);
      carregarTexto(await p.dxf.text(), p.arquivo, cfg);
      setProjId(p.id); setProjNome(p.nome); setProjPasta(pastaDe(p));
      irSeParado(de, cfg && cfg.pavs.some(x => x.ativo) ? (pastaDe(p) === 'orcamento' ? 'orcamento' : 'modulacao') : 'pavimentos');
    } catch (e) { setErro((e as Error).message); }
    setLendo(false);
  };
  // salva sozinho a cada alteração
  useEffect(() => {
    if (!projId || !pronto) return;
    const t = setTimeout(() => {
      const cfg: Config = { camada, pavs, quadro, regras, ajustes: aj, ...(projPasta === 'orcamento' ? { pasta: projPasta } : {}) };
      // cópia de segurança pelo nome do arquivo: se o projeto sumir, ao mandar o mesmo DXF os ajustes voltam
      try { localStorage.setItem(chave(nome), JSON.stringify(cfg)); } catch { /* sem espaço */ }
      repo.salvarConfig(projId, cfg).then(atualizarLista).catch(() => setErro('Não foi possível salvar o projeto. Verifique a internet.'));
    }, 500);
    return () => clearTimeout(t);
  }, [projId, pronto, camada, pavs, quadro, regras, aj, nome, projPasta]);
  const ativos = pavs.filter(p => p.ativo);
  const ativosT = useMemo(() => { const dB = aj.fund?.canaleta ? (aj.fund.canaletaAcima ?? 0.07) : 0; return dB > 0 ? ativos.map((p, i) => i === 0 ? { ...p, altura: p.altura - dB, baseAcima: dB } : p) : ativos; }, [pavs, aj.fund]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pesLidos = useMemo(() => dxf ? detectarPes(dxf, pavs.filter(p => !p.ativo).map(p => p.box)) : [], [dxf, pavs]);
  const calc: Calc = useMemo(() => {
    const ativos = ativosT;
    const vazio: Calc = { ts: [], ps: [], vaos: [], lajes: [], pl: [], vigas: [], muros: [], vigasParede: [], guardas: [], escadas: [], orcExtra: [], areaPav: [], encaixes: {} };
    if (!leitura) return vazio;
    const porPav = ativos.map(p => trechos(leitura, p, quadro, regras, aj));
    // linhas do desenho desta planta (a projeção do beiral pode ficar até 2,5 m para fora das paredes)
    const naCaixa = (b: Box, l: { a: number; b: number; c: number; o: 'H' | 'V' }) => { const [x, y] = l.o === 'H' ? [(l.a + l.b) / 2, l.c] : [l.c, (l.a + l.b) / 2]; return x > b.x0 - 2.5 && x < b.x1 + 2.5 && y > b.y0 - 2.5 && y < b.y1 + 2.5; };
    // porta mais alta que o pavimento: o vão continua no pé da parede de cima
    for (let i = 0; i < ativos.length - 1; i++) if (porPav[i].length && porPav[i + 1].length) {
      const al = alinhar(porPav[i], porPav[i + 1], encaixeManual(ativos[i], ativos[i + 1]));
      continuarVaos(porPav[i], porPav[i + 1], quadro, regras, al.dx, al.dy);
    }
    const pisos: Trecho[] = [];
    // por pavimento: deslocamento da planta de cima para esta e áreas descobertas (LAJE IMPERMEÁVEL na planta)
    const desloc = new Map<string, { baixo: string; dx: number; dy: number }>(), descob = new Map<string, Box[]>();
    ativos.forEach((p, i) => {
      const cima = ativos[i + 1], tc = porPav[i + 1] || [];
      // "LINHA DE PISO" do projeto: viga que serve de apoio para a laje
      const pp: Trecho[] = leitura.linhas.filter(l => l.tipo === 'piso' && naCaixa(p.box, l))
        .map(l => ({ id: `${p.id}|piso|${l.c.toFixed(2)}|${l.a.toFixed(2)}`, pav: p.id, o: l.o, c: l.c, s: l.a, e: l.b, vaos: [], H: p.altura, esp: regras.vigaLargura }));
      // vigas desenhadas no sistema (aba Lajes → Adicionar viga): apoio da laje como a LINHA DE PISO
      for (const v of aj.vigasManuais || []) if (v.pav === p.id) pp.push({ id: `${p.id}|vmanual|${v.o}|${v.c.toFixed(2)}|${v.a.toFixed(2)}`, pav: p.id, o: v.o, c: v.c, s: v.a, e: v.b, vaos: [], H: p.altura, esp: regras.vigaLargura });
      // parede marcada como viga (muxarabi, vidro): não vira painel, a laje apoia nela
      const vp = porPav[i].filter(x => (aj.viga || []).includes(x.id));
      vazio.vigasParede.push(...vp);
      pp.push(...vp.map(x => ({ ...x, id: `${p.id}|vparede|${x.id}`, vaos: [], esp: regras.vigaLargura })));
      const semVp = porPav[i].filter(x => !vp.includes(x));
      pisos.push(...pp);
      const man = encaixeManual(p, cima);
      const al = cima && tc.length && porPav[i].length ? alinhar(porPav[i], tc, man) : null;
      // cálculo novo (motor 2); projetos salvos antes continuam com o cálculo de quando foram feitos
      const novo = (regras.motor ?? 1) >= 2;
      // área coberta pelo pavimento de cima (nesta planta): embaixo dela leva laje mesmo sem paredes (garagem)
      const cob = novo && cima && al ? ambientes(cima, tc, [], [], { fechar: true }).map(a => ({ x0: a.x0 + al.dx, x1: a.x1 + al.dx, y0: a.y0 + al.dy, y1: a.y1 + al.dy })) : [];
      // "LAJE IMPERMEABILIZADA" na planta de cima: é a laje deste pavimento (cobertura de varanda, área gourmet)
      if (novo && cima && al) for (const x of leitura.textos.filter(x => /LAJE\s+IMPERME/i.test(x.text) && x.x > cima.box.x0 && x.x < cima.box.x1 && x.y > cima.box.y0 && x.y < cima.box.y1)) {
        const c = caixaDoPonto(tc, x.x, x.y);
        if (c) cob.push({ x0: c.x0 + al.dx, x1: c.x1 + al.dx, y0: c.y0 + al.dy, y1: c.y1 + al.dy });
      }
      // muro: parede que não encosta em nenhum ambiente (fica toda do lado de fora) — não é fabricado
      const amb0 = novo ? ambientes(p, semVp, pp, [], { fechar: true, cobertas: cob }) : [];
      const encosta = (x: Trecho) => (aj.naoMuro || []).includes(x.id) || amb0.some(a => x.o === 'V'
        ? x.c > a.x0 - 0.1 && x.c < a.x1 + 0.1 && Math.min(x.e, a.y1) - Math.max(x.s, a.y0) > Math.min(0.3, (x.e - x.s) / 2)
        : x.c > a.y0 - 0.1 && x.c < a.y1 + 0.1 && Math.min(x.e, a.x1) - Math.max(x.s, a.x0) > Math.min(0.3, (x.e - x.s) / 2));
      const t = amb0.length ? semVp.filter(encosta) : semVp;
      vazio.muros.push(...semVp.filter(x => !t.includes(x)));
      // guarda-corpo é feito na obra: não vira painel (a laje continua contando com ele no contorno)
      const noBox = (x: { x: number; y: number }) => x.x > p.box.x0 - 1 && x.x < p.box.x1 + 1 && x.y > p.box.y0 - 1 && x.y < p.box.y1 + 1;
      const grades = novo ? leitura.prims.filter(q => q.kind === 'line' && /BALA[UÚ]ST|CORRIM|GUARDA|RAIL|GRADIL/i.test(q.layer) && q.pts.every(([x, y]) => noBox({ x, y })))
        .flatMap(q => q.pts.slice(1).map((b, k) => [q.pts[k], b] as const))
        .flatMap(([[x1, y1], [x2, y2]]): { o: 'H' | 'V'; c: number; a: number; b: number }[] => Math.abs(y1 - y2) < 0.02 ? [{ o: 'H', c: (y1 + y2) / 2, a: Math.min(x1, x2), b: Math.max(x1, x2) }]
          : Math.abs(x1 - x2) < 0.02 ? [{ o: 'V', c: (x1 + x2) / 2, a: Math.min(y1, y2), b: Math.max(y1, y2) }] : []) : [];
      const gp = novo ? guardaCorpos(i > 0, t, amb0, leitura.textos.filter(noBox), grades).filter(g => !(aj.naoMuro || []).includes(g.t.id)) : [];
      // a parede fica só com o que não é guarda-corpo (pedaços de mais de 30 cm, com os vãos que caem neles)
      const tp: Trecho[] = [];
      for (const x of t) {
        const gs = gp.filter(g => g.t === x).sort((p, q) => p.a - q.a);
        if (!gs.length) { tp.push(x); continue; }
        let s0 = x.s, k = 0;
        for (const g of [...gs, { a: x.e, b: x.e }]) {
          if (g.a - s0 >= 0.3) tp.push({ ...x, id: k++ ? `${x.id}|${s0.toFixed(2)}` : x.id, s: s0, e: g.a, vaos: x.vaos.filter(v => (v.a + v.b) / 2 > s0 && (v.a + v.b) / 2 < g.a) });
          s0 = Math.max(s0, g.b);
        }
        vazio.guardas.push(...gs.map(g => ({ ...x, s: g.a, e: g.b, vaos: [] })));
      }
      // área construída do pavimento: ambientes (com garagem/varanda coberta), sem os que são VAZIO, pela face de fora das paredes
      if (novo) {
        const ehVazio = (a: { x0: number; x1: number; y0: number; y1: number }) => leitura.textos.some(x => /\bVAZIO\b/i.test(x.text) && x.x > a.x0 && x.x < a.x1 && x.y > a.y0 && x.y < a.y1);
        const esps = t.map(x => x.esp).sort((a, b) => a - b);
        // nos pavimentos de cima, área descoberta (solarium, sacada, terraço) ou ambiente com um lado todo aberto
        // (vão livre na fachada) não conta como área construída
        type R4 = { x0: number; x1: number; y0: number; y1: number };
        const descoberto = (a: R4) => i > 0 && (leitura.textos.some(x => /SOLARIUM|SOL[ÁA]RIO|SACADA|TERRA[ÇC]O|DECK/i.test(x.text) && x.x > a.x0 && x.x < a.x1 && x.y > a.y0 && x.y < a.y1) ||
          ([['H', a.y0, a.x0, a.x1], ['H', a.y1, a.x0, a.x1], ['V', a.x0, a.y0, a.y1], ['V', a.x1, a.y0, a.y1]] as const).some(([o, c, l0, l1]) =>
            t.filter(x => x.o === o && Math.abs(x.c - c) < 0.1).reduce((s, x) => s + x.vaos.filter(v => !v.tag && v.inteiro).reduce((q, v) => q + Math.max(0, Math.min(v.b, l1) - Math.max(v.a, l0)), 0), 0) >= 0.6 * (l1 - l0)));
        vazio.areaPav.push({ pav: p.id, area: areaConstruida(amb0.filter(a => !ehVazio(a) && !descoberto(a)), esps[Math.floor(esps.length / 2)] ?? 0.15) });
      }
      // pilar de concreto (moldado no local): a parede que passa por ele para na face dele (o painel da ponta fica menor)
      for (const pl of (aj.pilares || []).filter(q => q.pav === p.id)) {
        for (let k = tp.length - 1; k >= 0; k--) {
          const x = tp[k], [c0, c1, a0, a1] = x.o === 'V' ? [pl.x0, pl.x1, pl.y0, pl.y1] : [pl.y0, pl.y1, pl.x0, pl.x1];
          if (x.c < c0 - 0.02 || x.c > c1 + 0.02 || a1 <= x.s + 0.01 || a0 >= x.e - 0.01) continue;
          const ini = a0 <= x.s + 0.1, fim = a1 >= x.e - 0.1;
          if (ini && fim) { tp.splice(k, 1); continue; }
          if (ini) { tp[k] = { ...x, s: a1, vaos: x.vaos.filter(v => v.a >= a1 - 0.01) }; continue; }
          if (fim) { tp[k] = { ...x, e: a0, vaos: x.vaos.filter(v => v.b <= a0 + 0.01) }; continue; }
          tp.splice(k, 1, { ...x, e: a0, vaos: x.vaos.filter(v => v.b <= a0 + 0.01) }, { ...x, id: `${x.id}|pilar`, s: a1, vaos: x.vaos.filter(v => v.a >= a1 - 0.01) });
        }
      }
      const r = paineis(tp, regras, aj);
      if (aj.telhado?.[p.id]) aplicarTelhado(r.paineis, aj.telhado[p.id], aj.alturaPainel);
      vazio.ts.push(...tp); vazio.ps.push(...r.paineis); vazio.vaos.push(...r.vaos);
      // projeções de laje/beiral desta planta e áreas marcadas VAZIO no pavimento de cima
      const bordas = leitura.linhas.filter(l => l.tipo === 'proj' && naCaixa(p.box, l));
      const vz = cima && al ? vaziosDeCima(cima, tc, leitura.textos, al.dx, al.dy) : [];
      // escada desenhada (degraus) que continua no pavimento de cima, no mesmo lugar: vão na laje deste pavimento
      if (novo && cima && al && regras.escadaAuto !== false) {
        const eCima = escadas(segsEscada(leitura.prims, cima.box, camada), tc).map(e => ({ ...e, x0: e.x0 + al.dx, x1: e.x1 + al.dx, y0: e.y0 + al.dy, y1: e.y1 + al.dy }));
        const naCx = (b: Box) => (t: { x: number; y: number }) => t.x > b.x0 && t.x < b.x1 && t.y > b.y0 && t.y < b.y1;
        // helicoidal/caracol: contorno com o texto ESCADA (o texto pode estar só numa das plantas)
        const txP = leitura.textos.filter(naCx(p.box)), txC = leitura.textos.filter(naCx(cima.box)).map(t => ({ ...t, x: t.x + al.dx, y: t.y + al.dy }));
        const contC = escadasContorno(segsEscada(leitura.prims, cima.box, camada, true), circsEscada(leitura.prims as never, cima.box), [...leitura.textos.filter(naCx(cima.box)), ...txP.map(t => ({ ...t, x: t.x - al.dx, y: t.y - al.dy }))], tc)
          .map(e => ({ ...e, x0: e.x0 + al.dx, x1: e.x1 + al.dx, y0: e.y0 + al.dy, y1: e.y1 + al.dy }));
        eCima.push(...contC);
        const contP = escadasContorno(segsEscada(leitura.prims, p.box, camada, true), circsEscada(leitura.prims as never, p.box), [...txP, ...txC], porPav[i], pp);
        for (const e of [...escadas(segsEscada(leitura.prims, p.box, camada), porPav[i], pp), ...contP]) {
          const ov = (c: Box) => Math.max(0, Math.min(e.x1, c.x1) - Math.max(e.x0, c.x0)) * Math.max(0, Math.min(e.y1, c.y1) - Math.max(e.y0, c.y0));
          if (!eCima.some(c => ov(c) > 0.3 * (e.x1 - e.x0) * (e.y1 - e.y0))) continue;
          if (vazio.escadas.some(x => x.pav === p.id && ov(x.e) > 0.5 * (e.x1 - e.x0) * (e.y1 - e.y0))) continue;   // já achada pelos degraus
          const chave = `${p.id}|${e.x0.toFixed(1)}|${e.y0.toFixed(1)}`, ligada = !(aj.naoEscada || []).includes(chave);
          const ajv = aj.escadaVao?.[chave]; if (ajv) Object.assign(e, ajv);   // bordas do vão ajustadas à mão
          // borda do vão que não cai em parede/linha de piso fica solta: viga de borda na borda que dá a viga mais curta, de parede a parede
          let viga: { o: 'H' | 'V'; c: number; s: number; e: number } | undefined;
          if (ligada) {
            const sup = [...porPav[i], ...pp];
            const presa = (o: 'H' | 'V', c: number, a: number, b: number) => sup.some(t => t.o === o && Math.abs(t.c - c) < 0.1 && Math.min(t.e, b) - Math.max(t.s, a) >= 0.8 * (b - a));
            const estende = (o: 'H' | 'V', c: number, a: number, b: number) => {   // até a parede perpendicular de cada lado
              const cruz = sup.filter(t => t.o !== o && t.s - 0.1 <= c && c <= t.e + 0.1);
              const lo = Math.max(...cruz.filter(t => t.c <= a + 0.01).map(t => t.c)), hi = Math.min(...cruz.filter(t => t.c >= b - 0.01).map(t => t.c));
              return isFinite(lo) && isFinite(hi) ? { o, c, s: lo, e: hi } : undefined;
            };
            const cands = ([['V', e.x0, e.y0, e.y1], ['V', e.x1, e.y0, e.y1], ['H', e.y0, e.x0, e.x1], ['H', e.y1, e.x0, e.x1]] as const)
              .filter(([o, c, a, b]) => !presa(o, c, a, b)).map(([o, c, a, b]) => estende(o, c, a, b)).filter((v): v is NonNullable<typeof v> => !!v && v.e - v.s <= 6);
            viga = cands.sort((u, v) => (u.e - u.s) - (v.e - v.s))[0];
            if (viga) { const tv: Trecho = { id: `${p.id}|vescada|${viga.o}|${viga.c.toFixed(2)}|${viga.s.toFixed(2)}`, pav: p.id, o: viga.o, c: viga.c, s: viga.s, e: viga.e, vaos: [], H: p.altura, esp: regras.vigaLargura }; pp.push(tv); pisos.push(tv); }
          }
          vazio.escadas.push({ pav: p.id, chave, e, ligada, viga });
          if (ligada) vz.push({ x0: e.x0, x1: e.x1, y0: e.y0, y1: e.y1 });
        }
      }
      // área escrita "LAJE IMPERMEÁVEL" na própria planta é laje descoberta deste nível (é a laje do pavimento de baixo):
      // não leva laje em cima
      const txP = leitura.textos.filter(x => /LAJE\s+IMPERME/i.test(x.text) && x.x > p.box.x0 && x.x < p.box.x1 && x.y > p.box.y0 && x.y < p.box.y1);
      const descobertas = txP.length ? ambientes(p, t, pp, vz, { fechar: novo }).filter(a => txP.some(x => x.x > a.x0 && x.x < a.x1 && x.y > a.y0 && x.y < a.y1)).map(a => ({ x0: a.x0, x1: a.x1, y0: a.y0, y1: a.y1 })) : [];
      vz.push(...descobertas);
      descob.set(p.id, descobertas);
      if (cima && al) desloc.set(cima.id, { baixo: p.id, dx: al.dx, dy: al.dy });
      if (cima && al) vazio.encaixes[cima.id] = { x: cima.box.x0 + al.dx - p.box.x0, y: cima.box.y0 + al.dy - p.box.y0 };
      // o sentido da laje leva em conta as paredes do pavimento de cima
      // sem parede embaixo da borda da área coberta: viga apoiada em pilares
      const bv: Trecho[] = [];
      const am = ambientes(p, t, pp, vz, { fechar: novo, cobertas: cob, vigasBorda: bv, juntar: (aj.lajeJuntar || []).filter(j => j.pav === p.id) });
      for (const b of bv) b.esp = regras.vigaLargura;
      pisos.push(...bv);
      const m = modularLajes(am, regras, aj, [...t, ...pp, ...bv], cargasDeCima([...t, ...pp, ...bv], tc, man, regras.trelicaSobreVao), bordas);
      vazio.lajes.push(...m.ambs); vazio.pl.push(...m.paineis);
      // laje apoiada na linha do guarda-corpo (sacada coberta): ali não tem parede, vai viga na borda
      for (const g of gp) {
        const apoia = m.ambs.some(L => L.incluida && L.sentido && (L.sentido === 'H' ? g.t.o === 'V' && [L.x0, L.x1].some(x => Math.abs(x - g.t.c) < 0.15) && Math.min(g.b, L.y1) - Math.max(g.a, L.y0) > 0.3
          : g.t.o === 'H' && [L.y0, L.y1].some(y => Math.abs(y - g.t.c) < 0.15) && Math.min(g.b, L.x1) - Math.max(g.a, L.x0) > 0.3));
        if (apoia) pisos.push({ ...g.t, id: `${p.id}|gcorpo|${g.t.o}|${g.t.c.toFixed(2)}|${g.a.toFixed(2)}`, s: g.a, e: g.b, vaos: [], esp: regras.vigaLargura });
      }
    });
    // paredes que passam pela altura da laje (não tem laje dos dois lados):
    // - em cima do vazio (pé-direito duplo): a parede de cima desce até a parede de baixo (+ espessura da laje)
    // - em volta de área descoberta (laje impermeável sem cobertura): a parede sobe até o topo da platibanda
    // pé-direito próprio de ambiente (ex.: sala de 4,00): os painéis em volta dele sobem; no orçamento entra a área a mais
    const peEsp = Object.entries(aj.peAmb || {}).map(([id, H]) => { const L = vazio.lajes.find(a => a.id === id); return { L, H: H - (L?.pav === ativos[0]?.id ? ativos[0].baseAcima ?? 0 : 0) }; }).filter((x): x is { L: LajeAmb; H: number } => !!x.L && x.H > 0);   // pé-direito do piso acabado: desconta a base de canaleta
    const sobePe = (ps: Painel[]) => { for (const P of ps) {
      const m = (P.a + P.b) / 2, d = 0.3;
      const lados: [number, number][] = P.o === 'H' ? [[m, P.c - d], [m, P.c + d]] : [[P.c - d, m], [P.c + d, m]];
      const alvo = Math.max(0, ...peEsp.filter(({ L }) => L.pav === P.pav && lados.some(([x, y]) => x > L.x0 && x < L.x1 && y > L.y0 && y < L.y1)).map(x => x.H));
      if (alvo > P.H) { P.H = alvo; P.aviso = (P.aviso ? P.aviso + ' · ' : '') + `${br(alvo)} m: pé-direito do ambiente`; }
    } };
    sobePe(vazio.ps);
    // parede que subiu e passou da largura de painel alto (acima de 3,00 m: até 3,00 de largura): divide a parede de novo
    const Halto: Record<string, { a: number; b: number; H: number }[]> = {};
    if (vazio.ps.some(P => P.larg > larguraMaxDe(regras, P.H) + 1e-6))
      for (const P of vazio.ps) if (larguraMaxDe(regras, P.H) < regras.larguraMax) (Halto[P.trecho] ??= []).push({ a: P.a, b: P.b, H: P.H });
    // parede que atravessa o limite do ambiente de pé-direito alto: o painel alto morre no encontro com a parede que fecha o ambiente
    // (vai até a face de fora dela) e o painel baixo começa ali — senão o painel alto passa da parede e fica sobrando para fora
    const forc: Record<string, { a: number; b: number }[]> = {};
    for (const { L, H } of peEsp) for (const t of vazio.ts.filter(t => t.pav === L.pav && H > t.H)) {
      const [c0, c1] = t.o === 'V' ? [L.x0, L.x1] : [L.y0, L.y1], [b0, b1] = t.o === 'V' ? [L.y0, L.y1] : [L.x0, L.x1];
      if (t.c < c0 - 0.3 || t.c > c1 + 0.3) continue;
      for (const [lim, fora] of [[b0, -1], [b1, 1]] as const) {
        if (!(t.s < lim - 0.3 && t.e > lim + 0.3)) continue;
        // do outro lado do limite tem outro ambiente tão alto quanto (dos dois lados da parede)? então ali a parede não muda de altura
        const fora2 = [-0.3, 0.3].map(d => t.o === 'V' ? [t.c + d, lim + fora * 0.4] : [lim + fora * 0.4, t.c + d]);
        if (fora2.some(([fx, fy]) => peEsp.some(o => o.L.pav === t.pav && o.H >= H && fx > o.L.x0 && fx < o.L.x1 && fy > o.L.y0 && fy < o.L.y1))) continue;
        const x = vazio.ts.find(x => x.pav === t.pav && x.o !== t.o && Math.abs(x.c - lim) < 0.3 && x.s <= t.c + 0.1 && x.e >= t.c - 0.1);
        // os dois painéis param nas faces da parede que cruza (o de antes termina na face de baixo, o de depois começa na de cima):
        // o quadrado do encontro fica livre para o fechamento, como nos cantos
        const e2 = x ? meiaEncontro(regras) : 0, fa = x ? lim - e2 + regras.folga : lim, fb = lim + e2;   // sem parede cruzando embaixo: corte simples
        if (!(forc[t.id] ??= []).some(f => Math.abs(f.b - fb) < 0.01)) forc[t.id].push({ a: fa, b: fb });   // painel alto: começa/termina na face
        if (!Halto[t.id]) Halto[t.id] = vazio.ps.filter(P => P.trecho === t.id).map(P => ({ a: P.a, b: P.b, H: P.H }));
      }
    }
    if (Object.keys(Halto).length) {
      const tr = vazio.ts.filter(t => Halto[t.id] !== undefined), r2 = paineis(tr, regras, aj, Halto, forc, vazio.ts);
      vazio.ps = [...vazio.ps.filter(P => Halto[P.trecho] === undefined), ...r2.paineis];
      vazio.vaos = [...vazio.vaos.filter(v => Halto[v.trecho] === undefined), ...r2.vaos];
      for (const pv of ativos) if (aj.telhado?.[pv.id]) aplicarTelhado(r2.paineis.filter(P => P.pav === pv.id), aj.telhado[pv.id], aj.alturaPainel);
      sobePe(r2.paineis);
    }
    for (const { L, H } of peEsp) for (const t of vazio.ts.filter(t => t.pav === L.pav && H > t.H)) {
      const lim = t.o === 'H' ? [L.y0, L.y1] : [L.x0, L.x1], [s0, s1] = t.o === 'H' ? [L.x0, L.x1] : [L.y0, L.y1];
      const ov = Math.min(t.e, s1) - Math.max(t.s, s0);
      if (ov > 0 && lim.some(v => Math.abs(v - t.c) < 0.15)) vazio.orcExtra.push({ pav: t.pav, area: ov * (H - t.H) });
    }
    const desceu = new Set<Painel>(), espLaje = regras.lajeEsp ?? 0.15;
    if ((regras.motor ?? 1) >= 2) {
      const esp = espLaje, plat = regras.platibanda ?? 0.4;
      const temLaje = (pav: string, x: number, y: number) => vazio.pl.some(L => L.pav === pav && x > L.x0 && x < L.x1 && y > L.y0 && y < L.y1);
      const dentro = (bs: Box[], x: number, y: number) => bs.some(b => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1);
      for (const P of vazio.ps) {
        // pontos dos dois lados do painel (no meio e a 1/4 das pontas: o meio pode cair na folga entre dois painéis de laje)
        const d = 0.3, ms = [0.25, 0.5, 0.75].map(t => P.a + (P.b - P.a) * t), m = ms[1];
        const lados: [number, number][] = ms.flatMap((mm): [number, number][] => P.o === 'H' ? [[mm, P.c - d], [mm, P.c + d]] : [[P.c - d, mm], [P.c + d, mm]]);
        const ds = desloc.get(P.pav);
        if (ds && P.H >= (ativos.find(a => a.id === P.pav)?.altura ?? 0) - 0.01) {
          const emBaixo = lados.map(([x, y]) => [x + ds.dx, y + ds.dy] as [number, number]);
          const cb = P.o === 'H' ? P.c + ds.dy : P.c + ds.dx, ab = P.o === 'H' ? P.a + ds.dx : P.a + ds.dy, bb = P.o === 'H' ? P.b + ds.dx : P.b + ds.dy;
          const paredeEmbaixo = vazio.ts.some(t => t.pav === ds.baixo && t.o === P.o && Math.abs(t.c - cb) < 0.15 && Math.min(t.e, bb) - Math.max(t.s, ab) > 0.3);
          if (paredeEmbaixo && !emBaixo.some(([x, y]) => temLaje(ds.baixo, x, y))) {
            somaAltura(P, esp); P.desce = esp; for (const r of P.recortes) r.base += esp; desceu.add(P); P.aviso = (P.aviso ? P.aviso + ' · ' : '') + `${br(P.H)} m: sem laje embaixo (vazio), a parede desce até a parede de baixo`;
          }
        }
        const dsc = descob.get(P.pav) || [];
        if (dsc.length && lados.some(([x, y]) => dentro(dsc, x, y)) && !lados.some(([x, y]) => temLaje(P.pav, x, y))) {
          somaAltura(P, esp + plat); P.aviso = (P.aviso ? P.aviso + ' · ' : '') + `${br(P.H)} m: área descoberta, a parede sobe até o topo da platibanda`;
        }
      }
    }
    // verga: porta larga (vão inteiro, ex.: porta de vidro de 4,70) em parede mais alta que ela: painel em cima da porta até o topo da parede
    // (na sala de pé-direito alto a parede sobe até a laje alta)
    for (const v of vazio.vaos) {
      if (!v.topo || v.tipo === 'vão livre') continue;
      const m = (v.a + v.b) / 2, d = 0.3, lados: [number, number][] = v.o === 'H' ? [[m, v.c - d], [m, v.c + d]] : [[v.c - d, m], [v.c + d, m]];
      const alvo = Math.max(v.H ?? 0, ...peEsp.filter(({ L }) => L.pav === v.pav && lados.some(([x, y]) => x > L.x0 && x < L.x1 && y > L.y0 && y < L.y1)).map(x => x.H));
      const Hv = alvo - v.topo; if (Hv < 0.15 || alvo <= (v.H ?? 0) + 0.05) continue;   // só onde a parede sobe pelo pé-direito do ambiente (projetos antigos não mudam)
      const larg = v.b - v.a, lm = larguraMaxDe(regras, Hv), n = Math.max(1, Math.ceil((larg - regras.folga + regras.coluna) / (lm + regras.folga + regras.coluna) - 1e-9)), w = (larg - (n - 1) * regras.coluna) / n;
      for (let k = 0; k < n; k++) {
        const a = v.a + k * (w + regras.coluna), tid = `${v.trecho}|verga|${m.toFixed(2)}`;
        vazio.ps.push({ num: 0, trecho: tid, pav: v.pav, o: v.o, c: v.c, a, b: a + w, larg: w - regras.folga, H: Hv, comp: w, recortes: [], z0: v.topo, chave: `${tid}@${a.toFixed(2)}`,
          aviso: `verga em cima da ${v.tipo} (de ${br(v.topo)} a ${br(alvo)} m)` });
      }
    }
    // tira: ambiente com pé-direito próprio (sala de 4,50) do lado de um ambiente mais baixo e sem parede na divisa
    // (vão livre): painel baixo em cima da laje do ambiente mais baixo, fechando até a laje alta
    for (const { L, H } of peEsp) {
      const pav = ativos.find(a => a.id === L.pav); if (!pav || H <= pav.altura + 0.05) continue;
      const Ht = H - pav.altura - espLaje; if (Ht < 0.1) continue;
      const lados: { o: 'H' | 'V'; c: number; s: number; e: number; fora: number }[] = [
        { o: 'H', c: L.y0, s: L.x0, e: L.x1, fora: -1 }, { o: 'H', c: L.y1, s: L.x0, e: L.x1, fora: 1 },
        { o: 'V', c: L.x0, s: L.y0, e: L.y1, fora: -1 }, { o: 'V', c: L.x1, s: L.y0, e: L.y1, fora: 1 }];
      for (const ld of lados) {
        const ponto = (u: number, d: number): [number, number] => ld.o === 'H' ? [u, ld.c + ld.fora * d] : [ld.c + ld.fora * d, u];
        const meia = (o: 'H' | 'V', c: number, u: number) => (vazio.ts.find(t => t.pav === L.pav && t.o === o && Math.abs(t.c - c) < 0.15 && u > t.s - 0.2 && u < t.e + 0.2)?.esp ?? 0.1) / 2;
        // começa e termina na face das paredes do lado (que já sobem até a laje alta)
        const s0 = ld.s + meia(ld.o === 'H' ? 'V' : 'H', ld.s, ld.c), s1 = ld.e - meia(ld.o === 'H' ? 'V' : 'H', ld.e, ld.c);
        // trechos já fechados por painel que subiu até a laje alta
        const cheios = vazio.ps.filter(P => P.pav === L.pav && P.o === ld.o && Math.abs(P.c - ld.c) < 0.15 && (P.z0 ?? 0) + P.H >= H - 0.02 && (P.z0 ?? 0) <= pav.altura + espLaje + 0.01).map(P => [P.a - regras.coluna, P.b + regras.coluna] as [number, number]).sort((a, b) => a[0] - b[0]);
        const livres: [number, number][] = []; let u = s0;
        for (const [a, b] of cheios) { if (a > u) livres.push([u, Math.min(a, s1)]); u = Math.max(u, b); }
        if (u < s1) livres.push([u, s1]);
        for (const [a0, b0] of livres) {
          if (b0 - a0 < 0.3) continue;
          const m = (a0 + b0) / 2, [px, py] = ponto(m, 0.3);
          if (!vazio.pl.some(Q => Q.pav === L.pav && Q.amb !== L.id && (aj.peAmb?.[Q.amb] ?? 0) < H - 0.3 && px > Math.min(Q.x0, Q.x1) && px < Math.max(Q.x0, Q.x1) && py > Math.min(Q.y0, Q.y1) && py < Math.max(Q.y0, Q.y1))) continue;   // só em cima de laje mais baixa
          const n = Math.max(1, Math.ceil((b0 - a0 - regras.folga + regras.coluna) / (larguraMaxDe(regras, Ht) + regras.folga + regras.coluna)));
          const w = (b0 - a0 - (n - 1) * regras.coluna) / n;
          for (let k = 0; k < n; k++) {
            const a = a0 + k * (w + regras.coluna), b = a + w, tid = `${L.id}|tira|${ld.o}|${ld.c.toFixed(2)}`;
            vazio.ps.push({ num: 0, trecho: tid, pav: L.pav, o: ld.o, c: ld.c, a, b, larg: w - regras.folga, H: Ht, comp: w, recortes: [], z0: pav.altura + espLaje, chave: `${tid}@${a.toFixed(2)}`,
              aviso: `tira em cima da laje (de ${br(pav.altura + espLaje)} a ${br(H)} m): fecha a diferença até a laje do pé-direito de ${br(H)} m` });
          }
        }
      }
    }
    numerar(vazio.ps, ativos.map(p => p.id), aj.paredeNumFixa);
    numerarLajes(vazio.pl, ativos.map(p => p.id), aj.lajeNumFixa);
    { let nv = 0, nt = 0; vazio.vigas = sugerirVigas(ativos, vazio.ts, vazio.ps, vazio.vaos, vazio.lajes, regras, pisos).map(v => ({ ...v, n: v.tipo === 'trelica' ? ++nt : ++nv }));
      // treliças pedidas nos painéis compridos: ao longo do painel, uma em cada lateral e as outras distribuídas (numeradas depois das de parede)
      for (const P of vazio.pl) {
        const tp = aj.trelicasPainel?.[P.pav]; if (!tp || P.comp < tp.compMin - 0.005) continue;
        const q = Math.max(2, tp.qtd ?? 3), H = P.sentido === 'H', c0 = (H ? P.y0 : P.x0) + tp.borda, c1 = (H ? P.y1 : P.x1) - tp.borda;
        for (let k = 0; k < q; k++) {
          const c = c0 + (c1 - c0) * k / (q - 1);
          vazio.vigas.push({ id: `${P.pav}-trp-L${P.num}-${k}`, pav: P.pav, o: P.sentido, c, a: H ? P.x0 : P.y0, b: H ? P.x1 : P.y1, tipo: 'trelica', obrigatoria: false,
            motivo: `Treliça ${k === 0 || k === q - 1 ? 'da lateral' : 'do meio'} do painel L${P.num} (${br(P.comp)} m), pedida para todos os painéis a partir de ${br(tp.compMin)} m.`, ideia: '', rebaixos: [], n: ++nt });
        }
      }
    }
    // parede de cima que apoia em cima da viga fica mais baixa
    // (no vazio a viga ocupa a altura da laje: a parede não desce até a parede de baixo)
    for (const v of vazio.vigas) for (const d of v.desconto || []) {
      const p = vazio.ps.find(x => x.num === d.painel); if (!p) continue;
      const para = desceu.has(p) ? d.para - espLaje : d.para;
      if (p.H <= para) continue;
      if (desceu.has(p)) { desceu.delete(p); for (const r of p.recortes) r.base = Math.max(0, r.base - (p.desce ?? 0)); delete p.desce; p.aviso = p.aviso?.split(' · ').filter(x => !x.includes('(vazio)')).join(' · ') || undefined; }
      somaAltura(p, para - p.H); p.aviso = (p.aviso ? p.aviso + ' · ' : '') + `altura reduzida para ${br(para)} m: apoia em cima da viga V${v.n}`;
    }
    // vigas de concreto: pontas reais e encaixe no topo da parede de apoio
    // (viga com seção definida que desce abaixo do topo da parede: o painel ganha um recorte no topo do tamanho da viga, onde ela apoia)
    for (const v of vazio.vigas) {
      if (v.tipo === 'trelica') continue;
      const pav = ativos.find(q => q.id === v.pav); if (!pav) continue;
      const sec = aj.vigaSecao?.[v.id], larg = sec?.larg ?? regras.vigaLargura ?? 0.15, alt = sec?.alt ?? v.altura ?? regras.vigaAltura ?? 0.3;
      const pt = pontasViga(v, vazio.ts.filter(t => t.pav === v.pav), (aj.pilares || []).filter(q => q.pav === v.pav), vazio.vigas.filter(x => x.pav === v.pav), larg);
      v.ini = pt.a; v.fim = pt.b;
      const fundo = pav.altura + (sec?.abaixo ? 0 : espLaje) - alt;   // fundo da viga, a partir do piso do pavimento
      if (!sec) continue;   // encaixe só nas vigas com a seção definida pelo engenheiro (as sugeridas não mexem na fabricação)
      for (const { t } of pt.paredes) for (const P of vazio.ps) {
        if (P.pav !== v.pav || P.o !== t.o || Math.abs(P.c - t.c) > 0.05) continue;
        const a0 = Math.min(P.a, P.b), a1 = a0 + P.larg, f0 = v.c - larg / 2 - 0.01, f1 = v.c + larg / 2 + 0.01;
        if (f1 <= a0 || f0 >= a1) continue;
        const desce = P.H - fundo; if (desce < 0.02) continue;
        const dl = Math.max(0, f0 - a0), w = Math.min(a1, f1) - a0 - dl; if (w < 0.05) continue;
        P.recortes.push({ tipo: `apoio da ${sec?.nome || `V${v.n}`}`, dl, w, base: P.H - desce, h: desce });
        P.aviso = (P.aviso ? P.aviso + ' · ' : '') + `recorte de ${Math.round(w * 100)} × ${Math.round(desce * 100)} cm no topo: apoio da viga ${sec?.nome || `V${v.n}`}`;
      }
    }
    // painel girado (montado virado): recortes e aberturas da planta espelhados dentro do painel
    for (const P of vazio.ps) if (P.chave && aj.painelGirado?.includes(P.chave)) {
      const pa = Math.min(P.a, P.b), L = P.larg, m = (u: number) => 2 * pa + L - u;
      for (const r of P.recortes) r.dl = L - r.dl - r.w;
      for (const v of vazio.vaos) if (v.trecho === P.trecho && v.a >= pa - 0.3 && v.b <= pa + L + 0.3) { const a = m(v.b), b = m(v.a); v.a = a; v.b = b; }
      P.aviso = (P.aviso ? P.aviso + ' · ' : '') + 'painel girado: porta e janela do outro lado';
    }
    // rebaixo no topo definido à mão (viga de borda apoiada em parte da parede)
    for (const P of vazio.ps) for (const rb of aj.rebaixoTopo?.[P.chave ?? ''] || []) {
      const dl = Math.max(0, rb.dl), w = Math.min(P.larg - dl, rb.w), h = Math.min(rb.h, P.H - 0.5);
      if (w < 0.05 || h < 0.02) continue;
      P.recortes.push({ tipo: 'rebaixo da viga', dl, w, base: P.H - h, h });
      P.aviso = (P.aviso ? P.aviso + ' · ' : '') + `rebaixo de ${Math.round(h * 100)} cm no topo, de ${br(dl)} a ${br(dl + w)} m: viga de borda`;
    }
    return vazio;
  }, [leitura, pavs, quadro, regras, aj]);
  // dados de produção (etiquetas, corte de isopor/treliça, plano de carga): pesado, só nas abas que usam (e no celular pelo QR)
  const precisaProd = aba === 'impressao' || aba === 'acompanhamento' || new URLSearchParams(location.search).has('peca');
  const prod = useMemo(() => precisaProd && leitura && (regras.motor ?? 1) >= 2 ? dadosProducao(ativos, calc, regras, aj, leitura) : null, [precisaProd, calc, leitura, regras, aj, ativos]);
  const [modoImp, setModoImp] = useState<'folhas' | 'etiquetas'>('folhas');
  const [pavsImp, setPavsImp] = useState<string[]>([]);
  // deslocamento de cada pavimento para ficar em cima do de baixo (mesmo encaixe da laje): 3D e IFC
  const desloc3d = useMemo(() => {
    const d: Record<string, { dx: number; dy: number }> = {};
    ativos.forEach((p, i) => { if (!i) { d[p.id] = { dx: 0, dy: 0 }; return; } const b = ativos[i - 1], db = d[b.id], en = calc.encaixes[p.id];
      d[p.id] = en ? { dx: db.dx + en.x - p.box.x0 + b.box.x0, dy: db.dy + en.y - p.box.y0 + b.box.y0 } : { dx: db.dx + b.box.x0 - p.box.x0, dy: db.dy + b.box.y0 - p.box.y0 }; });
    return d;
  }, [ativos, calc]);
  const espParede3d = (regras.isoporAlt ?? 0.09) + 2 * (regras.capeamento ?? 0.025) + 0.01;
  // fundação para o 3D (mesmos pontos da aba Fundação): blocos, estacas e base de canaleta do térreo
  const fund3d = useMemo(() => {
    const pf = ativos[0]; if (!pf || !calc.ts.length) return null;
    const tf = calc.ts.filter(t => t.pav === pf.id), psf = calc.ps.filter(p => p.pav === pf.id); if (!tf.length) return null;
    const doPav = <T extends { pav: string }>(l?: T[]) => (l || []).filter(e => e.pav === pf.id);
    const oe = { ...ESTACA_PADRAO, ...(regras.estaca || {}) }, ob = { ...BLOCO_PADRAO, ...(regras.bloco || {}) }, f = { ...FUND_VAZIA, ...(aj.fund || {}) };
    const ptsW = pontosFundacao(tf, psf, regras.fundEspac ?? 0, { extra: doPav(aj.fundExtra), remover: doPav(aj.fundRemover), pares: f.auto2E ? doPav(aj.fundPar2) : [] }, regras.fundJunta ?? 0.5, 3 * oe.furo);
    const pts = blocosDivisa(ptsW, tf, aj.fundDivisa || [], ob.lado / 2);
    return { pav: pf.id, pts: pts.map(p => ({ n: p.n, x: p.x, y: p.y, tipo: p.tipo, par: p.par, cobre: p.cobre })), lado: ob.lado, alt: ob.alt, furo: oe.furo, comp: oe.comp,
      can: f.canaleta ? canaletaBase(tf, psf).pecas : null, canAlt: CANALETA.alt };
  }, [ativos, calc, regras, aj]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 3D: o que aparece no painel lateral ao clicar numa peça (medidas, espessura, peso e a ferragem detalhada do tipo dela)
  const info3d = useCallback((cod: string): InfoPeca | null => {
    const sg = siglas(ativos), fmt = (v: number, n = 2) => br(v, n), nomePav = (id: string) => ativos.find(a => a.id === id)?.nome ?? '';
    const ferragem = (laje: boolean, peca: Painel | PainelLaje) => async () => {
      const { detalhar } = await import('./engine/pranchasArm.ts'), { paginaParaSvg } = await import('./engine/folhaDoc.ts');
      const E = { obra: projNome || nome.replace(/\.(dxf|dwg|pdf|json)$/i, ''), resp: 'Eng. Nathael Fernando Miranda dos Santos · CREA 1020724730D-GO', pavs: ativos.map(p => ({ id: p.id, nome: p.nome })),
        ps: laje ? [] : [peca as Painel], pl: laje ? [peca as PainelLaje] : [], vigas: calc.vigas.filter(v => v.tipo === 'trelica'), regras,
        espLaje: (q: PainelLaje) => espDaLaje(aj)(q) ?? regras.lajeEsp ?? 0.14, balanco: balancoLaje(calc.ps), travamento: travamentoParede(calc.ps), codP: (q: Painel) => codigoParede(q, sg), codL: (q: PainelLaje) => codigoLaje(q, sg),
        liberado: aj.arm?.liberado ?? true, trelBorda16: aj.arm?.trelBorda16 ?? true, revisao: aj.arm?.revisao };
      const d = detalhar(E, laje), pgs = d.paginas.length > 3 ? d.paginas.slice(1, 3) : [d.paginas[1] ?? d.paginas[0]];   // as 2 folhas do tipo: jogo inferior e superior
      return { svg: pgs.map(paginaParaSvg).join(''), resumo: `Folha do tipo desta peça · aço ${br(d.kg, 1)} kg${d.avisos.length ? ' · ' + d.avisos.join(' · ') : ''}` };
    };
    const p = calc.ps.find(q => codigoParede(q, sg) === cod);
    if (p) {
      const kg = pesoParede(p, regras);
      return { titulo: `${cod} · parede`, ferragem: ferragem(false, p), linhas: [['Largura × altura', `${fmt(p.larg)} × ${fmt(p.H)} m`], ['Espessura', `${Math.round(espParede3d * 100 - 1)} cm (isopor ${Math.round((regras.isoporAlt ?? 0.09) * 100)} + 2 capas de ${br((regras.capeamento ?? 0.025) * 100, 1)})`],
        ['Recortes', p.recortes.length ? p.recortes.map(r => `${r.tipo} ${Math.round(r.w * 100)}×${Math.round(r.h * 100)}`).join(' · ') : 'nenhum'], ['Área', `${fmt(p.larg * p.H)} m²`], ['Peso', `${br(kg, 0)} kg`], ['Pavimento', nomePav(p.pav)], ...(p.aviso ? [['Obs.', p.aviso] as [string, string]] : [])] };
    }
    const l = calc.pl.find(q => codigoLaje(q, sg) === cod);
    if (l) {
      const e = espDaLaje(aj)(l) ?? regras.lajeEsp ?? 0.14, kg = pesoLaje(l, regras, e);
      return { titulo: `${cod} · laje`, ferragem: ferragem(true, l), linhas: [['Comprimento × largura', `${fmt(l.comp)} × ${fmt(l.larg)} m`], ['Espessura', `${Math.round(e * 100)} cm${l.comp > 4 + 1e-6 && e >= 0.16 - 1e-6 ? ' (vão acima de 4 m)' : ''}`],
        ['Vão entre paredes', (() => { const [b0, b1] = balancoLaje(calc.ps)(l); return b0 + b1 > 0.05 ? `${fmt(l.comp - b0 - b1)} m + balanço ${fmt(b0)} / ${fmt(b1)} m` : `${fmt(l.comp)} m (sem balanço)`; })()],
        ['Treliça', trelicaDaEsp(e)], ['Sentido', l.sentido === 'H' ? 'horizontal' : 'vertical'], ['Área', `${fmt(l.comp * l.larg)} m²`], ['Peso', `${br(kg, 0)} kg`], ['Pavimento', nomePav(l.pav)]] };
    }
    return null;
  }, [ativos, calc, regras, aj, projNome, nome, espParede3d]);   // eslint-disable-line react-hooks/exhaustive-deps
  const props3d = useMemo(() => ({ info: info3d, fund: fund3d, pavs: ativosT, desloc: desloc3d, ps: calc.ps, pl: calc.pl, espLaje: (p: PainelLaje) => espDaLaje(aj)(p) ?? regras.lajeEsp ?? 0.14, espParede: espParede3d, sg: siglas(ativos), pilares: aj.pilares, vigas: calc.vigas.filter(v => v.tipo !== 'trelica' && aj.vigaSecao?.[v.id]).map(v => { const s = aj.vigaSecao?.[v.id]; return { pav: v.pav, nome: s?.nome || `V${v.n}`, o: v.o, c: v.c, a: v.ini ?? v.a, b: v.fim ?? v.b, larg: s?.larg ?? regras.vigaLargura ?? 0.15, alt: s?.alt ?? v.altura ?? regras.vigaAltura ?? 0.3, abaixo: s?.abaixo }; }), peLaje: (p: PainelLaje) => { const v = aj.peAmb?.[p.amb]; return v != null && p.pav === ativosT[0]?.id ? v - (ativosT[0].baseAcima ?? 0) : v; } }),
    [ativos, ativosT, fund3d, info3d, desloc3d, calc, aj, regras.lajeEsp, espParede3d]);   // imprimir só estes pavimentos (vazio = todos)
  const [soEtq, setSoEtq] = useState('');   // imprimir só estas etiquetas (códigos separados por vírgula, espaço ou linha)
  const [revBase, setRevBase] = useState<number | null>(null);
  const [notaRev, setNotaRev] = useState('');
  // QR da etiqueta: ?obra=<projeto>&peca=<código> abre a peça no celular para marcar a montagem
  const qr = useMemo(() => { const u = new URLSearchParams(location.search); const o = u.get('obra'), pc = u.get('peca'), k = u.get('k'); return o && pc ? { obra: o, peca: pc, k } : null; }, []);
  const [qrAtivo, setQrAtivo] = useState(!!qr);
  const [montagem, setMontagem] = useState<Record<string, cloud.Marca>>({});
  useEffect(() => { if (qr && qrAtivo && (sess || !cloud.nuvemConfigurada) && projId !== qr.obra) abrirProjeto(qr.obra); }, [sess?.user.id]);
  const [pend, setPend] = useState<cloud.AjustePendente[]>([]);
  const lerPend = () => { if (projId && sess && cloud.nuvemConfigurada) cloud.ajustesPendentes(projId).then(setPend); else setPend([]); };
  useEffect(lerPend, [projId, sess?.user.id]);
  const resolverPend = async (p: cloud.AjustePendente, aplicar: boolean) => {
    if (aplicar) {
      const n = { ...aj } as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(p.mudancas)) if (k in AJUSTES_VAZIOS) n[k] = v;
      setAj(n as unknown as Ajustes);
    }
    try { await cloud.resolverAjuste(p.id, aplicar ? 'aplicado' : 'recusado'); } catch (e) { setErro('Não consegui marcar a alteração: ' + (e as Error).message); }
    setPend(l => l.filter(x => x.id !== p.id));
  };
  useEffect(() => { if (projId && sess && cloud.nuvemConfigurada) cloud.lerMontagem(projId).then(setMontagem).catch(() => setMontagem({})); }, [projId, sess?.user.id]);
  // chave da obra: vai no QR para marcar a peça sem login (null = SQL das marcações ainda não rodado)
  const [chaveQR, setChaveQR] = useState<string | null>(null);
  const [marcs, setMarcs] = useState<cloud.Marcacao[]>([]);
  useEffect(() => { setChaveQR(null); setMarcs([]); if (projId && sess && cloud.nuvemConfigurada) { cloud.chaveObra(projId).then(setChaveQR); cloud.lerMarcacoes(projId).then(setMarcs); } }, [projId, sess?.user.id]);
  useEffect(() => { if (!projId || !sess || aba !== 'acompanhamento') return; const t = setInterval(() => cloud.lerMarcacoes(projId).then(setMarcs), 30000); return () => clearInterval(t); }, [projId, sess?.user.id, aba]);
  const qrBase = cloud.nuvemConfigurada && sess && projId ? (chaveQR ? `${location.origin}/?obra=${projId}&k=${chaveQR}&peca=` : `${location.origin}/?obra=${projId}&peca=`) : '';
  // informações das peças para quem escaneia o QR (conferência): envia sozinho quando o projeto muda
  useEffect(() => {
    if (!prod || !projId || !sess || !chaveQR || !cloud.nuvemConfigurada) return;
    const t = setTimeout(() => {
      const trel = (p: (typeof calc.pl)[number]) => calc.vigas.filter(v => v.pav === p.pav && v.tipo === 'trelica').map(v => ({ ...v, tipo: trelicaDaEsp(espDaLaje(aj)(p) ?? 0) }));
      const rows = prod.pecas.map(pc => {
        let desenho = '';
        if (pc.tipo === 'Parede') { const p = calc.ps.find(x => x.num === pc.num); if (p) desenho = vistaSvg(p, prod.infos.get(p.num), 18); }
        else { const p = calc.pl.find(x => x.num === pc.num); if (p) desenho = vistaLajeSvg(p, [], trel(p), 0, 18, pc.codigo); }
        const dados: cloud.InfoPeca = { tipo: pc.tipo, pav: pavs.find(x => x.id === pc.pav)?.nome ?? '', desc: pc.desc, area: pc.area, peso: pc.peso,
          ordem: pc.ordemPav, esq: pc.esq, dir: pc.dir, face: pc.face, aberturas: pc.aberturas, carreta: pc.carreta, pilha: pc.pilha, desenho };
        return { peca: pc.codigo, dados };
      });
      const txt = JSON.stringify(rows); let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
      const chaveH = 'alv-info-' + projId;
      try { if (localStorage.getItem(chaveH) === String(h)) return; } catch { /* sem armazenamento */ }
      cloud.enviarInfoPecas(projId, rows).then(ok => { if (ok) try { localStorage.setItem(chaveH, String(h)); } catch { /* sem armazenamento */ } });
    }, 4000);
    return () => clearTimeout(t);
  }, [prod, projId, sess?.user.id, chaveQR]);

  const cortes = useMemo(() => dxf ? lerCortes(dxf, pavs.filter(p => p.corte)) : [], [dxf, pavs]);
  const avisos = useMemo(() => conferir(cortes, ativos, quadro, regras, calc.ps), [cortes, pavs, quadro, regras, calc]);

  // paredes desenhadas no sistema entram no desenho (contorno + hachura), como as do projeto
  const paredeDesenho = (m: { o: 'H' | 'V'; c: number; a: number; b: number; esp?: number }): Prim[] => {
    const h = (m.esp ?? 0.14) / 2, [x0, x1, y0, y1] = m.o === 'H' ? [m.a, m.b, m.c - h, m.c + h] : [m.c - h, m.c + h, m.a, m.b];
    const L = (a: [number, number], b: [number, number]): Prim => ({ kind: 'line', pts: [a, b], layer: 'PAREDE' });
    const out = [L([x0, y0], [x1, y0]), L([x1, y0], [x1, y1]), L([x1, y1], [x0, y1]), L([x0, y1], [x0, y0])];
    // hachura a 45° (x - y = k), recortada no retângulo
    for (let k = x0 - y1 + 0.05; k < x1 - y0; k += 0.05) {
      const xa = Math.max(x0, y0 + k), xb = Math.min(x1, y1 + k);
      if (xb - xa > 0.005) out.push(L([xa, xa - k], [xb, xb - k]));
    }
    return out;
  };
  const arqDe = (box: Box): Prim[] => leitura ? [...arqLimpa.filter(p => p.pts.every(q => q[0] > box.x0 - 0.6 && q[0] < box.x1 + 0.6 && q[1] > box.y0 - 0.6 && q[1] < box.y1 + 0.6)),
    ...(aj.paredesManuais || []).filter(m => { const [x, y] = m.o === 'H' ? [(m.a + m.b) / 2, m.c] : [m.c, (m.a + m.b) / 2]; return x > box.x0 - 0.6 && x < box.x1 + 0.6 && y > box.y0 - 0.6 && y < box.y1 + 0.6; }).flatMap(paredeDesenho)] : [];
  const pavAtual = ativos.find(p => p.id === pavSel) || ativos[0];

  // QR com a chave da obra: tela de marcação sem login
  if (qr?.k && cloud.nuvemConfigurada) return <PecaQRLigada obra={qr.obra} chave={qr.k} peca={qr.peca} />;
  if (cloud.nuvemConfigurada && (!checou || !sess || recuperando)) return <Login carregando={!checou} recuperando={recuperando} fimRecuperacao={() => setRecuperando(false)} />;
  if (qr && qrAtivo) {
    const pc = prod?.pecas.find(x => x.codigo === qr.peca);
    let desenho = '';
    if (pc && pc.tipo === 'Parede') { const p = calc.ps.find(x => x.num === pc.num); if (p) desenho = vistaSvg(p, prod!.infos.get(p.num), 18); }
    if (pc && pc.tipo === 'Laje') { const p = calc.pl.find(x => x.num === pc.num); if (p) desenho = vistaLajeSvg(p, [], calc.vigas.filter(v => v.pav === p.pav && v.tipo === 'trelica').map(t => ({ ...t, tipo: trelicaDaEsp(espDaLaje(aj)(p) ?? 0) })), 0, 18, pc.codigo); }
    return <PecaCelular codigo={qr.peca} pc={pc} obra={projNome} pav={pc ? pavs.find(x => x.id === pc.pav)?.nome ?? '' : ''} desenho={desenho} carregando={lendo || (!prod && !erro)} erro={erro}
      marca={montagem[qr.peca]} marcar={async m => { if (!projId || !cloud.nuvemConfigurada) throw new Error('marcar a montagem precisa do projeto na nuvem (login)'); setMontagem(await cloud.marcarMontagem(projId, qr.peca, m && { ...m, em: new Date().toISOString(), por: sess?.user.email ?? '' })); }}
      montadas={Object.values(montagem).filter(m => m.status === 'montada').length} total={prod?.pecas.length ?? 0}
      sair={() => { setQrAtivo(false); history.replaceState(null, '', location.pathname); }} />;
  }
  const tabs: [Aba, string][] = [['arquivo', '1. Arquivo'], ['pavimentos', '2. Desenhos'], ['esquadrias', '3. Portas e janelas'], ['regras', '4. Regras'], ['modulacao', '5. Paredes'], ['lajes', '6. Lajes'], ['vigas', '7. Vigas'], ['cortes', '8. Cortes'], ['impressao', '9. Impressão e arquivos'], ['fundacao', '10. Fundação'], ['orcamento', '11. Orçamento'], ['acompanhamento', '12. Produção e obra'], ['v3d', '13. Ver em 3D']];
  const erros = avisos.filter(a => a.nivel === 'erro').length;
  return (
    <div className="app">
      <header className="topo noprint">
        <h1>Alveolar Modulação</h1>
        <span className="arq">{projNome ? `${projNome} · salvo automaticamente` : 'nenhum projeto aberto'}</span>
        {calc.ps.length > 0 && <Resumo ps={calc.ps} pl={calc.pl} />}
        {sess && <span className="usuario">{sess.user.email} <button onClick={() => { cloud.sair(); setProjId(null); setDxf(null); setNome(''); setProjNome(''); setAba('arquivo'); }}>Sair</button></span>}
      </header>
      {lendo && <div className="carregando noprint">Abrindo o projeto… arquivos grandes podem levar alguns segundos.</div>}
      {dxf && pend.length > 0 && <div className="caixa noprint">{pend.map(p => {
        const mudou = p.antes && Object.keys(p.antes).some(k => JSON.stringify((aj as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify(p.antes![k] ?? null));
        return <div key={p.id} className="caixa-item">
          <b>📥 Alteração enviada pelo Claude</b> ({new Date(p.criado).toLocaleString('pt-BR')}): {p.descricao}
          {mudou && <span className="erro"> · Atenção: o projeto mudou depois que essa alteração foi preparada; confira após aplicar (dá para desfazer).</span>}
          <button onClick={() => resolverPend(p, true)}>Aplicar</button> <button onClick={() => resolverPend(p, false)}>Recusar</button>
        </div>; })}</div>}
      <nav className="abas noprint">{tabs.map(([k, t]) => <button key={k} className={aba === k ? 'on' : ''} disabled={k !== 'arquivo' && !dxf} onClick={() => setAba(k)}>{t}{k === 'cortes' && erros > 0 ? ` (${erros})` : ''}</button>)}</nav>
      <main>
        {aba === 'arquivo' && (
          <>
          <div className="pastas">
            {([['modulacao', 'Projetos para desmembramento'], ['orcamento', 'Orçamentos']] as [Pasta, string][]).map(([k, t]) =>
              <button key={k} className={pasta === k ? 'on' : ''} onClick={() => setPasta(k)}>📁 {t} ({projetos.filter(p => pastaDe(p) === k).length})</button>)}
          </div>
          <section className="card">
            <h2>{pasta === 'orcamento' ? 'Novo orçamento' : 'Novo projeto para desmembramento'}</h2>
            <p>Envie o projeto em <b>DWG</b>, <b>DXF</b> ou <b>PDF</b> exportado do programa de projeto (PDF vetorial, não escaneado). DWG e DXF são mais precisos. {pasta === 'orcamento' ? 'Fica na pasta Orçamentos, separado dos projetos de desmembramento.' : ''} {sess ? 'O arquivo e todos os ajustes ficam salvos na sua conta, na nuvem.' : 'O arquivo e todos os ajustes ficam salvos neste navegador.'}</p>
            <input type="file" accept=".dxf,.dwg,.pdf" onChange={e => { const f = e.target.files?.[0]; if (f) novo(f); e.target.value = ''; }} />
            {lendo && <p>Lendo o arquivo…</p>}
            {avisoPdf.length > 0 && <ul className="dica">{avisoPdf.map((a, i) => <li key={i}>{a}</li>)}</ul>}
            {erro && <p className="erro">{erro}</p>}
            {dxf && <div className="campo"><label>Camada das paredes do projeto aberto</label>
              <select value={camada} onChange={e => { const v = e.target.value; const { auto, L } = desenhosAuto(dxf, v); setCamada(v); setPavs(auto); if (!quadro.length) setQuadro(L.quadro); }}>{dxf.layers.map(l => <option key={l}>{l}</option>)}</select>
              <small>{leitura?.paredes.length} linhas nessa camada · {leitura?.regioes.length} desenhos encontrados</small></div>}
          </section>
          <section className="card">
            <h2>{pasta === 'orcamento' ? 'Meus orçamentos' : 'Meus projetos'}</h2>
            {projetos.filter(p => pastaDe(p) === pasta).length === 0 ? <p className="dica">{pasta === 'orcamento' ? 'Nenhum orçamento salvo ainda.' : 'Nenhum projeto salvo ainda.'}</p> :
            <table className="tab projetos"><thead><tr><th>Projeto</th><th>Arquivo</th><th>Atualizado</th><th></th></tr></thead><tbody>
              {projetos.filter(p => pastaDe(p) === pasta).map(p => <tr key={p.id} className={p.id === projId ? 'atual' : ''}>
                <td><input defaultValue={p.nome} onBlur={e => { const v = e.target.value.trim(); if (v && v !== p.nome) { repo.renomear(p.id, v).then(atualizarLista); if (p.id === projId) setProjNome(v); } }} /></td>
                <td className="dica">{p.arquivo}</td>
                <td className="dica">{new Date(p.atualizado).toLocaleString('pt-BR')}</td>
                <td className="botoes">
                  <button onClick={() => abrirProjeto(p.id)}>{p.id === projId ? 'Aberto' : 'Abrir'}</button>
                  <button onClick={async () => { const c = await repo.carregar(p.id); const bl = c ? new Blob([JSON.stringify({ formato: 'alveolar-modulacao', versao: 1, nome: c.nome, arquivo: c.arquivo, config: c.config, dxf: await c.dxf.text() })], { type: 'application/json' }) : null; if (bl) { const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = p.nome + '.modulacao.json'; a.click(); } }}>Baixar cópia</button>
                  <button onClick={async () => { const nova: Pasta = pastaDe(p) === 'orcamento' ? 'modulacao' : 'orcamento'; await repo.salvarConfig(p.id, { ...(p.config || {}), pasta: nova } as Config); if (p.id === projId) setProjPasta(nova); atualizarLista(); }}>{pastaDe(p) === 'orcamento' ? 'Mover para desmembramento' : 'Mover para orçamentos'}</button>
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
            {pavs.length === 0 && <p className="erro">Não encontrei nenhum desenho com paredes neste arquivo, por isso não há planta para marcar nem pé-direito para aplicar. Na aba <b>1. Arquivo</b>, troque a <b>"Camada das paredes"</b> para a camada onde estão as paredes do projeto (ex.: PAREDE, ALVENARIA, A-WALL).</p>}
            {pavs.length === 0 ? null : pesLidos.length > 0 ? <p className="ok-box">Pés-direitos lidos dos cortes, de baixo para cima: <b>{pesLidos.map(v => br(v)).join(' · ')}</b>.
              {' '}<button onClick={() => { let k = 0; setPavs(pavs.map(q => q.ativo ? { ...q, altura: pesLidos[k++] ?? pesLidos[pesLidos.length - 1] } : q)); }}>Aplicar às plantas na ordem</button></p>
              : <div className="aviso-local">Não encontrei o pé-direito nas cotas dos cortes. <PeRapido pavs={pavs} setPavs={setPavs} /> Ou escolha em cada planta abaixo.</div>}
            <div className="regioes">
              {pavs.map((p, i) => (
                <div key={p.id} className={'regiao' + (p.ativo ? ' on' : p.corte ? ' corte' : '')}>
                  <Miniatura prims={leitura.paredes} box={p.box} />
                  <select value={p.ativo ? 'planta' : p.corte ? 'corte' : 'nao'} onChange={e => {
                    const novo = pavs.map(q => q.id === p.id ? { ...q, ativo: e.target.value === 'planta', corte: e.target.value === 'corte' } : q);
                    const ordem = novo.filter(q => q.ativo).map(q => q.id);
                    setPavs(novo.map(q => q.id === p.id && q.ativo && pesLidos.length ? { ...q, altura: pesLidos[ordem.indexOf(q.id)] ?? pesLidos[pesLidos.length - 1] } : q));
                  }}>
                    <option value="nao">Não usar</option><option value="planta">Planta baixa (modular)</option><option value="corte">Corte (conferir alturas)</option>
                  </select>
                  <input value={p.nome} onChange={e => setPavs(pavs.map(q => q.id === p.id ? { ...q, nome: e.target.value } : q))} />
                  {p.ativo && <label>Pé-direito (m) <input type="number" step="0.01" value={p.altura} onChange={e => setPavs(pavs.map(q => q.id === p.id ? { ...q, altura: parseFloat(e.target.value) || 0 } : q))} />
                    {!pesLidos.length && <select value={PES.some(v => Math.abs(v - p.altura) < 1e-6) ? p.altura.toFixed(2) : ''} onChange={e => e.target.value && setPavs(pavs.map(q => q.id === p.id ? { ...q, altura: parseFloat(e.target.value) } : q))}>
                      <option value="">escolher…</option>{PES.map(v => <option key={v} value={v.toFixed(2)}>{br(v)}</option>)}</select>}</label>}
                  {p.ativo && calc.encaixes[p.id] && (() => {
                    const e = p.encaixe ?? calc.encaixes[p.id];
                    const muda = (v: { x: number; y: number } | undefined) => setPavs(pavs.map(q => q.id === p.id ? { ...q, encaixe: v } : q));
                    return <div className="encaixe">
                      <label><input type="checkbox" checked={!!p.encaixe} onChange={ev => muda(ev.target.checked ? { x: +e.x.toFixed(2), y: +e.y.toFixed(2) } : undefined)} /> Encaixe manual sobre a planta de baixo</label>
                      {p.encaixe ? <span>canto esquerdo-inferior a <input type="number" step="0.01" value={p.encaixe.x} onChange={ev => muda({ ...p.encaixe!, x: parseFloat(ev.target.value) || 0 })} /> m para a direita e
                        {' '}<input type="number" step="0.01" value={p.encaixe.y} onChange={ev => muda({ ...p.encaixe!, y: parseFloat(ev.target.value) || 0 })} /> m para cima do canto da planta de baixo</span>
                        : <small>automático: {br(e.x)} m para a direita, {br(e.y)} m para cima</small>}
                    </div>;
                  })()}
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
            <h3>Colar quadro</h3>
            <p className="dica">Quando o quadro só existe em PDF: cole uma linha por esquadria — código, largura, altura e (nas janelas) peitoril. Aceita metros ou centímetros, separados por espaço, tab ou ponto e vírgula. Ex.: <code>J1 140 405 50</code> ou <code>PM1 0,70 2,10</code>. Códigos já existentes são atualizados.</p>
            <textarea rows={6} style={{ width: '100%', fontFamily: 'monospace' }} value={colar} onChange={e => setColar(e.target.value)} placeholder={'J1 140 405 50\nPM1 70 210'} />
            <button onClick={() => {
              const novos = colar.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
                const [tag, ...r] = l.split(/[\s;\t]+/);
                const n = r.map(x => parseFloat(x.replace(',', '.'))).filter(x => !isNaN(x));
                const m = (x: number | undefined) => x === undefined ? 0 : x > 9 ? x / 100 : x;   // centímetros ou metros
                const t = tag.toUpperCase();
                return n.length >= 2 ? { tag: t, larg: m(n[0]), alt: m(n[1]), peit: t.startsWith('J') ? m(n[2]) : 0 } : null;
              }).filter((x): x is Esquadria => !!x);
              if (!novos.length) { setErro('Nenhuma linha válida no quadro colado (código, largura, altura e peitoril).'); return; }
              setQuadro([...quadro.filter(q => !novos.some(n => n.tag === q.tag)), ...novos].sort((a, b) => a.tag.localeCompare(b.tag, 'pt', { numeric: true })));
              setColar('');
            }}>Preencher a tabela</button>
            <p className="dica">Etiquetas encontradas nas plantas: {[...new Set(leitura?.tags.map(t => t.text))].join(', ') || 'nenhuma'}</p>
          </section>
        )}

        {aba === 'regras' && (
          <section className="card">
            <h2>Regras</h2>
            <h3>Paredes</h3>
            <div className="grade">
              {([
                ['larguraMax', 'Largura máxima do painel (m)'], ['larguraExcecao', 'Exceção: fabricar painel mais largo até (m) — 0 = não'], ['alturaAlta', 'Parede alta: altura acima de (m)'], ['larguraAlta', 'Parede alta: largura máxima do painel (m) — 0 = não limita'], ['coluna', 'Coluna entre painéis (m)'], ['espacoMax', 'Espaço máximo entre painéis alinhados (m) — cálculo novo'], ['juntaEncontro', 'Encontro: junta de cada lado do painel que cruza (m) — 0,04 = 22 cm'], ['isoporLarg', 'Isopor: largura (m)'], ['isoporAlt', 'Isopor: altura (m)'], ['isoporComp', 'Isopor: comprimento da barra (m)'], ['isoporEspaco', 'Concreto entre um isopor e outro (m)'], ['capeamento', 'Capeamento em cima e embaixo do isopor (m)'], ['perda', 'Perda no isopor e no concreto (%)'], ['folga', 'Diminuir de cada painel (m)'],
                ['boneca', 'Boneca de transporte nas laterais e embaixo (m)'], ['acrescimoLargura', 'Vão de porta/janela maior em (m)'],
                ['janelaDesce', 'Janela: recorte desce e sobe (m)'], ['espMin', 'Espessura mínima de parede (m)'], ['espMax', 'Espessura máxima de parede (m)'],
                ['minParede', 'Trecho mínimo de parede (m)'], ['naoFabricar', 'Marcar "n fabricar" abaixo de (m)'],
                ['lajeEsp', 'Espessura da laje entre pavimentos (m)'], ['platibanda', 'Platibanda acima da laje de cobertura (m)'],
              ] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={(regras[k] as number) ?? 0} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
              <label className="chk"><input type="checkbox" checked={(regras.motor ?? 1) >= 2} onChange={e => setRegras({ ...regras, motor: e.target.checked ? 2 : 1, motorFixo: !e.target.checked })} /> Cálculo atual (padrão): muros fora, laje na garagem e na laje impermeabilizada, paredes tortas, esquadrias pela etiqueta, 17 cm entre painéis, boneca de transporte, produção das lajes e quantitativos. Desmarque só para refazer um projeto pelo cálculo antigo</label>
              <label className="chk"><input type="checkbox" checked={regras.escadaAuto !== false} onChange={e => setRegras({ ...regras, escadaAuto: e.target.checked })} /> Reconhecer a escada desenhada (degraus) e abrir o vão na laje sozinho. Na aba Lajes dá para fechar uma escada que não seja escada.</label>
              <label className="chk"><input type="checkbox" checked={!!regras.paredeDominante} onChange={e => { if (!e.target.checked || confirm('Ligar a leitura nova das paredes? Paredes que tinham uma linha de detalhe junto (soleira, bancada) passam a ter a espessura e o eixo certos. ATENÇÃO: as paredes que encostam nelas podem mudar a modulação dos painéis. Use em projeto que ainda não foi para produção, ou confira as peças depois (↶ Desfazer volta).')) setRegras({ ...regras, paredeDominante: e.target.checked }); }} /> Leitura nova das paredes: linha de detalhe junto da parede (soleira, bancada) não muda a espessura nem o eixo dela. Já vem ligada nos projetos novos. (As lajes já usam a face certa da parede em todos os projetos, ligada ou não.)</label>
              <label className="chk"><input type="checkbox" checked={regras.pinarAuto} onChange={e => setRegras({ ...regras, pinarAuto: e.target.checked })} /> No encontro em T, pinar a parede que chega e deixar a parede contínua sem emenda quando ela couber num painel só</label>
            </div>
            <h3>Lajes</h3>
            <div className="grade">
              {([['lajeComp', 'Vão máximo do painel de laje (m)'], ['lajeLarg', 'Largura máxima do painel (m)'], ['lajeApoio', 'Apoio em cima da parede com laje dos dois lados (m)'], ['lajeApoioBorda', 'Apoio onde só uma laje apoia na parede (m)'], ['lajeFolga', 'Folga entre painéis de laje (m)'], ['lajeEsp', 'Espessura da laje (m)']] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={(regras[k] as number) ?? 0} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
            </div>
            <h3>Vigas</h3>
            <div className="grade">
              {([['vigaAltura', 'Altura da viga (rebaixo nas paredes) (m)'], ['vigaLargura', 'Largura da viga (m)'], ['vigaApoio', 'Apoio da viga em cima da parede (m)'], ['vigaPisoAbaixo', 'Viga da linha de piso: parte abaixo da laje (m)'], ['vaoViga', 'Vão sem parede a partir do qual a viga é obrigatória (m)'], ['beiral', 'Beiral (balanço) de laje sem viga até (m)']] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={(regras[k] as number) ?? 0} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
            </div>
            <label className="chk"><input type="checkbox" checked={!!regras.trelicaSobreVao} onChange={e => setRegras({ ...regras, trelicaSobreVao: e.target.checked })} /> Parede de cima sobre vão livre (sala integrada, passagem, sem parede embaixo): reforçar a laje com treliça em vez de viga. A viga continua só onde a laje apoia nessa linha</label>
            <h3>Produção e montagem</h3>
            <div className="grade">
              {([['densidade', 'Peso do concreto (kg/m³) — peso das peças'], ['cargaMax', 'Carga máxima por carreta (kg)'], ['carretaComp', 'Comprimento útil da carreta (m)'], ['carretaLarg', 'Largura da carreta (m)'], ['carretaLargMax', 'Largura máxima com excesso lateral (m)'], ['pilhaAlt', 'Altura máxima da pilha de peças deitadas (m)'], ['escoraMax', 'Distância máxima entre linhas de escora da laje (m)'], ['trelicaBarra', 'Comprimento da barra de treliça (m)'], ['mesas', 'Mesas de produção na fábrica'], ['mesaComp', 'Comprimento útil da mesa (m)'], ['mesaLarg', 'Largura útil da mesa (m)']] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={(regras[k] as number) ?? (REGRAS_PADRAO[k] as number) ?? 0} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
            </div>
            <label>Plano de carga<select value={regras.cargaModo ?? 'auto'} onChange={e => setRegras({ ...regras, cargaModo: e.target.value as Regras['cargaModo'] })}>
              <option value="auto">Carreta cheia — na ordem da montagem quando dá, senão maior embaixo (padrão)</option>
              <option value="tamanho">Carreta cheia — sempre maior embaixo</option>
              <option value="montagem">Sempre na ordem da montagem (descarrega já montando, mais carretas)</option>
            </select></label>
            <ul className="dica">
              <li>Paredes acima da largura máxima são divididas em partes iguais, com coluna entre elas. No T, a coluna fica só na parede que segue alinhada (ou nenhuma, se a parede for pinada).</li>
              <li>Porta: boneca embaixo + altura do quadro (0,10 + 2,10 = 2,20). Janela: o peitoril baixa e o topo sobe pelo valor acima. Largura sempre maior pelo acréscimo.</li>
              <li>Boneca nas laterais de toda porta/janela que chega no fim da parede, e embaixo das portas.</li>
              <li>Laje: apoia sempre que possível nas paredes (inclusive internas); o painel pode ser menor que o máximo. O sentido é escolhido para precisar de menos vigas. Beiral até o limite acima sem viga.</li>
            </ul>
            <button onClick={() => setRegras({ ...REGRAS_PADRAO, motor: regras.motor, paredeDominante: regras.paredeDominante })}>Voltar ao padrão</button>
          </section>
        )}

        {(aba === 'modulacao' || aba === 'lajes') && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta baixa na aba Desenhos.</p></section> :
          <section className="mod">
<Divisor />
            <div className="lado">
              <div className="pavsel">{ativos.map(p => <button key={p.id} className={pavAtual.id === p.id ? 'on' : ''} onClick={() => { setPavSel(p.id); setSel(null); setVaoSel(null); setAmbSel(null); setLajeSel(null); }}>{p.nome}</button>)}</div>
              <div className="desfazer"><button disabled={!hist.current.antes.length} onClick={desfazer} title="Ctrl+Z">↶ Desfazer{hist.current.antes.length ? ` (${hist.current.antes.length})` : ''}</button><button disabled={!hist.current.depois.length} onClick={refazer} title="Ctrl+Y">↷ Refazer</button></div>
              {aba === 'modulacao'
                ? <Acoes pav={pavAtual} sel={sel} vaoSel={vaoSel} calc={calc} aj={aj} setAj={setAj} quadro={quadro} regras={regras} cortando={cortando} setCortando={setCortando} limpar={() => { setSel(null); setVaoSel(null); setCortando(null); }} />
                : <>
                  <div className="card acoes">
                    <h3>Espessura das lajes deste pavimento</h3>
                    <label>Espessura (cm) <input type="number" step="1" key={'esp' + pavAtual.id} defaultValue={Math.round((aj.lajeEspPav?.[pavAtual.id] ?? regras.lajeEsp) * 100)} onBlur={e => {
                      const v = parseFloat(e.target.value.replace(',', '.')); const m = { ...(aj.lajeEspPav || {}) };
                      if (!isFinite(v) || Math.abs(v / 100 - regras.lajeEsp) < 1e-6) delete m[pavAtual.id]; else m[pavAtual.id] = v / 100;
                      setAj({ ...aj, lajeEspPav: m }); }} /></label>
                    <p className="dica">Vale para todos os ambientes deste pavimento que não têm espessura própria. 16 cm usa treliça TG12.</p>
                  </div>
                  <div className="card acoes">
                    <h3>Escada</h3>
                    {calc.escadas.filter(x => x.pav === pavAtual.id).length === 0
                      ? <p className="dica">{regras.escadaAuto === false ? 'Reconhecimento da escada desligado nas regras.' : 'Nenhuma escada reconhecida neste pavimento. O vão abre sozinho quando os degraus estão desenhados aqui e no pavimento de cima (no mesmo lugar). Se não abrir, use "Sem laje aqui" no ambiente da escada.'}</p>
                      : calc.escadas.filter(x => x.pav === pavAtual.id).map(x => <div key={x.chave} className="corte-item">
                        {x.ligada ? '✔ vão aberto na laje' : '✖ laje fechada'} · {br(x.e.x1 - x.e.x0)} × {br(x.e.y1 - x.e.y0)} m · {x.e.passo ? `degraus a cada ${Math.round(x.e.passo * 100)} cm` : 'contorno com o texto ESCADA (helicoidal/caracol)'}
                        {x.ligada && <div className="secao-viga">
                          <b>Bordas do vão (m)</b>
                          {([['x0', 'esquerda (x)'], ['x1', 'direita (x)'], ['y0', 'embaixo (y)'], ['y1', 'em cima (y)']] as const).map(([k, rot]) => <label key={k}>{rot} <input type="number" step="0.01" key={x.chave + k + x.e[k]} defaultValue={x.e[k].toFixed(3)} onBlur={ev => {
                            const v = parseFloat(ev.target.value.replace(',', '.')); if (!isFinite(v) || Math.abs(v - x.e[k]) < 0.0005) return;
                            setAj({ ...aj, escadaVao: { ...(aj.escadaVao || {}), [x.chave]: { ...(aj.escadaVao?.[x.chave] || {}), [k]: v } } }); }} /></label>)}
                          {aj.escadaVao?.[x.chave] && <button onClick={() => { const m = { ...(aj.escadaVao || {}) }; delete m[x.chave]; setAj({ ...aj, escadaVao: m }); }}>Voltar ao vão reconhecido</button>}
                          <p className="dica">Use para levar a borda do vão até a junta das lajes que já foram produzidas: as lajes em volta ficam iguais e só a do lado do vão muda.</p>
                        </div>}
                        {x.viga && <div>+ viga de borda do vão: {x.viga.o === 'H' ? 'horizontal' : 'vertical'} de {br(x.viga.e - x.viga.s)} m, de parede a parede (apoia a laje que fica do lado do vão; apoia em parede ou linha de piso)</div>}
                        <button onClick={() => setAj({ ...aj, naoEscada: x.ligada ? [...(aj.naoEscada || []), x.chave] : (aj.naoEscada || []).filter(k => k !== x.chave) })}>{x.ligada ? 'não é escada (fechar laje)' : 'abrir o vão de novo'}</button></div>)}
                    <p className="dica">Reconhecida pelos degraus desenhados (5 ou mais, espaçados por igual) ou, na helicoidal/caracol, pelo contorno de 1,00 a 2,60 m com o texto ESCADA perto. O vão vai de parede a parede e leva o patamar junto; a laje do pavimento de cima não é afetada.</p>
                  </div>
                  <div className="card acoes">
                    <h3>Pilares</h3>
                    <button className={modoPilar ? 'on' : ''} onClick={() => { setModoPilar(!modoPilar); setModoViga(null); }}>{modoPilar ? 'Clique na ponta da parede ou no canto… (clique aqui para parar)' : 'Adicionar pilar 15 × 30 (clique na planta)'}</button>
                    <p className="dica">Pilar de concreto moldado no local (ex.: ponta de viga sem parede embaixo). O clique encosta na ponta de parede ou no encontro mais perto (até 60 cm); o lado de 30 cm fica na direção da parede. A parede que passa pelo pilar para na face dele.</p>
                    {(aj.pilares || []).filter(v => v.pav === pavAtual.id).map((v, i) => <div key={i} className="corte-item">{v.nome} · {Math.round((v.x1 - v.x0) * 100)} × {Math.round((v.y1 - v.y0) * 100)} cm
                      <button onClick={() => setAj({ ...aj, pilares: (aj.pilares || []).filter(x => x !== v) })}>remover</button></div>)}
                  </div>
                  <div className="card acoes">
                    <h3>Vigas desenhadas</h3>
                    <button className={modoViga ? 'on' : ''} onClick={() => setModoViga(modoViga ? null : 'ok')}>{modoViga ? (modoViga === 'ok' ? 'Clique no 1º ponto da viga… (clique aqui para parar)' : 'Clique no 2º ponto da viga…') : 'Adicionar viga (clique em 2 pontos na planta)'}</button>
                    <p className="dica">A viga vira apoio da laje (como a LINHA DE PISO): depois dá para girar a laje do ambiente. Fica reta: horizontal ou vertical, pela direção dos dois cliques.</p>
                    {(aj.vigasManuais || []).filter(v => v.pav === pavAtual.id).map((v, i) => <div key={i} className="corte-item">{v.o === 'H' ? 'horizontal' : 'vertical'} · {br(v.b - v.a)} m
                      <button onClick={() => setAj({ ...aj, vigasManuais: (aj.vigasManuais || []).filter(x => x !== v) })}>remover</button></div>)}
                  </div>
                  <div className="card acoes">
                    <h3>Numeração das lajes</h3>
                    {aj.lajeNumFixa
                      ? <><p className="dica">Numeração fixa: a peça que não mudou mantém o número (etiqueta já impressa vale). Peça nova ganha número depois do último ({Math.max(0, ...Object.values(aj.lajeNumFixa))}).</p>
                        <button onClick={() => { if (confirm('Soltar a numeração? As lajes voltam a ser numeradas em sequência e os números podem mudar.')) { const { lajeNumFixa: _, ...r } = aj; setAj(r as typeof aj); } }}>Soltar numeração</button></>
                      : <><p className="dica">Depois de imprimir as etiquetas, fixe a numeração: se a modulação mudar, só as peças novas ganham número novo.</p>
                        <button onClick={() => setAj({ ...aj, lajeNumFixa: Object.fromEntries(calc.pl.map(p => [chaveNumLaje(p), p.num])) })}>Fixar numeração atual</button></>}
                  </div>
                  {(aj.lajeJuntar || []).some(j => j.pav === pavAtual.id) && <div className="card acoes">
                    <h3>Ambientes juntados na laje</h3>
                    <p className="dica">A laje passa por cima destas paredes (os ambientes viram um só na laje). A parede continua sendo fabricada.</p>
                    {(aj.lajeJuntar || []).filter(j => j.pav === pavAtual.id).map((j, i) => <div key={i} className="corte-item">parede {j.o === 'H' ? 'horizontal' : 'vertical'} · {br(j.b - j.a)} m
                      <button onClick={() => setAj({ ...aj, lajeJuntar: (aj.lajeJuntar || []).filter(x => x !== j) })}>separar</button></div>)}
                    {(aj.lajeJuntar || []).some(j => j.pav === pavAtual.id) && <button onClick={() => {
                      // a mesma parede (mesmo alinhamento) em todo o pavimento: junta todos os pares de ambientes separados por ela
                      const meus = (aj.lajeJuntar || []).filter(j => j.pav === pavAtual.id), novos: NonNullable<Ajustes['lajeJuntar']> = [];
                      const L = calc.lajes.filter(a => a.pav === pavAtual.id && a.incluida);
                      const ja = (l: NonNullable<Ajustes['lajeJuntar']>, x: { o: 'H' | 'V'; c: number; a: number; b: number }) =>
                        l.some(y => y.pav === pavAtual.id && y.o === x.o && Math.abs(y.c - x.c) < 0.08 && Math.min(y.b, x.b) - Math.max(y.a, x.a) > 0.3);
                      for (const j of meus) for (const A of L) for (const B of L) {
                        if (A === B) continue;
                        const enc = j.o === 'V' ? Math.abs(A.x1 - j.c) < 0.08 && Math.abs(B.x0 - j.c) < 0.08 : Math.abs(A.y1 - j.c) < 0.08 && Math.abs(B.y0 - j.c) < 0.08;
                        if (!enc) continue;
                        const a = j.o === 'V' ? Math.max(A.y0, B.y0) : Math.max(A.x0, B.x0), b = j.o === 'V' ? Math.min(A.y1, B.y1) : Math.min(A.x1, B.x1);
                        if (b - a < 0.3) continue;
                        const x = { pav: pavAtual.id, o: j.o, c: j.c, a, b };
                        if (!ja(aj.lajeJuntar || [], x) && !ja(novos, x)) novos.push(x);
                      }
                      if (novos.length) setAj(juntarLajes(aj, calc.lajes, novos));
                      alert(novos.length ? `${novos.length} cômodo(s) a mais juntado(s) na mesma parede.` : 'Não há outros cômodos separados por essa mesma parede neste pavimento.');
                    }}>Juntar em todo o pavimento (a mesma parede, em todos os cômodos)</button>}
                    {ativos.length > 1 && (aj.lajeJuntar || []).some(j => j.pav === pavAtual.id) && <button onClick={() => {
                      // repete as junções deste pavimento nos outros: mesma posição na planta, encostando na parede que existir lá
                      const meus = (aj.lajeJuntar || []).filter(j => j.pav === pavAtual.id), novos: NonNullable<Ajustes['lajeJuntar']> = [];
                      const ja = (l: NonNullable<Ajustes['lajeJuntar']>, x: { pav: string; o: 'H' | 'V'; c: number; a: number; b: number }) =>
                        l.some(y => y.pav === x.pav && y.o === x.o && Math.abs(y.c - x.c) < 0.08 && Math.min(y.b, x.b) - Math.max(y.a, x.a) > 0.3);
                      for (const p2 of ativos) {
                        if (p2.id === pavAtual.id) continue;
                        const dx = p2.box.x0 - pavAtual.box.x0, dy = p2.box.y0 - pavAtual.box.y0;
                        for (const j of meus) {
                          const c = j.c + (j.o === 'H' ? dy : dx), a = j.a + (j.o === 'H' ? dx : dy), b = j.b + (j.o === 'H' ? dx : dy);
                          const t = calc.ts.filter(t => t.pav === p2.id && t.o === j.o && Math.abs(t.c - c) < 0.15 && Math.min(t.e, b) - Math.max(t.s, a) > 0.5 * (b - a))
                            .sort((p, q) => Math.abs(p.c - c) - Math.abs(q.c - c))[0];
                          if (!t) continue;
                          const x = { pav: p2.id, o: j.o, c: t.c, a, b };
                          if (!ja(aj.lajeJuntar || [], x) && !ja(novos, x)) novos.push(x);
                        }
                      }
                      if (novos.length) setAj(juntarLajes(aj, calc.lajes, novos));
                      alert(novos.length ? `${novos.length} junção(ões) repetida(s) nos outros pavimentos.` : 'Os outros pavimentos já têm essas junções (ou não têm parede no mesmo lugar).');
                    }}>Repetir estas junções nos outros pavimentos</button>}
                  </div>}
                  <AcoesLaje regras={regras} amb={calc.lajes.find(a => a.id === ambSel) || null} lajeSel={lajeSel} calc={calc} aj={aj} setAj={setAj} pav={pavAtual} espPadrao={(regras.isoporAlt ?? 0.09) + 2 * (regras.capeamento ?? 0.025)} />
                </>}
              {aba === 'modulacao' && <div className="card acoes">
                <h3>Numeração das paredes</h3>
                {aj.paredeNumFixa
                  ? <><p className="dica">Numeração fixa: a parede que não mudou mantém o número (etiqueta já impressa vale). Parede nova ou que mudou de tamanho ganha número depois do último ({Math.max(0, ...Object.values(aj.paredeNumFixa))}).</p>
                    <button onClick={() => { if (confirm('Soltar a numeração? As paredes voltam a ser numeradas em sequência e os números podem mudar.')) { const { paredeNumFixa: _, ...r } = aj; setAj(r as typeof aj); } }}>Soltar numeração</button></>
                  : <><p className="dica">Depois de imprimir as etiquetas, fixe a numeração: se a modulação mudar, só as paredes novas ganham número novo.</p>
                    <button onClick={() => setAj({ ...aj, paredeNumFixa: Object.fromEntries(calc.ps.map(p => [chaveNumParede(p), p.num])) })}>Fixar numeração atual</button></>}
              </div>}
              {aba === 'modulacao' && <div className="card acoes">
                <h3>Paredes desenhadas</h3>
                <button className={modoParede ? 'on' : ''} onClick={() => { setModoParede(modoParede ? null : 'ok'); setSel(null); setVaoSel(null); }}>{modoParede ? (modoParede === 'ok' ? 'Clique no começo da parede… (clique aqui para parar)' : 'Clique no fim da parede…') : 'Desenhar parede (clique no começo e no fim)'}</button>
                <p className="dica">Para parede que o desenho não tem. Os pontos encostam no eixo das paredes perto (até 20 cm) e a parede vai até a face delas. Para apagar uma parede do desenho: clique nela e use "Não modular esta parede".</p>
                {(aj.paredesManuais || []).filter(m => m.pav === pavAtual.id).map((m, i) => <div key={i} className="corte-item">{m.o === 'H' ? 'horizontal' : 'vertical'} · {br(m.b - m.a)} m
                  <button onClick={() => setAj({ ...aj, paredesManuais: (aj.paredesManuais || []).filter(x => x !== m) })}>apagar</button></div>)}
              </div>}
              {aba === 'modulacao' && <div className="card acoes">
                <h3>Janelas</h3>
                {(() => {
                  const altas = calc.ts.filter(t => t.pav === pavAtual.id).flatMap(t => t.vaos.filter(v => v.key && v.tag?.startsWith('J') && (quadro.find(q => q.tag === v.tag)?.peit ?? 0) >= 1.4 - 1e-6).map(v => v.key!));
                  const todas = calc.ts.flatMap(t => t.vaos.filter(v => v.key && v.tag?.startsWith('J') && (quadro.find(q => q.tag === v.tag)?.peit ?? 0) >= 1.4 - 1e-6).map(v => v.key!));
                  const cent = aj.vaoCentro || [];
                  return <>
                    <button onClick={() => setAj({ ...aj, vaoCentro: [...new Set([...cent, ...todas])] })}>Centralizar as janelas altas de todos os pavimentos (banheiros: peitoril 1,40 m ou mais) — {todas.length}</button>
                    <button onClick={() => setAj({ ...aj, vaoCentro: [...new Set([...cent, ...altas])] })}>Só deste pavimento — {altas.length}</button>
                    {cent.length > 0 && <button onClick={() => setAj({ ...aj, vaoCentro: [] })}>Voltar todas as janelas para a posição do projeto ({cent.length} centralizada(s))</button>}
                    <p className="dica">Para uma janela só: clique nela na planta e marque "Centralizar".</p>
                  </>;
                })()}
              </div>}
              <details><summary>Desfazer ajustes</summary>
                <button onClick={() => { if (confirm('Apagar todos os ajustes manuais deste projeto?')) setAj({ ...AJUSTES_VAZIOS, revisoes: aj.revisoes }); }}>Apagar todos os ajustes (as revisões salvas ficam)</button>
              </details>
            </div>
            {aba === 'modulacao'
              ? <PlantaParedes L={leitura} pav={pavAtual} calc={calc} arq={arqDe(pavAtual.box)} sel={sel} vaoSel={vaoSel} cortando={cortando}
                  onCorte={(t, along) => { const tr = calc.ts.find(x => x.id === t); if (!tr || !cortando) return; const d = Math.round((along - tr.s) * 100) / 100; const k = cortando.coluna ? 'colunas' : 'cortes'; const m = { ...(aj[k] || {}) }; m[t] = [...(m[t] || []), d].sort((a, b) => a - b); setAj({ ...aj, [k]: m }); setCortando(null); }}
                  onPainel={t => { setSel({ trecho: t }); setVaoSel(null); }} onVao={k => { setVaoSel(k); setSel(null); setCortando(null); }}
                  modoParede={modoParede} onPonto={(x, y) => {
                    if (modoParede === 'ok' || modoParede === null) { setModoParede({ x, y }); return; }
                    const dx = x - modoParede.x, dy = y - modoParede.y, o: 'H' | 'V' = Math.abs(dx) >= Math.abs(dy) ? 'H' : 'V';
                    const r2 = (v: number) => Math.round(v * 100) / 100;
                    const c = o === 'H' ? (y + modoParede.y) / 2 : (x + modoParede.x) / 2;
                    let a = o === 'H' ? Math.min(x, modoParede.x) : Math.min(y, modoParede.y), b = o === 'H' ? Math.max(x, modoParede.x) : Math.max(y, modoParede.y);
                    // ponta no eixo de uma parede: a nova parede começa/termina na face dela
                    const perp = calc.ts.filter(t => t.pav === pavAtual.id && t.o !== o);
                    const pa = perp.find(t => Math.abs(t.c - a) < 0.005), pb = perp.find(t => Math.abs(t.c - b) < 0.005);
                    if (pa) a += pa.esp / 2; if (pb) b -= pb.esp / 2;
                    if (b - a > 0.2) setAj({ ...aj, paredesManuais: [...(aj.paredesManuais || []), { pav: pavAtual.id, o, c: r2(c), a: r2(a), b: r2(b), esp: 0.14 }] });
                    setModoParede('ok');
                  }} />
              : <PlantaLajes pav={pavAtual} calc={calc} arq={arqDe(pavAtual.box)} ambSel={ambSel} lajeSel={lajeSel} onAmb={id => { setAmbSel(id); setLajeSel(null); }} onLaje={p => { setAmbSel(p.amb); setLajeSel(chaveLaje(p)); }}
                  vigas={(aj.vigasManuais || []).filter(v => v.pav === pavAtual.id)} pilares={(aj.pilares || []).filter(v => v.pav === pavAtual.id)} modoViga={modoViga ?? (modoPilar ? 'ok' : null)}
                  onPonto={(x, y) => {
                    if (modoPilar) {   // pilar 15 × 30 na ponta de parede/viga mais perto; o lado de 30 cm na direção da parede, por dentro
                      // ponta de parede ganha da ponta de viga no mesmo lugar (o pilar entra na direção da parede e corta o painel)
                      const ts = [...calc.ts.filter(t => t.pav === pavAtual.id).map(t => ({ o: t.o, c: t.c, s: t.s, e: t.e, pen: 0 })), ...calc.vigas.filter(v => v.pav === pavAtual.id).map(v => ({ o: v.o, c: v.c, s: v.a + (v.apoio ?? 0), e: v.b - (v.apoio ?? 0), pen: 0.15 }))];
                      let best: { o: 'H' | 'V'; c: number; u: number; dir: 1 | -1; d: number } | null = null;
                      for (const t of ts) for (const [u, dir] of [[t.s, 1], [t.e, -1]] as const) { const [px, py] = t.o === 'H' ? [u, t.c] : [t.c, u], d0 = Math.hypot(px - x, py - y), d = d0 + t.pen; if (d0 < 0.6 && (!best || d < best.d)) best = { o: t.o, c: t.c, u, dir, d }; }
                      if (!best) { alert('Clique mais perto da ponta de uma parede ou viga (até 60 cm).'); return; }
                      const r2 = (v: number) => Math.round(v * 1000) / 1000, f0 = best.u - best.dir * 0.075, f1 = f0 + best.dir * 0.30;
                      const [a0, a1] = [Math.min(f0, f1), Math.max(f0, f1)];
                      const n = (aj.pilares || []).length + 1;
                      const pl = best.o === 'H' ? { pav: pavAtual.id, nome: `P${n}`, x0: r2(a0), x1: r2(a1), y0: r2(best.c - 0.075), y1: r2(best.c + 0.075) } : { pav: pavAtual.id, nome: `P${n}`, x0: r2(best.c - 0.075), x1: r2(best.c + 0.075), y0: r2(a0), y1: r2(a1) };
                      setAj({ ...aj, pilares: [...(aj.pilares || []), pl] }); setModoPilar(false); return;
                    }
                    if (modoViga === 'ok' || modoViga === null) { setModoViga({ x, y }); return; }
                    const dx = x - modoViga.x, dy = y - modoViga.y, o: 'H' | 'V' = Math.abs(dx) >= Math.abs(dy) ? 'H' : 'V';
                    const r2 = (v: number) => Math.round(v * 100) / 100;
                    const v = o === 'H' ? { pav: pavAtual.id, o, c: r2((y + modoViga.y) / 2), a: r2(Math.min(x, modoViga.x)), b: r2(Math.max(x, modoViga.x)) } : { pav: pavAtual.id, o, c: r2((x + modoViga.x) / 2), a: r2(Math.min(y, modoViga.y)), b: r2(Math.max(y, modoViga.y)) };
                    if (v.b - v.a > 0.2) setAj({ ...aj, vigasManuais: [...(aj.vigasManuais || []), v] });
                    setModoViga('ok');
                  }} />}
          </section>
        )}

        {aba === 'acompanhamento' && leitura && prod && (
          <Acompanhamento prod={prod} ativos={ativos} calc={calc} arqDe={arqDe} marcs={marcs} chave={chaveQR} logado={!!(sess && projId && cloud.nuvemConfigurada)}
            projId={projId} planta={() => plantaPortal(nome.replace(/\.dxf$/i, ''), ativos, calc, regras, aj)}
            atualizar={() => projId && cloud.lerMarcacoes(projId).then(setMarcs)}
            trocar={async () => { if (projId && confirm('Trocar a chave da obra? As etiquetas impressas param de funcionar e precisam ser impressas de novo.')) setChaveQR(await cloud.chaveObra(projId, true)); }} />
        )}
        {aba === 'fundacao' && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta baixa na aba Desenhos.</p></section> : (() => {
            // planta de fundação: paredes do pavimento mais baixo (térreo)
            const pf = ativos[0], tf = calc.ts.filter(t => t.pav === pf.id), psf = calc.ps.filter(p => p.pav === pf.id);
            const doPav = <T extends { pav: string }>(l?: T[]) => (l || []).filter(e => e.pav === pf.id);
            const geraPts = (pares: { x: number; y: number; x2: number; y2: number }[]) => pontosFundacao(tf, psf, regras.fundEspac ?? 0, { extra: doPav(aj.fundExtra), remover: doPav(aj.fundRemover), pares }, regras.fundJunta ?? 0.5, 3 * ({ ...ESTACA_PADRAO, ...(regras.estaca || {}) }).furo);
            const ptsW = geraPts(aj.fund?.auto2E ? doPav(aj.fundPar2) : []);   // no eixo das paredes (cálculo); segunda estaca por carga só com a opção ligada
            const pts = blocosDivisa(ptsW, tf, aj.fundDivisa || [], ({ ...BLOCO_PADRAO, ...(regras.bloco || {}) }).lado / 2);   // locação: bloco de divisa com a estaca para dentro
            const og = aj.fundOrigem?.pav === pf.id ? aj.fundOrigem : null;
            const pOg = og ? pts.find(p => Math.hypot(p.x - og.x, p.y - og.y) < 0.15) : null;
            const origem = og ? { x: og.x + og.dx, y: og.y + og.dy } : null;
            const origemDesc = og ? `ponto B${pOg?.n ?? '?'}${og.dx || og.dy ? ` deslocado ${br(og.dx)} em X e ${br(og.dy)} em Y` : ''}` : 'eixo 1 / eixo A';
            const loc = locacao(pts, origem);
            const sgF = siglas(ativos), codF = (p: Painel) => codigoParede(p, sgF);
            const eb = regras.esperaBorda ?? 0.2, ee = regras.esperaEspac ?? 1.2, es = esperasPaineis(psf, codF, eb, ee);
            const cont = (t: string) => pts.filter(p => p.tipo === t).length;
            const base = nome.replace(/\.dxf$/i, ''), arqF = arqDe(pf.box).filter(q => q.layer === camada || q.layer === 'PAREDE');   // fundação: só as paredes (planta limpa, como no Eberick)
            const ob = { ...BLOCO_PADRAO, ...(regras.bloco || {}), qtd: pts.length }, qb = quantBloco(ob), dbT = '';
            const oe = { ...ESTACA_PADRAO, ...(regras.estaca || {}), qtd: pts.filter(p => p.tipo !== 'apoio').length }, qe = quantEstaca(oe), dfT = fundacaoTecnico(ob, oe);
            const setEstaca = (k: keyof typeof ESTACA_PADRAO, v: number) => setRegras({ ...regras, estaca: { ...ESTACA_PADRAO, ...(regras.estaca || {}), [k]: v } });
            const setBloco = (k: keyof typeof BLOCO_PADRAO, v: number) => setRegras({ ...regras, bloco: { ...BLOCO_PADRAO, ...(regras.bloco || {}), [k]: v } });
            // ---- sondagem, estaca e cálculo das cargas (passos 2 e 3)
            const fund: DadosFund = { ...FUND_VAZIA, ...(aj.fund || {}) };
            const can = fund.canaleta ? canaletaBase(tf, psf) : null;   // base de canaleta embaixo das paredes
            const setFund = (f: Partial<DadosFund>) => setAj({ ...aj, fund: { ...fund, ...f } });
            const setFuro = (i: number, f: Partial<Furo>) => setFund({ furos: fund.furos.map((x, j) => j === i ? { ...x, ...f } : x) });
            const capTab = fund.furos.some(f => f.n.length >= 2) ? resumoCap(fund.furos.filter(f => f.n.length >= 2), oe.furo, fund.tipo) : [];
            const capL = capTab.find(r => Math.abs(r.L - oe.comp) < 1e-6) ?? null;
            const pavCarga = Object.fromEntries(ativos.map((p, i) => [p.id, fund.pavCarga?.[p.id] ?? (i === ativos.length - 1 ? 'forro' : 'piso')])) as Record<string, CargaPav>;
            const chaveFund = JSON.stringify([pts.map(p => [p.n, +p.x.toFixed(3), +p.y.toFixed(3)]), pavCarga, !!fund.baldrame, !!fund.canaleta, fund.furos, fund.tipo, oe.furo, oe.comp, calc.ps.length, calc.pl.length, calc.ts.length]);
            const resOk = !!resFund && resFund.chave === chaveFund;
            const TELA25 = 20.5, TELA10 = 41.4, CINTA = 31;   // CINTA: 2 ø8 da cinta da porta (kN)   // kN: tração que a tela ø4.2 (2 capas) aguenta nos 40 cm de baixo, c/25 e c/10
            const sit = (n: number): 'ok' | 'ponta' | 'fs' => { const R = resFund?.R[n] ?? 0; return !capL || R <= capL.Padm + 1e-6 ? 'ok' : R <= capL.Pfs + 1e-6 ? 'ponta' : 'fs'; };
            const corSit = { ok: '#2b8a3e', ponta: '#e8590c', fs: '#c92a2a' } as const;
            const calcular = () => {
              if (!capL) return; setCalcFund(true);
              setTimeout(() => { try {
                const C = cargasFundacao({ pavs: ativosT, desloc: desloc3d, ts: calc.ts, ps: calc.ps, pl: calc.pl, vigas: calc.vigas, regras, espLaje: p => espDaLaje(aj)(p) ?? regras.lajeEsp ?? 0.14, pavCarga, baldrame: !!fund.baldrame, canaleta: can?.kNm });
                const op = { baldrame: !!fund.baldrame, Rl: capL.Rl, Rp: capL.Rp, L: oe.comp, D: oe.furo };
                // bloco de 2 estacas automático: onde a carga passa de uma estaca (FS 2), segunda estaca ao longo da parede, e calcula de novo
                const dE = 3 * oe.furo;
                let pares: { pav: string; x: number; y: number; x2: number; y2: number }[] = [], P = geraPts([]), m1 = modeloParede(C, P.filter(p => p.tipo !== 'apoio'), op), m2 = modeloParede(C, P.filter(p => p.tipo !== 'apoio'), { ...op, Ec: 8e6 });   // bloco de apoio não tem estaca   // curto e longo prazo (fluência): vale o pior
                for (let it = 0; it < (fund.auto2E ? 4 : 0); it++) {
                  const novos: typeof pares = [];
                  for (const p of P) {
                    if (p.par || Math.max(m1.R[p.n] ?? 0, m2.R[p.n] ?? 0) <= capL.Pfs + 1e-6) continue;
                    let best: { x2: number; y2: number; f: number } | null = null;
                    for (const t of tf) {
                      const [u, w] = t.o === 'H' ? [p.x, p.y] : [p.y, p.x]; if (Math.abs(w - t.c) > 0.05 || u < t.s - 0.05 || u > t.e + 0.05) continue;
                      for (const sg of [1, -1]) { const u2 = u + sg * dE; if (u2 < t.s + 0.1 || u2 > t.e - 0.1) continue;
                        const [x2, y2] = t.o === 'H' ? [u2, t.c] : [t.c, u2], f = Math.min(...P.filter(q => q !== p).map(q => Math.hypot(q.x - x2, q.y - y2)));
                        if (f > 0.45 && (!best || f > best.f)) best = { x2, y2, f }; }
                    }
                    if (best) novos.push({ pav: pf.id, x: p.x, y: p.y, x2: best.x2, y2: best.y2 });
                  }
                  if (!novos.length) break;
                  pares = [...pares, ...novos]; P = geraPts(pares); m1 = modeloParede(C, P.filter(p => p.tipo !== 'apoio'), op); m2 = modeloParede(C, P.filter(p => p.tipo !== 'apoio'), { ...op, Ec: 8e6 });
                }
                const ptsF = blocosDivisa(P, tf, aj.fundDivisa || [], ob.lado / 2);
                const R: Record<number, number> = {}, rec: Record<number, number> = {};
                for (const p of P) { R[p.n] = Math.max(m1.R[p.n] ?? 0, m2.R[p.n] ?? 0); rec[p.n] = Math.max(m1.rec[p.n] ?? 0, m2.rec[p.n] ?? 0); }
                if (pares.length || doPav(aj.fundPar2).length) setAj({ ...aj, fundPar2: [...(aj.fundPar2 || []).filter(e => e.pav !== pf.id), ...pares] });
                const chaveF = JSON.stringify([ptsF.map(p => [p.n, +p.x.toFixed(3), +p.y.toFixed(3)]), pavCarga, !!fund.baldrame, !!fund.canaleta, fund.furos, fund.tipo, oe.furo, oe.comp, calc.ps.length, calc.pl.length, calc.ts.length]);
                const trechosR = m1.trechos.map((t, i) => ({ t: t.t, Tparede: Math.max(t.Tparede, m2.trechos[i].Tparede), Tporta: Math.max(t.Tporta, m2.trechos[i].Tporta), Ttopo: Math.max(t.Ttopo, m2.trechos[i].Ttopo) }));
                const portas = C.ts.reduce((s, t) => s + t.vaos.filter(v => v.tipo?.startsWith('P') || v.base < 0.15 && (v.topo ?? v.base + v.h) < (t.H ?? 3) - 0.3).length, 0);
                setResFund({ chave: chaveF, R, lev: cargaAlavanca(C, P.filter(p => p.tipo !== 'apoio')), rec, trechos: trechosR, tot: C.tot, portas, ok: m1.ok && m2.ok });
                setVerFund('cargas');
              } finally { setCalcFund(false); } }, 30);
            };
            const n2 = (v: number) => v.toFixed(2).replace('.', ',');
            const tabBloco = <div className="bloco-tabs">
              <table className="tab-loc"><thead><tr><th>Pos.</th><th>Quant. por bloco</th><th>Ø (mm)</th><th>Comp. (cm)</th><th>Blocos</th><th>Quant. total</th><th>Comp. total (m)</th><th>Peso (kg)</th></tr></thead>
                <tbody>{(['N1', 'N2'] as const).map(nn => <tr key={nn}><td>{nn}</td><td>{ob.barras}</td><td>{ob.bitola.toFixed(1).replace('.', ',')}</td><td>{Math.round(qb.comp * 100)}</td><td>{ob.qtd}</td><td>{ob.barras * ob.qtd}</td><td>{n2(qb.metros / 2)}</td><td>{n2(qb.kg / 2)}</td></tr>)}
                  <tr><td colSpan={5}><b>Total</b></td><td><b>{qb.total}</b></td><td><b>{n2(qb.metros)}</b></td><td><b>{n2(qb.kg)}</b></td></tr></tbody></table>
              <table className="tab-loc"><tbody>
                <tr><td>Blocos</td><td><b>{ob.qtd}</b> ({n2(ob.lado * 100)} × {n2(ob.lado * 100)} × {n2(ob.alt * 100)} cm)</td></tr>
                <tr><td>Concreto</td><td>{n2(qb.conc)} m³ por bloco · <b>{n2(qb.concTotal)} m³</b> no total (sem perda)</td></tr>
                <tr><td>Aço Ø{ob.bitola.toFixed(1).replace('.', ',')} ({n2(pesoBitola(ob.bitola))} kg/m)</td><td><b>{n2(qb.kg)} kg</b> · {n2(qb.metros)} m</td></tr>
                <tr><td>Barras de {br(ob.barra)} m</td><td><b>{qb.barras12} barras</b> · {qb.porBarra} peças de {Math.round(qb.comp * 100)} cm por barra (sobra {n2(qb.sobra)} m)</td></tr>
                <tr><td>Forma (laterais)</td><td>{n2(qb.forma)} m²</td></tr>
                <tr><td>Cobrimento</td><td>{n2(qb.cob * 100)} cm nas laterais · {n2(qb.cobFundo * 100)} cm no fundo e no topo · barras a cada {n2(qb.esp * 100)} cm</td></tr>
              </tbody></table>
            </div>;
            const q = quadroDe(pf, verFund === 'locacao' ? 6 : 1.4);
            const svgPontos = (Q: typeof q) => arqSvg(Q, arqF) + blocos2(Q) +
              tf.map(t => t.o === 'H' ? `<line x1="${Q.X(t.s)}" y1="${Q.Y(t.c)}" x2="${Q.X(t.e)}" y2="${Q.Y(t.c)}" stroke="#c92a2a" stroke-width="${t.esp * Q.k}" opacity=".35"/>` : `<line x1="${Q.X(t.c)}" y1="${Q.Y(t.s)}" x2="${Q.X(t.c)}" y2="${Q.Y(t.e)}" stroke="#c92a2a" stroke-width="${t.esp * Q.k}" opacity=".35"/>`).join('') +
              pts.map(p => `<circle cx="${Q.X(p.x)}" cy="${Q.Y(p.y)}" r="${0.25 * Q.k}" fill="none" stroke="#1971c2" stroke-width="3"/><rect x="${Q.X(p.x) - p.esp * Q.k / 2}" y="${Q.Y(p.y) - p.esp * Q.k / 2}" width="${p.esp * Q.k}" height="${p.esp * Q.k}" fill="${p.tipo === 'intermediário' ? '#e67700' : p.tipo === 'manual' ? '#ae3ec9' : '#2b8a3e'}"/><text x="${Q.X(p.x) + 20}" y="${Q.Y(p.y) - 20}" font-size="${0.16 * Q.k}" fill="#1971c2" font-weight="bold">B${p.n}</text>`).join('') +
              (origem ? `<g stroke="#ae3ec9" stroke-width="4"><line x1="${Q.X(origem.x) - 30}" y1="${Q.Y(origem.y) - 30}" x2="${Q.X(origem.x) + 30}" y2="${Q.Y(origem.y) + 30}"/><line x1="${Q.X(origem.x) - 30}" y1="${Q.Y(origem.y) + 30}" x2="${Q.X(origem.x) + 30}" y2="${Q.Y(origem.y) - 30}"/></g><text x="${Q.X(origem.x) + 35}" y="${Q.Y(origem.y) + 45}" font-size="${0.18 * Q.k}" fill="#ae3ec9">ORIGEM</text>` : '');
            const svgEsperas = (Q: typeof q) => arqSvg(Q, arqF) +
              psf.map(p => { const [x0, y0, x1, y1] = p.o === 'H' ? [p.a, p.c, p.a + p.larg, p.c] : [p.c, p.a, p.c, p.a + p.larg]; const m = p.a + p.larg / 2;
                return `<line x1="${Q.X(x0)}" y1="${Q.Y(y0)}" x2="${Q.X(x1)}" y2="${Q.Y(y1)}" stroke="${p.num % 2 ? '#1971c2' : '#e8590c'}" stroke-width="${0.12 * Q.k}" opacity=".55"/>` +
                  (p.o === 'H' ? `<text x="${Q.X(m)}" y="${Q.Y(p.c) - 18}" font-size="${0.1 * Q.k}" text-anchor="middle" fill="#333">${codF(p)}</text>` : `<text x="${Q.X(p.c) - 18}" y="${Q.Y(m)}" font-size="${0.1 * Q.k}" text-anchor="middle" fill="#333" transform="rotate(-90 ${Q.X(p.c) - 18} ${Q.Y(m)})">${codF(p)}</text>`); }).join('') +
              es.map(e => `<g stroke="#c92a2a" stroke-width="3"><line x1="${Q.X(e.x) - 7}" y1="${Q.Y(e.y) - 7}" x2="${Q.X(e.x) + 7}" y2="${Q.Y(e.y) + 7}"/><line x1="${Q.X(e.x) - 7}" y1="${Q.Y(e.y) + 7}" x2="${Q.X(e.x) + 7}" y2="${Q.Y(e.y) - 7}"/></g>`).join('');
            const blocos2 = (Q: typeof q, cor = '#495057') => pts.filter(p => (p.par && p.n < p.par) || (!p.par && p.cobre?.length)).map(p => { const r = pts.find(x => x.n === p.par); const cs: [number, number][] = r ? [[r.x, r.y]] : p.cobre || []; if (!cs.length) return '';
              const x0 = Math.min(p.x, ...cs.map(c => c[0])) - 0.25, x1 = Math.max(p.x, ...cs.map(c => c[0])) + 0.25, y0 = Math.min(p.y, ...cs.map(c => c[1])) - 0.25, y1 = Math.max(p.y, ...cs.map(c => c[1])) + 0.25;
              return `<rect x="${Q.X(x0)}" y="${Math.min(Q.Y(y0), Q.Y(y1))}" width="${(x1 - x0) * Q.k}" height="${(y1 - y0) * Q.k}" fill="none" stroke="${cor}" stroke-width="4" stroke-dasharray="14 6"/>`; }).join('');
            const svgCargas = (Q: typeof q) => arqSvg(Q, arqF) + blocos2(Q) +
              tf.map(t => t.o === 'H' ? `<line x1="${Q.X(t.s)}" y1="${Q.Y(t.c)}" x2="${Q.X(t.e)}" y2="${Q.Y(t.c)}" stroke="#868e96" stroke-width="${t.esp * Q.k}" opacity=".35"/>` : `<line x1="${Q.X(t.c)}" y1="${Q.Y(t.s)}" x2="${Q.X(t.c)}" y2="${Q.Y(t.e)}" stroke="#868e96" stroke-width="${t.esp * Q.k}" opacity=".35"/>`).join('') +
              pts.map(p => { const c = corSit[sit(p.n)]; return `<rect x="${Q.X(p.x) - 0.25 * Q.k}" y="${Q.Y(p.y) - 0.25 * Q.k}" width="${0.5 * Q.k}" height="${0.5 * Q.k}" fill="${c}" fill-opacity=".15" stroke="${c}" stroke-width="3"/><circle cx="${Q.X(p.x)}" cy="${Q.Y(p.y)}" r="${oe.furo / 2 * Q.k}" fill="#fff" stroke="${c}" stroke-width="3"/><text x="${Q.X(p.x) + 0.3 * Q.k}" y="${Q.Y(p.y) - 0.12 * Q.k}" font-size="${0.17 * Q.k}" fill="${c}" font-weight="bold">B${p.n}</text><text x="${Q.X(p.x) + 0.3 * Q.k}" y="${Q.Y(p.y) + 0.1 * Q.k}" font-size="${0.15 * Q.k}" fill="#222">${resFund ? br((resFund.R[p.n] ?? 0) / 9.81, 1) + ' tf' : ''}</text>`; }).join('');
            const svg = verFund === 'locacao' ? arqSvg(q, arqF) + svgLocacao(loc, q.X, q.Y, q.k) : verFund === 'esperas' ? svgEsperas(q) : verFund === 'cargas' && resOk ? svgCargas(q) : svgPontos(q);
            // clique na planta (ferramentas de edição)
            const perto = (x: number, y: number) => pts.map(p => ({ p, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d)[0];
            const noEixo = (x: number, y: number) => {
              // encosta no eixo da parede mais perto
              // pode passar até 60 cm da ponta da parede, no prolongamento do eixo (pilar maior, alinhado com outra linha)
              const c = tf.map(t => { const u = t.o === 'H' ? Math.min(t.e + 0.6, Math.max(t.s - 0.6, x)) : t.c, w = t.o === 'H' ? t.c : Math.min(t.e + 0.6, Math.max(t.s - 0.6, y)); return { x: u, y: w, d: Math.hypot(u - x, w - y), H: t.o === 'H' }; }).sort((a, b) => a.d - b.d)[0];
              if (!c || c.d >= 0.4) return { x: +x.toFixed(3), y: +y.toFixed(3) };
              // gruda na linha do desenho que atravessa o eixo, se o clique ficou a menos de 5 cm dela
              const H = c.H;
              let { x: px, y: py } = c, best = 0.05;
              for (const pr of arqF) for (let i = 0; i < pr.pts.length - 1; i++) {
                const [[x1, y1], [x2, y2]] = [pr.pts[i], pr.pts[i + 1]];
                if (H && Math.abs(x1 - x2) < 0.01 && Math.min(y1, y2) - 0.3 < c.y && c.y < Math.max(y1, y2) + 0.3 && Math.abs(x1 - c.x) < best) { best = Math.abs(x1 - c.x); px = (x1 + x2) / 2; }
                if (!H && Math.abs(y1 - y2) < 0.01 && Math.min(x1, x2) - 0.3 < c.x && c.x < Math.max(x1, x2) + 0.3 && Math.abs(y1 - c.y) < best) { best = Math.abs(y1 - c.y); py = (y1 + y2) / 2; }
              }
              return { x: +px.toFixed(3), y: +py.toFixed(3) };
            };
            const tirar = (p0: { x: number; y: number; wx?: number; wy?: number; tipo?: string }) => {
              const p = { x: p0.wx ?? p0.x, y: p0.wy ?? p0.y };
              // segunda estaca colocada pela carga: sai o par (o bloco volta a ter 1 estaca)
              const sp = p0.tipo === 'segunda' ? doPav(aj.fundPar2).find(e => Math.hypot(e.x2 - p.x, e.y2 - p.y) < 0.2) : undefined;
              if (sp) return { fundExtra: aj.fundExtra || [], fundRemover: aj.fundRemover || [], fundPar2: (aj.fundPar2 || []).filter(e => e !== sp) };
              const ex = doPav(aj.fundExtra).find(e => Math.hypot(e.x - p.x, e.y - p.y) < 0.15);
              return ex ? { fundExtra: (aj.fundExtra || []).filter(e => e !== ex), fundRemover: aj.fundRemover || [] } : { fundExtra: aj.fundExtra || [], fundRemover: [...(aj.fundRemover || []), { pav: pf.id, x: p.x, y: p.y }] };
            };
            const clique = (x: number, y: number) => {
              if (!modoFund) return;
              if (modoFund === 'add') { setAj({ ...aj, fundExtra: [...(aj.fundExtra || []), { pav: pf.id, ...noEixo(x, y) }] }); return; }
              const c = perto(x, y);
              if (modoFund === 'rem') { if (c && c.d < 0.5) setAj({ ...aj, ...tirar(c.p) }); return; }
              if (modoFund === 'origem') { if (c && c.d < 0.5) { setAj({ ...aj, fundOrigem: { pav: pf.id, x: c.p.x, y: c.p.y, dx: 0, dy: 0 } }); setModoFund(null); } return; }
              if (modoFund === 'mover') { if (c && c.d < 0.5) setModoFund({ x: c.p.wx ?? c.p.x, y: c.p.wy ?? c.p.y }); return; }
              // segundo clique do mover: tira o ponto de lá e põe aqui
              const t = tirar(modoFund); setAj({ ...aj, ...t, fundExtra: [...t.fundExtra, { pav: pf.id, ...noEixo(x, y) }] }); setModoFund('mover');
            };
            const dicaModo = modoFund === 'add' ? 'Clique na planta onde quer o ponto (ele encosta no eixo da parede mais perto).' : modoFund === 'rem' ? 'Clique no ponto que quer tirar.' : modoFund === 'origem' ? 'Clique no ponto que será a origem.' : modoFund === 'mover' ? 'Clique no ponto que quer mover.' : modoFund ? 'Agora clique no lugar novo do ponto.' : '';
            const carimbo = (titulo: string, n: number, tot: number, obs?: string) => <div className="carimbo"><div><b>{titulo}</b><br />{projNome || base} · {pf.nome}</div><div>{obs ?? <>Origem: {origemDesc}<br />Medidas em metros · sem escala: use as cotas</>}</div><div>{new Date().toLocaleDateString('pt-BR')}<br />Folha {n}/{tot}</div></div>;
            const qL = quadroDe(pf, 6), qE = quadroDe(pf, 1.4);
            const linhasTab = loc.pts.map(p => <tr key={p.n}><td>B{p.n}</td><td>{p.eixo}</td><td>{br(p.X)}</td><td>{br(p.Y)}</td><td>{p.tipo === 'L' ? 'canto (L)' : p.tipo === 'T' ? 'encontro (T)' : p.tipo === 'X' ? 'cruzamento' : p.tipo}</td></tr>);
            const metade = Math.ceil(linhasTab.length / 2);
            const tabela = (l: typeof linhasTab) => <table className="tab-loc"><thead><tr><th>Ponto</th><th>Eixo</th><th>X (m)</th><th>Y (m)</th><th>Tipo</th></tr></thead><tbody>{l}</tbody></table>;
            const baixarPranchas = async () => {
              const P = await import('./engine/pranchasFund.ts'), { paginasParaPdf } = await import('./engine/folhaDoc.ts');
              const I = { obra: projNome || base, resp: 'Eng. Nathael Fernando Miranda dos Santos · CREA 1020724730D-GO', empresa: 'Estruttura Projetos e Construções', data: new Date().toLocaleDateString('pt-BR'), revisao: aj.arm?.revisao };
              const nAp = pts.filter(p => p.tipo === 'apoio').length, n = pts.length - nAp, ehBase = resOk && !fund.baldrame && !!resFund;
              const tipoE = TIPOS_ESTACA.find(t => t[0] === fund.tipo)?.[1].toLowerCase() ?? '';
              const nomes = ['FUND-01', 'FUND-02', ...(resOk ? ['FUND-02'] : []), ...(ehBase ? ['FUND-03'] : []), ...(can ? ['FUND-07', 'FUND-07'] : []), 'FUND-04', 'FUND-05', 'FUND-06'];
              const tot = String(nomes.length).padStart(2, '0'); let k = 0; const fol = () => `${nomes[k]} · ${String(++k).padStart(2, '0')}/${tot}`;
              const pares = pts.filter(p => p.par && p.n < p.par), dPar = pares.length ? Math.max(...pares.map(p => { const q = pts.find(r => r.n === p.par)!; return Math.hypot(p.x - q.x, p.y - q.y); })) : 0;
              const pags = [P.folhaEstacaBloco(I, oe, ob, n, n - 2 * pares.length + nAp, [{ L: oe.comp, n }], { baldrame: !!fund.baldrame }, fol(), { n: pares.length, comp: Math.ceil((dPar + ob.lado) * 20) / 20 })];
              const cab = `${n} estacas ${tipoE} ø${Math.round(oe.furo * 100)} × ${br(oe.comp)} m${capL ? ` · admissível ${br(capL.Padm / 9.81, 1)} tf` : ''} · ${pf.nome}`;
              const cargasQ = resOk && resFund ? pts.filter(p => p.tipo !== 'apoio').map(p => ({ n: p.n, R: resFund.R[p.n] ?? 0, sit: sit(p.n) === 'ok' ? 'atende' : sit(p.n) === 'ponta' ? (fund.criterio === 'rt' ? 'atende FS 2 (critério RT)' : 'passa da regra da ponta') : 'FS menor que 2' })) : null;
              const f2 = fol(), f2b = cargasQ ? fol() : ''; pags.push(...P.folhasLocacao(I, loc, arqF.map(p => p.pts as [number, number][]), cargasQ, cab, [f2, f2b]));
              if (ehBase && resFund) {
                const grupos = new Map<string, { nome: string; w: number; q: number }>();
                for (const t of tf) for (const v of t.vaos) if (v.tipo?.startsWith('P') || v.base < 0.15 && (v.topo ?? v.base + v.h) < t.H - 0.3) { const w = Math.round((v.b - v.a) * 100), kk = (v.tipo || 'P') + w; const g = grupos.get(kk) ?? { nome: v.tipo || 'porta', w, q: 0 }; g.q++; grupos.set(kk, g); }
                const T = resFund.trechos, Hs = tf.map(t => t.H).sort((a, b) => a - b);
                pags.push(P.folhaBaseParedes(I, { portas: [...grupos.values()], LW: tf.reduce((s, t) => s + t.e - t.s, 0), tela10: T.some(t => t.Tparede > TELA25), nTrechosTela: T.filter(t => t.Tparede > TELA25).length, nTrechosCinta: T.filter(t => t.Tparede > TELA10).length, Tporta: Math.max(0, ...T.map(t => t.Tporta)), Tparede: Math.max(0, ...T.map(t => t.Tparede)), H: Hs[Math.floor(Hs.length / 2)] ?? 3 }, fol()));
              }
              if (can) { const bl = pts.map(p => ({ x: p.x, y: p.y })); pags.push(P.folhaCanaletaPlanta(I, can, bl, fol()), P.folhaCanaleta(I, can, [], bl, fol())); }
              pags.push(...P.folhasBloco3D(I, oe, ob, [fol(), fol(), fol()]));
              baixarBin(`${projNome || base} - Fundacao (pranchas).pdf`, paginasParaPdf(pags), 'application/pdf');
            };
            const totF = resOk ? 6 : 4;
            const linhasCarga = pts.map(p => <tr key={p.n}><td>B{p.n}</td><td>{br((resFund?.lev[p.n] ?? 0) / 9.81, 1)}</td><td><b>{br((resFund?.R[p.n] ?? 0) / 9.81, 1)}</b></td><td>{br(resFund?.rec[p.n] ?? 0, 1)}</td><td style={{ color: corSit[sit(p.n)] }}>{sit(p.n) === 'ok' ? 'atende' : sit(p.n) === 'ponta' ? (fund.criterio === 'rt' ? 'atende FS 2 (critério RT)' : 'passa da regra da ponta') : 'FS menor que 2'}</td></tr>);
            const nColC = linhasCarga.length > 90 ? 4 : linhasCarga.length > 40 ? 3 : 2, porColC = Math.ceil(linhasCarga.length / nColC);
            const tabCarga = (l: typeof linhasCarga) => <table className="tab-loc"><thead><tr><th>Bloco</th><th>Sem a parede (tf)</th><th>Carga (tf)</th><th>Recalque (mm)</th><th>Situação</th></tr></thead><tbody>{l}</tbody></table>;
            const folhasCarga = resOk && capL ? <>
              <div className={`folha ${papelFund}`}><div className="desenho-a3"><SvgFolha vb={qL.vb} html={svgCargas(qL)} /></div>{carimbo('PLANTA DE CARGAS NAS ESTACAS', 3, totF, `Carga característica no topo da estaca (tf), com a parede redistribuindo · estaca ${TIPOS_ESTACA.find(t => t[0] === fund.tipo)?.[1].toLowerCase()} ø${Math.round(oe.furo * 100)} × ${br(oe.comp)} m · admissível ${br(capL.Padm / 9.81, 1)} tf`)}</div>
              <div className={`folha ${papelFund}`}><div className="desenho-a3 tabelas"><h2>Quadro de cargas e verificação (NBR 6122)</h2>
                <p>Estaca {TIPOS_ESTACA.find(t => t[0] === fund.tipo)?.[1].toLowerCase()} ø{Math.round(oe.furo * 100)} × {br(oe.comp)} m · admissível <b>{br(capL.Padm / 9.81, 1)} tf</b> ({capL.governa}) · ruptura ÷ 2 = {br(capL.Pfs / 9.81, 1)} tf · {fund.baldrame ? 'com viga baldrame 15 × 40' : 'sem baldrame: a parede apoia nos blocos'} · cargas: {ativos.map(p => `${p.nome}: ${CARGA_PAV[pavCarga[p.id]].nome.toLowerCase()}`).join(' · ')}</p>
                <div className="duas cargas-tab">{Array.from({ length: nColC }, (_, i) => <div key={i}>{tabCarga(linhasCarga.slice(i * porColC, (i + 1) * porColC))}</div>)}</div>
                <p className="dica">"Sem a parede" = carga dividida só entre as estacas vizinhas da mesma parede. "Carga" = com a parede trabalhando como viga entre as estacas (pior entre curto e longo prazo). Não inclui caixa d'água.</p>
              </div>{carimbo('QUADRO DE CARGAS', 4, totF, fund.criterio === 'rt' ? 'Comprimento da estaca adotado pelo responsável técnico' : 'Valores característicos (sem majorar)')}</div>
            </> : null;
            const folhas = <div className={'folhas folhas-a3' + (verFund === 'folhas' ? '' : ' so-imp')}>
              {parteFund !== 'detalhe' && <><div className={`folha ${papelFund}`}><div className="desenho-a3"><SvgFolha vb={qL.vb} html={arqSvg(qL, arqF) + svgLocacao(loc, qL.X, qL.Y, qL.k)} /></div>{carimbo('PLANTA DE LOCAÇÃO', 1, totF)}</div>
              <div className={`folha ${papelFund}`}><div className="desenho-a3 tabelas"><h2>Coordenadas dos pontos (a partir da origem)</h2><div className="duas">{tabela(linhasTab.slice(0, metade))}{tabela(linhasTab.slice(metade))}</div></div>{carimbo('TABELA DE LOCAÇÃO', 2, totF)}</div>
              {folhasCarga}
              <div className={`folha ${papelFund}`}><div className="desenho-a3"><SvgFolha vb={qE.vb} html={svgEsperas(qE)} /></div>{carimbo(`ESPERAS DOS PAINÉIS (${es.length}) · ${br(eb)} m das pontas · máx. ${br(ee)} m entre elas`, 3, 4)}</div></>}
              {parteFund !== 'plantas' && <div className="folha a3"><div className="desenho-a3 bloco-folha"><svg viewBox="0 0 400 255" preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{ __html: dfT }} /></div>{carimbo(`BLOCOS E ESTACAS — ${ob.qtd} blocos ${Math.round(ob.lado * 100)}x${Math.round(ob.lado * 100)}x${Math.round(ob.alt * 100)} · estacas ø${Math.round(oe.furo * 100)} × ${br(oe.comp)} m`, totF, totF, 'Medidas em cm · estaca ESC 1:50 · seção 1:10 · bloco 1:20 (impresso em A3)')}</div>}
            </div>;
            return <>
            <section className="mod noprint">
<Divisor />
              <div className="lado">
                <div className="card passos-fund">
                  <div className="botoes">{([[1, '1. Pontos'], [2, '2. Solo e estaca'], [3, '3. Cargas'], [4, '4. Folhas']] as const).map(([k, t]) => <button key={k} className={passoFund === k ? 'on' : ''} onClick={() => { setPassoFund(k); setModoFund(null); if (k === 3 && resOk) setVerFund('cargas'); else if (k !== 4 && verFund === 'cargas') setVerFund('pontos'); }}>{t}</button>)}</div>
                  <p className="dica">{passoFund === 1 ? 'Onde vão os blocos: os pontos saem das paredes do térreo; acerte à mão se precisar.' : passoFund === 2 ? 'Lance a sondagem (SPT metro a metro) e escolha a estaca. O sistema mostra quanto ela aguenta pela NBR 6122.' : passoFund === 3 ? 'Diga o que tem em cima de cada pavimento e calcule: a carga de cada estaca já com a parede ajudando.' : 'Folhas para imprimir e o detalhe da ferragem.'}</p>
                </div>
                {passoFund === 1 && <>
                <div className="card acoes">
                  <h3>Pontos de fundação (para o Eberick)</h3>
                  <p>{pf.nome}: <b>{pts.length} pontos</b></p>
                  <p className="dica">{cont('L')} cantos (L) · {cont('T')} encontros (T) · {cont('X')} cruzamentos · {cont('ponta')} pontas · {cont('coluna')} colunas no meio da parede{cont('emenda') ? ` · ${cont('emenda')} emendas` : ''}{cont('intermediário') ? ` · ${cont('intermediário')} intermediários (laranja)` : ''}{cont('manual') ? ` · ${cont('manual')} acrescentados (roxo)` : ''}</p>
                  <label>Espaçamento máximo entre pontos ao longo da parede (m) — 0 = só cantos, encontros, pontas e colunas
                    <input type="number" step="0.1" value={regras.fundEspac ?? 0} onChange={e => setRegras({ ...regras, fundEspac: parseFloat(e.target.value) || 0 })} /></label>
                  <div className="botoes"><span className="dica">Blocos de divisa (bloco encostado na divisa, estaca para dentro):</span>
                    {([['esq', 'Esquerda'], ['dir', 'Direita'], ['fundo', 'Fundo'], ['frente', 'Frente']] as const).map(([k, t]) => { const on = (aj.fundDivisa || []).includes(k);
                      return <button key={k} className={on ? 'on' : ''} onClick={() => setAj({ ...aj, fundDivisa: on ? (aj.fundDivisa || []).filter(x => x !== k) : [...(aj.fundDivisa || []), k] })}>{t}</button>; })}</div>
                  {pts.some(p => p.div) && <p className="dica">{pts.filter(p => p.div).length} blocos de divisa: estaca a {Math.round((({ ...BLOCO_PADRAO, ...(regras.bloco || {}) }).lado / 2 - 0.075) * 100)} cm do eixo da parede, para dentro.</p>}
                  <label>Distância mínima entre blocos (m) — pontos mais perto que isso viram um bloco só
                    <input type="number" step="0.05" value={regras.fundJunta ?? 0.5} onChange={e => setRegras({ ...regras, fundJunta: parseFloat(e.target.value) || 0.5 })} /></label>
                  <h3>Editar pontos</h3>
                  <div className="botoes">
                    {([['add', 'Acrescentar'], ['rem', 'Tirar'], ['mover', 'Mover']] as const).map(([k, t]) => <button key={k} className={modoFund === k || (k === 'mover' && typeof modoFund === 'object' && modoFund) ? 'on' : ''} onClick={() => { setModoFund(modoFund === k ? null : k); setVerFund('pontos'); }}>{t}</button>)}
                  </div>
                  {dicaModo && <p className="dica"><b>{dicaModo}</b> (clique de novo no botão para parar)</p>}
                  {(doPav(aj.fundExtra).length > 0 || doPav(aj.fundRemover).length > 0) && <button onClick={() => setAj({ ...aj, fundExtra: (aj.fundExtra || []).filter(e => e.pav !== pf.id), fundRemover: (aj.fundRemover || []).filter(e => e.pav !== pf.id) })}>Voltar aos pontos automáticos ({doPav(aj.fundExtra).length} acrescentados, {doPav(aj.fundRemover).length} tirados)</button>}
                  <details><summary>Baixar arquivos (DXF, DWG, PDF, CSV)</summary><div className="acoes">
                  <button onClick={() => baixar(base + '-fundacao.dxf', dxfFundacao(pf, tf, pts, arqF), 'application/dxf')}>Baixar planta de fundação (DXF)</button>
                  <button onClick={() => baixarDwg(base + '-fundacao.dxf', dxfFundacao(pf, tf, pts, arqF))}>Baixar planta de fundação (DWG)</button>
                  <button onClick={() => baixarPdf(base + '-fundacao.dxf', dxfFundacao(pf, tf, pts, arqF), { titulo: 'PLANTA DE FUNDAÇÃO', sub: `${projNome || base} · ${pf.nome}` })}>Baixar planta de fundação (PDF)</button>
                  <button onClick={() => baixar(base + '-pontos-fundacao.csv', csvFundacao(pts), 'text/csv')}>Baixar tabela de pontos (CSV)</button>
                  <p className="dica">DXF em metros, nas mesmas coordenadas do projeto. No Eberick, importe como arquitetura (unidade: metros) e lance os pilares/blocos nos pontos.</p>
                  </div></details>
                </div>
                <div className="card acoes">
                  <h3>Planta de locação</h3>
                  <p className="dica">Origem: <b>{origemDesc}</b>.</p>
                  <button className={modoFund === 'origem' ? 'on' : ''} onClick={() => { setModoFund(modoFund === 'origem' ? null : 'origem'); setVerFund('pontos'); }}>Escolher a origem na planta (clique num ponto)</button>
                  {og && <div className="grade">
                    <label>Deslocar a origem em X (m)<input type="number" step="0.01" key={'dx' + og.x} defaultValue={og.dx} onBlur={e => setAj({ ...aj, fundOrigem: { ...og, dx: parseFloat(e.target.value.replace(',', '.')) || 0 } })} /></label>
                    <label>Deslocar a origem em Y (m)<input type="number" step="0.01" key={'dy' + og.y} defaultValue={og.dy} onBlur={e => setAj({ ...aj, fundOrigem: { ...og, dy: parseFloat(e.target.value.replace(',', '.')) || 0 } })} /></label>
                  </div>}
                  {og && <p className="dica">Ex.: divisa 1,50 m à esquerda do ponto → X = -1,50; 2,00 m abaixo → Y = -2,00.</p>}
                  {og && <button onClick={() => setAj({ ...aj, fundOrigem: undefined })}>Voltar a origem para o canto de baixo à esquerda</button>}
                  <details><summary>Baixar arquivos (DXF, DWG, PDF, CSV)</summary><div className="acoes">
                  <button onClick={() => baixar(base + '-locacao.dxf', dxfLocacao(pf, loc, arqF, origemDesc), 'application/dxf')}>Baixar planta de locação (DXF)</button>
                  <button onClick={() => baixarDwg(base + '-locacao.dxf', dxfLocacao(pf, loc, arqF, origemDesc))}>Baixar planta de locação (DWG)</button>
                  <button onClick={() => baixarPdf(base + '-locacao.dxf', dxfLocacao(pf, loc, arqF, origemDesc), { titulo: 'PLANTA DE LOCAÇÃO', sub: `${projNome || base} · ${pf.nome}` })}>Baixar planta de locação (PDF)</button>
                  <button onClick={() => baixar(base + '-locacao.csv', csvLocacao(loc), 'text/csv')}>Baixar coordenadas da locação (CSV)</button>
                  </div></details>
                </div>
                </>}
                {passoFund === 2 && <>
                  <div className="card acoes">
                    <h3>Sondagem</h3>
                    {fund.furos.length === 0 && <p className="dica">Nenhum furo lançado. Acrescente um furo para cada sondagem do laudo.</p>}
                    {fund.furos.map((f, i) => <div key={i} className="furo">
                      <div className="botoes"><input value={f.nome} onChange={e => setFuro(i, { nome: e.target.value })} style={{ width: '7em' }} /><button onClick={() => setFund({ furos: fund.furos.filter((_, j) => j !== i) })}>Tirar furo</button></div>
                      <label>SPT metro a metro (pode colar do laudo: 4 12 10 7…)<input key={'n' + i + f.n.join(',')} defaultValue={f.n.join(' ')} onBlur={e => { const n = lerNs(e.target.value); setFuro(i, { n, solo: n.map((_, k) => f.solo[k] ?? f.solo[f.solo.length - 1] ?? 'argila') }); }} /></label>
                      <table className="tab-loc tab-furo"><thead><tr><th>Metro</th><th>N</th><th>Solo</th></tr></thead><tbody>
                        {f.n.map((v, k) => <tr key={k}><td>{k}–{k + 1}</td><td><input type="number" value={v} onChange={e => { const n = [...f.n]; n[k] = parseInt(e.target.value) || 0; setFuro(i, { n }); }} /></td>
                          <td><select value={f.solo[k] ?? 'argila'} onChange={e => { const ant = f.solo[k] ?? 'argila', so = [...f.solo]; so[k] = e.target.value as Solo; for (let z = k + 1; z < f.n.length && (f.solo[z] ?? 'argila') === ant; z++) so[z] = e.target.value as Solo; setFuro(i, { solo: so }); }}>{SOLOS.map(s => <option key={s}>{s}</option>)}</select></td></tr>)}
                      </tbody></table>
                    </div>)}
                    <button onClick={() => setFund({ furos: [...fund.furos, { nome: 'SP-' + String(fund.furos.length + 1).padStart(2, '0'), n: [], solo: [] }] })}>Acrescentar furo</button>
                    <p className="dica">Trocar o solo de um metro troca também os de baixo que estavam iguais (escolha de cima para baixo).</p>
                    <details><summary>Abrir ou salvar os dados da fundação (JSON)</summary><div className="acoes">
                      <label className="botao">Abrir dados da fundação (JSON)<input type="file" accept=".json" hidden onChange={async e => { const fl = e.target.files?.[0]; if (!fl) return; try {
                        const j = JSON.parse(await fl.text()), f = (j.fund ?? j.config?.ajustes?.fund ?? j.ajustes?.fund) as DadosFund | undefined;
                        if (!f?.furos) throw new Error('não tem dados de fundação');
                        setAj({ ...aj, fund: f, ...(j.fundExtra ? { fundExtra: j.fundExtra } : {}), ...(j.fundRemover ? { fundRemover: j.fundRemover } : {}) }); if (j.estaca || j.bloco) setRegras({ ...regras, ...(j.estaca ? { estaca: { ...ESTACA_PADRAO, ...(regras.estaca || {}), ...j.estaca } } : {}), ...(j.bloco ? { bloco: { ...BLOCO_PADRAO, ...(regras.bloco || {}), ...j.bloco } } : {}) }); setResFund(null);
                        alert(`Fundação aplicada: ${f.furos.length} furo(s) de sondagem${j.estaca ? `, estaca ø${Math.round((j.estaca.furo ?? oe.furo) * 100)} × ${br(j.estaca.comp ?? oe.comp)} m` : ''}. ${j.fundExtra || j.fundRemover ? ' Pontos de fundação ajustados conforme o arquivo.' : ''} Paredes e lajes não foram mexidas.`);
                      } catch (er) { alert('Arquivo inválido: ' + (er as Error).message); } e.target.value = ''; }} /></label>
                      <button onClick={() => baixar(base + '-fundacao.json', JSON.stringify({ fund, estaca: regras.estaca ?? { furo: oe.furo, comp: oe.comp }, bloco: regras.bloco, fundExtra: aj.fundExtra, fundRemover: aj.fundRemover }, null, 1), 'application/json')}>Salvar dados da fundação (JSON)</button>
                    </div></details>
                  </div>
                  <div className="card acoes">
                    <h3>Estaca</h3>
                    <label>Tipo<select value={fund.tipo} onChange={e => setFund({ tipo: e.target.value as DadosFund['tipo'] })}>{TIPOS_ESTACA.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                    <div className="grade">
                      <label>Diâmetro (m)<input type="number" step="0.05" value={oe.furo} onChange={e => setEstaca('furo', parseFloat(e.target.value) || 0.3)} /></label>
                      <label>Comprimento (m)<input type="number" step="1" value={oe.comp} onChange={e => setEstaca('comp', parseFloat(e.target.value) || 1)} /></label>
                    </div>
                    {capTab.length > 0 ? <>
                      <table className="tab-loc"><thead><tr><th>Comp.</th><th>Admissível</th><th>Ruptura ÷ 2</th><th>Quem manda</th></tr></thead><tbody>
                        {capTab.map(r => <tr key={r.L} className={Math.abs(r.L - oe.comp) < 1e-6 ? 'on' : ''} style={{ cursor: 'pointer' }} onClick={() => setEstaca('comp', r.L)}><td>{r.L} m</td><td><b>{br(r.Padm / 9.81, 1)} tf</b></td><td>{br(r.Pfs / 9.81, 1)} tf</td><td className="dica">{r.Padm < r.Pfs - 1e-6 ? 'regra da ponta · ' : ''}{r.governa}</td></tr>)}
                      </tbody></table>
                      <p className="dica">Clique numa linha para escolher o comprimento. Admissível = o menor entre os furos e os dois métodos (Aoki-Velloso e Décourt-Quaresma), NBR 6122: fator de segurança 2{fund.tipo === 'escavada' ? ' e, na escavada, a ponta leva no máximo 20% da carga' : ''}. O primeiro metro não conta no atrito.</p>
                    </> : <p className="dica">Lance a sondagem para ver quanto a estaca aguenta.</p>}
                  </div>
                </>}
                {passoFund === 3 && <div className="card acoes">
                  <h3>O que tem em cima de cada pavimento</h3>
                  {ativos.map(p => <label key={p.id}>{p.nome}<select value={pavCarga[p.id]} onChange={e => setFund({ pavCarga: { ...pavCarga, [p.id]: e.target.value as CargaPav } })}>{(Object.keys(CARGA_PAV) as CargaPav[]).map(k => <option key={k} value={k}>{CARGA_PAV[k].nome}</option>)}</select></label>)}
                  <label className="check"><input type="checkbox" checked={!!fund.baldrame} onChange={e => setFund({ baldrame: e.target.checked })} /> Tem viga baldrame 15 × 40 embaixo das paredes (sem ela, a parede apoia direto nos blocos)</label>
                  <label className="check"><input type="checkbox" checked={!!fund.canaleta} onChange={e => setFund({ canaleta: e.target.checked })} /> Base de canaleta 14 × 19 × 39 embaixo de todas as paredes (em cima dos blocos; por dentro treliça TG8 e concreto; as paredes assentam nela)</label>
                  {fund.canaleta && <label>Canaleta acima do piso acabado (cm) — o pé-direito conta do piso acabado: as paredes do térreo diminuem isso (portas e janelas descem junto)<input type="number" step="1" value={Math.round((fund.canaletaAcima ?? 0.07) * 100)} onChange={e => { const v = parseFloat(e.target.value); setFund({ canaletaAcima: isFinite(v) && v >= 0 ? v / 100 : 0.07 }); }} /></label>}
                  {can && <p className="dica">Canaleta: <b>{br(can.L, 1)} m</b> · <b>{can.un} canaletas</b> 14 × 19 × 39 (com 5% de perdas) · concreto de enchimento <b>{br(can.concreto, 2)} m³</b> · treliça {can.trelica.tipo} corrida = {br(can.trelica.m, 0)} m ({can.trelica.pecas} peças de 12 m · {br(can.trelica.kg, 0)} kg) · peso {br(can.kNm, 2)} kN/m entra na carga das estacas</p>}
                  <label className="check"><input type="checkbox" checked={!!fund.auto2E} onChange={e => setAj({ ...aj, fund: { ...fund, auto2E: e.target.checked }, ...(e.target.checked ? {} : { fundPar2: (aj.fundPar2 || []).filter(x => x.pav !== pf.id) }) })} /> Bloco de 2 estacas onde a carga passar de uma estaca (opcional: a segunda estaca vai ao longo da parede, a 3 diâmetros)</label>
                  {!capL && <p className="dica"><b>Falta a sondagem</b> (passo 2) para saber quanto a estaca aguenta.</p>}
                  <button className="principal" disabled={!capL || calcFund} onClick={calcular}>{calcFund ? 'Calculando…' : resOk ? 'Calcular de novo' : 'Calcular as cargas nas estacas'}</button>
                  {resFund && !resOk && <p className="dica"><b>Os dados mudaram</b>: calcule de novo.</p>}
                  {resOk && capL && (() => {
                    const v = pts.map(p => resFund!.R[p.n] ?? 0), mx = Math.max(...v), nOk = pts.filter(p => sit(p.n) === 'ok').length, nP = pts.filter(p => sit(p.n) === 'ponta').length, nF = pts.filter(p => sit(p.n) === 'fs').length;
                    const T = resFund!.trechos, Tp = Math.max(0, ...T.map(t => t.Tparede)), Td = Math.max(0, ...T.map(t => t.Tporta));
                    const n10 = T.filter(t => t.Tparede > TELA25).length, nX = T.filter(t => t.Tparede > TELA10).length;
                    const tt = resFund!.tot, totT = (tt.paredes + tt.lajes + tt.uso + tt.outros) / 9.81;
                    return <div className="res-fund">
                      <p>Carga total: <b>{br(totT, 0)} tf</b> <span className="dica">(paredes {br(tt.paredes / 9.81, 0)} · lajes {br(tt.lajes / 9.81, 0)} · uso {br(tt.uso / 9.81, 0)} · vigas e baldrame {br(tt.outros / 9.81, 0)})</span></p>
                      <p>Maior carga numa estaca: <b>{br(mx / 9.81, 1)} tf</b> · admissível <b>{br(capL.Padm / 9.81, 1)} tf</b> (ø{Math.round(oe.furo * 100)} × {br(oe.comp)} m) · recalque máx. {br(Math.max(...pts.map(p => resFund!.rec[p.n] ?? 0)), 1)} mm</p>
                      <p><span className="bola" style={{ background: '#2b8a3e' }} /> {nOk} atendem · <span className="bola" style={{ background: '#e8590c' }} /> {nP} passam da regra da ponta · <span className="bola" style={{ background: '#c92a2a' }} /> {nF} passam da ruptura ÷ 2</p>
                      {nF > 0 && <p className="aviso">{nF} estaca(s) com fator de segurança menor que 2: aumente o comprimento ou ponha 2 estacas nesses blocos.</p>}
                      {nP > 0 && nF === 0 && <label className="check"><input type="checkbox" checked={fund.criterio === 'rt'} onChange={e => setFund({ criterio: e.target.checked ? 'rt' : 'norma' })} /> Manter {br(oe.comp)} m por decisão do responsável técnico (atende o fator de segurança 2, não atende a regra da ponta)</label>}
                      <h3>Base das paredes</h3>
                      {fund.baldrame ? <p>Baldrame: tração máx. <b>{br(Tp / 9.81, 1)} tf</b> → aço embaixo ≈ <b>{br(1.4 * Tp / 43.5, 2)} cm²</b>.</p> : <>
                        <p>Tração máx. no pé da parede: <b>{br(Tp / 9.81, 1)} tf</b>{n10 ? <> · <b>{n10} trecho(s)</b> precisam da tela ø4.2 c/10 nos 40 cm de baixo (em vez de c/25)</> : ' · a tela normal do painel dá conta'}.</p>
                        {nX > 0 && <p className="aviso">{nX} trecho(s) passam até da tela c/10: ponha uma cinta armada no pé da parede ou o baldrame.</p>}
                        {resFund!.portas > 0 && <p>Portas: <b>{resFund!.portas}</b> com cinta 14 × 10 na base (2 ø8 + estribo ø5 c/15) · tração máx. {br(Td / 9.81, 1)} tf.</p>}
                        {Td > CINTA && <p className="aviso">A cinta das portas precisa de mais aço: ≈ {br(1.4 * Td / 43.5, 2)} cm² ({Math.ceil(1.4 * Td / 43.5 / 0.785)} ø10 ou {Math.ceil(1.4 * Td / 43.5 / 1.227)} ø12.5), ou use o baldrame.</p>}
                      </>}
                      <p className="dica">A carga de cada estaca aparece na planta (Cargas nas estacas) e sai no quadro das folhas (passo 4).</p>
                    </div>;
                  })()}
                </div>}
                {passoFund === 4 && <>
                <div className="card acoes">
                  <h3>Folhas para imprimir</h3>
                  <label>Tamanho da folha (locação, coordenadas e esperas)<select value={papelFund} onChange={e => setPapelFund(e.target.value as 'a3' | 'a2')}><option value="a2">A2 deitado</option><option value="a3">A3 deitado</option></select></label>
                  <p className="dica">Locação, tabela de coordenadas{resOk ? ', planta e quadro de cargas' : ''}, esperas, bloco e estaca, com carimbo. O detalhe do bloco e da estaca sai sempre em A3 (escalas 1:50, 1:20 e 1:10). Na impressão escolha o papel <b>A2</b> ou <b>A3</b> e <i>Salvar como PDF</i> (ou mande para a gráfica).</p>
                  <button onClick={() => { setVerFund('folhas'); setParteFund('plantas'); setTimeout(() => { window.print(); setParteFund('todas'); }, 400); }}>Imprimir locação, coordenadas{resOk ? ', cargas' : ''} e esperas ({papelFund.toUpperCase()})</button>
                  <button onClick={() => { setVerFund('folhas'); setParteFund('detalhe'); setTimeout(() => { window.print(); setParteFund('todas'); }, 400); }}>Imprimir detalhe do bloco e da estaca (A3)</button>
                  <h3>Pranchas da fundação (PDF)</h3>
                  <p className="dica">Em preto e branco, com carimbo: FUND-01 estaca e bloco · FUND-02 locação{resOk ? ' e quadro de cargas' : ''}{resOk && !fund.baldrame ? ' · FUND-03 cinta das portas e base das paredes' : ''}{fund.canaleta ? ' · FUND-07 base de canaleta' : ''} · bloco em 3D (vista, peças e montagem).{!resOk ? ' Calcule as cargas (passo 3) para sair também o quadro de cargas e a base das paredes.' : ''}</p>
                  <button className="principal" onClick={baixarPranchas}>Baixar pranchas da fundação (PDF)</button>
                </div>
                <details className="card acoes"><summary><b>Bloco de coroamento</b></summary>
                  <p><b>{ob.qtd} blocos</b> (um em cada ponto) · {n2(qb.concTotal)} m³ · {n2(qb.kg)} kg de aço · {qb.barras12} barras</p>
                  <div className="grade">
                    {([['lado', 'Bloco: lado (m)'], ['alt', 'Bloco: altura (m)'], ['armLado', 'Ferragem: lado (m)'], ['armAlt', 'Ferragem: altura (m)'], ['barras', 'Barras em cada direção'], ['bitola', 'Bitola (mm)'], ['gancho', 'Gancho em cada ponta (m)'], ['barra', 'Barra comercial (m)'], ['estaca', 'Estaca: diâmetro (m) — 0 = sem estaca'], ['estrH', 'Estribos deitados por fora (quant.)'], ['bitH', 'Estribos deitados: bitola (mm)']] as [keyof typeof BLOCO_PADRAO, string][]).map(([k, t]) =>
                      <label key={k}>{t}<input type="number" step={k === 'barras' ? 1 : 0.01} value={ob[k]} onChange={e => setBloco(k, parseFloat(e.target.value) || 0)} /></label>)}
                  </div>
                  <button onClick={() => baixar(base + '-bloco-estaca.dxf', dxfFundacaoDetalhe(ob, oe), 'application/dxf')}>Baixar detalhe do bloco e da estaca (DXF)</button>
                  <button onClick={() => baixarDwg(base + '-bloco-estaca.dxf', dxfFundacaoDetalhe(ob, oe))}>Baixar detalhe do bloco e da estaca (DWG)</button>
                  <button onClick={() => baixarPdf(base + '-bloco-estaca.dxf', dxfFundacaoDetalhe(ob, oe), { titulo: 'DETALHE DO BLOCO E DA ESTACA', sub: `${projNome || base} · ${pf.nome}`, obs: 'Medidas em cm' })}>Baixar detalhe do bloco e da estaca (PDF)</button>
                  <p className="dica">Gaiola: {ob.barras} estribos quadrados fechados em cada direção (N1 e N2), de {n2(ob.armLado * 100)} × {n2(ob.armAlt * 100)} cm, com gancho de {n2(ob.gancho * 100)} cm em cada ponta. Comprimento de cada estribo: {Math.round(qb.comp * 100)} cm.</p>
                </details>
                <details className="card acoes"><summary><b>Estaca</b></summary>
                  <p><b>{oe.qtd} estacas</b> · furo ø{Math.round(oe.furo * 100)} × {br(oe.comp)} m · {br(qe.concTotal)} m³ · aço {br((qe.kgLong + qe.kgEstr) * oe.qtd)} kg</p>
                  <div className="grade">
                    {([['furo', 'Furo: diâmetro (m)'], ['comp', 'Furo: profundidade (m)'], ['armDiam', 'Armação: diâmetro (m)'], ['armComp', 'Armação: comprimento (m)'], ['noBloco', 'Armação: quanto entra no bloco (m)'], ['barras', 'Ferros longitudinais (quant.)'], ['bitLong', 'Ferros: bitola (mm)'], ['bitEstr', 'Estribos: bitola (mm)'], ['espEstr', 'Estribos: a cada (m)'], ['transpEstr', 'Estribos: transpasse (m)'], ['barra', 'Barra comercial (m)']] as [keyof typeof ESTACA_PADRAO, string][]).map(([k, t]) =>
                      <label key={k}>{t}<input type="number" step={k === 'barras' ? 1 : 0.01} value={oe[k]} onChange={e => setEstaca(k, parseFloat(e.target.value) || 0)} /></label>)}
                  </div>
                  <p className="dica">{oe.barras} N3 ø{oe.bitLong.toFixed(1)} C={Math.round(oe.armComp * 100)} · {qe.nEstr} estribos N4 ø{oe.bitEstr.toFixed(1)} c/{Math.round(oe.espEstr * 100)} C={Math.round(qe.cEstr * 100)} (circular ø{Math.round(oe.armDiam * 100)}).</p>
                  <button onClick={() => baixar(base + '-bloco-estaca.dxf', dxfFundacaoDetalhe(ob, oe), 'application/dxf')}>Baixar detalhe do bloco e da estaca (DXF)</button>
                  <button onClick={() => baixarDwg(base + '-bloco-estaca.dxf', dxfFundacaoDetalhe(ob, oe))}>Baixar detalhe do bloco e da estaca (DWG)</button>
                  <button onClick={() => baixarPdf(base + '-bloco-estaca.dxf', dxfFundacaoDetalhe(ob, oe), { titulo: 'DETALHE DO BLOCO E DA ESTACA', sub: `${projNome || base} · ${pf.nome}`, obs: 'Medidas em cm' })}>Baixar detalhe do bloco e da estaca (PDF)</button>
                </details>
                <details className="card acoes"><summary><b>Esperas dos painéis</b></summary>
                  <p><b>{es.length} esperas</b> em {psf.length} painéis</p>
                  <div className="grade">
                    <label>Distância da ponta do painel (m)<input type="number" step="0.01" value={eb} onChange={e => setRegras({ ...regras, esperaBorda: parseFloat(e.target.value) || 0 })} /></label>
                    <label>Espaçamento máximo entre esperas (m)<input type="number" step="0.05" value={ee} onChange={e => setRegras({ ...regras, esperaEspac: parseFloat(e.target.value) || 1.2 })} /></label>
                  </div>
                  <p className="dica">Embaixo de porta não tem espera. As cotas saem a partir do início de cada painel.</p>
                  <button onClick={() => baixar(base + '-esperas.dxf', dxfEsperas(pf, tf, psf, es, codF, arqF, eb, ee), 'application/dxf')}>Baixar planta das esperas (DXF)</button>
                  <button onClick={() => baixarDwg(base + '-esperas.dxf', dxfEsperas(pf, tf, psf, es, codF, arqF, eb, ee))}>Baixar planta das esperas (DWG)</button>
                  <button onClick={() => baixarPdf(base + '-esperas.dxf', dxfEsperas(pf, tf, psf, es, codF, arqF, eb, ee), { titulo: 'PLANTA DAS ESPERAS DOS PAINÉIS', sub: `${projNome || base} · ${pf.nome}` })}>Baixar planta das esperas (PDF)</button>
                  <button onClick={() => baixar(base + '-esperas.csv', csvEsperas(es, loc.ox, loc.oy), 'text/csv')}>Baixar tabela das esperas (CSV)</button>
                </details>
                <details className="card acoes"><summary><b>Pontos</b></summary>
                  <p className="dica">Coordenadas a partir da origem.</p>
                  {loc.pts.map(p => <div key={p.n} className="dica">B{p.n} · eixo {p.eixo} · X {br(p.X)} · Y {br(p.Y)} · {p.tipo === 'L' ? 'canto (L)' : p.tipo === 'T' ? 'encontro (T)' : p.tipo === 'X' ? 'cruzamento' : p.tipo}</div>)}
                </details>
                </>}
              </div>
              <div className="planta">
                <div className="botoes">{([['pontos', 'Pontos de fundação'], ...(resOk ? [['cargas', 'Cargas nas estacas']] as const : []), ['locacao', 'Planta de locação'], ['esperas', 'Esperas dos painéis'], ['bloco', 'Bloco e estaca'], ['folhas', 'Folhas para imprimir']] as const).map(([k, t]) => <button key={k} className={verFund === k ? 'on' : ''} onClick={() => { setVerFund(k); if (k !== 'pontos') setModoFund(null); }}>{t}</button>)}</div>
                {(verFund === 'bloco' || verFund === 'estaca') && <div className="bloco-tela"><ZoomSvg vb="0 0 400 255"><g dangerouslySetInnerHTML={{ __html: dfT }} /></ZoomSvg></div>}
                {verFund !== 'folhas' && verFund !== 'bloco' && verFund !== 'estaca' && <ZoomSvg key={verFund} vb={q.vb} metro={q.k}><g dangerouslySetInnerHTML={{ __html: svg }} />
                  {modoFund && verFund === 'pontos' && <rect x={-100000} y={-100000} width={200000} height={200000} fill="rgba(174,62,201,.04)" style={{ cursor: 'crosshair' }} onClick={e => {
                    const el = (e.target as SVGElement).ownerSVGElement!; const pt = el.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
                    const v = pt.matrixTransform((e.target as SVGGraphicsElement).getScreenCTM()!.inverse()); clique(q.iX(v.x), q.iY(v.y)); }} />}
                  {typeof modoFund === 'object' && modoFund && <circle cx={q.X(modoFund.x)} cy={q.Y(modoFund.y)} r={0.3 * q.k} fill="none" stroke="#ae3ec9" strokeWidth={6} />}
                </ZoomSvg>}
                {verFund !== 'folhas' && verFund !== 'bloco' && verFund !== 'estaca' && <p className="dica">{verFund === 'cargas' && resOk ? 'Carga de cada estaca (tf), já com a parede ajudando: verde = atende · laranja = passa da regra da ponta · vermelho = fator de segurança menor que 2.' : verFund === 'esperas' ? 'Painéis do térreo (azul e laranja alternados) com as esperas (x vermelho).' : 'Pontos de fundação nas paredes do térreo: verde = canto, encontro, ponta ou coluna · laranja = intermediário · roxo = acrescentado à mão. Mudou as paredes, a planta acompanha.'}</p>}
              </div>
            </section>
            {folhas}
            </>;
          })()
        )}
        {aba === 'vigas' && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta baixa na aba Desenhos.</p></section> :
          <section className="mod">
<Divisor />
            <div className="lado">
              <div className="pavsel">{ativos.map(p => <button key={p.id} className={pavAtual.id === p.id ? 'on' : ''} onClick={() => { setPavSel(p.id); setVigaSel(null); }}>{p.nome}</button>)}</div>
              <ListaVigas V={calc.vigas.filter(v => v.pav === pavAtual.id)} sel={vigaSel} onSel={setVigaSel} aj={aj} setAj={setAj} regras={regras} />
            </div>
            <div className="planta">
              <ZoomSvg vb={quadroDe(pavAtual).vb} metro={quadroDe(pavAtual).k}>
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

        {aba === 'orcamento' && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta baixa na aba Desenhos e informe o pé-direito.</p></section> :
          <>
          {!pesLidos.length && <div className="card noprint aviso-local">A planta não tem o pé-direito. <PeRapido pavs={pavs} setPavs={setPavs} /></div>}
          <Orcamento linhas={orcamentoAreas(ativos, calc.ts, calc.pl).map((l, i) => ({ ...l, paredes: l.paredes + calc.orcExtra.filter(x => x.pav === ativos[i].id).reduce((s, x) => s + x.area, 0) }))} ativos={ativos} pl={calc.pl} areaPav={calc.areaPav} regras={regras} setRegras={setRegras} nome={projNome || nome} />
          </>
        )}
        {aba === 'v3d' && leitura && (
          <section className="card card-3d">
            <h2>Ver em 3D</h2>
            {calc.ps.length || calc.pl.length ? <Suspense fallback={<p>Carregando o 3D…</p>}><Vista3D {...props3d} /></Suspense> : <p>Marque as plantas na aba Desenhos para ver o 3D.</p>}
          </section>
        )}
        {aba === 'impressao' && leitura && (
          <section>
            <div className="card noprint">
              <h2>Impressão e arquivos</h2>
              <p>As folhas abaixo saem em <b>A4 deitado</b>. Use <i>Imprimir → Salvar como PDF</i>.</p>
              <div className="botoes">
                <button className={modoImp === 'folhas' ? 'on' : ''} onClick={() => setModoImp('folhas')}>Ver folhas de produção</button>
                {prod && <button className={modoImp === 'etiquetas' ? 'on' : ''} onClick={() => setModoImp('etiquetas')}>Ver etiquetas das peças</button>}
                <button onClick={() => window.print()}>Imprimir / salvar PDF ({modoImp === 'folhas' ? 'folhas' : 'etiquetas'}{pavsImp.length ? ' — ' + ativos.filter(p => pavsImp.includes(p.id)).map(p => p.nome).join(', ') : ''})</button>
              </div>
              <div className="botoes pavs-imp"><b>Pavimentos que saem na impressão:</b>
                <label><input type="checkbox" checked={!pavsImp.length} onChange={() => setPavsImp([])} /> Todos</label>
                {ativos.map(p => <label key={p.id}><input type="checkbox" checked={pavsImp.includes(p.id)} onChange={e => setPavsImp(e.target.checked ? [...pavsImp, p.id] : pavsImp.filter(x => x !== p.id))} /> {p.nome}</label>)}
              </div>
              <div className="botoes">
                {prod && modoImp === 'etiquetas' && <label className="so-etq">Só estas etiquetas (códigos, ex.: T-L128, T-L129 — vazio = todas)
                  <textarea rows={2} value={soEtq} onChange={e => setSoEtq(e.target.value)} placeholder="T-L128, T-L129, 1-P74…" />
                  {soEtq.trim() && (() => { const ks = new Set(soEtq.toUpperCase().split(/[\s,;]+/).filter(Boolean)), tem = new Set(prod.pecas.map(x => x.codigo.toUpperCase())), fora = [...ks].filter(k => !tem.has(k)); return <small>{[...ks].filter(k => tem.has(k)).length} etiqueta(s){fora.length ? ` · não encontrei: ${fora.slice(0, 8).join(', ')}${fora.length > 8 ? '…' : ''}` : ''}</small>; })()}
                </label>}
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-modulacao.dxf', exportarDxf(pavsImp.length ? ativos.filter(p => pavsImp.includes(p.id)) : ativos, calc.ps, calc.pl, (regras.motor ?? 1) >= 2 && leitura ? Object.fromEntries((pavsImp.length ? ativos.filter(p => pavsImp.includes(p.id)) : ativos).map(p => [p.id, { prims: arqDe(p.box), textos: leitura.textos.filter(t => t.x > p.box.x0 - 0.6 && t.x < p.box.x1 + 0.6 && t.y > p.box.y0 - 0.6 && t.y < p.box.y1 + 0.6) }])) : {}, (regras.motor ?? 1) >= 2 ? calc.vigas : [], regras.vigaLargura, (regras.motor ?? 1) >= 2), 'application/dxf')}>Baixar DXF da modulação</button>
                <button onClick={() => baixarDwg(nome.replace(/\.dxf$/i, '') + '-modulacao.dxf', exportarDxf(pavsImp.length ? ativos.filter(p => pavsImp.includes(p.id)) : ativos, calc.ps, calc.pl, (regras.motor ?? 1) >= 2 && leitura ? Object.fromEntries((pavsImp.length ? ativos.filter(p => pavsImp.includes(p.id)) : ativos).map(p => [p.id, { prims: arqDe(p.box), textos: leitura.textos.filter(t => t.x > p.box.x0 - 0.6 && t.x < p.box.x1 + 0.6 && t.y > p.box.y0 - 0.6 && t.y < p.box.y1 + 0.6) }])) : {}, (regras.motor ?? 1) >= 2 ? calc.vigas : [], regras.vigaLargura, (regras.motor ?? 1) >= 2))}>Baixar DWG da modulação</button>
                <button onClick={() => baixarPdf(nome.replace(/\.dxf$/i, '') + '-modulacao.dxf', exportarDxf(pavsImp.length ? ativos.filter(p => pavsImp.includes(p.id)) : ativos, calc.ps, calc.pl, (regras.motor ?? 1) >= 2 && leitura ? Object.fromEntries((pavsImp.length ? ativos.filter(p => pavsImp.includes(p.id)) : ativos).map(p => [p.id, { prims: arqDe(p.box), textos: leitura.textos.filter(t => t.x > p.box.x0 - 0.6 && t.x < p.box.x1 + 0.6 && t.y > p.box.y0 - 0.6 && t.y < p.box.y1 + 0.6) }])) : {}, (regras.motor ?? 1) >= 2 ? calc.vigas : [], regras.vigaLargura, (regras.motor ?? 1) >= 2), { titulo: 'MODULAÇÃO', sub: projNome || nome.replace(/\.dxf$/i, '') }, true)}>Baixar PDF da modulação</button>
                {(regras.motor ?? 1) >= 2 && <button title="Paredes, portas, janelas e lajes em 3D, cada peça com o código da etiqueta (abre no visualizador 3D do sistema de gestão, Revit, BIMvision…)" onClick={() => {
                  const n = (projNome || nome).replace(/\.(dxf|dwg|pdf|json)$/i, '');
                  baixar(n + (pavsImp.length ? ' - ' + ativos.filter(p => pavsImp.includes(p.id)).map(p => p.nome).join(', ') : '') + '.ifc',
                    gerarIfc({ ...props3d, nome: n, so: pavsImp }), 'application/x-step');
                }}>Baixar IFC (3D)</button>}
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-paineis.csv', exportarCsv(calc.ps, ativos, calc.pl, (regras.motor ?? 1) >= 2 ? quantitativos(ativos, calc.ps, calc.pl, regras, espDaLaje(aj)) : []) + ((regras.motor ?? 1) >= 2 ? csvTrelicas(ativos, calc, aj, regras.perda ?? 10) : ''), 'text/csv')}>Baixar lista de painéis (CSV)</button>
                {prod && <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-producao.csv', csvProducao(prod, ativos), 'text/csv')}>Baixar planilha de produção (CSV)</button>}
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-ajustes.json', JSON.stringify({ camada, pavs, quadro, regras, ajustes: aj }, null, 1), 'application/json')}>Salvar ajustes (JSON)</button>
                <label className="botao">Abrir ajustes (JSON)<input type="file" accept=".json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const s = JSON.parse(await f.text()) as Salvo; setCamada(s.camada); setPavs(s.pavs); setQuadro(s.quadro); setRegras(regrasDoSalvo(s.regras)); setAj({ ...AJUSTES_VAZIOS, ...s.ajustes }); }} /></label>
                <label className="botao">Aplicar alterações (JSON)<input type="file" accept=".json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try {
                  // arquivo de alterações: só as chaves que mudam; listas/objetos de ajuste são somados (não apagam o que já existe)
                  const j = JSON.parse(await f.text()) as { formato?: string; descricao?: string; mudancas?: Record<string, unknown> };
                  if (j.formato !== 'alveolar-alteracoes' || !j.mudancas) throw new Error('não é um arquivo de alterações');
                  if (!confirm('Aplicar estas alterações neste projeto?\n\n' + (j.descricao || '') + '\n\n(dá para desfazer com Ctrl+Z / Desfazer)')) return;
                  const novo = { ...aj } as Record<string, unknown>;
                  for (const [k, v] of Object.entries(j.mudancas)) {
                    if (!(k in AJUSTES_VAZIOS) && !['vaoPos', 'rebaixoTopo', 'painelGirado', 'alturaPainel', 'colunas', 'vigaSecao', 'pilares', 'paredesManuais', 'vigasManuais', 'vaoCentro', 'naoPinar', 'viga'].includes(k)) continue;
                    const cur = novo[k];
                    novo[k] = Array.isArray(v) && Array.isArray(cur) && v.every(x => typeof x === 'string') ? [...new Set([...cur, ...v])]
                      : v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...cur as object, ...v as object } : v;
                  }
                  setAj(novo as unknown as Ajustes); alert('Alterações aplicadas.');
                } catch (er) { alert('Arquivo inválido: ' + (er as Error).message); } e.target.value = ''; }} /></label>
                <label className="botao">Abrir só os ajustes das LAJES (JSON)<input type="file" accept=".json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try {
                  const j = JSON.parse(await f.text()), sa = (j.config?.ajustes ?? j.ajustes ?? {}) as Partial<Ajustes>;
                  // só o que é da laje: giro, inteira, emendas, juntar, fora, espessuras, treliças, numeração fixa e armação; paredes e vigas ficam como estão
                  const K = ['lajeGiro', 'lajeInteira', 'lajeEmendas', 'lajeJuntar', 'lajeFora', 'lajeEspAmb', 'lajeEspPainel', 'lajeEspPav', 'laje16', 'trelicasPainel', 'lajeNumFixa', 'arm', 'naoEscada', 'escadaVao'] as const;
                  const novo = { ...aj } as Record<string, unknown>; for (const k of K) if (k in sa) novo[k] = (sa as Record<string, unknown>)[k];
                  setAj(novo as unknown as Ajustes); alert('Ajustes das lajes aplicados. Paredes e vigas não foram mexidas.');
                } catch (er) { alert('Arquivo inválido: ' + (er as Error).message); } e.target.value = ''; }} /></label>
              </div>
            </div>
            {prod && (() => {
              const revs = aj.revisoes || [], atual = retrato(calc, prod.sg), base = revs.find(r => r.n === revBase);
              const dif = base ? compararRev(base.pecas, atual) : null;
              return <div className="card noprint revisoes"><h3>Revisões</h3>
                <p className="dica">Salve uma revisão sempre que mandar para a fábrica. Depois, escolha uma revisão para ver o que mudou desde ela (sai também uma folha no PDF).</p>
                <div className="botoes"><input placeholder="Nota (ex.: enviada para a fábrica)" value={notaRev} onChange={e => setNotaRev(e.target.value)} />
                  <button onClick={() => { const n = (revs[revs.length - 1]?.n ?? 0) + 1; setAj({ ...aj, revisoes: [...revs, { n, em: new Date().toISOString(), nota: notaRev.trim(), pecas: atual }] }); setNotaRev(''); }}>Salvar revisão {(revs[revs.length - 1]?.n ?? 0) + 1}</button></div>
                {revs.map(r => <div key={r.n} className="corte-item"><b>Rev. {r.n}</b> · {new Date(r.em).toLocaleString('pt-BR')}{r.nota ? ` · ${r.nota}` : ''} · {r.pecas.length} peças
                  <button className={revBase === r.n ? 'on' : ''} onClick={() => setRevBase(revBase === r.n ? null : r.n)}>{revBase === r.n ? 'comparando' : 'comparar com esta'}</button>
                  <button onClick={() => { if (confirm(`Apagar a revisão ${r.n}?`)) { setAj({ ...aj, revisoes: revs.filter(x => x !== r) }); if (revBase === r.n) setRevBase(null); } }}>apagar</button></div>)}
                {dif && <TabelaAlteracoes dif={dif} />}
              </div>;
            })()}
            {prod && qrBase && <div className="card noprint"><h3>Instalação na obra (marcada pelo QR das etiquetas)</h3>
              <p><b>{Object.values(montagem).filter(m => m.status === 'montada').length}</b> de {prod.pecas.length} peças instaladas · <b>{Object.values(montagem).filter(m => m.status === 'problema').length}</b> com problema <button onClick={() => projId && cloud.lerMontagem(projId).then(setMontagem)}>Atualizar</button></p>
              {Object.entries(montagem).filter(([, m]) => m.status === 'problema').map(([c, m]) => <p key={c} className="erro">{c}: {m.obs || 'problema'} ({new Date(m.em).toLocaleString('pt-BR')} · {m.por})</p>)}
              {ativos.map(pv => { const ps = prod.pecas.filter(x => x.pav === pv.id); const mt = ps.filter(x => montagem[x.codigo]?.status === 'montada').length; return ps.length ? <p key={pv.id} className="dica">{pv.nome}: {mt}/{ps.length}</p> : null; })}
            </div>}
            {!qrBase && prod && <p className="dica noprint">O QR das etiquetas (marcar a montagem pelo celular) aparece com o projeto salvo na nuvem e o login feito.</p>}
            {(regras.motor ?? 1) >= 2 && <CardArmacao ativos={ativos} calc={calc} regras={regras} aj={aj} setAj={setAj} nome={projNome || nome} />}
            {(regras.motor ?? 1) >= 2 && <div className="card noprint"><Quantitativos linhas={quantitativos(ativos, calc.ps, calc.pl, regras, espDaLaje(aj))} perda={regras.perda ?? 10} /><TabelaQuantTrelicas pavs={ativos} calc={calc} aj={aj} perda={regras.perda ?? 10} /></div>}
            {modoImp === 'etiquetas' && prod ? <Etiquetas prod={(pr => pavsImp.length ? { ...pr, pecas: pr.pecas.filter(x => pavsImp.includes(x.pav)) } : pr)(soEtq.trim() ? { ...prod, pecas: (ks => prod.pecas.filter(x => ks.has(x.codigo.toUpperCase())))(new Set(soEtq.toUpperCase().split(/[\s,;]+/).filter(Boolean))) } : prod)} ativos={ativos} nome={projNome || nome} qrBase={qrBase} />
              : prod ? <Folhas p3d={props3d} ativos={ativos} soPavs={pavsImp} calc={calc} leitura={leitura} arqDe={arqDe} nome={nome} novo={(regras.motor ?? 1) >= 2} regras={regras} aj={aj} prod={prod}
                  rev={(() => { const b = (aj.revisoes || []).find(r => r.n === revBase); return b ? { base: b, dif: compararRev(b.pecas, retrato(calc, prod.sg)) } : undefined; })()} />
              : <p className="dica">As folhas de produção usam o cálculo atual (aba Regras).</p>}
          </section>
        )}
      </main>
    </div>
  );
}

// treliças de reforço pela espessura da laje: TG8 (ferro 6,3 mm); TG12 (ferro 8,0 mm) de 16 cm;
// TG16 (ferro 8,0 mm) de 20 cm; TG20 (ferro 8,0 mm) de 25 cm
const TRELICA = { TG8: 'ferro 6,3 mm', TG12: 'ferro 8,0 mm', TG16: 'ferro 8,0 mm', TG20: 'ferro 8,0 mm' } as const;
const trelicaDaEsp = (e: number): keyof typeof TRELICA => e >= 0.25 - 1e-6 ? 'TG20' : e >= 0.20 - 1e-6 ? 'TG16' : e >= 0.16 - 1e-6 ? 'TG12' : 'TG8';
const REGRA_TRELICA = 'até 15 cm TG8 · 16 cm TG12 · 20 cm TG16 · 25 cm ou mais TG20';
// espessura da laje do ambiente (m), quando alterada; o "laje16" antigo vale 16 cm
const espDoAmb = (aj: Ajustes) => (amb: string) => aj.lajeEspAmb?.[amb] ?? ((aj.laje16 || []).includes(amb) ? 0.16 : undefined) ?? aj.lajeEspPav?.[amb.split('|')[0]];
// painel de laje: chave estável pelo ambiente e pelo canto (a numeração muda); espessura do painel vale mais que a do ambiente
const chaveLaje = (p: { amb: string; x0?: number; y0?: number }) => `${p.amb}@${(p.x0 ?? 0).toFixed(1)},${(p.y0 ?? 0).toFixed(1)}`;
// balanço da laje em cada ponta do vão (beiral): do começo do painel até a primeira parede que apoia, e da última parede até o fim
const balancoLaje = (ps: Painel[]) => (p: PainelLaje): [number, number] => {
  const o = p.sentido === 'V' ? 'H' : 'V', [s0, s1] = p.sentido === 'V' ? [Math.min(p.y0, p.y1), Math.max(p.y0, p.y1)] : [Math.min(p.x0, p.x1), Math.max(p.x0, p.x1)];
  const [t0, t1] = p.sentido === 'V' ? [Math.min(p.x0, p.x1), Math.max(p.x0, p.x1)] : [Math.min(p.y0, p.y1), Math.max(p.y0, p.y1)];
  // linhas de painel (paredes e tiras em cima de outra laje) embaixo da laje: apoio onde os painéis cobrem pelo menos metade da largura
  const lin = new Map<number, number>();
  for (const q of ps) { if (q.pav !== p.pav || q.o !== o || q.c <= s0 - 0.05 || q.c >= s1 + 0.05) continue;
    const ov = Math.min(Math.max(q.a, q.b), t1) - Math.max(Math.min(q.a, q.b), t0); if (ov <= 0) continue; const k = Math.round(q.c * 20) / 20; lin.set(k, (lin.get(k) ?? 0) + ov); }
  const cs = [...lin].filter(([, v]) => v >= 0.5 * (t1 - t0)).map(([c]) => c);
  if (cs.length < 2) return [0, 0];
  const a = Math.min(...cs), b = Math.max(...cs);
  return [Math.max(0, a - s0 - 0.15), Math.max(0, s1 - b - 0.15)];   // até 15 cm além do eixo é apoio (espessura da parede + encaixe), não balanço
};
// travamento da parede nas bordas verticais: paredes (ou tiras) perpendiculares que chegam na linha dela, antes e depois do painel
const travamentoParede = (ps: Painel[]) => (p: Painel): { L: number; n: number } | null => {
  const a0 = Math.min(p.a, p.b), b0 = Math.max(p.a, p.b), tol = 0.25;
  const js = ps.filter(q => q.pav === p.pav && q.o !== p.o && Math.min(q.a, q.b) - tol <= p.c && p.c <= Math.max(q.a, q.b) + tol).map(q => q.c);
  const esq = js.filter(c => c <= a0 + 0.2), dir = js.filter(c => c >= b0 - 0.2);
  const e = esq.length ? Math.max(...esq) : null, d = dir.length ? Math.min(...dir) : null;
  if (e != null && d != null && d - e > 0.3) return { L: d - e, n: 2 };
  if (e != null) return { L: b0 - e, n: 1 }; if (d != null) return { L: d - a0, n: 1 };
  return null;
};
// regra: laje com vão (comprimento do painel, no sentido da treliça) acima de 4,00 m vai para 16 cm — o que foi ajustado à mão vale por cima
const VAO_LAJE16 = 4.0;
const espDaLaje = (aj: Ajustes) => (p: { amb: string; x0?: number; y0?: number; comp?: number }) => aj.lajeEspPainel?.[chaveLaje(p)] ?? espDoAmb(aj)(p.amb) ?? ((p.comp ?? 0) > VAO_LAJE16 + 1e-6 ? 0.16 : undefined);
function quantTrelicas(pavs: Pavimento[], calc: Calc, aj: Ajustes) {
  const out: { pav: string; tipo: keyof typeof TRELICA; pecas: number; metros: number; cortes: Map<string, number> }[] = [];
  for (const pav of pavs) {
    const P = calc.pl.filter(p => p.pav === pav.id), TR = calc.vigas.filter(v => v.pav === pav.id && v.tipo === 'trelica');
    for (const tp of trelicasNasLajes(TR, P)) {
      const pn = P.find(p => p.num === tp.painel), tipo = trelicaDaEsp(pn ? espDaLaje(aj)(pn) ?? 0 : 0);
      let l = out.find(x => x.pav === pav.nome && x.tipo === tipo);
      if (!l) out.push(l = { pav: pav.nome, tipo, pecas: 0, metros: 0, cortes: new Map() });
      l.pecas++; l.metros += tp.comp; const k = br(tp.comp); l.cortes.set(k, (l.cortes.get(k) || 0) + 1);
    }
  }
  return out;
}
function csvTrelicas(pavs: Pavimento[], calc: Calc, aj: Ajustes, perda: number) {
  const L = quantTrelicas(pavs, calc, aj); if (!L.length) return '';
  const k = 1 + perda / 100;
  return '\r\n\r\nTreliças;Tipo;Ferro;Peças;Comprimento (m);Com perda (m);Peças cortadas\r\n' +
    L.map(l => [l.pav, l.tipo, TRELICA[l.tipo], l.pecas, br(l.metros), br(l.metros * k), [...l.cortes].map(([c, n]) => `${n} x ${c} m`).join(' | ')].join(';')).join('\r\n');
}
function TabelaQuantTrelicas({ pavs, calc, aj, perda }: { pavs: Pavimento[]; calc: Calc; aj: Ajustes; perda: number }) {
  const L = quantTrelicas(pavs, calc, aj);
  if (!L.length) return null;
  const k = 1 + perda / 100;
  const tot = (t: keyof typeof TRELICA) => L.filter(l => l.tipo === t).reduce((s, l) => s + l.metros, 0);
  return <table className="tquant"><thead>
    <tr><th colSpan={7}>TRELIÇAS DE REFORÇO DAS LAJES</th></tr>
    <tr><th>Pavimento</th><th>Treliça</th><th>Ferro</th><th>Peças</th><th>Comprimento (m)</th><th>Com {perda}% de perda (m)</th><th>Peças cortadas</th></tr></thead>
    <tbody>{L.map((l, i) => <tr key={i}><td>{l.pav}</td><td>{l.tipo}</td><td>{TRELICA[l.tipo]}</td><td>{l.pecas}</td><td>{br(l.metros)}</td><td><b>{br(l.metros * k)}</b></td>
      <td style={{ textAlign: 'left' }}>{[...l.cortes].sort((a, b) => parseFloat(b[0].replace(',', '.')) - parseFloat(a[0].replace(',', '.'))).map(([c, n]) => `${n} × ${c} m`).join(' · ')}</td></tr>)}
      {(Object.keys(TRELICA) as (keyof typeof TRELICA)[]).filter(t => tot(t) > 0).map(t => <tr key={t} className="tot"><td>Total</td><td>{t}</td><td>{TRELICA[t]}</td><td>{L.filter(l => l.tipo === t).reduce((s, l) => s + l.pecas, 0)}</td><td>{br(tot(t))}</td><td>{br(tot(t) * k)}</td><td></td></tr>)}
    </tbody></table>;
}

// orçamento: paredes (área cheia) e lajes; opção 1 só paredes e lajes, opção 2 a obra cinza (por m² de área construída)
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// pé-direito quando a planta/os cortes não trazem a altura: de 2,80 a 3,20 (de 5 em 5 cm), aplicado a todas as plantas
const PES = [2.8, 2.85, 2.9, 2.95, 3.0, 3.05, 3.1, 3.15, 3.2];
function PeRapido({ pavs, setPavs }: { pavs: Pavimento[]; setPavs: (p: Pavimento[]) => void }) {
  const at = pavs.filter(p => p.ativo), igual = at.length > 0 && at.every(p => Math.abs(p.altura - at[0].altura) < 1e-6) ? at[0].altura : null;
  return <span className="pes">Pé-direito de todas as plantas:{' '}
    {PES.map(v => <button key={v} className={igual !== null && Math.abs(igual - v) < 1e-6 ? 'on' : ''} onClick={() => setPavs(pavs.map(q => q.ativo ? { ...q, altura: v } : q))}>{br(v)}</button>)}
  </span>;
}

function Orcamento({ linhas, ativos, pl, areaPav, regras, setRegras, nome }: { linhas: ReturnType<typeof orcamentoAreas>; ativos: Pavimento[]; pl: PainelLaje[]; areaPav: { pav: string; area: number }[]; regras: Regras; setRegras: (r: Regras) => void; nome: string }) {
  const [erro, setErro] = useState('');
  const ap = linhas.reduce((s, l) => s + l.paredes, 0), al = linhas.reduce((s, l) => s + l.lajes, 0);
  const vp = regras.orcParede ?? 0, vl = regras.orcLaje ?? 0, vc = regras.orcCinza ?? 0;
  // área construída: soma dos pavimentos pelo contorno externo das paredes (sem vazios); dá para corrigir à mão
  const acCalc = areaPav.reduce((s, a) => s + a.area, 0);
  const ac = regras.orcAreaCinza || acCalc || al;
  const tp = ap * vp, tl = al * vl;
  // obra cinza = painéis (paredes + lajes) + parte cinza por m² de área construída
  const op1 = regras.orcValor1 || tp + tl, op2 = regras.orcValor2 || op1 + ac * vc;
  const num = (k: 'orcParede' | 'orcLaje' | 'orcCinza' | 'orcAreaCinza' | 'orcValidade' | 'orcValor1' | 'orcValor2' | 'orcEspParede' | 'orcEspLaje', rot: string, ph?: string) =>
    <label>{rot}<input type="number" step="0.01" placeholder={ph} value={regras[k] ?? ''} onChange={e => setRegras({ ...regras, [k]: e.target.value === '' ? undefined : parseFloat(e.target.value) })} /></label>;
  const txt = (k: 'orcCliente' | 'orcObra' | 'orcInicio' | 'orcPrazos' | 'orcPagamento', rot: string, ph?: string) =>
    <label>{rot}<input value={regras[k] ?? ''} placeholder={ph} onChange={e => setRegras({ ...regras, [k]: e.target.value })} /></label>;
  const validade = regras.orcValidade ?? 5;
  const alturas = [...new Set(ativos.map(p => br(p.altura)))];
  const campos = (valor: number): Record<string, string> => ({
    CLIENTE: regras.orcCliente || '', ENDERECO: regras.orcObra || '', DATA: new Date().toLocaleDateString('pt-BR'),
    INICIO: regras.orcInicio || 'A combinar', PRAZOS: regras.orcPrazos || 'A combinar', PAGAMENTO: regras.orcPagamento || 'A combinar',
    VALIDADE: `${validade} (${numeroPorExtenso(validade).toLowerCase()}) dias`,
    AREA_CONSTRUIDA: br(ac), M2_PAREDES: br(ap), M2_LAJES: br(al), M2_TOTAL: br(ap + al),
    ALTURA_PAREDES: alturas.length > 1 ? alturas.slice(0, -1).join(', ') + ' e ' + alturas[alturas.length - 1] : alturas[0] ?? '',
    ESP_PAREDE: String(regras.orcEspParede ?? 14), ESP_LAJE: String(regras.orcEspLaje ?? 15),
    VAO_LAJE: br(Math.max(0, ...pl.map(p => p.comp))),
    VALOR: reais(valor), VALOR_EXTENSO: reaisPorExtenso(valor),
  });
  const baixar = async (modelo: 'proposta-paredes-lajes' | 'proposta-obra-cinza', valor: number) => {
    setErro('');
    try {
      const b = await gerarProposta(modelo, campos(valor));
      const a = document.createElement('a'); a.href = URL.createObjectURL(b);
      a.download = `${modelo === 'proposta-paredes-lajes' ? 'Proposta paredes e lajes' : 'Proposta obra cinza'} - ${regras.orcCliente || nome}.docx`; a.click();
    } catch (e) { setErro((e as Error).message); }
  };
  return <section>
    <div className="card noprint">
      <h2>Orçamento</h2>
      <p className="dica">Paredes pela área cheia: comprimento de cada parede × pé-direito, <b>sem descontar portas, janelas nem os 5 cm dos painéis</b>. Lajes pela área dos painéis. Para orçar só pela planta baixa, marque a planta na aba Desenhos e informe o pé-direito lá.</p>
      <div className="grade">
        {txt('orcCliente', 'Cliente')}{txt('orcObra', 'Endereço da obra')}
        {txt('orcInicio', 'Previsão de início', 'A combinar')}{txt('orcPrazos', 'Prazos', 'A combinar')}{txt('orcPagamento', 'Condições de pagamento', 'A combinar')}
        {num('orcValidade', 'Validade da proposta (dias)', '5')}
        {num('orcEspParede', 'Espessura da parede no texto (cm)', '14')}{num('orcEspLaje', 'Espessura da laje no texto (cm)', '15')}
      </div>
      <h3>Opção 1 — paredes e lajes</h3>
      <div className="grade">
        {num('orcParede', 'Paredes — valor por m² (R$)')}{num('orcLaje', 'Lajes — valor por m² (R$)')}
        {num('orcValor1', 'Ou valor global (R$)', reais(tp + tl))}
      </div>
      <h3>Opção 2 — obra cinza (paredes e lajes da opção 1 + parte cinza)</h3>
      <p className="dica">Área construída pelo projeto: {areaPav.map(a => `${ativos.find(p => p.id === a.pav)?.nome ?? ''} ${br(a.area)} m²`).join(' + ')} = <b>{br(acCalc)} m²</b> (pela face de fora das paredes, sem vazios e sem áreas descobertas como solarium e sacada). Se o quadro de áreas do projeto der outro valor, digite abaixo.</p>
      <div className="grade">
        {num('orcCinza', 'Parte cinza — valor por m² de área construída (R$)')}{num('orcAreaCinza', 'Área construída (m²)', br(acCalc || al))}
        {num('orcValor2', 'Ou valor global (R$)', reais(op1 + ac * vc))}
      </div>
      <div className="botoes">
        <button onClick={() => baixar('proposta-paredes-lajes', op1)}>Baixar proposta paredes e lajes (Word)</button>
        <button onClick={() => baixar('proposta-obra-cinza', op2)}>Baixar proposta obra cinza (Word)</button>
        <button onClick={() => window.print()}>Imprimir resumo</button>
      </div>
      {erro && <p className="erro">{erro}</p>}
    </div>
    <div className="folhas"><div className="folha orc">
      <div className="cab">ORÇAMENTO — {(regras.orcObra || nome).toUpperCase()}</div>
      <p>{regras.orcCliente ? <>Cliente: <b>{regras.orcCliente}</b> · </> : null}Data: {new Date().toLocaleDateString('pt-BR')} · Validade: {validade} dias · Pé-direito: {alturas.join(' / ')} m</p>
      <table className="tquant"><thead><tr><th>Pavimento</th><th>Paredes (m²)</th><th>Lajes (m²)</th></tr></thead>
        <tbody>{linhas.map(l => <tr key={l.pav}><td>{l.pav}</td><td>{br(l.paredes)}</td><td>{br(l.lajes)}</td></tr>)}
          <tr className="tot"><td>Total</td><td>{br(ap)}</td><td>{br(al)}</td></tr>
          <tr className="tot"><td>Total de painéis</td><td colSpan={2}>{br(ap + al)} m²</td></tr></tbody></table>
      <table className="tquant"><thead><tr><th colSpan={4}>OPÇÃO 1 — PAREDES E LAJES</th></tr><tr><th>Item</th><th>Quantidade</th><th>Valor unitário</th><th>Total</th></tr></thead>
        <tbody><tr><td>Paredes</td><td>{br(ap)} m²</td><td>{moeda(vp)}</td><td>{moeda(tp)}</td></tr>
          <tr><td>Lajes</td><td>{br(al)} m²</td><td>{moeda(vl)}</td><td>{moeda(tl)}</td></tr>
          <tr className="tot"><td colSpan={3}>Valor global{regras.orcValor1 ? ' (informado)' : ''}</td><td>{moeda(op1)}</td></tr></tbody></table>
      <table className="tquant"><thead><tr><th colSpan={4}>OPÇÃO 2 — OBRA CINZA</th></tr><tr><th>Item</th><th>Quantidade</th><th>Valor unitário</th><th>Total</th></tr></thead>
        <tbody><tr><td>Paredes e lajes (opção 1)</td><td>{br(ap + al)} m²</td><td></td><td>{moeda(op1)}</td></tr>
          <tr><td>Parte cinza (área construída)</td><td>{br(ac)} m²</td><td>{moeda(vc)}</td><td>{moeda(ac * vc)}</td></tr>
          <tr className="tot"><td colSpan={3}>Valor global{regras.orcValor2 ? ' (informado)' : ''}</td><td>{moeda(op2)}</td></tr></tbody></table>
      <div className="rod"><span>Paredes pela área cheia (comprimento × pé-direito), sem descontar portas e janelas · lajes pela área dos painéis</span><span>{nome}</span></div>
    </div></div>
  </section>;
}

// quadro de m² e m³ por pavimento
function Quantitativos({ linhas, perda }: { linhas: ReturnType<typeof quantitativos>; perda: number }) {
  type K = 'qtd' | 'area' | 'aberturas' | 'bruto' | 'isoporM' | 'isoporPecas' | 'isoporM3' | 'concreto' | 'isoporPerda' | 'concretoPerda';
  const tot = (k: K, it?: string) => linhas.filter(l => !it || l.item === it).reduce((s, l) => s + l[k], 0);
  const m3 = (v: number) => v.toFixed(3).replace('.', ',');
  const cel = (g: (k: K) => number) => <><td>{g('qtd')}</td><td>{br(g('area'))}</td><td>{g('aberturas') ? br(g('aberturas')) : '—'}</td><td>{m3(g('bruto'))}</td><td>{br(g('isoporM'))}</td><td><b>{g('isoporPecas')}</b></td><td>{m3(g('isoporM3'))}</td><td>{m3(g('concreto'))}</td><td><b>{g('isoporPerda')}</b></td><td><b>{m3(g('concretoPerda'))}</b></td></>;
  return <table className="tquant"><thead>
    <tr><th colSpan={13}>QUANTITATIVOS — ÁREA, CONCRETO E ISOPOR</th></tr>
    <tr><th>Pavimento</th><th>Item</th><th>Espessura (m)</th><th>Painéis</th><th>Área (m²)</th><th>Portas e janelas (m²)</th><th>Volume do painel (m³)</th><th>Isopor (m)</th><th>Isopores (barras)</th><th>Volume de isopor (m³)</th><th>Concreto (m³)</th><th>Isopores com {perda}% de perda</th><th>Concreto com {perda}% de perda (m³)</th></tr></thead>
    <tbody>{linhas.map((l, i) => <tr key={i}><td>{l.pav}</td><td>{l.item}</td><td>{br(l.esp)}</td>{cel(k => l[k])}</tr>)}
      {(['Paredes', 'Lajes'] as const).map(it => <tr key={it} className="tot"><td>Total</td><td>{it}</td><td></td>{cel(k => tot(k, it))}</tr>)}
      <tr className="tot"><td>Total geral</td><td></td><td></td>{cel(k => k === 'isoporPecas' ? linhas.barras : k === 'isoporPerda' ? linhas.barrasPerda : tot(k))}</tr>
    </tbody></table>;
}

function Resumo({ ps, pl }: { ps: Painel[]; pl: PainelLaje[] }) {
  const r = resumo(ps);
  const al = pl.reduce((s, p) => s + areaLaje(p), 0);
  return <span className="resumo">Paredes: {r.qtd} painéis · {br(r.bruta)} m² · Lajes: {pl.length} painéis · {br(al)} m² · Total {br(r.bruta + al)} m²</span>;
}

function Miniatura({ prims, box }: { prims: Prim[]; box: Box }) {
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  const ps = prims.filter(p => p.pts.every(q => q[0] >= box.x0 - 0.1 && q[0] <= box.x1 + 0.1 && q[1] >= box.y0 - 0.1 && q[1] <= box.y1 + 0.1));
  return <svg viewBox={`${box.x0} ${-box.y1} ${w} ${h}`} className="mini">{ps.map((p, i) => <polyline key={i} points={p.pts.map(q => `${q[0]},${-q[1]}`).join(' ')} fill="none" stroke="#333" strokeWidth={w / 300} />)}</svg>;
}

// tela de paredes no layout da planta baixa, com áreas clicáveis por cima
function PlantaParedes({ L, pav, calc, arq, sel, vaoSel, cortando, onCorte, onPainel, onVao, modoParede = null, onPonto }: {
  L: Leitura; pav: Pavimento; calc: Calc; arq: Prim[]; sel: { trecho: string } | null; vaoSel: string | null;
  cortando: { trecho: string; coluna: boolean } | null; onCorte: (t: string, along: number) => void; onPainel: (t: string) => void; onVao: (k: string) => void;
  modoParede?: { x: number; y: number } | null | 'ok'; onPonto?: (x: number, y: number) => void;
}) {
  const q = quadroDe(pav);
  const ps = calc.ps.filter(p => p.pav === pav.id), ts = calc.ts.filter(t => t.pav === pav.id);
  const base = useMemo(() => plantaConteudo(L, pav, ps, calc.vaos.filter(v => v.pav === pav.id), arq, q), [L, pav, calc, arq]);
  return (
    <div className="planta">
      <ZoomSvg vb={q.vb} metro={q.k}>
        <g dangerouslySetInnerHTML={{ __html: base }} />
        {calc.guardas.filter(m => m.pav === pav.id).map(m => {
          const [x1, y1, x2, y2] = m.o === 'H' ? [m.s, m.c, m.e, m.c] : [m.c, m.s, m.c, m.e];
          return <line key={'g' + m.id} x1={q.X(x1)} y1={q.Y(y1)} x2={q.X(x2)} y2={q.Y(y2)} stroke="rgba(230,120,0,.5)" strokeWidth={14} strokeDasharray="4 6"><title>Guarda-corpo — feito na obra, não modulado</title></line>;
        })}
        {calc.muros.filter(m => m.pav === pav.id).map(m => {
          const [x1, y1, x2, y2] = m.o === 'H' ? [m.s, m.c, m.e, m.c] : [m.c, m.s, m.c, m.e];
          return <line key={m.id} x1={q.X(x1)} y1={q.Y(y1)} x2={q.X(x2)} y2={q.Y(y2)} stroke="rgba(120,120,120,.45)" strokeWidth={14} strokeDasharray="10 6"><title>Muro — não modulado</title></line>;
        })}
        {ps.map(p => {
          const on = sel?.trecho === p.trecho;
          const [x1, y1, x2, y2] = p.o === 'H' ? [p.a, p.c, p.a + p.larg, p.c] : [p.c, p.a, p.c, p.a + p.larg];
          return <line key={p.num} className="hit" x1={q.X(x1)} y1={q.Y(y1)} x2={q.X(x2)} y2={q.Y(y2)} stroke={on ? 'rgba(230,0,0,.55)' : 'transparent'} strokeWidth={26}
            onClick={e => {
              if (cortando && cortando.trecho === p.trecho) {
                const svg = (e.target as SVGElement).ownerSVGElement!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
                const v = pt.matrixTransform((e.target as SVGGraphicsElement).getScreenCTM()!.inverse());
                onCorte(p.trecho, p.o === 'H' ? q.iX(v.x) : q.iY(v.y));
              } else onPainel(p.trecho);
            }}><title>Painel {p.num} · {br(p.larg)} × {p.chanfro ? `${br(p.chanfro.ha)} → ${br(p.chanfro.hb)} (chanfro)` : br(p.H)}</title></line>;
        })}
        {ts.flatMap(t => t.vaos.map(v => {
          const key = v.key ?? `${t.id}@${((v.a + v.b) / 2).toFixed(2)}`;
          const [x, y, w, h] = t.o === 'H' ? [v.x0, t.c - 0.13, v.x1 - v.x0, 0.26] : [t.c - 0.13, v.x0, 0.26, v.x1 - v.x0];
          const on = vaoSel === key;
          return <rect key={key} className="hit" x={q.X(x)} y={q.Y(y + h)} width={w * q.k} height={h * q.k} fill={on ? 'rgba(204,0,204,.35)' : v.tag ? 'rgba(204,0,204,.08)' : 'rgba(255,170,0,.25)'} stroke={v.tag ? '#c0c' : '#e80'} strokeWidth={2} strokeDasharray={v.tag ? '' : '8 5'} onClick={() => onVao(key)}><title>{v.tag ? `${v.tag}` : 'vão sem etiqueta — clique para definir'}</title></rect>;
        }))}
        {modoParede && typeof modoParede === 'object' && <circle cx={q.X(modoParede.x)} cy={q.Y(modoParede.y)} r={10} fill="#0a8a2c" />}
        {modoParede && onPonto && <rect x={-100000} y={-100000} width={200000} height={200000} fill="rgba(10,138,44,.04)" style={{ cursor: 'crosshair' }} onClick={e => {
          const svg = (e.target as SVGElement).ownerSVGElement!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
          const v = pt.matrixTransform((e.target as SVGGraphicsElement).getScreenCTM()!.inverse());
          let x = q.iX(v.x), y = q.iY(v.y);
          const vx = ts.filter(t => t.o === 'V').map(t => t.c).sort((a, b) => Math.abs(a - x) - Math.abs(b - x))[0];
          const hy = ts.filter(t => t.o === 'H').map(t => t.c).sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0];
          if (vx !== undefined && Math.abs(vx - x) < 0.2) x = vx;
          if (hy !== undefined && Math.abs(hy - y) < 0.2) y = hy;
          onPonto(x, y);
        }} />}
      </ZoomSvg>
      <p className="dica">{cortando ? 'Clique no ponto da parede selecionada onde ela deve ser dividida.' : 'Roda do mouse ou + / − para zoom, arraste para mover. Clique numa parede para ajustar. Os vãos em laranja não têm etiqueta no projeto: clique para dizer se é porta, janela ou vão livre.'}</p>
    </div>
  );
}

// tabelas longas na impressão: divididas em blocos (colunas lado a lado / folhas seguintes) para não cortar no fim da folha A4
const LINHAS_TLAJE = 40, LINHAS_TREL = 24, LINHAS_TREL_CONT = 30;
// vistas de produção: 18 mm por metro; linhas por largura (13,8 m) e folhas pela altura útil da folha A4 deitada
const ESC_VISTA = 18, LARG_FOLHA = 13.8, ALT_FOLHA_MM = 172;
function paginarVistas<T>(itens: T[], larg: (p: T) => number, alt: (p: T) => number, maxLinhas = 99, esc = ESC_VISTA): T[][][] {
  // na ordem dos números, mas uma peça que não cabe na linha ainda pode entrar numa linha anterior da mesma folha
  // (enche os buracos sem embaralhar a numeração); esc = mm por metro na folha
  const W = LARG_FOLHA * ESC_VISTA / esc, hL = (p: T) => alt(p) * esc + 4;
  const pgs: { linhas: { it: T[]; w: number; h: number }[] }[] = [];
  let pg: { linhas: { it: T[]; w: number; h: number }[] } | null = null;
  const altPg = (g: typeof pg) => g!.linhas.reduce((s, l) => s + l.h, 0);
  for (const p of itens) {
    const w = larg(p) + 1.1, h = hL(p);
    let ok = false;
    if (pg) for (const l of pg.linhas) {
      if (l.w + w > W) continue;
      if (altPg(pg) - l.h + Math.max(l.h, h) > ALT_FOLHA_MM) continue;
      l.it.push(p); l.w += w; l.h = Math.max(l.h, h); ok = true; break;
    }
    if (ok) continue;
    if (pg && pg.linhas.length < maxLinhas && altPg(pg) + h <= ALT_FOLHA_MM) { pg.linhas.push({ it: [p], w, h }); continue; }
    pg = { linhas: [{ it: [p], w, h }] }; pgs.push(pg);
  }
  return pgs.length ? pgs.map(g => g.linhas.map(l => l.it)) : [[[]]];
}
function emBlocos<T>(a: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out.length ? out : [[]]; }

function TabelaTrelicas({ TP, TR, curta }: { TP: TrelicaPainel[]; TR: VigaN[]; curta?: boolean }) {
  return <div className="card trelicas">
    <h3>Treliças na laje ({TR.length})</h3>
    {!curta && TR.map(t => <p key={t.id} className="dica"><b>T{t.n}</b> · {br(t.b - t.a)} m · {t.motivo}</p>)}
    <table className="tlaje"><thead><tr><th>Treliça</th><th>Painel</th><th>Onde</th><th>Comp.</th></tr></thead><tbody>
      {TP.map((x, i) => <tr key={i}><td>T{x.t}</td><td>{x.painel ? `L${x.painel}` : '—'}</td><td>{x.painel ? `${x.ao} do painel, ${x.onde}` : curta ? 'sem laje modulada embaixo — conferir apoio' : x.onde}</td><td>{br(x.comp)}</td></tr>)}
    </tbody></table>
  </div>;
}

function PlantaLajes({ pav, calc, arq, ambSel, lajeSel, onAmb, onLaje, vigas = [], pilares = [], modoViga = null, onPonto }: { pav: Pavimento; calc: Calc; arq: Prim[]; ambSel: string | null; lajeSel: string | null; onAmb: (id: string) => void; onLaje: (p: PainelLaje) => void;
  vigas?: { o: 'H' | 'V'; c: number; a: number; b: number }[]; pilares?: { nome: string; x0: number; x1: number; y0: number; y1: number }[]; modoViga?: { x: number; y: number } | null | 'ok'; onPonto?: (x: number, y: number) => void }) {
  const q = quadroDe(pav);
  const lj = calc.lajes.filter(a => a.pav === pav.id), P = calc.pl.filter(p => p.pav === pav.id);
  const TR = calc.vigas.filter(v => v.pav === pav.id && v.tipo === 'trelica'), TP = trelicasNasLajes(TR, P);
  return (
    <div className="planta">
      <ZoomSvg vb={q.vb} metro={q.k}>
        <g dangerouslySetInnerHTML={{ __html: DEFS_LAJE + arqSvg(q, arq) + lajesConteudo(lj, P, q, TR.filter(t => TP.some(x => x.t === t.n))) }} />
        {lj.map(a => {
          // área clicável de face a face das paredes; aviso = marcador "!" dentro do ambiente (sem contorno em cima das paredes)
          const fx0 = a.x0 + a.esp.o / 2, fx1 = a.x1 - a.esp.l / 2, fy0 = a.y0 + a.esp.s / 2, fy1 = a.y1 - a.esp.n / 2;
          return <g key={a.id} onClick={() => onAmb(a.id)} className="hit">
            <rect x={q.X(fx0)} y={q.Y(fy1)} width={(fx1 - fx0) * q.k} height={(fy1 - fy0) * q.k} fill={ambSel === a.id && !lajeSel ? 'rgba(230,0,0,.12)' : 'transparent'}><title>{a.aviso || 'clique para ajustar'}</title></rect>
            {a.aviso && <g><circle cx={q.X(fx0) + 16} cy={q.Y(fy1) + 16} r={11} fill="#e80" /><text x={q.X(fx0) + 16} y={q.Y(fy1) + 22} fontSize={16} fontWeight="bold" fill="#fff" textAnchor="middle">!</text><title>{a.aviso}</title></g>}
          </g>;
        })}
        {/* cada painel é clicável sozinho: seleciona só a laje clicada */}
        {P.map(p => <rect key={p.num} className="hit" x={q.X(p.x0)} y={q.Y(p.y1)} width={(p.x1 - p.x0) * q.k} height={(p.y1 - p.y0) * q.k}
          fill={lajeSel === chaveLaje(p) ? 'rgba(230,0,0,.18)' : 'transparent'} stroke={lajeSel === chaveLaje(p) ? '#e00' : 'none'} strokeWidth={3}
          onClick={() => onLaje(p)}><title>{`L${p.num} · ${br(p.comp)} × ${br(p.larg)}`}</title></rect>)}
        {/* vigas desenhadas no sistema */}
        {vigas.map((v, i) => { const [x1, y1, x2, y2] = v.o === 'H' ? [v.a, v.c, v.b, v.c] : [v.c, v.a, v.c, v.b];
          return <line key={'vm' + i} x1={q.X(x1)} y1={q.Y(y1)} x2={q.X(x2)} y2={q.Y(y2)} stroke="#e67700" strokeWidth={12} strokeOpacity={0.8}><title>Viga desenhada · {br(v.b - v.a)} m</title></line>; })}
        {pilares.map((v, i) => <g key={'pil' + i}><rect x={q.X(v.x0)} y={q.Y(v.y1)} width={(v.x1 - v.x0) * q.k} height={(v.y1 - v.y0) * q.k} fill="#222" /><text x={q.X(v.x1) + 6} y={q.Y(v.y1) + 14} fontSize={16} fontWeight="bold" fill="#222">{v.nome}</text><title>Pilar {v.nome} · {Math.round((v.x1 - v.x0) * 100)} × {Math.round((v.y1 - v.y0) * 100)} cm</title></g>)}
        {modoViga && typeof modoViga === 'object' && <circle cx={q.X(modoViga.x)} cy={q.Y(modoViga.y)} r={10} fill="#e67700" />}
        {/* adicionar viga: a planta toda recebe o clique; o ponto encosta no eixo da parede mais perto (até 20 cm) */}
        {modoViga && onPonto && <rect x={-100000} y={-100000} width={200000} height={200000} fill="rgba(230,119,0,.04)" style={{ cursor: 'crosshair' }} onClick={e => {
          const svg = (e.target as SVGElement).ownerSVGElement!; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
          const v = pt.matrixTransform((e.target as SVGGraphicsElement).getScreenCTM()!.inverse());
          let x = q.iX(v.x), y = q.iY(v.y);
          const ts = calc.ts.filter(t => t.pav === pav.id);
          const vx = ts.filter(t => t.o === 'V').map(t => t.c).sort((a, b) => Math.abs(a - x) - Math.abs(b - x))[0];
          const hy = ts.filter(t => t.o === 'H').map(t => t.c).sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0];
          if (vx !== undefined && Math.abs(vx - x) < 0.2) x = vx;
          if (hy !== undefined && Math.abs(hy - y) < 0.2) y = hy;
          onPonto(x, y);
        }} />}
      </ZoomSvg>
      <p className="dica">Laje sobre este pavimento. Clique numa laje para mudar a espessura só dela, ou girar o sentido / tirar a laje do ambiente dela. Clique num ambiente para tirar a laje (vazio, área externa), girar o sentido dos painéis ou mudar a espessura (ex.: 16 cm). Marcador laranja "!" = precisa de atenção (passe o mouse ou clique para ver). Linha roxa = treliça de reforço embaixo de parede de cima.</p>
      {TP.length > 0 && <TabelaTrelicas TP={TP} TR={TR} />}
    </div>
  );
}

function ListaVigas({ V, sel, onSel, aj, setAj, regras }: { V: VigaN[]; sel: string | null; onSel: (id: string) => void; aj: Ajustes; setAj: (a: Ajustes) => void; regras: Regras }) {
  if (!V.length) return <div className="card acoes"><p>Nenhuma viga necessária neste pavimento pelas regras atuais.</p></div>;
  const reb = V.flatMap(v => v.rebaixos), vg = V.filter(v => v.tipo !== 'trelica'), tr = V.length - vg.length;
  return <div className="card acoes vigas">
    <h3>{vg.length} viga(s) sugerida(s) · {vg.filter(v => v.obrigatoria).length} obrigatória(s){tr ? ` · ${tr} reforço(s) com treliça` : ''}</h3>
    {reb.length > 0 && <p className="erro">Paredes que diminuem de altura: {[...new Map(reb.map(r => [r.painel, r])).values()].sort((a, b) => a.painel - b.painel).map(r => `${r.painel} (${br(r.de)} → ${br(r.para)})`).join(', ')}</p>}
    {V.map(v => <div key={v.id} className={'viga' + (sel === v.id ? ' on' : '') + (v.obrigatoria ? ' obrig' : '')} onClick={() => onSel(v.id)}>
      <b>{v.tipo === 'trelica' ? `T${v.n}` : (aj.vigaSecao?.[v.id]?.nome || `V${v.n}`)}</b> {v.tipo === 'trelica' ? '· treliça (sem viga)' : v.obrigatoria ? '· obrigatória' : '· recomendada'} · {br(v.b - v.a)} m
      {v.tipo !== 'trelica' && (() => { const s = aj.vigaSecao?.[v.id], L = s?.larg ?? regras.vigaLargura ?? 0.15, H = s?.alt ?? v.altura ?? regras.vigaAltura ?? 0.3;
        return <div><b>Seção {Math.round(L * 100)} × {Math.round(H * 100)} cm</b>{s?.abaixo ? ' · toda embaixo da laje' : ' · topo no topo da laje'}{s ? ' (definida)' : ' (sugerida pelo sistema)'}</div>; })()}
      <div>{v.motivo}</div>
      <div className="dica">Ideia: {v.ideia}</div>
      {v.rebaixos.length > 0 && <div className="dica">Paredes rebaixadas: {v.rebaixos.map(r => `${r.painel} (${br(r.de)} → ${br(r.para)})`).join(', ')}</div>}
      {sel === v.id && v.tipo !== 'trelica' && (() => {
        const s = aj.vigaSecao?.[v.id], cur = { nome: s?.nome ?? '', larg: s?.larg ?? regras.vigaLargura ?? 0.15, alt: s?.alt ?? v.altura ?? regras.vigaAltura ?? 0.3, abaixo: !!s?.abaixo };
        const grava = (m: Partial<typeof cur>) => { const n = { ...cur, ...m }; setAj({ ...aj, vigaSecao: { ...(aj.vigaSecao || {}), [v.id]: { nome: n.nome || undefined, larg: n.larg, alt: n.alt, abaixo: n.abaixo || undefined } } }); };
        const num = (t: string) => { const x = parseFloat(t.replace(',', '.')); return isFinite(x) && x > 0 ? x / 100 : null; };
        return <div className="secao-viga" onClick={e => e.stopPropagation()}>
          <label>Nome <input key={'n' + v.id} defaultValue={cur.nome} placeholder={`V${v.n}`} onBlur={e => grava({ nome: e.target.value.trim() })} /></label>
          <label>Largura (cm) <input type="number" step="1" key={'l' + v.id} defaultValue={Math.round(cur.larg * 100)} onBlur={e => { const x = num(e.target.value); if (x) grava({ larg: x }); }} /></label>
          <label>Altura (cm) <input type="number" step="1" key={'h' + v.id} defaultValue={Math.round(cur.alt * 100)} onBlur={e => { const x = num(e.target.value); if (x) grava({ alt: x }); }} /></label>
          <label className="chk"><input type="checkbox" checked={cur.abaixo} onChange={e => grava({ abaixo: e.target.checked })} /> Toda embaixo da laje (a laje apoia em cima dela)</label>
          {s && <button onClick={() => { const m = { ...(aj.vigaSecao || {}) }; delete m[v.id]; setAj({ ...aj, vigaSecao: m }); }}>Voltar à seção sugerida</button>}
          <p className="dica">Sem marcar, o topo da viga fica no nível do topo da laje (a altura conta a laje). A seção vale para o 3D e para a lista de vigas.</p>
        </div>; })()}
    </div>)}
  </div>;
}

function Acoes({ pav, sel, vaoSel, calc, aj, setAj, quadro, regras, cortando, setCortando, limpar }: {
  pav: Pavimento; sel: { trecho: string } | null; vaoSel: string | null; calc: Calc; aj: Ajustes; setAj: (a: Ajustes) => void; quadro: Esquadria[]; regras: Regras;
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
      </select></label>
      {(() => {
        const t = calc.ts.find(x => x.vaos.some(v => v.key === vaoSel)); const v = t?.vaos.find(x => x.key === vaoSel);
        if (!t || !v) return null;
        const pos = aj.vaoPos?.[vaoSel];
        return <>
          <p className="dica">Parede de {br(t.e - t.s)} m (de face a face). O vão está a <b>{br(v.x0 - t.s)} m</b> do começo da parede ({t.o === 'H' ? 'ponta da esquerda' : 'ponta de baixo'} na planta) e a <b>{br(t.e - v.x1)} m</b> do fim. Largura do vão com o acréscimo: {br(v.x1 - v.x0)} m.</p>
          <label>Mover: distância do começo da parede até o vão (m)
            <input type="number" step="0.01" key={vaoSel + (pos ?? '')} defaultValue={(pos ?? v.x0 - t.s).toFixed(2)} onBlur={e => { const n = parseFloat(e.target.value.replace(',', '.')); if (!isFinite(n) || Math.abs(n - (v.x0 - t.s)) < 0.005) return; const m = { ...(aj.vaoPos || {}) }; m[vaoSel] = Math.max(0, Math.min(n, t.e - t.s - (v.x1 - v.x0))); setAj({ ...aj, vaoPos: m, vaoCentro: (aj.vaoCentro || []).filter(x => x !== vaoSel) }); }} />
          </label>
          {pos != null && <button onClick={() => { const m = { ...(aj.vaoPos || {}) }; delete m[vaoSel]; setAj({ ...aj, vaoPos: m }); }}>Voltar o vão para a posição do projeto</button>}
        </>;
      })()}
      <label className="chk"><input type="checkbox" checked={(aj.vaoCentro || []).includes(vaoSel)} onChange={e => { const m = { ...(aj.vaoPos || {}) }; if (e.target.checked) delete m[vaoSel]; setAj({ ...aj, vaoPos: m, vaoCentro: e.target.checked ? [...(aj.vaoCentro || []), vaoSel] : (aj.vaoCentro || []).filter(x => x !== vaoSel) }); }} /> Centralizar esta janela/porta na parede (de face a face)</label>
      <button onClick={limpar}>Fechar</button></div>;
  }
  if (!t) return <div className="card acoes"><p>Clique numa parede ou num vão na planta.</p>
    {calc.muros.some(m => m.pav === pav.id) && <>
      <p className="dica">Muros (não encostam em nenhum ambiente) — não são modulados:</p>
      <ul className="dica">{calc.muros.filter(m => m.pav === pav.id).map(m => <li key={m.id}>{m.o === 'H' ? 'horizontal' : 'vertical'} de {br(m.e - m.s)} m{' '}
        <button onClick={() => setAj({ ...aj, naoMuro: [...(aj.naoMuro || []), m.id] })}>é parede</button></li>)}</ul>
    </>}
    {calc.guardas.some(m => m.pav === pav.id) && <>
      <p className="dica">Guarda-corpo (feito na obra) — não é modulado:</p>
      <ul className="dica">{calc.guardas.filter(m => m.pav === pav.id).map(m => <li key={m.id}>{m.o === 'H' ? 'horizontal' : 'vertical'} de {br(m.e - m.s)} m{' '}
        <button onClick={() => setAj({ ...aj, naoMuro: [...(aj.naoMuro || []), m.id] })}>é parede</button></li>)}</ul>
    </>}
    {(aj.naoMuro || []).length > 0 && <button onClick={() => setAj({ ...aj, naoMuro: [] })}>Voltar a separar os muros e guarda-corpos automaticamente</button>}
    {calc.vigasParede.some(m => m.pav === pav.id) && <>
      <p className="dica">Vigas no lugar de parede (a laje apoia nelas):</p>
      <ul className="dica">{calc.vigasParede.filter(m => m.pav === pav.id).map(m => <li key={m.id}>{m.o === 'H' ? 'horizontal' : 'vertical'} de {br(m.e - m.s)} m{' '}
        <button onClick={() => setAj({ ...aj, viga: (aj.viga || []).filter(x => x !== m.id) })}>voltar a ser parede</button></li>)}</ul>
    </>}
  </div>;
  const P = calc.ps.filter(p => p.trecho === t.id);
  const tog = (k: 'excluir' | 'juntar' | 'naoDividir' | 'naoPinar') => setAj({ ...aj, [k]: (aj[k] || []).includes(t.id) ? (aj[k] || []).filter(x => x !== t.id) : [...(aj[k] || []), t.id] });
  return <div className="card acoes">
    <h3>Parede {P.map(p => p.num).join(', ')}</h3>
    <p>Comprimento {br(t.e - t.s)} m · espessura {br(t.esp)} m{t.pinado ? ' · pinada (sem emenda)' : ''}<br />{P.map(p => `${p.num}: ${br(p.larg)} × ${p.chanfro ? `${br(p.chanfro.ha)} → ${br(p.chanfro.hb)} (topo chanfrado)` : br(p.H)}`).join(' · ')}</p>
    {P.some(p => p.aviso) && <p className="erro">{P.filter(p => p.aviso).map(p => `${p.num}: ${p.aviso}`).join(' · ')}</p>}
    <button onClick={() => tog('excluir')}>Não modular esta parede (shaft, platibanda, torre…)</button>
    <button onClick={() => setAj({ ...aj, viga: [...(aj.viga || []), t.id] })}>É viga, não parede (muxarabi, vidro, esquadria) — a laje apoia nela</button>
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
    {calc.ps.filter(p => p.trecho === t.id && p.chave).map(p =>
      <label key={p.chave}>Altura só do painel {p.num} (m){p.chanfro ? ` — topo chanfrado ${br(p.chanfro.ha)} → ${br(p.chanfro.hb)} (telhado em caimento; digitar uma altura aqui tira o chanfro)` : ''}
        <input type="number" step="0.01" defaultValue={p.H} key={`${p.chave}${p.H}`} onBlur={e => { const v = parseFloat(e.target.value); if (isFinite(v) && Math.abs(v - p.H) < 1e-6) return; const a = { ...(aj.alturaPainel || {}) }; if (isFinite(v) && v > 0 && Math.abs(v - t.H) > 1e-6) a[p.chave!] = v; else delete a[p.chave!]; setAj({ ...aj, alturaPainel: a }); }} />
      </label>)}
    <button onClick={limpar}>Fechar</button>
  </div>;
}

// junta ambientes na laje: o ambiente juntado começa sem "girar" e sem "laje inteira" (marcas dos pedaços antigos,
// que passariam para ele porque ele fica com o código de um deles)
function juntarLajes(aj: Ajustes, lajes: LajeAmb[], novos: NonNullable<Ajustes['lajeJuntar']>): Ajustes {
  const ids = new Set<string>();
  for (const j of novos) for (const a of lajes) {
    if (a.pav !== j.pav) continue;
    const enc = j.o === 'V' ? (Math.abs(a.x0 - j.c) < 0.08 || Math.abs(a.x1 - j.c) < 0.08) && Math.min(a.y1, j.b) - Math.max(a.y0, j.a) > 0.3
      : (Math.abs(a.y0 - j.c) < 0.08 || Math.abs(a.y1 - j.c) < 0.08) && Math.min(a.x1, j.b) - Math.max(a.x0, j.a) > 0.3;
    if (enc) ids.add(a.id);
  }
  return { ...aj, lajeJuntar: [...(aj.lajeJuntar || []), ...novos], lajeGiro: (aj.lajeGiro || []).filter(x => !ids.has(x)), lajeInteira: (aj.lajeInteira || []).filter(x => !ids.has(x)) };
}

function AcoesLaje({ amb, lajeSel, calc, aj, setAj, pav, espPadrao, regras }: { regras: Regras; amb: LajeAmb | null; lajeSel: string | null; calc: Calc; aj: Ajustes; setAj: (a: Ajustes) => void; pav: Pavimento; espPadrao: number }) {
  const lj = calc.lajes.filter(a => a.pav === pav.id && a.incluida), P = calc.pl.filter(p => p.pav === pav.id);
  const area = P.reduce((s, p) => s + areaLaje(p), 0);
  const tog = (k: 'lajeFora' | 'lajeGiro' | 'laje16' | 'lajeInteira', id: string) => setAj({ ...aj, [k]: (aj[k] || []).includes(id) ? (aj[k] || []).filter(x => x !== id) : [...(aj[k] || []), id] });
  return <div className="card acoes">
    <h3>Laje sobre {pav.nome}</h3>
    <p>{P.length} painéis · {br(area)} m² · {lj.length} ambientes</p>
    {lj.filter(a => a.aviso).map(a => <p key={a.id} className="erro">{a.aviso}</p>)}
    {(() => {
      const p = lajeSel ? P.find(x => chaveLaje(x) === lajeSel) : undefined;
      if (!p) return null;
      const e = espDaLaje(aj)(p) ?? espPadrao, t = trelicaDaEsp(e);
      return <>
        <h3>Laje L{p.num} selecionada</h3>
        <p>{br(p.comp)} × {br(p.larg)} m{p.dente ? ` · dente ${br(p.dente.x1 - p.dente.x0)} × ${br(p.dente.y1 - p.dente.y0)}` : ''}</p>
        <label>Espessura desta laje (cm)
          <input type="number" step="1" key={lajeSel} defaultValue={Math.round(e * 100)} onBlur={ev => {
            const v = parseFloat(ev.target.value.replace(',', '.')); const m = { ...(aj.lajeEspPainel || {}) };
            const doAmb = espDoAmb(aj)(p.amb) ?? (p.comp > VAO_LAJE16 + 1e-6 ? 0.16 : espPadrao);   // automático (com a regra dos 4 m): diferente disso fica à mão
            if (isFinite(v) && v > 0 && Math.abs(v / 100 - doAmb) > 1e-6) m[lajeSel!] = v / 100; else delete m[lajeSel!];
            setAj({ ...aj, lajeEspPainel: m }); }} />
        </label>
        <p className="dica">Treliça {t} ({TRELICA[t]}) · {REGRA_TRELICA}</p>
      </>;
    })()}
    {amb ? <>
      <h3>{lajeSel ? 'Ambiente desta laje' : 'Ambiente selecionado'}</h3>
      <p>{br(amb.x1 - amb.x0)} × {br(amb.y1 - amb.y0)} m (eixos) · vão {br(amb.vao)} m</p>
      {amb.aviso && <p className="erro">{amb.aviso}</p>}
      {amb.info && <p className="dica">{amb.info}</p>}
      {P.filter(p => p.amb === amb.id).map(p => <div key={p.num} className="dica">L{p.num}: {br(p.comp)} × {br(p.larg)}{p.dente ? ` · dente ${br(p.dente.x1 - p.dente.x0)} × ${br(p.dente.y1 - p.dente.y0)}` : ''}</div>)}
      <button onClick={() => tog('lajeFora', amb.id)}>{(aj.lajeFora || []).includes(amb.id) ? 'Colocar laje neste ambiente' : 'Sem laje aqui (vazio, área externa)'}</button>
      <button onClick={() => tog('lajeGiro', amb.id)}>Girar o sentido dos painéis</button>
      {(P.filter(p => p.amb === amb.id).length > 1 || (aj.lajeInteira || []).includes(amb.id)) && <button onClick={() => setAj({ ...aj, lajeInteira: (aj.lajeInteira || []).includes(amb.id) ? (aj.lajeInteira || []).filter(x => x !== amb.id) : [...(aj.lajeInteira || []), amb.id] })}>
        {(aj.lajeInteira || []).includes(amb.id) ? 'Voltar a dividir na largura máxima' : 'Laje inteira (um painel só na largura)'}</button>}
      {(() => {
        // juntar com o ambiente vizinho: a parede entre os dois deixa de dividir a laje
        const lados = ([['o', 'à esquerda'], ['l', 'à direita'], ['n', 'de cima'], ['s', 'de baixo']] as const).filter(([l]) => amb.apoio[l] && !amb.externo?.[l]);
        const seg = (l: 'o' | 'l' | 's' | 'n') => l === 'o' || l === 'l' ? { pav: pav.id, o: 'V' as const, c: l === 'o' ? amb.x0 : amb.x1, a: amb.y0, b: amb.y1 } : { pav: pav.id, o: 'H' as const, c: l === 's' ? amb.y0 : amb.y1, a: amb.x0, b: amb.x1 };
        return lados.length ? <>
          {lados.map(([l, t]) => <button key={l} onClick={() => setAj(juntarLajes(aj, calc.lajes, [seg(l)]))}>Juntar com o ambiente {t} (laje passa por cima da parede)</button>)}
        </> : null;
      })()}
      {amb.apoioLado && amb.sentido && (() => {
        // apoio da laje em cima de cada parede do ambiente (cm), editável
        const nomes = { o: 'Esquerda', l: 'Direita', n: 'Em cima', s: 'Embaixo' } as const;
        const ordem = (amb.sentido === 'H' ? ['o', 'l', 'n', 's'] : ['n', 's', 'o', 'l']) as ('o' | 'l' | 's' | 'n')[];
        const pontas = amb.sentido === 'H' ? ['o', 'l'] : ['n', 's'];
        const over = aj.lajeApoioLado?.[amb.id] || {};
        const muda = (l: 'o' | 'l' | 's' | 'n', txt: string) => {
          const v = parseFloat(txt.replace(',', '.')); const m = { ...(aj.lajeApoioLado || {}) }; const o = { ...(m[amb.id] || {}) };
          if (isFinite(v) && v >= 0) o[l] = v / 100; else delete o[l];
          if (Object.keys(o).length) m[amb.id] = o; else delete m[amb.id];
          setAj({ ...aj, lajeApoioLado: m });
        };
        return <div className="apoio-laje">
          <b>Apoio da laje em cima da parede (cm)</b>
          <div className="apoio-grade">{ordem.map(l => <label key={l}>{nomes[l]}{pontas.includes(l) ? ' (ponta)' : ' (lateral)'}
            <input type="number" step="0.5" min="0" key={amb.id + l + (over[l] ?? '')} defaultValue={Math.round(amb.apoioLado![l] * 1000) / 10}
              className={over[l] != null ? 'mudado' : ''} onBlur={e => muda(l, e.target.value)} /></label>)}</div>
          <p className="dica">Padrão: {Math.round(regras.lajeApoio * 100)} cm onde a parede recebe laje dos dois lados, {Math.round((regras.lajeApoioBorda ?? 0.10) * 100)} cm na borda, 0 sem parede. Apague o número para voltar ao padrão.{Object.keys(over).length ? ' Valor mudado neste ambiente em azul.' : ''}</p>
          {pontas.some(l => amb.apoioLado![l as 'o'] < regras.lajeApoio - 1e-6) && <p className="erro">Atenção: ponta da laje com menos de {Math.round(regras.lajeApoio * 100)} cm de apoio na parede.</p>}
        </div>;
      })()}
      {amb.sentido && (() => {
        // alinhar as emendas dos painéis com as da fileira vizinha (de cima/de baixo, ou dos lados se os painéis estão deitados)
        const largX = amb.sentido === 'V';                       // painéis em pé: a largura corre em x
        const lados = (largX ? [['n', 'de cima'], ['s', 'de baixo']] : [['o', 'da esquerda'], ['l', 'da direita']]) as ['o' | 'l' | 's' | 'n', string][];
        const [w0, w1] = largX ? [amb.x0, amb.x1] : [amb.y0, amb.y1];
        const emendasDo = (lado: 'o' | 'l' | 's' | 'n') => {
          const viz = calc.lajes.filter(b => b.pav === amb.pav && b !== amb && (lado === 'n' ? Math.abs(b.y0 - amb.y1) < 0.08 : lado === 's' ? Math.abs(b.y1 - amb.y0) < 0.08 : lado === 'o' ? Math.abs(b.x1 - amb.x0) < 0.08 : Math.abs(b.x0 - amb.x1) < 0.08)
            && (largX ? Math.min(b.x1, amb.x1) - Math.max(b.x0, amb.x0) : Math.min(b.y1, amb.y1) - Math.max(b.y0, amb.y0)) > 0.3);
          const iv = calc.pl.filter(p => viz.some(b => b.id === p.amb)).map(p => largX ? [p.x0, p.x1] : [p.y0, p.y1]).sort((p, q) => p[0] - q[0]);
          const js: number[] = [];
          for (let i = 0; i < iv.length - 1; i++) { const g = iv[i + 1][0] - iv[i][1]; if (g > -0.01 && g < 0.3) { const c = (iv[i][1] + iv[i + 1][0]) / 2; if (c > w0 + 0.3 && c < w1 - 0.3 && !js.some(x => Math.abs(x - c) < 0.05)) js.push(c); } }
          return js;
        };
        const tem = (aj.lajeEmendas || {})[amb.id];
        const opc = lados.map(([l, t]) => ({ t, js: emendasDo(l) })).filter(o => o.js.length);
        if (!opc.length && !tem) return null;
        return <>{opc.map(o => <button key={o.t} onClick={() => setAj({ ...aj, lajeEmendas: { ...(aj.lajeEmendas || {}), [amb.id]: o.js }, lajeInteira: (aj.lajeInteira || []).filter(x => x !== amb.id) })}>
          Alinhar as emendas com as lajes {o.t} ({o.js.map(c => br(c - w0)).join(' · ')} m da borda)</button>)}
          {tem && <button onClick={() => { const m = { ...(aj.lajeEmendas || {}) }; delete m[amb.id]; setAj({ ...aj, lajeEmendas: m }); }}>Voltar a dividir em partes iguais</button>}</>;
      })()}
      <label>Pé-direito deste ambiente (m) — vazio = {br(pav.altura)} do pavimento
        <input type="number" step="0.01" key={'pe' + amb.id} defaultValue={aj.peAmb?.[amb.id] ?? ''} onBlur={e => {
          const v = parseFloat(e.target.value.replace(',', '.')); const m = { ...(aj.peAmb || {}) };
          if (isFinite(v) && v > 0 && Math.abs(v - pav.altura) > 1e-6) m[amb.id] = v; else delete m[amb.id];
          setAj({ ...aj, peAmb: m }); }} />
      </label>
      <label>Espessura da laje em todo o ambiente (cm)
        <input type="number" step="1" key={amb.id + (lajeSel || '')} defaultValue={Math.round((espDoAmb(aj)(amb.id) ?? espPadrao) * 100)} onBlur={e => {
          const v = parseFloat(e.target.value.replace(',', '.')); const m = { ...(aj.lajeEspAmb || {}) };
          if (isFinite(v) && v > 0 && Math.abs(v / 100 - espPadrao) > 1e-6) m[amb.id] = v / 100; else delete m[amb.id];
          // vale para o ambiente todo: tira a espessura própria das lajes dele
          const mp = Object.fromEntries(Object.entries(aj.lajeEspPainel || {}).filter(([k]) => !k.startsWith(amb.id + '@')));
          setAj({ ...aj, lajeEspAmb: m, lajeEspPainel: mp, laje16: (aj.laje16 || []).filter(x => x !== amb.id) }); }} />
      </label>
      {(() => { const t = trelicaDaEsp(espDoAmb(aj)(amb.id) ?? espPadrao); return <p className="dica">Treliça {t} ({TRELICA[t]}) · {REGRA_TRELICA}</p>; })()}
    </> : <p className="dica">Clique numa laje ou num ambiente na planta.</p>}
  </div>;
}

// revisões: retrato das peças (chave estável pela posição) para comparar uma versão com a outra
type Revisao = NonNullable<Ajustes['revisoes']>[number];
function retrato(calc: Calc, sg: Map<string, string>): Revisao['pecas'] {
  return [
    ...calc.ps.map(p => ({ k: 'P|' + (p.chave ?? `${p.trecho}@${p.a.toFixed(2)}`), cod: codigoParede(p, sg),
      d: `${br(p.larg)} × ${p.chanfro ? `${br(p.chanfro.ha)}/${br(p.chanfro.hb)}` : br(p.H)}${p.recortes.length ? ' · ' + p.recortes.map(r => `${r.tipo} ${br(r.w)}x${br(r.h)} a ${br(r.dl)}`).join(', ') : ''}` })),
    ...calc.pl.map(p => ({ k: 'L|' + chaveLaje(p), cod: codigoLaje(p, sg), d: `${br(p.comp)} × ${br(p.larg)}${p.dente ? ' (dente)' : ''}` })),
  ];
}
function compararRev(base: Revisao['pecas'], atual: Revisao['pecas']) {
  const B = new Map(base.map(x => [x.k, x])), A = new Map(atual.map(x => [x.k, x]));
  const novas = atual.filter(x => !B.has(x.k)), removidas = base.filter(x => !A.has(x.k));
  const mudaram = atual.filter(x => B.has(x.k) && B.get(x.k)!.d !== x.d).map(x => ({ cod: x.cod, antes: B.get(x.k)!.d, depois: x.d, codAntes: B.get(x.k)!.cod }));
  const renum = atual.filter(x => B.has(x.k) && B.get(x.k)!.d === x.d && B.get(x.k)!.cod !== x.cod).map(x => ({ de: B.get(x.k)!.cod, para: x.cod }));
  return { novas, removidas, mudaram, renum };
}
function TabelaAlteracoes({ dif }: { dif: ReturnType<typeof compararRev> }) {
  return <div className="alteracoes">
    <p><b>{dif.mudaram.length}</b> peça(s) mudaram · <b>{dif.novas.length}</b> nova(s) · <b>{dif.removidas.length}</b> deixaram de existir · {dif.renum.length} só mudaram de número</p>
    {dif.mudaram.length > 0 && <table className="tlaje rom"><thead><tr><th>Peça</th><th>Antes</th><th>Agora</th></tr></thead><tbody>
      {dif.mudaram.map((m, i) => <tr key={i}><td><b>{m.cod}</b>{m.codAntes !== m.cod ? ` (era ${m.codAntes})` : ''}</td><td>{m.antes}</td><td><b>{m.depois}</b></td></tr>)}</tbody></table>}
    {dif.novas.length > 0 && <p><b>Novas:</b> {dif.novas.map(x => `${x.cod} (${x.d})`).join(' · ')}</p>}
    {dif.removidas.length > 0 && <p><b>Deixaram de existir:</b> {dif.removidas.map(x => `${x.cod} (${x.d})`).join(' · ')}</p>}
    {dif.renum.length > 0 && <p className="dica"><b>Só o número mudou:</b> {dif.renum.map(x => `${x.de} → ${x.para}`).join(' · ')}</p>}
  </div>;
}
// dados de produção de todas as peças: etiqueta, ordem de montagem, vizinhos, face, peso e posição na carreta
export interface PecaProd { id: string; tipo: 'Parede' | 'Laje'; pav: string; num: number; codigo: string; desc: string; a: number; b: number; area: number; peso: number;
  ordem: number; ordemPav?: number; esq?: string; dir?: string; face?: string; aberturas?: string; carreta?: number; pilha?: number; pos?: number; nPilha?: number }
function dadosProducao(ativos: Pavimento[], calc: Calc, regras: Regras, aj: Ajustes, leitura: Leitura) {
  const sg = siglas(ativos);
  const nomesAmb = leitura.textos.filter(t => AMBIENTE_RE.test(t.text.trim()) && t.text.length <= 28).map(t => ({ text: t.text.trim(), x: t.x, y: t.y }));
  const pecas: PecaProd[] = [], ordens = new Map<string, Map<number, number>>(), infos = new Map<number, InfoVista>();
  let k = 0;
  for (const pav of ativos) {
    const ps = calc.ps.filter(p => p.pav === pav.id);
    const ordem = ordemMontagem(ps), viz = vizinhos(ps); ordens.set(pav.id, ordem);
    for (const p of [...ps].sort((a, b) => ordem.get(a.num)! - ordem.get(b.num)!)) {
      const v = viz.get(p.num)!, fc = faceDaVista(p, calc.lajes, nomesAmb);
      const lista = (xs: Painel[]) => xs.length ? xs.map(x => 'P' + x.num).join(', ') : 'livre';
      const face = fc.face === 'externa' ? 'vista: face EXTERNA' : fc.face === 'interna' ? `vista: face interna${fc.amb ? ' — ' + fc.amb : ''}` : 'vista: sem ambiente';
      const info: InfoVista = { codigo: codigoParede(p, sg), esq: lista(v.a), dir: lista(v.b), face };
      infos.set(p.num, info);
      pecas.push({ id: 'P' + p.num, tipo: 'Parede', pav: pav.id, num: p.num, codigo: info.codigo, desc: `${br(p.larg)} × ${p.chanfro ? `${br(p.chanfro.ha)}/${br(p.chanfro.hb)}` : br(p.H)}`, a: p.larg, b: p.H,
        area: areaPainel(p), peso: pesoParede(p, regras), ordem: ++k, ordemPav: ordem.get(p.num), esq: info.esq, dir: info.dir, face, aberturas: p.recortes.map(r => r.tipo).join(', ') });
    }
    for (const p of calc.pl.filter(x => x.pav === pav.id).sort((a, b) => a.num - b.num))
      pecas.push({ id: 'L' + p.num, tipo: 'Laje', pav: pav.id, num: p.num, codigo: codigoLaje(p, sg), desc: `${br(p.comp)} × ${br(p.larg)}`, a: p.comp, b: p.larg, area: areaLaje(p), peso: pesoLaje(p, regras, espDaLaje(aj)(p)), ordem: ++k });
  }
  const esp = (regras.isoporAlt ?? 0.09) + 2 * (regras.capeamento ?? 0.025);
  const pc = pecas.map(p => ({ id: p.id, codigo: p.codigo, ordem: p.ordem, a: p.a, b: p.b, peso: p.peso }));
  const op = { pesoMax: regras.cargaMax ?? 35000, comp: regras.carretaComp ?? 12.4, larg: regras.carretaLarg ?? 2.8, largMax: regras.carretaLargMax ?? 3.2, altPilha: regras.pilhaAlt ?? 1.5, esp, tol: 0.3 };
  const modo = regras.cargaModo ?? 'auto';
  const plano = planoCarga(pc, { ...op, modoPlano: modo });
  const nOutro = modo === 'montagem' ? planoCarga(pc, { ...op, modoPlano: 'auto' }).length : planoCarga(pc, { ...op, modoPlano: 'montagem' }).length;
  const porId = new Map(pecas.map(p => [p.id, p]));
  for (const c of plano) for (const pl of c.pilhas) pl.pecas.forEach((x, i) => { const q = porId.get(x.id)!; q.carreta = c.n; q.pilha = pl.n; q.pos = pl.pecas.length - i; q.nPilha = pl.pecas.length; });
  // plano de corte do isopor (barras) e das treliças, e produção nas mesas na ordem das carretas
  const pedIso: { comp: number; peca: string }[] = [];
  for (const p of calc.ps) {
    const ha = p.chanfro?.ha ?? p.H, hb = p.chanfro?.hb ?? p.H;
    for (const c of isoporDaPeca(p.larg, x => ha + (hb - ha) * x / p.larg, p.recortes.map(r => ({ x: r.dl, w: r.w, base: r.base, h: r.h })), regras)) pedIso.push({ comp: c, peca: codigoParede(p, sg) });
  }
  for (const p of calc.pl) for (const c of isoporDaPeca(p.larg, () => p.comp, [], regras)) pedIso.push({ comp: c, peca: codigoLaje(p, sg) });
  const corteIso = planoCorte(pedIso, regras.isoporComp ?? 4);
  const corteTrel = (Object.keys(TRELICA) as (keyof typeof TRELICA)[]).map(t => {
    const ped: { comp: number; peca: string }[] = [];
    for (const l of quantTrelicas(ativos, calc, aj).filter(x => x.tipo === t)) for (const [c, n] of l.cortes) for (let i = 0; i < n; i++) ped.push({ comp: parseFloat(c.replace(',', '.')), peca: l.pav });
    return { tipo: t, ...planoCorte(ped, regras.trelicaBarra ?? 12, 0.01) };
  }).filter(x => x.barras > 0);
  const seqProd = [...pecas].sort((a, b) => (a.carreta ?? 0) - (b.carreta ?? 0) || a.ordem - b.ordem).map(p => ({ codigo: p.codigo, a: p.a, b: p.b, carreta: p.carreta }));
  const mesas = planoMesas(seqProd, { qtd: Math.max(1, Math.round(regras.mesas ?? 4)), comp: regras.mesaComp ?? 12, larg: regras.mesaLarg ?? 3.2, folga: 0.1 });
  return { sg, pecas, plano, ordens, infos, porId, modo, nOutro, corteIso, corteTrel, mesas };
}
type Prod = ReturnType<typeof dadosProducao>;
const camada = (p: PecaProd) => (p.nPilha ?? 0) - (p.pos ?? 0) + 1;   // 1 = embaixo
const posTxt = (p: PecaProd) => `camada ${camada(p)} de ${p.nPilha}${p.pos === 1 ? ' (em cima)' : camada(p) === 1 ? ' (embaixo)' : ''}`;
// planilha de produção (CSV)
function csvProducao(prod: Prod, ativos: Pavimento[]): string {
  const nome = new Map(ativos.map(p => [p.id, p.nome]));
  const L = ['Ordem geral;Peça;Tipo;Pavimento;Medidas (m);Área (m²);Peso (kg);Montagem no pavimento;Carreta;Pilha;Camada (1 = embaixo);Camadas na pilha;Sai da pilha em;Lado esquerdo;Lado direito;Face da vista;Aberturas'];
  for (const p of prod.pecas) L.push([p.ordem, p.codigo, p.tipo, (p.tipo === 'Laje' ? 'sobre o ' : '') + nome.get(p.pav), p.desc, br(p.area), Math.round(p.peso), p.ordemPav ?? '', p.carreta ?? '', p.pilha ?? '', p.pos ? camada(p) : '', p.nPilha ?? '', p.pos ? `${p.pos}º` : '', p.esq ?? '', p.dir ?? '', p.face ?? '', p.aberturas ?? ''].join(';'));
  L.push('', 'Carreta;Peças;Peso (kg);Comprimento usado (m);Da peça;Até a peça');
  for (const c of prod.plano) L.push([c.n, c.pecas.length, Math.round(c.peso), br(c.usado), c.pecas[0].codigo, c.pecas[c.pecas.length - 1].codigo].join(';'));
  return '﻿' + L.join('\r\n');
}
// detalhamento da armação (paredes e lajes), caderno da fábrica e lista de compra do aço
function CardArmacao({ ativos, calc, regras, aj, setAj, nome }: { ativos: Pavimento[]; calc: Calc; regras: Regras; aj: Ajustes; setAj: (a: Ajustes) => void; nome: string }) {
  const [msg, setMsg] = useState(''); const [ocupado, setOcupado] = useState(false);
  const o = aj.arm || {}, liberado = o.liberado ?? true, trelBorda16 = o.trelBorda16 ?? true, pavs = o.pavs ?? ativos.map(p => p.id), revisao = o.revisao ?? '00';
  const muda = (x: Partial<NonNullable<Ajustes['arm']>>) => setAj({ ...aj, arm: { ...o, ...x } });
  const titulo = nome.replace(/\.(dxf|dwg|pdf|json)$/i, ''), nomesPav = ativos.filter(p => pavs.includes(p.id)).map(p => p.nome);
  const obra = titulo + (nomesPav.length && nomesPav.length < ativos.length ? ' - ' + nomesPav.join(', ') : '');
  const gerar = async (o2: 'paredes' | 'lajes' | 'caderno' | 'compra' | 'aco') => {
    setOcupado(true); setMsg('');
    try {
      const { detalhar, caderno, csvCompra, csvAco } = await import('./engine/pranchasArm.ts');
      const { paginasParaPdf } = await import('./engine/folhaDoc.ts');
      const sg = siglas(ativos);
      const E = { obra, resp: 'Eng. Nathael Fernando Miranda dos Santos · CREA 1020724730D-GO', pavs: ativos.map(p => ({ id: p.id, nome: p.nome })),
        ps: calc.ps.filter(p => pavs.includes(p.pav)), pl: calc.pl.filter(p => pavs.includes(p.pav)), vigas: calc.vigas.filter(v => v.tipo === 'trelica'), regras,
        espLaje: (p: PainelLaje) => espDaLaje(aj)(p) ?? regras.lajeEsp ?? 0.14, balanco: balancoLaje(calc.ps), travamento: travamentoParede(calc.ps), codP: (p: Painel) => codigoParede(p, sg), codL: (p: PainelLaje) => codigoLaje(p, sg), liberado, trelBorda16, revisao };
      const arq = titulo + (nomesPav.length < ativos.length ? ' - ' + nomesPav.join(' ') : '');
      if (o2 === 'paredes' || o2 === 'lajes') {
        const d = detalhar(E, o2 === 'lajes');
        baixarBin(`${arq} - Armacao ${o2.toUpperCase()}.pdf`, paginasParaPdf(d.paginas), 'application/pdf');
        setMsg(`${d.tipos} tipos · ${d.paginas.length} folhas · ${br(d.kg, 1)} kg de aço${d.reforcos.length ? ` · ${new Set(d.reforcos.map(r => r.codigo)).size} painéis com reforço embaixo de parede de cima: ${[...new Set(d.reforcos.map(r => r.codigo))].join(', ')}` : ''}${d.avisos.length ? ' · ATENÇÃO: ' + d.avisos.join(' | ') : ''}`);
      } else {
        const dp = detalhar(E, false), dl = detalhar(E, true), lin = [...dp.linhas, ...dl.linhas];
        if (o2 === 'aco') { baixar(`${arq} - Relacao do aco.csv`, csvAco(lin), 'text/csv'); return; }
        const c = caderno(E, lin);
        if (o2 === 'caderno') baixarBin(`${arq} - Caderno da fabrica (aco).pdf`, paginasParaPdf(c.paginas), 'application/pdf');
        else baixar(`${arq} - Lista de compra de aco.csv`, csvCompra(c.compra, obra), 'text/csv');
        const a = c.compra.reduce((s, x) => s + x.kgPecas, 0), b = c.compra.reduce((s, x) => s + x.kgCompra, 0);
        setMsg(`Aço nas peças ${br(a, 1)} kg · comprado ${br(b, 1)} kg (barras de 12 m)`);
      }
    } catch (e) { setMsg('Não consegui gerar: ' + (e as Error).message); }
    finally { setOcupado(false); }
  };
  return <div className="card noprint">
    <h3>Armação (detalhamento das paredes e lajes)</h3>
    <p className="dica">Pranchas A3 de cada tipo de peça (2 vistas na ordem de montagem, relação do aço, corte), resumo do aço, verificações, caderno da fábrica (corte, dobra e plano de corte) e lista de compra.</p>
    <div className="botoes">{ativos.map(p => <label key={p.id}><input type="checkbox" checked={pavs.includes(p.id)} onChange={e => muda({ pavs: e.target.checked ? [...pavs, p.id] : pavs.filter(x => x !== p.id) })} /> {p.nome}</label>)}</div>
    <label><input type="checkbox" checked={liberado} onChange={e => muda({ liberado: e.target.checked })} /> Folhas liberadas para produção</label>
    <label><input type="checkbox" checked={trelBorda16} onChange={e => muda({ trelBorda16: e.target.checked })} /> Lajes de 16 cm ou mais: treliça nas 2 laterais de cada painel</label>
    <label>Revisão das folhas <input style={{ width: 60 }} value={revisao} onChange={e => muda({ revisao: e.target.value.slice(0, 3) })} /> <small>(aumente a cada versão mandada para a fábrica)</small></label>
    <div className="botoes">
      <button disabled={ocupado} onClick={() => gerar('paredes')}>Baixar armação das PAREDES (PDF)</button>
      <button disabled={ocupado} onClick={() => gerar('lajes')}>Baixar armação das LAJES (PDF)</button>
      <button disabled={ocupado} onClick={() => gerar('caderno')}>Caderno da fábrica (PDF)</button>
      <button disabled={ocupado} onClick={() => gerar('compra')}>Lista de compra do aço (CSV)</button>
      <button disabled={ocupado} onClick={() => gerar('aco')}>Relação do aço por peça (CSV)</button>
    </div>
    {ocupado && <p className="dica">Gerando…</p>}
    {msg && <p className={/ATENÇÃO|Não consegui/.test(msg) ? 'erro' : 'dica'}>{msg}</p>}
  </div>;
}
// etiquetas para colar nas peças: 12 por folha A4 deitada
const qrSvg = (t: string) => { const q = qrcode(0, 'M'); q.addData(t); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); };
function Etiquetas({ prod, ativos, nome, qrBase }: { prod: Prod; ativos: Pavimento[]; nome: string; qrBase?: string }) {
  const nomePav = new Map(ativos.map(p => [p.id, p.nome])), titulo = nome.replace(/\.(dxf|dwg|pdf|json)$/i, '');
  return <div className="folhas">{emBlocos(prod.pecas, 12).map((B, i) => <div className="folha etiquetas" key={i}>
    {B.map(p => <div className={'etq' + (qrBase ? ' comqr' : '')} key={p.id}>
      {qrBase && <div className="etq-qr" dangerouslySetInnerHTML={{ __html: qrSvg(qrBase + encodeURIComponent(p.codigo)) }} />}
      <div className="etq-cod">{p.codigo}<span>{p.tipo === 'Parede' ? '▲ topo' : ''}</span></div>
      <div className="etq-obra">{titulo} · {p.tipo === 'Laje' ? 'laje sobre o ' : ''}{nomePav.get(p.pav)}</div>
      <div><b>{p.tipo} {p.desc} m</b> · {Math.round(p.peso)} kg{p.aberturas ? ` · ${p.aberturas}` : ''}</div>
      <div>Montagem nº <b>{p.tipo === 'Parede' ? p.ordemPav : '—'}</b> · ordem geral {p.ordem}</div>
      <div>Carreta <b>{p.carreta}</b> · pilha <b>{p.pilha}</b> · {p.pos ? posTxt(p) : ''}</div>
      {p.tipo === 'Parede' && <div>Lado esquerdo: <b>{p.esq}</b> · lado direito: <b>{p.dir}</b></div>}
      {p.tipo === 'Parede' && <div className="etq-face">{p.face}</div>}
    </div>)}
  </div>)}</div>;
}
const ESC_LAJE = 12, ESC_PAREDE = 12;   // vistas de produção das lajes: 12 mm por metro (mais peças por folha, letras do mesmo tamanho)

// planta comprida em pé numa folha deitada: gira 90° para ocupar a folha toda
function girar(vb: string, html: string): { vb: string; html: string } {
  const [x, y, w, h] = vb.split(/[ ,]+/).map(Number);
  if (!(h > w * 1.15)) return { vb, html };
  return { vb: `0 0 ${h} ${w}`, html: `<g transform="translate(0 ${w}) rotate(-90) translate(${-x} ${-y})">${html}</g>` };
}
function SvgFolha({ vb, html }: { vb: string; html: string }) { const g = girar(vb, html); return <svg viewBox={g.vb} preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{ __html: g.html }} />; }

// foto do 3D da montagem para a prancha (o three.js só carrega quando a folha aparece)
function Foto3D({ p3d, pav, modo }: { p3d: Props3D; pav: string; modo: 'paredes' | 'lajes' }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    // espera um pouco depois da última alteração (digitando/clicando várias vezes não refaz as fotos a cada clique)
    const t = setTimeout(() => import('./Vista3D.tsx').then(m => m.fotoMontagem(p3d, pav, modo)).then(u => { if (vivo) setSrc(u); }).catch(() => { if (vivo) setSrc(''); }), 900);
    return () => { vivo = false; clearTimeout(t); };
  }, [p3d, pav, modo]);
  return src ? <img src={src} alt={`3D ${modo}`} /> : <p className="dica">{src === null ? 'Gerando o 3D…' : 'Não consegui gerar o 3D neste navegador.'}</p>;
}
function Folhas({ ativos: todos, soPavs, calc, leitura, arqDe, nome, novo, regras, aj, prod, rev, p3d }: { p3d?: Props3D; ativos: Pavimento[]; soPavs?: string[]; calc: Calc; leitura: Leitura; arqDe: (b: Box) => Prim[]; nome: string; novo?: boolean; regras: Regras; aj: Ajustes; prod: Prod; rev?: { base: Revisao; dif: ReturnType<typeof compararRev> } }) {
  type F = { key: string; tit: string; body: JSX.Element; rod: string };
  // só os pavimentos escolhidos: folhas do pavimento, cargas com peças dele; as folhas gerais (isopor, mesas, conferência...) saem só com todos
  const filtra = !!soPavs?.length && soPavs.length < todos.length, ativos = filtra ? todos.filter(p => soPavs!.includes(p.id)) : todos;
  const F: F[] = [];
  const add = (key: string, tit: string, body: JSX.Element, rod: string) => { F.push({ key, tit, body, rod }); return F.length - 1; };
  const sg = prod.sg;
  if (rev) F.push({ key: 'rev', tit: `ALTERAÇÕES DESDE A REVISÃO ${rev.base.n} (${new Date(rev.base.em).toLocaleDateString('pt-BR')}${rev.base.nota ? ' · ' + rev.base.nota : ''})`, body: <div className="desenho lajes cont conf"><TabelaAlteracoes dif={rev.dif} /></div>, rod: 'Comparação peça por peça pela posição na planta · produzir de novo as peças que mudaram e descartar as que deixaram de existir' });
  const fLaje = ESC_VISTA / ESC_LAJE, fPar = ESC_VISTA / ESC_PAREDE, titulo = nome.replace(/\.(dxf|dwg|pdf|json)$/i, '');
  const indice: { pav: string; tipo: 'Paredes' | 'Lajes'; nums: number[]; f: number }[] = [];
  const trelSemLaje: { pav: string; t: number }[] = [];
  const faixa = (ns: number[]) => { const v = [...ns].sort((a, b) => a - b), out: string[] = []; for (let i = 0; i < v.length;) { let j = i; while (j + 1 < v.length && v[j + 1] === v[j] + 1) j++; out.push(j > i ? `${v[i]}–${v[j]}` : `${v[i]}`); i = j + 1; } return out.join(', '); };
  for (const pav of ativos) {
    const ps = calc.ps.filter(p => p.pav === pav.id);
    const q = quadroDe(pav);
    if (ps.length) {
      add(pav.id + 'p', `PLANTA DE MONTAGEM DAS PAREDES — ${pav.nome.toUpperCase()}`,
        <div className="desenho"><SvgFolha vb={q.vb} html={plantaConteudo(leitura, pav, ps, calc.vaos.filter(v => v.pav === pav.id), arqDe(pav.box), q)} /></div>,
        '■ vermelho: número do painel · azul: cota da parede (painel = cota − desconto) · rosa: porta / janela');
      const ordem = prod.ordens.get(pav.id)!;
      add(pav.id + 's', `SEQUÊNCIA DE MONTAGEM DAS PAREDES — ${pav.nome.toUpperCase()}`,
        <div className="desenho"><SvgFolha vb={q.vb} html={arqSvg(q, arqDe(pav.box)) + sequenciaConteudo(ps, ordem, q)} /></div>,
        'Círculo azul = ordem de montagem (começa num canto e segue sempre encostando em peça já montada, fechando os cantos) · vermelho = número da peça · conferir prumo e travamento a cada canto fechado');
      if (p3d) add(pav.id + '3p', `3D DA MONTAGEM DAS PAREDES — ${pav.nome.toUpperCase()}`,
        <div className="desenho foto3d"><Foto3D p3d={p3d} pav={pav.id} modo="paredes" /></div>,
        'Paredes do pavimento em destaque com o número de cada painel (o mesmo da planta e da etiqueta) · em cinza: o que já está montado embaixo');
      const info = (p: Painel) => prod.infos.get(p.num)!;
      const paginas = paginarVistas(ps, p => p.larg, p => p.H + 0.45 + (0.35 + 0.26) * fPar + Math.ceil((p.aviso || '').length * fPar / (18 * (p.larg + 0.6))) * 0.13 * fPar, 3, ESC_PAREDE);
      paginas.forEach((pgx, i) => {
        const fi = add(pav.id + 'v' + i, `MODULAÇÃO DAS PAREDES — ${pav.nome.toUpperCase()} — ${i + 1}/${paginas.length}`,
          <div className="vistas">{pgx.map((linha, j) => <div className="linha" key={j}>{linha.map(p => <div key={p.num} className="vista" dangerouslySetInnerHTML={{ __html: vistaSvg(p, info(p), ESC_PAREDE) }} />)}</div>)}</div>,
          'Etiqueta = pavimento-peça · embaixo da peça: ◄ P12 = peça encostada no lado ESQUERDO · P2, P6 ► = peças encostadas no lado DIREITO (livre = ponta solta) · ▲ topo · vãos de portas e janelas maiores pelo acréscimo · boneca nas laterais e embaixo (retirar na obra) · medidas em metros');
        indice.push({ pav: pav.id, tipo: 'Paredes', nums: pgx.flat().map(p => p.num), f: fi });
      });
    }
    const VG = calc.vigas.filter(v => v.pav === pav.id);
    if (VG.length) add(pav.id + 'g', `VIGAS E TRELIÇAS — ${pav.nome.toUpperCase()}`,
      <div className="desenho lajes"><SvgFolha vb={q.vb} html={arqSvg(q, arqDe(pav.box)) + vigasConteudo(VG, q)} />
        <div className="tvigas">{VG.map(v => <p key={v.id}><b>{v.tipo === 'trelica' ? 'T' : 'V'}{v.n}</b> ({v.tipo === 'trelica' ? 'treliça' : v.obrigatoria ? 'obrigatória' : 'recomendada'}, {br(v.b - v.a)} m): {v.motivo} <i>{v.ideia}</i>{v.rebaixos.length ? ` Rebaixo: ${v.rebaixos.map(r => `${r.painel} (${br(r.de)}→${br(r.para)})`).join(', ')}.` : ''}</p>)}</div></div>,
      'Sugestões para o engenheiro conferir e dimensionar · vermelho = viga obrigatória · laranja = recomendada · roxo = treliça de reforço da laje');
    const P = calc.pl.filter(p => p.pav === pav.id);
    const TRf = calc.vigas.filter(v => v.pav === pav.id && v.tipo === 'trelica'), TPf = trelicasNasLajes(TRf, P);
    for (const t of TPf) if (!t.painel) trelSemLaje.push({ pav: pav.id, t: t.t });
    if (P.length) {
      const LJ = calc.lajes.filter(a => a.pav === pav.id);
      const desenhoLaje = DEFS_LAJE + arqSvg(q, arqDe(pav.box)) + lajesConteudo(LJ, P, q, TRf.filter(t => TPf.some(x => x.t === t.n)));
      add(pav.id + 'l', `MODULAÇÃO DA LAJE SOBRE O ${pav.nome.toUpperCase()}`,
        <div className="desenho lajes"><SvgFolha vb={q.vb} html={desenhoLaje} />
          <div className="tlajes">{emBlocos(P, LINHAS_TLAJE).map((B, bi, BB) => <table className="tlaje" key={bi}><thead><tr><th>Painel</th><th>Comp.</th><th>Larg.</th><th>m²</th></tr></thead><tbody>
            {B.map(p => <tr key={p.num}><td>L{p.num}{p.dente ? '*' : ''}</td><td>{br(p.comp)}</td><td>{br(p.larg)}</td><td>{br(areaLaje(p))}</td></tr>)}
            {bi === BB.length - 1 && <tr className="tot"><td>Total</td><td></td><td></td><td>{br(P.reduce((s, p) => s + areaLaje(p), 0))}</td></tr>}
          </tbody></table>)}</div></div>,
        'Comprimento e largura com apoio em cima das paredes: 6 cm onde a parede recebe laje dos dois lados, 10 cm na borda · * = painel com dente (recorte no canto) · seta = sentido do vão · tracejado laranja = viga sugerida (conferir) · roxo = treliça');
      if (p3d) add(pav.id + '3l', `3D DA MONTAGEM DA LAJE SOBRE O ${pav.nome.toUpperCase()}`,
        <div className="desenho foto3d"><Foto3D p3d={p3d} pav={pav.id} modo="lajes" /></div>,
        'Lajes em azul com o número de cada painel (o mesmo da planta e da etiqueta) · em cinza: as paredes que recebem a laje e o que está embaixo');
      const ES = escoras(LJ, regras.escoraMax ?? 1.5);
      if (ES.linhas.length) add(pav.id + 'e', `ESCORAMENTO DA LAJE SOBRE O ${pav.nome.toUpperCase()}`,
        <div className="desenho"><SvgFolha vb={q.vb} html={DEFS_LAJE + arqSvg(q, arqDe(pav.box)) + lajesConteudo(LJ, P, q) + escorasConteudo(ES.linhas, ES.vaos, q)} /></div>,
        `Verde tracejado = linha de escora (pontaletes com travessa), perpendicular ao vão, a no máximo ${br(regras.escoraMax ?? 1.5)} m uma da outra e das paredes · cota = distância entre linhas · conferir com o fabricante e o engenheiro · retirar só após a cura do capeamento`);
      if (novo) {
        const trDe = (p: PainelLaje) => TRf.map(t => ({ ...t, tipo: trelicaDaEsp(espDaLaje(aj)(p) ?? 0) }));
        const ex = (p: PainelLaje) => extraVistaLaje(p, TRf, fLaje);
        const pgs = paginarVistas(P, p => p.larg + ex(p).larg, p => p.comp + 0.8 + 0.15 * fLaje + ex(p).alt, 99, ESC_LAJE);
        pgs.forEach((pgx, i) => {
          const fi = add(pav.id + 'lv' + i, `PRODUÇÃO DA LAJE SOBRE O ${pav.nome.toUpperCase()} — ${i + 1}/${pgs.length}`,
            <div className="vistas lajes">{pgx.map((linha, j) => { const bx = Math.max(...linha.map(p => ex(p).alt)); return <div className="linha" key={j}>{linha.map(p => <div key={p.num} className="vista" dangerouslySetInnerHTML={{ __html: vistaLajeSvg(p, [], trDe(p), bx, ESC_LAJE, codigoLaje(p, sg)) }} />)}</div>; })}</div>,
            'Painéis em pé: comprimento na vertical (seta = alvéolos) · largura na horizontal · roxo = treliça de reforço, cotada a partir da borda esquerda / de baixo · dente = recorte no canto · medidas em metros, já com o apoio em cima das paredes');
          indice.push({ pav: pav.id, tipo: 'Lajes', nums: pgx.flat().map(p => p.num), f: fi });
        });
      }
      if (TPf.length) {
        const T0 = TPf.slice(0, LINHAS_TREL), resto = TPf.length > LINHAS_TREL ? emBlocos(TPf.slice(LINHAS_TREL), LINHAS_TREL_CONT) : [];
        const nf = 1 + Math.ceil(resto.length / 2);
        add(pav.id + 't', `TRELIÇAS DE REFORÇO NA LAJE SOBRE O ${pav.nome.toUpperCase()}${nf > 1 ? ` — 1/${nf}` : ''}`,
          <div className="desenho lajes"><SvgFolha vb={q.vb} html={desenhoLaje} /><TabelaTrelicas TP={T0} TR={TRf} curta /></div>,
          'Treliça embaixo de cada parede do pavimento de cima que não tem parede embaixo · distâncias medidas na planta a partir da borda do painel');
        for (let f = 0; f * 2 < resto.length; f++) add(pav.id + 't' + (f + 1), `TRELIÇAS DE REFORÇO NA LAJE SOBRE O ${pav.nome.toUpperCase()} — ${f + 2}/${nf} (continuação da tabela)`,
          <div className="desenho lajes cont">{resto.slice(f * 2, f * 2 + 2).map((B, i) => <TabelaTrelicas key={i} TP={B} TR={TRf} curta />)}</div>,
          'Treliça embaixo de cada parede do pavimento de cima que não tem parede embaixo · distâncias medidas na planta a partir da borda do painel');
      }
    }
  }
  // plano de carga: uma folha por carreta, com as pilhas vistas de cima e a ordem de descarga (= ordem de montagem)
  const CL = regras.carretaComp ?? 12.4, CW = regras.carretaLarg ?? 2.8, CWM = regras.carretaLargMax ?? 3.2, nCargas = prod.plano.length, pesoTot = prod.pecas.filter(p => ativos.some(v => v.id === p.pav)).reduce((s, p) => s + p.peso, 0);
  for (const c of prod.plano) {
    if (filtra && !c.pecas.some(x => ativos.some(p => p.id === prod.porId.get(x.id)?.pav))) continue;
    const kk = 100, W = (CL + 0.6) * kk, H = (CW + 0.9) * kk, X = (x: number) => (x + 0.3) * kk, Y = (y: number) => (y + 0.6) * kk;
    const cores = ['#dbe8ff', '#ffe3c7', '#dff5d8', '#f4dcf5', '#fff3b0', '#d8f1f4'];
    const ex = (CWM - CW) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 2 * ex * kk}"><rect x="${X(0)}" y="${Y(-ex)}" width="${CL * kk}" height="${CWM * kk}" fill="none" stroke="#d11" stroke-width="1.5" stroke-dasharray="10 6"/><rect x="${X(0)}" y="${Y(0)}" width="${CL * kk}" height="${CW * kk}" fill="#f7f7f7" stroke="#333" stroke-width="3"/>` +
      `<text x="${X(CL) - 4}" y="${Y(0) - 10}" font-size="22" text-anchor="end" fill="#555">frente da carreta (cavalo) →</text><text x="${X(0)}" y="${Y(0) - 10}" font-size="22" fill="#555">traseira</text>` +
      c.pilhas.map((pl, i) => `<rect x="${X(pl.x)}" y="${Y(pl.y - ex)}" width="${pl.comp * kk}" height="${pl.larg * kk}" fill="${cores[i % cores.length]}" stroke="${pl.y - ex < -1e-3 || pl.y + pl.larg - ex > CW + 1e-3 ? '#d11' : '#1a3fd6'}" stroke-width="${pl.y - ex < -1e-3 || pl.y + pl.larg - ex > CW + 1e-3 ? 5 : 2.5}"/>` +
        `<text x="${X(pl.x + pl.comp / 2)}" y="${Y(pl.y - ex + pl.larg / 2) - 6}" font-size="30" font-weight="bold" text-anchor="middle" fill="#c00">Pilha ${pl.n}</text>` +
        `<text x="${X(pl.x + pl.comp / 2)}" y="${Y(pl.y - ex + pl.larg / 2) + 26}" font-size="${Math.min(22, pl.comp * kk / 13).toFixed(0)}" text-anchor="middle">${pl.pecas.length} peça(s) · topo ${pl.pecas[pl.pecas.length - 1].codigo}</text>` +
        (pl.y - ex < -1e-3 || pl.y + pl.larg - ex > CW + 1e-3 ? `<text x="${X(pl.x + pl.comp / 2)}" y="${Y(pl.y - ex + pl.larg / 2) + 54}" font-size="${Math.min(20, pl.comp * kk / 13).toFixed(0)}" text-anchor="middle" fill="#d11" font-weight="bold">excesso lateral</text>` : '')).join('') +
      `<text x="${X(0)}" y="${Y(CW + ex) + 40}" font-size="22" fill="#333">${br(CL)} × ${br(CW)} m · usado ${br(c.usado)} m · ${Math.round(c.peso)} kg de ${Math.round(regras.cargaMax ?? 35000)} kg</text></svg>`;
    const seq = [...c.pecas].sort((a, b) => a.ordem - b.ordem);
    add('carga' + c.n, `PLANO DE CARGA — CARRETA ${c.n}/${nCargas} — ${c.pecas.length} peças · ${br(c.peso / 1000)} t`,
      <div className="plano">
        <div className="plano-desenho" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="plano-pilhas">{c.pilhas.map((pl, pi) => {
          // vista de lado da pilha: cada peça é uma faixa no tamanho dela (comprimento deitado), a de cima sai primeiro
          const LH = 44, top = 50, n = pl.pecas.length, Lmax = Math.max(...pl.pecas.map(x => Math.max(x.a, x.b))), esc = 600 / Math.max(Lmax, 1);
          const saida = [...c.pecas].sort((a, b) => a.ordem - b.ordem);
          const faixas = pl.pecas.map((x, i) => {
            const y = top + (n - 1 - i) * LH, L = Math.max(x.a, x.b) * esc, x0 = 150 + (600 - L) / 2, q = prod.porId.get(x.id)!;
            return `<rect x="${x0}" y="${y}" width="${L}" height="${LH - 12}" fill="${['#dbe8ff', '#ffe3c7', '#dff5d8', '#f4dcf5', '#fff3b0', '#d8f1f4'][pi % 6]}" stroke="#333" stroke-width="2"/>` +
              `<rect x="${x0 + 12}" y="${y + LH - 12}" width="16" height="12" fill="#8b5a2b"/><rect x="${x0 + L - 28}" y="${y + LH - 12}" width="16" height="12" fill="#8b5a2b"/>` +
              `<text x="${150 + 300}" y="${y + 23}" font-size="20" text-anchor="middle" font-weight="bold">${x.codigo}</text>` +
              `<text x="140" y="${y + 23}" font-size="17" text-anchor="end" fill="#555">camada ${i + 1}</text>` +
              `<text x="760" y="${y + 23}" font-size="17" fill="#1a3fd6">${q.desc} · sai em ${saida.indexOf(x) + 1}º</text>`;
          }).join('');
          const H = top + n * LH + 30;
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${H}"><text x="10" y="30" font-size="26" font-weight="bold" fill="#c00">Pilha ${pl.n}</text><text x="990" y="30" font-size="18" text-anchor="end" fill="#555">▲ em cima (sai primeiro)</text>${faixas}<line x1="120" y1="${top + n * LH}" x2="880" y2="${top + n * LH}" stroke="#333" stroke-width="5"/><text x="500" y="${top + n * LH + 26}" font-size="17" text-anchor="middle" fill="#555">piso da carreta · camada 1 = embaixo · marrom = caibros</text></svg>`;
          return <div key={pl.n} className="pilha" dangerouslySetInnerHTML={{ __html: svg }} />;
        })}</div>
        <div className="plano-desc"><b>{c.modo === 'tamanho' ? 'Carga por tamanho (maior embaixo)' : 'Carga na ordem da montagem'}</b> · <b>{(c.estocar || []).length ? `estocar no canteiro ${(c.estocar || []).length} peça(s) até a vez delas: ${(c.estocar || []).join(', ')}` : 'descarrega já montando, sem estocar'}</b>.<br /><b>Ordem de montagem</b>: {seq.map((x, i) => <span key={x.id}>{i ? ' → ' : ''}<b>{x.codigo}</b> <small>(p{c.pilhas.find(pl => pl.pecas.includes(x))!.n})</small></span>)}</div>
        {c.avisos.length > 0 && <p className="plano-aviso">⚠ Excesso lateral (peça deitada mais larga que a carreta): {c.avisos.map(a => a.split(':')[0]).join(', ')} — transportar em pé (cavalete) ou com autorização de carga larga</p>}
      </div>,
      `Peças deitadas · camada 1 = embaixo · peça de cima no máximo 30 cm maior que a de baixo · carreta de ${br(CW)} m (até ${br(CWM)} m com excesso lateral, pilha em vermelho) · peças de etapas seguintes completam a carga · calçar com caibros entre as peças e amarrar cada pilha`);
  }
  // plano de corte do isopor
  if (!filtra) {
    const ci = prod.corteIso, bc = regras.isoporComp ?? 4;
    const tabPad = (P: typeof ci.padroes) => <table className="tlaje rom"><thead><tr><th>Barras</th><th>Cortes de cada barra (m)</th><th>Sobra (m)</th></tr></thead><tbody>
      {P.map((p, i) => <tr key={i}><td><b>{p.qtd}</b></td><td>{p.cortes.map(c => br(c)).join(' + ')}</td><td>{br(p.sobra)}</td></tr>)}</tbody></table>;
    const tabMed = (M: typeof ci.medidas) => <table className="tlaje rom"><thead><tr><th>Pedaço (m)</th><th>Qtd.</th><th>Peças</th></tr></thead><tbody>
      {M.map((m, i) => <tr key={i}><td><b>{br(m.comp)}</b></td><td>{m.n}</td><td className="pecasLista">{[...m.pecas].slice(0, 14).join(', ')}{m.pecas.size > 14 ? ` e mais ${m.pecas.size - 14}` : ''}</td></tr>)}</tbody></table>;
    const bp = emBlocos(ci.padroes, 40), bm = emBlocos(ci.medidas, 40);
    const nf = Math.max(bp.length, bm.length);
    for (let f = 0; f < nf; f++) add('iso' + f, `PLANO DE CORTE DO ISOPOR — BARRAS DE ${br(bc)} m${nf > 1 ? ` — ${f + 1}/${nf}` : ''}`,
      <div className="desenho lajes cont conf">{f === 0 && <p className="resumoConf"><b>{ci.barras} barras</b> de {br(bc)} m · {br(ci.total)} m de isopor nas peças · perda {br(ci.perda * 100)}% · {ci.emendas} emenda(s) (alvéolo maior que a barra)</p>}
        {bp[f] && <div className="ccol"><h3>Cortes por barra (padrões)</h3>{tabPad(bp[f])}</div>}
        {bm[f] && <div className="ccol"><h3>Pedaços por medida</h3>{tabMed(bm[f])}</div>}</div>,
      `Isopor ${br((regras.isoporLarg ?? 0.12) * 100)} × ${br((regras.isoporAlt ?? 0.09) * 100)} cm · alvéolos na altura das paredes e no comprimento das lajes, cortados nas portas e janelas · a sobra de uma barra vira pedaço de outra peça · alvéolo maior que a barra sai emendado`);
  }
  // plano de corte das treliças
  if (!filtra && prod.corteTrel.length) add('trelcorte', `PLANO DE CORTE DAS TRELIÇAS — BARRAS DE ${br(regras.trelicaBarra ?? 12)} m`,
    <div className="desenho lajes cont conf">{prod.corteTrel.map(t => <div className="ccol" key={t.tipo}><h3>{t.tipo} ({TRELICA[t.tipo]}): {t.barras} barra(s) · {br(t.total)} m · perda {br(t.perda * 100)}%</h3>
      <table className="tlaje rom"><thead><tr><th>Barras</th><th>Cortes de cada barra (m)</th><th>Sobra (m)</th></tr></thead><tbody>
        {t.padroes.map((p, i) => <tr key={i}><td><b>{p.qtd}</b></td><td>{p.cortes.map(c => br(c)).join(' + ')}</td><td>{br(p.sobra)}</td></tr>)}</tbody></table>
      <p className="dica">Pedaços: {t.medidas.map(m => `${m.n} × ${br(m.comp)}`).join(' · ')}</p></div>)}</div>,
    'Comprimentos das treliças de reforço (folhas de treliças de cada laje) · 1 cm de corte entre pedaços · sobra de uma barra vira pedaço de outra laje');
  // produção nas mesas: um dia por linha, as mesas lado a lado
  if (!filtra) {
    const MC = regras.mesaComp ?? 12, ML = regras.mesaLarg ?? 3.2, DIAS = 6;
    const mesaSvg = (m: { n: number; pecas: { codigo: string; x: number; y: number; L: number; W: number }[]; usado: number }) => {
      const k = 100;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -30 ${MC * k + 10} ${ML * k + 40}"><rect x="0" y="0" width="${MC * k}" height="${ML * k}" fill="#f4f4f4" stroke="#333" stroke-width="3"/>` +
        m.pecas.map(p => `<rect x="${p.x * k}" y="${p.y * k}" width="${p.L * k}" height="${p.W * k}" fill="#dbe8ff" stroke="#1a3fd6" stroke-width="3"/><text x="${(p.x + p.L / 2) * k}" y="${(p.y + p.W / 2) * k + 14}" font-size="${Math.min(42, p.W * k / 2.2, p.L * k / 4.5).toFixed(0)}" text-anchor="middle" font-weight="bold">${p.codigo}</text>`).join('') +
        `<text x="0" y="-8" font-size="26" font-weight="bold" fill="#c00">Mesa ${m.n}</text><text x="${MC * k}" y="-8" font-size="24" text-anchor="end" fill="#555">${m.pecas.length} peça(s) · ${Math.round(m.usado * 100)}% ocupada</text></svg>`;
    };
    const ds = prod.mesas, nf = Math.ceil(ds.length / DIAS);
    for (let f = 0; f < nf; f++) add('mesa' + f, `PRODUÇÃO NAS MESAS — DIAS ${f * DIAS + 1} A ${Math.min(ds.length, (f + 1) * DIAS)} DE ${ds.length}`,
      <div className="mesas">{ds.slice(f * DIAS, (f + 1) * DIAS).map(d => <div className="dia" key={d.dia}>
        <div className="dia-tit"><b>Dia {d.dia}</b>{d.carretasProntas.length ? <span> · completa a carreta {d.carretasProntas.join(', ')}</span> : null}</div>
        <div className="dia-mesas">{d.mesas.map(m => <div key={m.n} dangerouslySetInnerHTML={{ __html: mesaSvg(m) }} />)}</div></div>)}</div>,
      `${Math.round(regras.mesas ?? 4)} mesa(s) de ${br(MC)} × ${br(ML)} m · uma concretagem por mesa por dia · peças na ordem das carretas (a carreta 1 fica pronta primeiro) · 10 cm entre peças · ajuste mesas e medidas na aba Regras`);
  }
  // conferência
  const alertas = conferencia(ativos, calc.ps, calc.lajes, regras, trelSemLaje);
  const comTrel = new Set(calc.pl.filter(p => calc.vigas.some(v => v.pav === p.pav && v.tipo === 'trelica' && trelicasNasLajes([v], [p]).some(x => x.painel))).map(p => p.num));
  const iguaisP = paredesIguais(calc.ps), iguaisL = lajesIguais(calc.pl, comTrel);
  // [elemento, quantas linhas impressas ocupa]
  const nl = (t: string) => Math.max(1, Math.ceil(t.length / 105));
  const linhasConf: [JSX.Element, number][] = [
    ...alertas.map((a, i) => [<p key={'a' + i} className={a.nivel === 'erro' ? 'erro' : ''}><b>{a.nivel === 'erro' ? '✖' : '!'} {a.onde}:</b> {a.texto}</p>, nl(a.onde + a.texto + '   ')] as [JSX.Element, number]),
    [<h3 key="hp">Peças iguais (mesma fôrma / mesma produção)</h3>, 2],
    ...iguaisP.map((g, i) => { const t = g.map(p => codigoParede(p, sg)).join(', '); return [<p key={'p' + i}><b>{g.length} paredes</b> {br(g[0].larg)} × {br(g[0].H)}{g[0].recortes.length ? ` com ${g[0].recortes.map(r => r.tipo).join(', ')}` : ''}: {t}</p>, nl(t + '                         ')] as [JSX.Element, number]; }),
    ...iguaisL.map((g, i) => { const t = g.map(p => codigoLaje(p, sg)).join(', '); return [<p key={'l' + i}><b>{g.length} lajes</b> {br(g[0].comp)} × {br(g[0].larg)}: {t}</p>, nl(t + '                    ')] as [JSX.Element, number]; }),
  ];
  // cada coluna leva ~46 linhas impressas; item longo conta como várias linhas
  const blocosConf: JSX.Element[][] = [[]]; let carga = 0;
  for (const [el, w] of linhasConf) { if (carga + w > 46 && blocosConf[blocosConf.length - 1].length) { blocosConf.push([]); carga = 0; } blocosConf[blocosConf.length - 1].push(el); carga += w; }
  if (!filtra) for (let f = 0; f * 2 < blocosConf.length; f++) add('conf' + f, `CONFERÊNCIA AUTOMÁTICA${blocosConf.length > 2 ? ` — ${f + 1}/${Math.ceil(blocosConf.length / 2)}` : ''}`,
    <div className="desenho lajes cont conf">{f === 0 && <p className="resumoConf"><b>{alertas.filter(a => a.nivel === 'erro').length} erro(s)</b> · {alertas.filter(a => a.nivel !== 'erro').length} ponto(s) de atenção · {iguaisP.length + iguaisL.length} grupo(s) de peças iguais</p>}
      {blocosConf.slice(f * 2, f * 2 + 2).map((B, i) => <div className="ccol" key={i}>{B}</div>)}</div>,
    '✖ = corrigir antes de produzir · ! = conferir · aberturas a menos de 15 cm da borda ou do topo · peças iguais agrupadas para produzir juntas');
  add('det', 'DETALHES TÍPICOS DE MONTAGEM',
    <div className="desenho" dangerouslySetInnerHTML={{ __html: detalhesSvg({ esp: (regras.isoporAlt ?? 0.09) + 2 * (regras.capeamento ?? 0.025), lajeEsp: (regras.isoporAlt ?? 0.09) + 2 * (regras.capeamento ?? 0.025), apoio: regras.lajeApoio, apoioBorda: regras.lajeApoioBorda ?? 0.1, coluna: regras.coluna, folga: regras.folga, vigaAlt: regras.vigaAltura, vigaLarg: regras.vigaLargura }) }} />,
    'Detalhes esquemáticos com as medidas das regras do projeto · armaduras, grautes, ligações e fundação conforme o projeto estrutural');
  if (novo && !filtra) add('quant', 'QUANTITATIVOS — ÁREA (m²) E VOLUME (m³)',
    <><Quantitativos linhas={quantitativos(ativos, calc.ps, calc.pl, regras, espDaLaje(aj))} perda={regras.perda ?? 10} />
      <TabelaQuantTrelicas pavs={ativos} calc={calc} aj={aj} perda={regras.perda ?? 10} /></>,
    `Isopor ${br((regras.isoporLarg ?? 0.12) * 100)} × ${br((regras.isoporAlt ?? 0.09) * 100)} cm, em barras de ${br(regras.isoporComp ?? 4)} m, sobras aproveitadas (em cima das janelas e nas lajes), ${br((regras.isoporEspaco ?? 0.03) * 100)} cm de concreto entre eles e ${br((regras.capeamento ?? 0.025) * 100)} cm de capeamento em cima e embaixo · paredes com os alvéolos na altura · portas e janelas sem concreto e sem isopor`);
  // capa: resumo e índice (folha 1); as outras começam na 2
  const N = F.length + 1, num = (i: number) => i + 2;
  const linhasResumo = ativos.map(pv => {
    const ps = calc.ps.filter(p => p.pav === pv.id), pl = calc.pl.filter(p => p.pav === pv.id);
    return { nome: pv.nome, np: ps.length, ap: ps.reduce((s, p) => s + areaPainel(p), 0), nl: pl.length, al: pl.reduce((s, p) => s + areaLaje(p), 0) };
  }).filter(l => l.np || l.nl);
  const tot = linhasResumo.reduce((s, l) => ({ np: s.np + l.np, ap: s.ap + l.ap, nl: s.nl + l.nl, al: s.al + l.al }), { np: 0, ap: 0, nl: 0, al: 0 });
  const capa = <div className="folha capa" key="capa">
    <div className="cab">PRODUÇÃO E MONTAGEM — PAREDES E LAJES{filtra ? ' — SÓ ' + ativos.map(p => p.nome.toUpperCase()).join(', ') : ''}</div>
    <h1>{titulo}</h1>
    <div className="capa-grid">
      <div>
        <table className="tlaje"><thead><tr><th>Pavimento</th><th>Paredes</th><th>m²</th><th>Lajes</th><th>m²</th></tr></thead><tbody>
          {linhasResumo.map(l => <tr key={l.nome}><td>{l.nome}</td><td>{l.np}</td><td>{br(l.ap)}</td><td>{l.nl}</td><td>{br(l.al)}</td></tr>)}
          <tr className="tot"><td>Total</td><td>{tot.np}</td><td>{br(tot.ap)}</td><td>{tot.nl}</td><td>{br(tot.al)}</td></tr></tbody></table>
        <p>{tot.np + tot.nl} peças · {br(tot.ap + tot.al)} m² · peso total {br(pesoTot / 1000)} t · {nCargas} carreta(s) de até {br((regras.cargaMax ?? 35000) / 1000)} t {prod.modo === 'montagem' ? `sempre na ordem da montagem (com a carreta cheia seriam ${prod.nOutro})` : `com a carreta cheia (sempre na ordem da montagem seriam ${prod.nOutro})`}</p>
        <p>Produção: {prod.mesas.length} dia(s) em {Math.round(regras.mesas ?? 4)} mesa(s) · isopor: {prod.corteIso.barras} barras de {br(regras.isoporComp ?? 4)} m{prod.corteTrel.length ? ` · treliças: ${prod.corteTrel.map(t => `${t.barras} barra(s) ${t.tipo}`).join(', ')}` : ''}</p>
        <p>{alertas.filter(a => a.nivel === 'erro').length} erro(s) e {alertas.filter(a => a.nivel !== 'erro').length} ponto(s) de atenção na conferência automática</p>
        <h3>Onde está cada peça</h3>
        {ativos.flatMap(pv => (['Paredes', 'Lajes'] as const).map(tp => { const xs = indice.filter(x => x.pav === pv.id && x.tipo === tp); if (!xs.length) return null;
          return <p key={pv.id + tp} className="idx"><b>{tp} — {pv.nome}:</b> {xs.map(x => `${tp === 'Paredes' ? 'P' : 'L'}${faixa(x.nums)} → folha ${num(x.f)}`).join(' · ')}</p>; }))}
      </div>
      <div className="indice">
        <h3>Índice das folhas</h3>
        <ol start={1}><li>Capa, resumo e índice</li>{F.map(f => <li key={f.key}>{f.tit}</li>)}</ol>
      </div>
    </div>
    <div className="rod"><span>Folha 1/{N} · gerado em {new Date().toLocaleDateString('pt-BR')}</span><span>{nome}</span></div>
  </div>;
  return <div className="folhas">{capa}{F.map((f, i) => <div className="folha" key={f.key}>
    <div className="cab">{f.tit}</div>{f.body}
    <div className="rod"><span>{f.rod}</span><span>{nome} · folha {num(i)}/{N}</span></div>
  </div>)}</div>;
}

// barra entre o painel e a planta: um toque esconde/mostra o painel (a planta ocupa a tela toda)
function Divisor() {
  return <button type="button" className="divisor noprint" title="Esconder/mostrar o painel" onClick={() => alternarPainel()}>
    <span className="mostra">▶</span><span className="esconde">◀</span></button>;
}

// tela do celular aberta pelo QR da etiqueta: a peça, o desenho dela e o botão para marcar a montagem

// ---------- marcação pelo QR, sem login ----------
// ordem: montada na pista (fôrma/armação) → concretada → carregada → instalada na obra.
// 'montada' continua sendo a chave gravada da instalação (marcações antigas e portal do gestão)
const ETAPAS: { k: cloud.Etapa; t: string; bt: string; cor: string; ic: string; cn: string }[] = [
  { k: 'pista', t: 'Montada na pista', bt: 'Peça montada na pista', cor: '#7048e8', ic: '🔧', cn: 'roxo' },
  { k: 'concretada', t: 'Concretada', bt: 'Peça concretada', cor: '#1971c2', ic: '🧱', cn: 'azul' },
  { k: 'carregada', t: 'Carregada', bt: 'Peça carregada', cor: '#f08c00', ic: '🚚', cn: 'laranja' },
  { k: 'montada', t: 'Instalada na obra', bt: 'Peça instalada na obra', cor: '#2f9e44', ic: '🏗', cn: 'verde' },
];
const corEtapa = (e?: cloud.Etapa | null) => e === 'problema' ? '#e03131' : ETAPAS.find(x => x.k === e)?.cor ?? '#adb5bd';
const nomeEtapa = (e?: cloud.Etapa | null) => e === 'problema' ? 'Problema' : ETAPAS.find(x => x.k === e)?.t ?? 'Sem marcação';

// etiqueta antiga: se o código da obra foi ligado a outro projeto (projeto apagado/substituído), abre o projeto atual
function PecaQRLigada({ obra, chave, peca }: { obra: string; chave: string; peca: string }) {
  const [alvo, setAlvo] = useState<{ obra: string; chave: string } | null | undefined>(undefined);
  useEffect(() => { let ok = true; cloud.resolverObra(obra, chave).then(r => { if (ok) setAlvo(r); }); return () => { ok = false; }; }, [obra, chave]);
  if (alvo === undefined) return <div className="qr-tela"><p>Abrindo a peça {peca}…</p></div>;
  return alvo ? <PecaQR obra={alvo.obra} chave={alvo.chave} peca={peca} /> : <PecaQR obra={obra} chave={chave} peca={peca} />;
}

function PecaQR({ obra, chave, peca }: { obra: string; chave: string; peca: string }) {
  const [nome, setNome] = useState(() => { try { return localStorage.getItem('alv-nome') || ''; } catch { return ''; } });
  const [nomeOk, setNomeOk] = useState(!!nome);
  const [info, setInfo] = useState<{ obra: string; hist: cloud.Marcacao[] } | null>(null);
  const [erro, setErro] = useState(''); const [msg, setMsg] = useState(''); const [obs, setObs] = useState(''); const [salvando, setSalvando] = useState(false);
  const [dados, setDados] = useState<cloud.InfoPeca | null | undefined>(undefined);
  // sem internet: usa a obra guardada no celular e põe as marcações numa fila
  const [semSinal, setSemSinal] = useState(false); const [salvoEm, setSalvoEm] = useState<string | null>(null); const [avisoOff, setAvisoOff] = useState('');
  const [, setTick] = useState(0);
  const carregar = async () => {
    setTick(t => t + 1);
    try {
      const sit = await cloud.situacaoPeca(obra, chave, peca);
      setInfo(sit); setSemSinal(false); setErro('');
      const d = await cloud.lerObraOffline(obra);
      if (d && Object.keys(d.info).length > 1) setSalvoEm(d.salvoEm);
      if (!d || Object.keys(d.info).length <= 1 || Date.now() - new Date(d.salvoEm).getTime() > 15 * 60e3)
        cloud.baixarObra(obra, chave).then(async n => {
          if (n) { setSalvoEm(n.salvoEm); setAvisoOff(''); return; }
          setAvisoOff(cloud.erroBaixarObra);
          // sem a obra inteira: guarda ao menos esta peça
          await cloud.guardarPeca(obra, sit.obra, peca, sit.hist, await cloud.infoPeca(obra, chave, peca));
        });
    } catch (x) {
      const m = (x as Error).message, d = await cloud.lerObraOffline(obra);
      if (cloud.semRede(m) && d) { setInfo({ obra: d.obra, hist: d.marcas.filter(h => h.peca === peca) }); setSemSinal(true); setSalvoEm(d.salvoEm);
        if (!(peca in d.info)) setAvisoOff('esta peça não está guardada no celular'); }
      else setErro(cloud.semRede(m) ? 'Sem internet, e esta obra ainda não foi guardada neste celular. Abra uma etiqueta uma vez com sinal para guardar a obra.' : m);
    }
  };
  useEffect(() => {
    (async () => { await cloud.enviarFila(); await carregar(); })();
    (async () => { let d = await cloud.infoPeca(obra, chave, peca); if (!d) d = (await cloud.lerObraOffline(obra))?.info[peca] ?? null; setDados(d); })();
    const voltou = () => { cloud.enviarFila().then(carregar); };
    window.addEventListener('online', voltou);
    const t = setInterval(() => { if (cloud.lerFila().length) cloud.enviarFila().then(carregar); }, 30000);
    return () => { window.removeEventListener('online', voltou); clearInterval(t); };
  }, []);
  const fila = cloud.lerFila().filter(f => f.obra === obra);
  const pend = fila.filter(f => f.peca === peca).map(f => ({ peca: f.peca, etapa: f.etapa, obs: f.obs, por: f.por, em: f.em, pendente: true }));
  const hist = info ? [...info.hist, ...pend].sort((a, b) => a.em.localeCompare(b.em)) : [];
  const st = info ? cloud.situacoes(hist).get(peca) : undefined, feitas = new Set(st?.etapas.map(e => e.etapa));
  const marcar = async (e: cloud.Etapa, o: string | null = null) => {
    setSalvando(true); setMsg('');
    cloud.porNaFila({ obra, chave, peca, etapa: e, obs: o, por: nome.trim(), em: new Date().toISOString() });
    const recusas = await cloud.enviarFila();
    const ficou = cloud.lerFila().some(f => f.obra === obra && f.peca === peca);
    setMsg(recusas.length ? 'Não salvou: ' + recusas.join(' · ') : ficou ? '⏳ Sem sinal: marcação guardada no celular. Ela é enviada sozinha quando o sinal voltar.' : e === 'desfeita' ? 'Desmarcado.' : `Salvo: ${nomeEtapa(e)}.`);
    setObs(''); await carregar(); setSalvando(false);
  };
  return <div className="celular qr">
    <div className="cel-topo"><b>{peca}</b><span>{info?.obra ?? ''}</span></div>
    {erro ? <p className="erro">{erro}</p> : !info ? <p>Abrindo…</p> : !nomeOk ? <div className="qr-nome">
      <p>Antes da primeira marcação, escreva seu nome (fica guardado neste celular):</p>
      <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Carlos – produção" />
      <button className="cel-ok" disabled={!nome.trim()} onClick={() => { try { localStorage.setItem('alv-nome', nome.trim()); } catch { /* sem armazenamento */ } setNomeOk(true); }}>Continuar</button>
    </div> : <>
      <div className="cel-status" style={{ borderColor: corEtapa(st?.atual?.etapa), color: corEtapa(st?.atual?.etapa) }}>
        Situação: <b>{nomeEtapa(st?.atual?.etapa)}</b>{st?.atual ? ` · ${new Date(st.atual.em).toLocaleString('pt-BR')} · ${st.atual.por ?? ''}` : ''}{st?.atual?.obs ? ` · ${st.atual.obs}` : ''}
      </div>
      {semSinal && <p className="qr-off">📵 Sem sinal: mostrando o que está guardado no celular{salvoEm ? ` (atualizado ${new Date(salvoEm).toLocaleString('pt-BR')})` : ''}.</p>}
      {fila.length > 0 && <p className="qr-off">⏳ {fila.length} marcaç{fila.length === 1 ? 'ão' : 'ões'} desta obra aguardando sinal para enviar.</p>}
      {!semSinal && salvoEm && <p className="dica">✔ Obra guardada neste celular para usar sem internet ({new Date(salvoEm).toLocaleString('pt-BR')}).</p>}
      {avisoOff && <p className="qr-off">⚠ {semSinal ? `Sem as informações desta peça: ${avisoOff}. A marcação funciona e é enviada quando o sinal voltar.` : `A obra inteira não foi guardada para usar sem internet: ${avisoOff}. Só as peças já abertas com sinal funcionam sem internet.`}</p>}
      <details className="qr-info" open>
        <summary>Informações da peça (conferência)</summary>
        {dados === undefined ? <p className="dica">Carregando…</p> : !dados ? <p className="dica">As informações desta peça ainda não foram enviadas. Peça ao responsável para abrir o projeto no sistema (com login) e elas sobem sozinhas.</p> : <>
          <table><tbody>
            <tr><td>Peça</td><td><b>{dados.tipo} {peca}</b></td></tr>
            <tr><td>{dados.tipo === 'Laje' ? 'Laje sobre o' : 'Pavimento'}</td><td>{dados.pav}</td></tr>
            <tr><td>Medidas</td><td>{dados.desc} m</td></tr>
            <tr><td>Área / peso</td><td>{dados.area.toFixed(2).replace('.', ',')} m² · {Math.round(dados.peso)} kg</td></tr>
            {dados.ordem != null && <tr><td>Ordem de montagem</td><td><b>nº {dados.ordem}</b></td></tr>}
            {dados.esq && <tr><td>Lado esquerdo</td><td>{dados.esq}</td></tr>}
            {dados.dir && <tr><td>Lado direito</td><td>{dados.dir}</td></tr>}
            {dados.face && <tr><td>Face</td><td>{dados.face.replace(/^vista: /, '')}</td></tr>}
            {dados.aberturas && <tr><td>Aberturas</td><td>{dados.aberturas}</td></tr>}
            {(dados.carreta != null || dados.pilha != null) && <tr><td>Carreta / pilha</td><td>{dados.carreta ?? '—'} / {dados.pilha ?? '—'}</td></tr>}
          </tbody></table>
          {dados.desenho && <div className="cel-desenho" dangerouslySetInnerHTML={{ __html: dados.desenho }} />}
        </>}
      </details>
      {ETAPAS.map((e, i) => {
        const feito = feitas.has(e.k), falta = ETAPAS.slice(0, i).find(x => !feitas.has(x.k));
        const toque = () => {
          if (feito) {
            // desmarca só a última marcação (mantém a sequência)
            if (st?.atual?.etapa === e.k) { if (confirm(`Desmarcar "${e.bt}"?`)) marcar('desfeita'); return; }
            const depois = ETAPAS.slice(i + 1).filter(x => feitas.has(x.k)).pop();
            setMsg(depois ? `Para desmarcar "${e.bt}", desmarque antes "${depois.bt}".` : 'Há um problema registrado depois desta etapa: use "Desfazer a última marcação" primeiro.');
            return;
          }
          if (falta) { setMsg(`Siga a sequência: marque antes "${falta.bt}".`); return; }
          marcar(e.k);
        };
        return <button key={e.k} className={'qr-bt' + (feito ? ' feito' : falta ? ' bloq' : '')} style={{ background: e.cor }} disabled={salvando} onClick={toque}>
          {feito ? '✔ ' : `${i + 1}. `}{e.ic} {e.bt}{feito ? <small> (toque para desmarcar)</small> : null}</button>;
      })}
      <textarea placeholder="Problema? (avaria, trinca, medida errada, falta…)" value={obs} onChange={e => setObs(e.target.value)} />
      <button className="cel-prob" disabled={salvando || !obs.trim()} onClick={() => marcar('problema', obs.trim())}>⚠ Registrar problema</button>
      {st?.atual && <button disabled={salvando} onClick={() => marcar('desfeita')}>↶ Desfazer a última marcação</button>}
      {msg && <p className="qr-msg">{msg}</p>}
      {!!st?.etapas.length && <div className="qr-hist"><b>Histórico</b>{st.etapas.map((h, i) => <div key={i}>{nomeEtapa(h.etapa)} · {new Date(h.em).toLocaleString('pt-BR')} · {h.por}{h.obs ? ` · ${h.obs}` : ''}{'pendente' in h ? ' · ⏳ aguardando envio' : ''}</div>)}</div>}
      <p className="dica">Marcando como <b>{nome}</b> · <a href="#" onClick={e => { e.preventDefault(); setNomeOk(false); }}>trocar nome</a></p>
    </>}
  </div>;
}

// card "Portal do cliente": manda a planta (paredes, lajes e estacas) para o sistema de gestão
function CardPortal({ projId, planta, logado }: { projId: string | null; planta: () => ReturnType<typeof plantaPortal>; logado: boolean }) {
  const [msg, setMsg] = useState(''); const [ocupado, setOcupado] = useState(false);
  const baixar = () => { const b = new Blob([JSON.stringify(planta())], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'planta-portal.json'; a.click(); };
  return <div className="card acoes">
    <h3>Portal do cliente</h3>
    <p className="dica">O cliente vê no portal do sistema de gestão a planta da obra: estacas concretadas e paredes/lajes instaladas (pelo QR das etiquetas).</p>
    {logado && projId ? <>
      <p className="dica">1) Envie a planta (de novo sempre que mudar o projeto). 2) No sistema de gestão, na obra → <b>Planta</b>, cole o código abaixo.</p>
      <button disabled={ocupado} onClick={async () => { setOcupado(true); setMsg(''); try { await cloud.enviarPlantaPortal(projId, planta()); setMsg('✔ Planta enviada ao portal.'); } catch (e) { setMsg((e as Error).message); } setOcupado(false); }}>{ocupado ? 'Enviando…' : 'Enviar planta ao portal'}</button>
      <p className="dica">Código da modulação: <b style={{ userSelect: 'all' }}>{projId}</b> <button onClick={() => { navigator.clipboard?.writeText(projId); setMsg('Código copiado.'); }}>Copiar</button></p>
    </> : <p className="dica">Para enviar ao portal, entre com o seu e-mail e abra o projeto salvo na nuvem.</p>}
    <button onClick={baixar}>Baixar planta do portal (.json)</button>
    {msg && <p className={msg.startsWith('✔') || msg.startsWith('Código') ? 'dica' : 'erro'}>{msg}</p>}
  </div>;
}

function Acompanhamento({ prod, ativos, calc, arqDe, marcs, chave, logado, atualizar, trocar, projId, planta }: { prod: Prod; ativos: Pavimento[]; calc: Calc; arqDe: (b: Box) => Prim[]; marcs: cloud.Marcacao[]; chave: string | null; logado: boolean; atualizar: () => void; trocar: () => void; projId: string | null; planta: () => ReturnType<typeof plantaPortal> }) {
  const [pavV, setPavV] = useState(ativos[0]?.id ?? ''); const [tipoV, setTipoV] = useState<'Parede' | 'Laje'>('Parede');
  const sit = cloud.situacoes(marcs), atual = (c: string) => sit.get(c)?.atual?.etapa ?? null, fez = (c: string, e: cloud.Etapa) => !!sit.get(c)?.etapas.some(x => x.etapa === e);
  const P = prod.pecas, tot = P.length;
  const conta = (e: cloud.Etapa, l = P) => l.filter(p => fez(p.codigo, e)).length;
  const probs = P.filter(p => atual(p.codigo) === 'problema');
  if (!logado) return <section className="mod acomp"><div className="lado"><section className="card"><p>Para acompanhar a produção e a obra, entre com o seu e-mail e abra o projeto salvo na nuvem.</p></section><CardPortal projId={projId} planta={planta} logado={false} /></div></section>;
  const pav = ativos.find(p => p.id === pavV) || ativos[0], q = quadroDe(pav), sg = prod.sg;
  const desenho = arqSvg(q, arqDe(pav.box)) + (tipoV === 'Parede'
    ? calc.ps.filter(p => p.pav === pav.id).map(p => { const c = corEtapa(atual(codigoParede(p, sg))); const [x1, y1, x2, y2] = p.o === 'H' ? [p.a, p.c, p.a + p.larg, p.c] : [p.c, p.a, p.c, p.a + p.larg]; return `<line x1="${q.X(x1)}" y1="${q.Y(y1)}" x2="${q.X(x2)}" y2="${q.Y(y2)}" stroke="${c}" stroke-width="${0.16 * q.k}" opacity=".9"><title>${codigoParede(p, sg)} · ${nomeEtapa(atual(codigoParede(p, sg)))}</title></line>`; }).join('')
    : calc.pl.filter(p => p.pav === pav.id).map(p => { const c = corEtapa(atual(codigoLaje(p, sg))); return `<rect x="${q.X(p.x0)}" y="${q.Y(p.y1)}" width="${(p.x1 - p.x0) * q.k}" height="${(p.y1 - p.y0) * q.k}" fill="${c}" fill-opacity=".45" stroke="${c}" stroke-width="3"><title>${codigoLaje(p, sg)} · ${nomeEtapa(atual(codigoLaje(p, sg)))}</title></rect><text x="${q.X((p.x0 + p.x1) / 2)}" y="${q.Y((p.y0 + p.y1) / 2)}" font-size="${0.18 * q.k}" text-anchor="middle">L${p.num}</text>`; }).join(''));
  const cargas = [...new Set(P.map(p => p.carreta ?? 0))].sort((a, b) => a - b);
  return <section className="mod acomp">
<Divisor />
    <div className="lado">
      <div className="card acoes">
        <h3>Produção e obra (marcado pelo QR)</h3>
        {!chave && <p className="erro">A marcação sem login ainda não está ligada: falta rodar o SQL das marcações no Supabase.</p>}
        {[...ETAPAS.map(e => ({ t: e.t, cor: e.cor, n: conta(e.k) })), { t: 'Com problema', cor: '#e03131', n: probs.length }].map(x => <div key={x.t} className="acomp-barra">
          <span>{x.t}</span><b>{x.n} de {tot}</b><div><i style={{ width: `${tot ? (100 * x.n) / tot : 0}%`, background: x.cor }} /></div></div>)}
        <button onClick={atualizar}>Atualizar agora</button>
        <p className="dica">Atualiza sozinho a cada 30 segundos.</p>
      </div>
      <div className="card acoes">
        <h3>Por pavimento</h3>
        <table className="tab-acomp"><thead><tr><th></th><th>Peças</th><th>Pista</th><th>Concr.</th><th>Carreg.</th><th>Instal.</th></tr></thead><tbody>
          {ativos.map(pv => { const l = P.filter(p => p.pav === pv.id); return l.length ? <tr key={pv.id}><td>{pv.nome}</td><td>{l.length}</td><td>{conta('pista', l)}</td><td>{conta('concretada', l)}</td><td>{conta('carregada', l)}</td><td>{conta('montada', l)}</td></tr> : null; })}
        </tbody></table>
        <h3>Por carreta</h3>
        <table className="tab-acomp"><thead><tr><th>Carreta</th><th>Peças</th><th>Concr.</th><th>Carreg.</th><th></th></tr></thead><tbody>
          {cargas.map(c => { const l = P.filter(p => (p.carreta ?? 0) === c), pronta = conta('concretada', l) === l.length, foi = conta('carregada', l) === l.length; return <tr key={c}><td>{c}</td><td>{l.length}</td><td>{conta('concretada', l)}</td><td>{conta('carregada', l)}</td><td>{foi ? '🚚 saiu' : pronta ? '✔ pronta para carregar' : ''}</td></tr>; })}
        </tbody></table>
      </div>
      {probs.length > 0 && <div className="card acoes"><h3>Peças com problema ({probs.length})</h3>
        {probs.map(p => { const a = sit.get(p.codigo)!.atual!; return <p key={p.id} className="erro">{p.codigo}: {a.obs} ({new Date(a.em).toLocaleString('pt-BR')} · {a.por})</p>; })}</div>}
      <div className="card acoes">
        <h3>Últimas marcações</h3>
        {[...marcs].reverse().slice(0, 40).map((m, i) => <div key={i} className="dica">{new Date(m.em).toLocaleString('pt-BR')} · <b>{m.peca}</b> · {m.etapa === 'desfeita' ? 'desfez' : nomeEtapa(m.etapa)} · {m.por}{m.obs ? ` · ${m.obs}` : ''}</div>)}
        {!marcs.length && <p className="dica">Nenhuma marcação ainda.</p>}
      </div>
      <CardPortal projId={projId} planta={planta} logado={logado} />
      {chave && <div className="card acoes"><h3>Chave da obra</h3>
        <p className="dica">O QR das etiquetas leva uma chave secreta: quem escaneia marca as peças desta obra sem login. Se uma etiqueta vazar, troque a chave e imprima as etiquetas de novo.</p>
        <button onClick={trocar}>Trocar chave da obra</button></div>}
    </div>
    <div className="planta">
      <div className="botoes">{ativos.map(pv => <button key={pv.id} className={pav.id === pv.id ? 'on' : ''} onClick={() => setPavV(pv.id)}>{pv.nome}</button>)}
        <button className={tipoV === 'Parede' ? 'on' : ''} onClick={() => setTipoV('Parede')}>Paredes</button><button className={tipoV === 'Laje' ? 'on' : ''} onClick={() => setTipoV('Laje')}>Lajes</button></div>
      <ZoomSvg key={pav.id + tipoV} vb={q.vb} metro={q.k}><g dangerouslySetInnerHTML={{ __html: desenho }} /></ZoomSvg>
      <p className="dica">{[...ETAPAS.map(e => `${e.t}: ${e.cn}`), 'problema: vermelho', 'sem marcação: cinza'].join(' · ')} · passe o mouse na peça para ver o código.</p>
    </div>
  </section>;
}

function PecaCelular({ codigo, pc, obra, pav, desenho, carregando, erro, marca, marcar, montadas, total, sair }: {
  codigo: string; pc?: PecaProd; obra: string; pav: string; desenho: string; carregando: boolean; erro: string; marca?: cloud.Marca;
  marcar: (m: { status: 'montada' | 'problema'; obs?: string } | null) => Promise<void>; montadas: number; total: number; sair: () => void }) {
  const [obs, setObs] = useState(''); const [salvando, setSalvando] = useState(false); const [msg, setMsg] = useState('');
  const vai = async (m: { status: 'montada' | 'problema'; obs?: string } | null) => { setSalvando(true); setMsg(''); try { await marcar(m); setMsg(m ? 'Salvo.' : 'Marcação desfeita.'); } catch (e) { setMsg('Não salvou: ' + (e as Error).message); } setSalvando(false); };
  return <div className="celular">
    <div className="cel-topo"><b>{codigo}</b><span>{obra}</span></div>
    {carregando ? <p>Abrindo o projeto…</p> : erro ? <p className="erro">{erro}</p> : !pc ? <p className="erro">Peça {codigo} não encontrada neste projeto (a modulação pode ter mudado).</p> : <>
      <p className="cel-info">{pc.tipo} {pc.desc} m · {Math.round(pc.peso)} kg · {pc.tipo === 'Laje' ? 'laje sobre o ' : ''}{pav}</p>
      {pc.tipo === 'Parede' && <p className="cel-info">Montagem nº <b>{pc.ordemPav}</b> · lado esquerdo: <b>{pc.esq}</b> · lado direito: <b>{pc.dir}</b><br />{pc.face}</p>}
      <p className="cel-info">Carreta {pc.carreta} · pilha {pc.pilha}</p>
      <div className="cel-desenho" dangerouslySetInnerHTML={{ __html: desenho }} />
      <div className={'cel-status ' + (marca?.status ?? '')}>{marca ? `${marca.status === 'montada' ? '✔ Instalada na obra' : '⚠ Problema'} em ${new Date(marca.em).toLocaleString('pt-BR')} (${marca.por})${marca.obs ? ' — ' + marca.obs : ''}` : 'Ainda não marcada'}</div>
      <button className="cel-ok" disabled={salvando} onClick={() => vai({ status: 'montada' })}>✔ Peça instalada na obra</button>
      <textarea placeholder="Problema? (avaria, medida errada, falta…)" value={obs} onChange={e => setObs(e.target.value)} />
      <button className="cel-prob" disabled={salvando || !obs.trim()} onClick={() => vai({ status: 'problema', obs: obs.trim() })}>⚠ Registrar problema</button>
      {marca && <button disabled={salvando} onClick={() => vai(null)}>Desfazer marcação</button>}
      {msg && <p>{msg}</p>}
      <p className="dica">Obra: {montadas} de {total} peças instaladas</p>
    </>}
    <button onClick={sair}>Abrir o sistema completo</button>
  </div>;
}
