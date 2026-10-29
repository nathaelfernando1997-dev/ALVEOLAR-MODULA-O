import { useEffect, useMemo, useRef, useState } from 'react';
import { parseDxf } from './engine/dxf.ts';
import type { Dxf, Prim } from './engine/dxf.ts';
import { ler, camadaDasParedes, trechos, paineis, numerar, resumo, continuarVaos, quantitativos, orcamentoAreas, regrasDoSalvo, REGRAS_PADRAO, AJUSTES_VAZIOS } from './engine/model.ts';
import type { Ajustes, Esquadria, Pavimento, Regras, Painel, Trecho, VaoInteiro, Box, Leitura } from './engine/model.ts';
import { plantaSvg, vistaSvg, vistaLajeSvg, quadro as quadroDe, plantaConteudo, arqSvg, lajesConteudo, DEFS_LAJE, vigasConteudo } from './engine/draw.ts';
import { ambientes, modularLajes, numerarLajes, vaziosDeCima, areaLaje, caixaDoPonto, guardaCorpos, areaConstruida } from './engine/lajes.ts';
import type { LajeAmb, PainelLaje } from './engine/lajes.ts';
import { lerCortes, conferir, detectarPes, adivinharPapeis } from './engine/cortes.ts';
import { sugerirVigas, cargasDeCima, trelicasNasLajes, alinhar, encaixeManual } from './engine/vigas.ts';
import type { Viga, TrelicaPainel } from './engine/vigas.ts';
import { gerarProposta } from './engine/proposta.ts';
import { numeroPorExtenso, reaisPorExtenso } from './engine/extenso.ts';
import { exportarDxf, exportarCsv } from './engine/exportDxf.ts';
import { ZoomSvg } from './Zoom.tsx';
import * as db from './db.ts';
import { pastaDe, configValida } from './db.ts';
import * as cloud from './cloud.ts';
import type { Session } from '@supabase/supabase-js';
import { Login } from './Login.tsx';
import type { Projeto, Config, Pasta } from './db.ts';

type Aba = 'arquivo' | 'pavimentos' | 'esquadrias' | 'regras' | 'modulacao' | 'lajes' | 'vigas' | 'cortes' | 'impressao' | 'orcamento';
const br = (v: number, n = 2) => v.toFixed(n).replace('.', ',');
const baixar = (nome: string, conteudo: string, tipo: string) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome; a.click();
};
interface Salvo { camada: string; pavs: Pavimento[]; quadro: Esquadria[]; regras: Regras; ajustes: Ajustes }
const chave = (n: string) => `modulacao:${n}`;
type VigaN = Viga & { n: number };
interface Calc { ts: Trecho[]; ps: Painel[]; vaos: VaoInteiro[]; lajes: LajeAmb[]; pl: PainelLaje[]; vigas: VigaN[]; muros: Trecho[]; vigasParede: Trecho[]; guardas: Trecho[]; orcExtra: { pav: string; area: number }[]; areaPav: { pav: string; area: number }[]; encaixes: Record<string, { x: number; y: number }> }

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
  const [aj, setAj] = useState<Ajustes>(AJUSTES_VAZIOS);
  const [pavSel, setPavSel] = useState('');
  const [sel, setSel] = useState<{ trecho: string } | null>(null);
  const [vaoSel, setVaoSel] = useState<string | null>(null);
  const [ambSel, setAmbSel] = useState<string | null>(null);
  const [lajeSel, setLajeSel] = useState<string | null>(null);   // painel de laje clicado (chaveLaje)
  const [cortando, setCortando] = useState<{ trecho: string; coluna: boolean } | null>(null);
  const [vigaSel, setVigaSel] = useState<string | null>(null);
  const [projId, setProjId] = useState<string | null>(null);
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
    return { pavs, aj: { ...a, excluir: lista(a.excluir), juntar: lista(a.juntar), naoDividir: lista(a.naoDividir), naoPinar: lista(a.naoPinar), lajeFora: lista(a.lajeFora), lajeGiro: lista(a.lajeGiro), laje16: lista(a.laje16), lajeEspAmb: reg(a.lajeEspAmb), peAmb: reg(a.peAmb),
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
  const pesLidos = useMemo(() => dxf ? detectarPes(dxf, pavs.filter(p => !p.ativo).map(p => p.box)) : [], [dxf, pavs]);
  const calc: Calc = useMemo(() => {
    const vazio: Calc = { ts: [], ps: [], vaos: [], lajes: [], pl: [], vigas: [], muros: [], vigasParede: [], guardas: [], orcExtra: [], areaPav: [], encaixes: {} };
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
      const r = paineis(tp, regras, aj);
      vazio.ts.push(...tp); vazio.ps.push(...r.paineis); vazio.vaos.push(...r.vaos);
      // projeções de laje/beiral desta planta e áreas marcadas VAZIO no pavimento de cima
      const bordas = leitura.linhas.filter(l => l.tipo === 'proj' && naCaixa(p.box, l));
      const vz = cima && al ? vaziosDeCima(cima, tc, leitura.textos, al.dx, al.dy) : [];
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
      const am = ambientes(p, t, pp, vz, { fechar: novo, cobertas: cob, vigasBorda: bv });
      for (const b of bv) b.esp = regras.vigaLargura;
      pisos.push(...bv);
      const m = modularLajes(am, regras, aj, [...t, ...pp, ...bv], cargasDeCima([...t, ...pp, ...bv], tc, man), bordas);
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
    const peEsp = Object.entries(aj.peAmb || {}).map(([id, H]) => ({ L: vazio.lajes.find(a => a.id === id), H })).filter((x): x is { L: LajeAmb; H: number } => !!x.L && x.H > 0);
    for (const P of vazio.ps) {
      const m = (P.a + P.b) / 2, d = 0.3;
      const lados: [number, number][] = P.o === 'H' ? [[m, P.c - d], [m, P.c + d]] : [[P.c - d, m], [P.c + d, m]];
      const alvo = Math.max(0, ...peEsp.filter(({ L }) => L.pav === P.pav && lados.some(([x, y]) => x > L.x0 && x < L.x1 && y > L.y0 && y < L.y1)).map(x => x.H));
      if (alvo > P.H) { P.H = alvo; P.aviso = (P.aviso ? P.aviso + ' · ' : '') + `${br(alvo)} m: pé-direito do ambiente`; }
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
        const m = (P.a + P.b) / 2, d = 0.3;
        const lados: [number, number][] = P.o === 'H' ? [[m, P.c - d], [m, P.c + d]] : [[P.c - d, m], [P.c + d, m]];
        const ds = desloc.get(P.pav);
        if (ds && P.H >= (ativos.find(a => a.id === P.pav)?.altura ?? 0) - 0.01) {
          const emBaixo = lados.map(([x, y]) => [x + ds.dx, y + ds.dy] as [number, number]);
          const cb = P.o === 'H' ? P.c + ds.dy : P.c + ds.dx, ab = P.o === 'H' ? P.a + ds.dx : P.a + ds.dy, bb = P.o === 'H' ? P.b + ds.dx : P.b + ds.dy;
          const paredeEmbaixo = vazio.ts.some(t => t.pav === ds.baixo && t.o === P.o && Math.abs(t.c - cb) < 0.15 && Math.min(t.e, bb) - Math.max(t.s, ab) > 0.3);
          if (paredeEmbaixo && !emBaixo.some(([x, y]) => temLaje(ds.baixo, x, y))) {
            P.H += esp; desceu.add(P); P.aviso = (P.aviso ? P.aviso + ' · ' : '') + `${br(P.H)} m: sem laje embaixo (vazio), a parede desce até a parede de baixo`;
          }
        }
        const dsc = descob.get(P.pav) || [];
        if (dsc.length && lados.some(([x, y]) => dentro(dsc, x, y)) && !lados.some(([x, y]) => temLaje(P.pav, x, y))) {
          P.H += esp + plat; P.aviso = (P.aviso ? P.aviso + ' · ' : '') + `${br(P.H)} m: área descoberta, a parede sobe até o topo da platibanda`;
        }
      }
    }
    numerar(vazio.ps, ativos.map(p => p.id));
    numerarLajes(vazio.pl, ativos.map(p => p.id));
    { let nv = 0, nt = 0; vazio.vigas = sugerirVigas(ativos, vazio.ts, vazio.ps, vazio.vaos, vazio.lajes, regras, pisos).map(v => ({ ...v, n: v.tipo === 'trelica' ? ++nt : ++nv })); }
    // parede de cima que apoia em cima da viga fica mais baixa
    // (no vazio a viga ocupa a altura da laje: a parede não desce até a parede de baixo)
    for (const v of vazio.vigas) for (const d of v.desconto || []) {
      const p = vazio.ps.find(x => x.num === d.painel); if (!p) continue;
      const para = desceu.has(p) ? d.para - espLaje : d.para;
      if (p.H <= para) continue;
      if (desceu.has(p)) { desceu.delete(p); p.aviso = p.aviso?.split(' · ').filter(x => !x.includes('(vazio)')).join(' · ') || undefined; }
      p.H = para; p.aviso = (p.aviso ? p.aviso + ' · ' : '') + `altura reduzida para ${br(para)} m: apoia em cima da viga V${v.n}`;
    }
    return vazio;
  }, [leitura, pavs, quadro, regras, aj]);

  const cortes = useMemo(() => dxf ? lerCortes(dxf, pavs.filter(p => p.corte)) : [], [dxf, pavs]);
  const avisos = useMemo(() => conferir(cortes, ativos, quadro, regras, calc.ps), [cortes, pavs, quadro, regras, calc]);

  const arqDe = (box: Box): Prim[] => leitura ? leitura.prims.filter(p => p.pts.every(q => q[0] > box.x0 - 0.6 && q[0] < box.x1 + 0.6 && q[1] > box.y0 - 0.6 && q[1] < box.y1 + 0.6)) : [];
  const pavAtual = ativos.find(p => p.id === pavSel) || ativos[0];

  if (cloud.nuvemConfigurada && (!checou || !sess || recuperando)) return <Login carregando={!checou} recuperando={recuperando} fimRecuperacao={() => setRecuperando(false)} />;
  const tabs: [Aba, string][] = [['arquivo', '1. Arquivo'], ['pavimentos', '2. Desenhos'], ['esquadrias', '3. Portas e janelas'], ['regras', '4. Regras'], ['modulacao', '5. Paredes'], ['lajes', '6. Lajes'], ['vigas', '7. Vigas'], ['cortes', '8. Cortes'], ['impressao', '9. Impressão e arquivos'], ['orcamento', '10. Orçamento']];
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
                ['larguraMax', 'Largura máxima do painel (m)'], ['coluna', 'Coluna entre painéis (m)'], ['espacoMax', 'Espaço máximo entre painéis alinhados (m) — cálculo novo'], ['isoporLarg', 'Isopor: largura (m)'], ['isoporAlt', 'Isopor: altura (m)'], ['isoporComp', 'Isopor: comprimento da barra (m)'], ['isoporEspaco', 'Concreto entre um isopor e outro (m)'], ['capeamento', 'Capeamento em cima e embaixo do isopor (m)'], ['perda', 'Perda no isopor e no concreto (%)'], ['folga', 'Diminuir de cada painel (m)'],
                ['boneca', 'Boneca de transporte nas laterais e embaixo (m)'], ['acrescimoLargura', 'Vão de porta/janela maior em (m)'],
                ['janelaDesce', 'Janela: recorte desce e sobe (m)'], ['espMin', 'Espessura mínima de parede (m)'], ['espMax', 'Espessura máxima de parede (m)'],
                ['minParede', 'Trecho mínimo de parede (m)'], ['naoFabricar', 'Marcar "n fabricar" abaixo de (m)'],
                ['lajeEsp', 'Espessura da laje entre pavimentos (m)'], ['platibanda', 'Platibanda acima da laje de cobertura (m)'],
              ] as [keyof Regras, string][]).map(([k, t]) => (
                <label key={k}>{t}<input type="number" step="0.01" value={(regras[k] as number) ?? 0} onChange={e => setRegras({ ...regras, [k]: parseFloat(e.target.value) || 0 })} /></label>
              ))}
              <label className="chk"><input type="checkbox" checked={(regras.motor ?? 1) >= 2} onChange={e => setRegras({ ...regras, motor: e.target.checked ? 2 : 1, motorFixo: !e.target.checked })} /> Cálculo atual (padrão): muros fora, laje na garagem e na laje impermeabilizada, paredes tortas, esquadrias pela etiqueta, 17 cm entre painéis, boneca de transporte, produção das lajes e quantitativos. Desmarque só para refazer um projeto pelo cálculo antigo</label>
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
            <ul className="dica">
              <li>Paredes acima da largura máxima são divididas em partes iguais, com coluna entre elas. No T, a coluna fica só na parede que segue alinhada (ou nenhuma, se a parede for pinada).</li>
              <li>Porta: boneca embaixo + altura do quadro (0,10 + 2,10 = 2,20). Janela: o peitoril baixa e o topo sobe pelo valor acima. Largura sempre maior pelo acréscimo.</li>
              <li>Boneca nas laterais de toda porta/janela que chega no fim da parede, e embaixo das portas.</li>
              <li>Laje: apoia sempre que possível nas paredes (inclusive internas); o painel pode ser menor que o máximo. O sentido é escolhido para precisar de menos vigas. Beiral até o limite acima sem viga.</li>
            </ul>
            <button onClick={() => setRegras({ ...REGRAS_PADRAO, motor: regras.motor })}>Voltar ao padrão</button>
          </section>
        )}

        {(aba === 'modulacao' || aba === 'lajes') && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta baixa na aba Desenhos.</p></section> :
          <section className="mod">
            <div className="lado">
              <div className="pavsel">{ativos.map(p => <button key={p.id} className={pavAtual.id === p.id ? 'on' : ''} onClick={() => { setPavSel(p.id); setSel(null); setVaoSel(null); setAmbSel(null); setLajeSel(null); }}>{p.nome}</button>)}</div>
              {aba === 'modulacao'
                ? <Acoes pav={pavAtual} sel={sel} vaoSel={vaoSel} calc={calc} aj={aj} setAj={setAj} quadro={quadro} regras={regras} cortando={cortando} setCortando={setCortando} limpar={() => { setSel(null); setVaoSel(null); setCortando(null); }} />
                : <AcoesLaje amb={calc.lajes.find(a => a.id === ambSel) || null} lajeSel={lajeSel} calc={calc} aj={aj} setAj={setAj} pav={pavAtual} espPadrao={(regras.isoporAlt ?? 0.09) + 2 * (regras.capeamento ?? 0.025)} />}
              <details><summary>Desfazer ajustes</summary>
                <button onClick={() => { if (confirm('Apagar todos os ajustes manuais deste projeto?')) setAj(AJUSTES_VAZIOS); }}>Apagar todos os ajustes</button>
              </details>
            </div>
            {aba === 'modulacao'
              ? <PlantaParedes L={leitura} pav={pavAtual} calc={calc} arq={arqDe(pavAtual.box)} sel={sel} vaoSel={vaoSel} cortando={cortando}
                  onCorte={(t, along) => { const tr = calc.ts.find(x => x.id === t); if (!tr || !cortando) return; const d = Math.round((along - tr.s) * 100) / 100; const k = cortando.coluna ? 'colunas' : 'cortes'; const m = { ...(aj[k] || {}) }; m[t] = [...(m[t] || []), d].sort((a, b) => a - b); setAj({ ...aj, [k]: m }); setCortando(null); }}
                  onPainel={t => { setSel({ trecho: t }); setVaoSel(null); }} onVao={k => { setVaoSel(k); setSel(null); setCortando(null); }} />
              : <PlantaLajes pav={pavAtual} calc={calc} arq={arqDe(pavAtual.box)} ambSel={ambSel} lajeSel={lajeSel} onAmb={id => { setAmbSel(id); setLajeSel(null); }} onLaje={p => { setAmbSel(p.amb); setLajeSel(chaveLaje(p)); }} />}
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

        {aba === 'orcamento' && leitura && (
          ativos.length === 0 ? <section className="card"><p>Marque pelo menos uma planta baixa na aba Desenhos e informe o pé-direito.</p></section> :
          <>
          {!pesLidos.length && <div className="card noprint aviso-local">A planta não tem o pé-direito. <PeRapido pavs={pavs} setPavs={setPavs} /></div>}
          <Orcamento linhas={orcamentoAreas(ativos, calc.ts, calc.pl).map((l, i) => ({ ...l, paredes: l.paredes + calc.orcExtra.filter(x => x.pav === ativos[i].id).reduce((s, x) => s + x.area, 0) }))} ativos={ativos} pl={calc.pl} areaPav={calc.areaPav} regras={regras} setRegras={setRegras} nome={projNome || nome} />
          </>
        )}
        {aba === 'impressao' && leitura && (
          <section>
            <div className="card noprint">
              <h2>Impressão e arquivos</h2>
              <p>As folhas abaixo saem em <b>A4 deitado</b>. Use <i>Imprimir → Salvar como PDF</i>.</p>
              <div className="botoes">
                <button onClick={() => window.print()}>Imprimir / salvar PDF</button>
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-modulacao.dxf', exportarDxf(ativos, calc.ps, calc.pl, (regras.motor ?? 1) >= 2 && leitura ? Object.fromEntries(ativos.map(p => [p.id, { prims: arqDe(p.box), textos: leitura.textos.filter(t => t.x > p.box.x0 - 0.6 && t.x < p.box.x1 + 0.6 && t.y > p.box.y0 - 0.6 && t.y < p.box.y1 + 0.6) }])) : {}, (regras.motor ?? 1) >= 2 ? calc.vigas : [], regras.vigaLargura, (regras.motor ?? 1) >= 2), 'application/dxf')}>Baixar DXF da modulação</button>
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-paineis.csv', exportarCsv(calc.ps, ativos, calc.pl, (regras.motor ?? 1) >= 2 ? quantitativos(ativos, calc.ps, calc.pl, regras, espDaLaje(aj)) : []) + ((regras.motor ?? 1) >= 2 ? csvTrelicas(ativos, calc, aj, regras.perda ?? 10) : ''), 'text/csv')}>Baixar lista de painéis (CSV)</button>
                <button onClick={() => baixar(nome.replace(/\.dxf$/i, '') + '-ajustes.json', JSON.stringify({ camada, pavs, quadro, regras, ajustes: aj }, null, 1), 'application/json')}>Salvar ajustes (JSON)</button>
                <label className="botao">Abrir ajustes (JSON)<input type="file" accept=".json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; const s = JSON.parse(await f.text()) as Salvo; setCamada(s.camada); setPavs(s.pavs); setQuadro(s.quadro); setRegras(regrasDoSalvo(s.regras)); setAj({ ...AJUSTES_VAZIOS, ...s.ajustes }); }} /></label>
              </div>
            </div>
            {(regras.motor ?? 1) >= 2 && <div className="card noprint"><Quantitativos linhas={quantitativos(ativos, calc.ps, calc.pl, regras, espDaLaje(aj))} perda={regras.perda ?? 10} /><TabelaQuantTrelicas pavs={ativos} calc={calc} aj={aj} perda={regras.perda ?? 10} /></div>}
            <Folhas ativos={ativos} calc={calc} leitura={leitura} arqDe={arqDe} nome={nome} novo={(regras.motor ?? 1) >= 2} regras={regras} aj={aj} />
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
const espDoAmb = (aj: Ajustes) => (amb: string) => aj.lajeEspAmb?.[amb] ?? ((aj.laje16 || []).includes(amb) ? 0.16 : undefined);
// painel de laje: chave estável pelo ambiente e pelo canto (a numeração muda); espessura do painel vale mais que a do ambiente
const chaveLaje = (p: { amb: string; x0?: number; y0?: number }) => `${p.amb}@${(p.x0 ?? 0).toFixed(1)},${(p.y0 ?? 0).toFixed(1)}`;
const espDaLaje = (aj: Ajustes) => (p: { amb: string; x0?: number; y0?: number }) => aj.lajeEspPainel?.[chaveLaje(p)] ?? espDoAmb(aj)(p.amb);
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

function TabelaTrelicas({ TP, TR, curta }: { TP: TrelicaPainel[]; TR: VigaN[]; curta?: boolean }) {
  return <div className="card trelicas">
    <h3>Treliças na laje ({TR.length})</h3>
    {!curta && TR.map(t => <p key={t.id} className="dica"><b>T{t.n}</b> · {br(t.b - t.a)} m · {t.motivo}</p>)}
    <table className="tlaje"><thead><tr><th>Treliça</th><th>Painel</th><th>Onde</th><th>Comp.</th></tr></thead><tbody>
      {TP.map((x, i) => <tr key={i}><td>T{x.t}</td><td>{x.painel ? `L${x.painel}` : '—'}</td><td>{x.painel ? `${x.ao} do painel, ${x.onde}` : curta ? 'sem laje modulada embaixo — conferir apoio' : x.onde}</td><td>{br(x.comp)}</td></tr>)}
    </tbody></table>
  </div>;
}

function PlantaLajes({ pav, calc, arq, ambSel, lajeSel, onAmb, onLaje }: { pav: Pavimento; calc: Calc; arq: Prim[]; ambSel: string | null; lajeSel: string | null; onAmb: (id: string) => void; onLaje: (p: PainelLaje) => void }) {
  const q = quadroDe(pav);
  const lj = calc.lajes.filter(a => a.pav === pav.id), P = calc.pl.filter(p => p.pav === pav.id);
  const TR = calc.vigas.filter(v => v.pav === pav.id && v.tipo === 'trelica'), TP = trelicasNasLajes(TR, P);
  return (
    <div className="planta">
      <ZoomSvg vb={q.vb}>
        <g dangerouslySetInnerHTML={{ __html: DEFS_LAJE + arqSvg(q, arq) + lajesConteudo(lj, P, q, TR) }} />
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
      </ZoomSvg>
      <p className="dica">Laje sobre este pavimento. Clique numa laje para mudar a espessura só dela, ou girar o sentido / tirar a laje do ambiente dela. Clique num ambiente para tirar a laje (vazio, área externa), girar o sentido dos painéis ou mudar a espessura (ex.: 16 cm). Marcador laranja "!" = precisa de atenção (passe o mouse ou clique para ver). Linha roxa = treliça de reforço embaixo de parede de cima.</p>
      {TP.length > 0 && <TabelaTrelicas TP={TP} TR={TR} />}
    </div>
  );
}

function ListaVigas({ V, sel, onSel }: { V: VigaN[]; sel: string | null; onSel: (id: string) => void }) {
  if (!V.length) return <div className="card acoes"><p>Nenhuma viga necessária neste pavimento pelas regras atuais.</p></div>;
  const reb = V.flatMap(v => v.rebaixos), vg = V.filter(v => v.tipo !== 'trelica'), tr = V.length - vg.length;
  return <div className="card acoes vigas">
    <h3>{vg.length} viga(s) sugerida(s) · {vg.filter(v => v.obrigatoria).length} obrigatória(s){tr ? ` · ${tr} reforço(s) com treliça` : ''}</h3>
    {reb.length > 0 && <p className="erro">Paredes que diminuem de altura: {[...new Map(reb.map(r => [r.painel, r])).values()].sort((a, b) => a.painel - b.painel).map(r => `${r.painel} (${br(r.de)} → ${br(r.para)})`).join(', ')}</p>}
    {V.map(v => <div key={v.id} className={'viga' + (sel === v.id ? ' on' : '') + (v.obrigatoria ? ' obrig' : '')} onClick={() => onSel(v.id)}>
      <b>{v.tipo === 'trelica' ? 'T' : 'V'}{v.n}</b> {v.tipo === 'trelica' ? '· treliça (sem viga)' : v.obrigatoria ? '· obrigatória' : '· recomendada'} · {br(v.b - v.a)} m
      <div>{v.motivo}</div>
      <div className="dica">Ideia: {v.ideia}</div>
      {v.rebaixos.length > 0 && <div className="dica">Paredes rebaixadas: {v.rebaixos.map(r => `${r.painel} (${br(r.de)} → ${br(r.para)})`).join(', ')}</div>}
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
      </select></label><button onClick={limpar}>Fechar</button></div>;
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
    <p>Comprimento {br(t.e - t.s)} m · espessura {br(t.esp)} m{t.pinado ? ' · pinada (sem emenda)' : ''}<br />{P.map(p => `${p.num}: ${br(p.larg)} × ${br(p.H)}`).join(' · ')}</p>
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
    <button onClick={limpar}>Fechar</button>
  </div>;
}

function AcoesLaje({ amb, lajeSel, calc, aj, setAj, pav, espPadrao }: { amb: LajeAmb | null; lajeSel: string | null; calc: Calc; aj: Ajustes; setAj: (a: Ajustes) => void; pav: Pavimento; espPadrao: number }) {
  const lj = calc.lajes.filter(a => a.pav === pav.id && a.incluida), P = calc.pl.filter(p => p.pav === pav.id);
  const area = P.reduce((s, p) => s + areaLaje(p), 0);
  const tog = (k: 'lajeFora' | 'lajeGiro' | 'laje16', id: string) => setAj({ ...aj, [k]: (aj[k] || []).includes(id) ? (aj[k] || []).filter(x => x !== id) : [...(aj[k] || []), id] });
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
            const doAmb = espDoAmb(aj)(p.amb) ?? espPadrao;
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

function Folhas({ ativos, calc, leitura, arqDe, nome, novo, regras, aj }: { ativos: Pavimento[]; calc: Calc; leitura: Leitura; arqDe: (b: Box) => Prim[]; nome: string; novo?: boolean; regras: Regras; aj: Ajustes }) {
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
        <div className="cab">VIGAS E TRELIÇAS — {pav.nome.toUpperCase()}</div>
        <div className="desenho lajes"><svg viewBox={q.vb} dangerouslySetInnerHTML={{ __html: arqSvg(q, arqDe(pav.box)) + vigasConteudo(VG, q) }} />
          <div className="tvigas">{VG.map(v => <p key={v.id}><b>{v.tipo === 'trelica' ? 'T' : 'V'}{v.n}</b> ({v.tipo === 'trelica' ? 'treliça' : v.obrigatoria ? 'obrigatória' : 'recomendada'}, {br(v.b - v.a)} m): {v.motivo} <i>{v.ideia}</i>{v.rebaixos.length ? ` Rebaixo: ${v.rebaixos.map(r => `${r.painel} (${br(r.de)}→${br(r.para)})`).join(', ')}.` : ''}</p>)}</div></div>
        {rod('Sugestões para o engenheiro conferir e dimensionar · vermelho = viga obrigatória · laranja = recomendada · roxo = treliça de reforço da laje')}
      </div>);
    }
    const P = calc.pl.filter(p => p.pav === pav.id);
    const TRf = calc.vigas.filter(v => v.pav === pav.id && v.tipo === 'trelica'), TPf = trelicasNasLajes(TRf, P);
    if (P.length) {
      const q = quadroDe(pav);
      folhas.push(<div className="folha" key={pav.id + 'l'}>
        <div className="cab">MODULAÇÃO DA LAJE SOBRE O {pav.nome.toUpperCase()}</div>
        <div className="desenho lajes"><svg viewBox={q.vb} dangerouslySetInnerHTML={{ __html: DEFS_LAJE + arqSvg(q, arqDe(pav.box)) + lajesConteudo(calc.lajes.filter(a => a.pav === pav.id), P, q, TRf) }} />
          <table className="tlaje"><thead><tr><th>Painel</th><th>Comp.</th><th>Larg.</th><th>m²</th></tr></thead><tbody>
            {P.map(p => <tr key={p.num}><td>L{p.num}{p.dente ? '*' : ''}</td><td>{br(p.comp)}</td><td>{br(p.larg)}</td><td>{br(areaLaje(p))}</td></tr>)}
            <tr className="tot"><td>Total</td><td></td><td></td><td>{br(P.reduce((s, p) => s + areaLaje(p), 0))}</td></tr>
          </tbody></table></div>
        {rod('Comprimento e largura com apoio em cima das paredes: 6 cm onde a parede recebe laje dos dois lados, 10 cm na borda · * = painel com dente (recorte no canto) · seta = sentido do vão · tracejado laranja = viga sugerida (conferir) · roxo = treliça')}
      </div>);
      // produção: uma vista por painel de laje, como as paredes
      if (novo) {
        const pgs: PainelLaje[][][] = []; let pg: PainelLaje[][] = [[]], w = 0, nl = 1;
        for (const p of P) {
          if (w + p.larg + 1.1 > 13.8) { if (nl === 2) { pgs.push(pg); pg = [[]]; nl = 1; } else { pg.push([]); nl++; } w = 0; }
          pg[pg.length - 1].push(p); w += p.larg + 1.1;
        }
        pgs.push(pg);
        pgs.forEach((pgx, i) => folhas.push(<div className="folha" key={pav.id + 'lv' + i}>
          <div className="cab">PRODUÇÃO DA LAJE SOBRE O {pav.nome.toUpperCase()} — folha {i + 1}/{pgs.length}</div>
          <div className="vistas">{pgx.map((linha, j) => <div className="linha" key={j}>{linha.map(p => <div key={p.num} className="vista" dangerouslySetInnerHTML={{ __html: vistaLajeSvg(p, [], TRf.map(t => ({ ...t, tipo: trelicaDaEsp(espDaLaje(aj)(p) ?? 0) }))) }} />)}</div>)}</div>
          {rod('Painéis em pé: comprimento na vertical (seta = alvéolos) · largura na horizontal · roxo = treliça de reforço, cotada a partir da borda esquerda / de baixo · dente = recorte no canto · medidas em metros, já com o apoio em cima das paredes')}
        </div>));
      }
      if (TPf.length) folhas.push(<div className="folha" key={pav.id + 't'}>
        <div className="cab">TRELIÇAS DE REFORÇO NA LAJE SOBRE O {pav.nome.toUpperCase()}</div>
        <div className="desenho lajes"><svg viewBox={q.vb} dangerouslySetInnerHTML={{ __html: DEFS_LAJE + arqSvg(q, arqDe(pav.box)) + lajesConteudo(calc.lajes.filter(a => a.pav === pav.id), P, q, TRf) }} />
          <TabelaTrelicas TP={TPf} TR={TRf} curta /></div>
        {rod('Treliça embaixo de cada parede do pavimento de cima que não tem parede embaixo · distâncias medidas na planta a partir da borda do painel')}
      </div>);
    }
  }
  if (novo) folhas.push(<div className="folha" key="quant">
    <div className="cab">QUANTITATIVOS — ÁREA (m²) E VOLUME (m³)</div>
    <Quantitativos linhas={quantitativos(ativos, calc.ps, calc.pl, regras, espDaLaje(aj))} perda={regras.perda ?? 10} />
    <TabelaQuantTrelicas pavs={ativos} calc={calc} aj={aj} perda={regras.perda ?? 10} />
    {rod(`Isopor ${br((regras.isoporLarg ?? 0.12) * 100)} × ${br((regras.isoporAlt ?? 0.09) * 100)} cm, em barras de ${br(regras.isoporComp ?? 4)} m, sobras aproveitadas (em cima das janelas e nas lajes), ${br((regras.isoporEspaco ?? 0.03) * 100)} cm de concreto entre eles e ${br((regras.capeamento ?? 0.025) * 100)} cm de capeamento em cima e embaixo · paredes com os alvéolos na altura · portas e janelas sem concreto e sem isopor`)}
  </div>);
  return <div className="folhas">{folhas}</div>;
}
