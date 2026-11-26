// Visualizador 3D da modulação: paredes (com portas e janelas), lajes, pavimentos um em cima do outro e a fundação do térreo.
// Carregado só quando a aba 3D é aberta (three.js fica fora do pacote principal).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Painel, Pavimento } from './engine/model.ts';
import type { PainelLaje } from './engine/lajes.ts';

export interface Props3D {
  pavs: Pavimento[];
  desloc: Record<string, { dx: number; dy: number }>;
  ps: Painel[]; pl: PainelLaje[];
  espLaje: (p: PainelLaje) => number;
  espParede: number;
  sg: Map<string, string>;
  peLaje?: (p: PainelLaje) => number | undefined;   // altura da laje no ambiente com pé-direito próprio (sala de 4,5 m)
  fund?: Fund3D | null;   // fundação do térreo: blocos, estacas e base de canaleta
  info?: (cod: string) => InfoPeca | null;   // painel lateral da peça clicada (medidas, espessura, peso e o detalhamento da ferragem)
}
export interface InfoPeca { titulo: string; linhas: [string, string][]; ferragem?: () => Promise<{ svg: string; resumo: string }> }
export interface Fund3D { pav: string; pts: { n: number; x: number; y: number; tipo: string; par?: number; cobre?: [number, number][] }[]; lado: number; alt: number; furo: number; comp: number;
  can: { o: 'H' | 'V'; c: number; a: number; b: number; cortada: boolean }[] | null; canAlt: number }

type Caixa = { pav: string; tipo: 'parede' | 'laje'; cod: string; txt: string; ab: boolean; grossa: boolean; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };

// peças em caixas (parede com abertura vira pedaços em volta do vão)
function caixas(o: Props3D): Caixa[] {
  const out: Caixa[] = [], T = o.espParede;
  let z = 0;
  for (const pav of o.pavs) {
    const zp = z, { dx, dy } = o.desloc[pav.id] ?? { dx: 0, dy: 0 }, sig = o.sg.get(pav.id) ?? '';
    const lajes = o.pl.filter(q => q.pav === pav.id);
    z += pav.altura + Math.max(0, ...lajes.map(o.espLaje));
    for (const p of o.ps.filter(q => q.pav === pav.id)) {
      // painel como sai da fábrica: começa em a e tem a largura real (a folga e a junta ficam vazias, a trena mede a emenda de verdade)
      const a = Math.min(p.a, p.b), b = a + (p.larg > 0 ? p.larg : Math.abs(p.b - p.a)), cod = `${sig}-P${p.num}`;
      const txt = `${cod} · parede ${(b - a).toFixed(2)} × ${p.H.toFixed(2)} m${p.recortes.length ? ' · ' + p.recortes.map(r => r.tipo).join(', ') : ''} · ${pav.nome}`.replace(/(\d)\.(\d)/g, '$1,$2');
      const ped: [number, number, number, number][] = [];
      let s = a;
      for (const r of [...p.recortes].sort((m, n) => m.dl - n.dl)) {
        const u0 = Math.max(a, a + r.dl), u1 = Math.min(b, a + r.dl + r.w), h0 = r.base, h1 = r.base + r.h;
        if (u0 > s + 1e-3) ped.push([s, u0, 0, p.H]);
        if (h0 > 1e-3) ped.push([u0, u1, 0, h0]);
        if (h1 < p.H - 1e-3) ped.push([u0, u1, h1, p.H]);
        s = Math.max(s, u1);
      }
      if (b > s + 1e-3) ped.push([s, b, 0, p.H]);
      for (const [s0, s1, h0, h1] of ped) {
        const c = p.c + (p.o === 'H' ? dy : dx);
        const [x0, x1, y0, y1] = p.o === 'H' ? [s0 + dx, s1 + dx, c - T / 2, c + T / 2] : [c - T / 2, c + T / 2, s0 + dy, s1 + dy];
        const zb = zp + (p.z0 ?? 0) - (p.desce ?? 0);   // parede que desce no vazio: o pedaço a mais fica embaixo, no nível da laje de baixo
        out.push({ pav: pav.id, tipo: 'parede', cod, txt, ab: p.recortes.length > 0, grossa: false, x0, y0, z0: zb + h0, x1, y1, z1: zb + h1 });
      }
    }
    for (const q of lajes) {
      const e = o.espLaje(q), cod = `${sig}-L${q.num}`;
      out.push({ pav: pav.id, tipo: 'laje', cod, txt: `${cod} · laje ${q.comp.toFixed(2)} × ${q.larg.toFixed(2)} m · ${Math.round(e * 100)} cm · sobre o ${pav.nome}`.replace(/(\d)\.(\d)/g, '$1,$2'), ab: false, grossa: e >= 0.16 - 1e-6,
        x0: Math.min(q.x0, q.x1) + dx, x1: Math.max(q.x0, q.x1) + dx, y0: Math.min(q.y0, q.y1) + dy, y1: Math.max(q.y0, q.y1) + dy, z0: zp + (o.peLaje?.(q) ?? pav.altura), z1: zp + (o.peLaje?.(q) ?? pav.altura) + e });
    }
  }
  return out;
}

export default function Vista3D(props: Props3D) {
  const ref = useRef<HTMLDivElement>(null);
  const cx = useMemo(() => caixas(props), [props]);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const [so, setSo] = useState<string | null>(null);
  const [verL, setVerL] = useState(true), [verP, setVerP] = useState(true), [sep, setSep] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const api = useRef<{ grupos: Map<string, { p: THREE.Group; l: THREE.Group }>; marcar: (cod: string | null) => void; centrar: () => void; gF: THREE.Group; chao: THREE.Mesh; grade: THREE.GridHelper; O: OrbitControls; zc: number;
    tirar: (cod: string) => void; recolocar: () => void; limparTrena: () => void; desfazerTrena: () => void; apagarMedida: (i: number) => void; numeros: (on: boolean) => void } | null>(null);
  const [verN, setVerN] = useState(true); const verNRef = useRef(verN); verNRef.current = verN;
  const [verF, setVerF] = useState(true);
  // tela cheia, ferramenta (selecionar / trena), peça marcada, peças tiradas, medidas e o detalhamento da ferragem
  const raiz = useRef<HTMLDivElement>(null);
  const [cheia, setCheia] = useState(false);
  const [modo, setModo] = useState<'sel' | 'trena'>('sel'); const modoRef = useRef(modo); modoRef.current = modo;
  const [selCod, setSelCod] = useState<string | null>(null);
  const [nTiradas, setNTiradas] = useState(0);
  const [medidas, setMedidas] = useState<string[]>([]);
  const [pend, setPend] = useState(false);   // trena com o primeiro ponto marcado, esperando o segundo
  const [ferr, setFerr] = useState<{ cod: string; svg?: string; resumo?: string; erro?: string; carregando?: boolean } | null>(null);
  const [verDet, setVerDet] = useState(true);
  useEffect(() => {   // Esc ou Ctrl+Z na trena: desfaz o ponto / a última medida
    const k = (e: KeyboardEvent) => { if (modoRef.current !== 'trena' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) { e.preventDefault(); api.current?.desfazerTrena(); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  useEffect(() => { const f = () => setCheia(document.fullscreenElement === raiz.current); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const telaCheia = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void raiz.current?.requestFullscreen?.(); };
  const info = selCod && props.info ? props.info(selCod) : null;
  const verFerragem = async () => {
    if (!info?.ferragem || !selCod) return; const cod = selCod; setFerr({ cod, carregando: true });
    try { const r = await info.ferragem(); setFerr({ cod, ...r }); } catch (e) { setFerr({ cod, erro: (e as Error).message }); }
  };
  // folha da ferragem em outra aba: zoom pela bolinha do mouse (no ponto do cursor), arrastar para mover, duplo clique volta ao todo
  const abrirGrande = () => {
    if (!ferr?.svg) return;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${selCod ?? ''} · ferragem</title>
<style>html,body{margin:0;height:100%;background:#e9ecef;overflow:hidden;font-family:Arial,sans-serif}#v{position:absolute;inset:0;cursor:grab;touch-action:none}#v.arr{cursor:grabbing}
#f{position:absolute;left:0;top:0;transform-origin:0 0}#f svg{display:block;width:100%;height:auto;background:#fff;box-shadow:0 2px 12px #0003;margin-bottom:40px}
#d{position:fixed;left:10px;bottom:10px;background:#fff;border:1px solid #ccd;border-radius:6px;padding:5px 9px;font-size:13px;color:#333}</style></head>
<body><div id="v"><div id="f">${ferr.svg}</div></div><div id="d">Bolinha do mouse: zoom · arrastar: mover · duplo clique: ver a folha toda</div>
<script>
const v=document.getElementById('v'),f=document.getElementById('f'),sv=f.querySelector('svg');
const W=1600;f.style.width=W+'px';const H=f.offsetHeight||W*0.7;
let k=1,x=0,y=0;const ap=()=>{f.style.transform='translate('+x+'px,'+y+'px) scale('+k+')'};
const todo=()=>{k=Math.min(innerWidth/W,innerHeight/H)*0.96;x=(innerWidth-W*k)/2;y=(innerHeight-H*k)/2;ap()};todo();addEventListener('resize',todo);
v.addEventListener('wheel',e=>{e.preventDefault();const z=Math.exp(-e.deltaY*0.0009),k2=Math.min(40,Math.max(0.05,k*z));x=e.clientX-(e.clientX-x)*k2/k;y=e.clientY-(e.clientY-y)*k2/k;k=k2;ap()},{passive:false});
let dn=null;v.addEventListener('pointerdown',e=>{dn=[e.clientX-x,e.clientY-y];v.classList.add('arr');v.setPointerCapture(e.pointerId)});
v.addEventListener('pointermove',e=>{if(dn){x=e.clientX-dn[0];y=e.clientY-dn[1];ap()}});v.addEventListener('pointerup',()=>{dn=null;v.classList.remove('arr')});v.addEventListener('dblclick',todo);
<\/script></body></html>`;
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
  };

  useEffect(() => {
    const el = ref.current!; const escuro = matchMedia('(prefers-color-scheme: dark)').matches;
    const R = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true }); R.setPixelRatio(Math.min(devicePixelRatio, 2)); R.setClearColor(0x000000, 0);
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 0.9; el.appendChild(R.domElement);
    const S = new THREE.Scene();   // fundo em degradê vem do CSS (.v3-tela)
    const C = new THREE.PerspectiveCamera(35, 1, 0.1, 2000); C.up.set(0, 0, 1);
    const O = new OrbitControls(C, R.domElement); O.enableDamping = true; O.dampingFactor = 0.08; O.maxPolarAngle = Math.PI * 0.495;
    const hemi = new THREE.HemisphereLight(0xf4f7fb, escuro ? 0x2a2f36 : 0xc8c2b6, escuro ? 1.2 : 1.25); hemi.position.set(0, 0, 1); S.add(hemi);
    const sol = new THREE.DirectionalLight(0xfff4e6, escuro ? 2.0 : 2.6); sol.castShadow = true; sol.shadow.mapSize.set(4096, 4096); sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02; sol.shadow.radius = 4; S.add(sol, sol.target);
    const luz2 = new THREE.DirectionalLight(0xdfe8f5, 0.6); luz2.position.set(40, 30, 25); S.add(luz2);   // luz de preenchimento do outro lado
    const box = new THREE.BoxGeometry(1, 1, 1), aresta = new THREE.EdgesGeometry(box);
    // polygonOffset: as faces ficam um tico atrás das arestas desenhadas (sem a aresta piscar em cima da face)
    const mat = (c: number, r = 0.92) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const M = { parede: mat(0xece6db), ab: mat(0xddd3c2), laje: mat(0xa7afb8, 0.85), laje16: mat(0x87929e, 0.85), sel: mat(0x2f7de1, 0.6) };
    const EM = new THREE.LineBasicMaterial({ color: escuro ? 0x0d1014 : 0x55524c, transparent: true, opacity: escuro ? 0.5 : 0.32 });
    const grupos = new Map<string, { p: THREE.Group; l: THREE.Group }>(); const pick: THREE.Mesh[] = []; const gF = new THREE.Group(); S.add(gF);
    for (const pv of props.pavs) { const g = { p: new THREE.Group(), l: new THREE.Group() }; grupos.set(pv.id, g); S.add(g.p, g.l); }
    const G = 0.006, bb = new THREE.Box3();
    for (const c of cx) {
      const m = new THREE.Mesh(box, c.tipo === 'laje' ? (c.grossa ? M.laje16 : M.laje) : c.ab ? M.ab : M.parede);
      // faces que coincidem (topo da parede no nível do topo da laje, paredes que se cruzam no encontro) brigam na tela e a imagem treme:
      // a laje perde 3 mm em cima e embaixo e cada parede fica 1 a 2 mm mais estreita, alternando, para nenhuma face ficar no mesmo plano
      const eL = c.tipo === 'laje' ? 0.003 : 0, eP = c.tipo === 'laje' ? 0 : (c.x1 - c.x0 > c.y1 - c.y0 ? 0.002 : 0.004);
      // a folguinha G (linha entre peças encostadas) só na laje: os painéis de parede nunca encostam, e assim a trena mede a junta exata
      const gg = c.tipo === 'laje' ? G : 0;
      const lx = c.x1 - c.x0 > c.y1 - c.y0 ? c.x1 - c.x0 - gg : c.x1 - c.x0 - gg - eP, ly = c.x1 - c.x0 > c.y1 - c.y0 ? c.y1 - c.y0 - gg - eP : c.y1 - c.y0 - gg;
      m.scale.set(Math.max(lx, 0.01), Math.max(ly, 0.01), Math.max(c.z1 - c.z0 - 2 * eL, 0.01));
      m.position.set((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, (c.z0 + c.z1) / 2);
      m.castShadow = true; m.receiveShadow = c.tipo === 'laje';   // parede não recebe sombra: a luz rasante fazia riscos (acne) nas faces
      m.userData = { cod: c.cod, txt: c.txt, mat: m.material };
      m.add(new THREE.LineSegments(aresta, EM));
      const g = grupos.get(c.pav)!; (c.tipo === 'laje' ? g.l : g.p).add(m); pick.push(m);
      bb.expandByPoint(new THREE.Vector3(c.x0, c.y0, c.z0)).expandByPoint(new THREE.Vector3(c.x1, c.y1, c.z1));
    }
    // numeração: plaquinha colada na face da parede, no canto superior direito de quem olha (nas duas faces); na laje, deitada no meio
    const etqs: THREE.Mesh[] = [], texs = new Map<string, THREE.CanvasTexture>();
    const texDe = (t: string) => { let tx = texs.get(t); if (tx) return tx; const cv = document.createElement('canvas'); cv.width = 256; cv.height = 112; const g = cv.getContext('2d')!;
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 112); g.strokeStyle = '#1f4e79'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 102); g.fillStyle = '#1f4e79'; g.font = 'bold 70px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 128, 60);
      tx = new THREE.CanvasTexture(cv); tx.anisotropy = 8; texs.set(t, tx); return tx; };
    const plq = (t: string, w: number) => new THREE.Mesh(new THREE.PlaneGeometry(w, w * 112 / 256), new THREE.MeshBasicMaterial({ map: texDe(t), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const cxCod = new Map<string, Caixa>();
    for (const c of cx) { const b = cxCod.get(c.cod); if (!b) cxCod.set(c.cod, { ...c }); else { b.x0 = Math.min(b.x0, c.x0); b.y0 = Math.min(b.y0, c.y0); b.z0 = Math.min(b.z0, c.z0); b.x1 = Math.max(b.x1, c.x1); b.y1 = Math.max(b.y1, c.y1); b.z1 = Math.max(b.z1, c.z1); } }
    const UP = new THREE.Vector3(0, 0, 1);
    for (const [cod, b] of cxCod) {
      const n = cod.replace(/^.*-/, ''), g = grupos.get(b.pav)!;
      if (b.tipo === 'laje') { const m = plq(n, 0.75); m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 + 0.002); m.userData.cod = cod; g.l.add(m); etqs.push(m); continue; }
      const H = b.x1 - b.x0 > b.y1 - b.y0, W = 0.46, hh = W * 112 / 256, mg = 0.06, L = H ? b.x1 - b.x0 : b.y1 - b.y0; if (L < W + 2 * mg) continue;
      for (const sg of [-1, 1]) {
        const nrm = H ? new THREE.Vector3(0, sg, 0) : new THREE.Vector3(sg, 0, 0), dir = nrm.clone().negate().cross(UP), off = L / 2 - mg - W / 2;
        const m = plq(n, W); m.setRotationFromMatrix(new THREE.Matrix4().makeBasis(dir, UP, nrm));
        m.position.set((b.x0 + b.x1) / 2 + dir.x * off + nrm.x * ((b.x1 - b.x0) / 2 + 0.002), (b.y0 + b.y1) / 2 + dir.y * off + nrm.y * ((b.y1 - b.y0) / 2 + 0.002), b.z1 - mg - hh / 2);
        m.userData.cod = cod; g.p.add(m); etqs.push(m);
      }
    }
    // fundação: blocos (topo no chão), estacas embaixo e a base de canaleta em cima dos blocos (as paredes sobem a altura dela)
    const F = props.fund, zc = F?.can ? F.canAlt : 0;
    if (F) {
      const { dx, dy } = props.desloc[F.pav] ?? { dx: 0, dy: 0 }, h = F.lado / 2;
      const MB = mat(0x9c968c), ME = mat(0x8a847a), MC = mat(0xb5aea2), MA = mat(0x8b3a1a);
      const MCon = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.9, transparent: true, opacity: 0.3, depthWrite: false });
      const cil = new THREE.CylinderGeometry(F.furo / 2, F.furo / 2, 1, 20); cil.rotateX(Math.PI / 2);
      const caixa = (M: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cod: string, txt: string, linha = true) => {
        const m = new THREE.Mesh(box, M); m.scale.set(x1 - x0, y1 - y0, z1 - z0); m.position.set((x0 + x1) / 2 + dx, (y0 + y1) / 2 + dy, (z0 + z1) / 2);
        m.castShadow = true; m.userData = { cod, txt, mat: M }; if (linha) m.add(new THREE.LineSegments(aresta, EM)); gF.add(m); pick.push(m); return m; };
      for (const p of F.pts) {
        const q = p.par ? F.pts.find(r => r.n === p.par) : undefined;
        if (q && p.n > q.n) continue;   // bloco de 2 estacas: desenha uma vez
        const xs = [p.x, ...(q ? [q.x] : []), ...(p.cobre || []).map(c => c[0])], ys = [p.y, ...(q ? [q.y] : []), ...(p.cobre || []).map(c => c[1])];
        const cod = q ? `B${p.n}+B${q.n}` : `B${p.n}`, txt = p.tipo === 'apoio' ? `${cod} · bloco de apoio ${Math.round(F.lado * 100)} × ${Math.round(F.lado * 100)} · sem estaca`
          : `${cod} · ${q ? 'bloco de 2 estacas' : p.cobre?.length ? 'bloco alongado até a emenda' : `bloco ${Math.round(F.lado * 100)} × ${Math.round(F.lado * 100)} × ${Math.round(F.alt * 100)}`} · estaca ø${Math.round(F.furo * 100)} × ${String(F.comp).replace('.', ',')} m`;
        caixa(MB, Math.min(...xs) - h, Math.min(...ys) - h, -F.alt, Math.max(...xs) + h, Math.max(...ys) + h, 0, cod, txt);
        if (p.tipo === 'apoio') continue;
        for (const r of [p, ...(q ? [q] : [])]) { const e = new THREE.Mesh(cil, ME); e.scale.set(1, 1, F.comp); e.position.set(r.x + dx, r.y + dy, -F.alt - F.comp / 2 + 0.1); e.userData = { cod, txt, mat: ME }; gF.add(e); pick.push(e); }
      }
      // canaleta 14 × 19 × 39 em U, com treliça TG8 corrida e concreto dentro
      for (const s of F.can || []) {
        const C = (d0: number, d1: number, z0: number, z1: number, M: THREE.Material, linha = false) => s.o === 'H' ? caixa(M, s.a, s.c + d0, z0, s.b, s.c + d1, z1, 'canaleta', txtC, linha) : caixa(M, s.c + d0, s.a, z0, s.c + d1, s.b, z1, 'canaleta', txtC, linha);
        const txtC = `Canaleta 14 × 19 × 39${s.cortada ? ` cortada com ${Math.round((s.b - s.a) * 100)} cm` : ''} · por dentro treliça TG8 corrida e concreto`;
        C(-0.07, 0.07, 0, 0.03, MC); C(-0.07, -0.045, 0.03, zc, MC); C(0.045, 0.07, 0.03, zc, MC); C(-0.045, 0.045, 0.03, zc, MCon).renderOrder = 2;
        const cont = C(-0.07, 0.07, 0, zc, MC, true); cont.material = new THREE.MeshBasicMaterial({ visible: false });
        // treliça TG8: 2 banzos embaixo (2,5 cm do fundo), 1 em cima (8 cm acima) e as diagonais em zigue-zague a cada 20 cm
        const P3 = (u: number, d: number, z: number) => s.o === 'H' ? new THREE.Vector3(u + dx, s.c + d + dy, z) : new THREE.Vector3(s.c + d + dx, u + dy, z);
        for (const [d, z, rr] of [[-0.034, 0.055, 0.0042], [0.034, 0.055, 0.0042], [0, 0.135, 0.006]] as const) {
          const f = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, s.b - s.a, 6), MA); const m0 = P3((s.a + s.b) / 2, d, z);
          if (s.o === 'H') f.rotation.z = Math.PI / 2; f.position.copy(m0); gF.add(f);
        }
        const dg: THREE.Vector3[] = [];
        for (let u = s.a; u < s.b - 0.1; u += 0.2) for (const d of [-0.034, 0.034]) dg.push(P3(u, d, 0.055), P3(Math.min(s.b, u + 0.1), 0, 0.135), P3(Math.min(s.b, u + 0.1), 0, 0.135), P3(Math.min(s.b, u + 0.2), d, 0.055));
        gF.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(dg), new THREE.LineBasicMaterial({ color: 0x8b3a1a })));
      }
    }
    const ctr = bb.getCenter(new THREE.Vector3()), tam = bb.getSize(new THREE.Vector3()), raio = Math.max(tam.x, tam.y, tam.z, 1);
    // sol de fim de tarde vindo da frente-esquerda; a sombra cobre o prédio todo
    sol.position.set(ctr.x - raio * 0.8, ctr.y - raio * 1.1, ctr.z + raio * 1.3); sol.target.position.copy(ctr);
    const sc = sol.shadow.camera; sc.left = sc.bottom = -raio * 1.1; sc.right = sc.top = raio * 1.1; sc.near = 0.5; sc.far = raio * 5; sc.updateProjectionMatrix();
    sol.shadow.normalBias = Math.max(0.02, 2.2 * raio / 4096 * 1.5);   // prédio grande: texel da sombra maior, sem listras (acne) nas faces da laje
    // chão: piso claro que recebe sombra + malha de 1 m bem leve
    const LC = Math.max(tam.x, tam.y) + 40;
    const chao = new THREE.Mesh(new THREE.PlaneGeometry(LC * 3, LC * 3), new THREE.MeshStandardMaterial({ color: escuro ? 0x20262e : 0xe9ecef, roughness: 1, transparent: true }));
    chao.position.set(ctr.x, ctr.y, bb.min.z - 0.012); chao.receiveShadow = true; S.add(chao);
    const grade = new THREE.GridHelper(Math.ceil(LC), Math.ceil(LC), escuro ? 0x39424d : 0xd3d8de, escuro ? 0x2b323b : 0xdde1e6);
    grade.rotation.x = Math.PI / 2; grade.position.set(ctr.x, ctr.y, bb.min.z - 0.008);
    (grade.material as THREE.Material).transparent = true; (grade.material as THREE.Material).opacity = 0.7; S.add(grade);
    S.fog = new THREE.Fog(escuro ? 0x1b2027 : 0xe9ecef, raio * 4, raio * 9);
    const centrar = () => { const d = raio * 1.5; C.position.set(ctr.x - d * 0.55, ctr.y - d * 1.1, ctr.z + d * 0.7); O.target.copy(ctr); O.update(); };
    centrar();
    const marcar = (cod: string | null) => { for (const m of pick) m.material = m.userData.cod === cod ? M.sel : m.userData.mat; };
    // peças tiradas da vista (ficam guardadas para recolocar)
    const tiradas = new Set<THREE.Mesh>();
    const tirar = (cod: string) => { for (const m of [...pick, ...etqs]) if (m.userData.cod === cod) { m.visible = false; tiradas.add(m); } setNTiradas(new Set([...tiradas].map(m => m.userData.cod)).size); };
    const recolocar = () => { for (const m of tiradas) m.visible = etqs.includes(m) ? verNRef.current : true; tiradas.clear(); setNTiradas(0); };
    // trena: dois cliques em qualquer peça (ou no chão) e mostra a distância
    const gM = new THREE.Group(); S.add(gM); let pA: THREE.Vector3 | null = null;
    const MM = new THREE.MeshBasicMaterial({ color: 0xd9480f, depthTest: false }), LM = new THREE.LineBasicMaterial({ color: 0xd9480f, depthTest: false }), bola = new THREE.SphereGeometry(0.04, 12, 8);
    // cada medida guarda os seus objetos (bolinhas, linha e rótulo), para desfazer ou apagar uma só
    let cur: THREE.Object3D[] = []; const feitas: THREE.Object3D[][] = [];
    const tirarObjs = (os: THREE.Object3D[]) => { for (const o of os) gM.remove(o); };
    const ponto = (v: THREE.Vector3) => { const b = new THREE.Mesh(bola, MM); b.position.copy(v); b.renderOrder = 10; gM.add(b); cur.push(b); };
    const rotulo = (t: string, v: THREE.Vector3) => {
      const cv = document.createElement('canvas'); cv.width = 320; cv.height = 96; const g = cv.getContext('2d')!; g.fillStyle = '#d9480f'; g.fillRect(0, 0, 320, 96); g.fillStyle = '#fff'; g.font = 'bold 56px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 160, 50);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false })); sp.scale.set(0.6, 0.18, 1); sp.center.set(0.5, -0.35); sp.position.copy(v);   // rótulo em cima da linha, sem tapar a junta medida
      sp.renderOrder = 11; gM.add(sp); cur.push(sp); };
    const limparTrena = () => { gM.clear(); pA = null; cur = []; feitas.length = 0; setMedidas([]); setPend(false); };
    // desfazer: tira o primeiro ponto que ficou esperando; se não tem, apaga a última medida
    const desfazerTrena = () => {
      if (pA) { tirarObjs(cur); cur = []; pA = null; setPend(false); setSel(modoRef.current === 'trena' ? 'Trena: clique no primeiro ponto' : null); return; }
      const u = feitas.pop(); if (!u) return; tirarObjs(u); setMedidas(ms => ms.slice(0, -1));
    };
    const apagarMedida = (i: number) => { const u = feitas[i]; if (!u) return; tirarObjs(u); feitas.splice(i, 1); setMedidas(ms => ms.filter((_, j) => j !== i)); };
    const numeros = (on: boolean) => { for (const m of etqs) m.visible = on && !tiradas.has(m); };
    api.current = { grupos, marcar, centrar, gF, chao, grade, O, zc, tirar, recolocar, limparTrena, desfazerTrena, apagarMedida, numeros };
    const rs = () => { const w = el.clientWidth, h = el.clientHeight; R.setSize(w, h); C.aspect = w / h; C.updateProjectionMatrix(); };
    const ro = new ResizeObserver(rs); ro.observe(el); rs();
    const rc = new THREE.Raycaster(), mp = new THREE.Vector2(); let dn: [number, number] | null = null;
    const down = (e: PointerEvent) => { dn = [e.clientX, e.clientY]; };
    const up = (e: PointerEvent) => {
      if (!dn || Math.hypot(e.clientX - dn[0], e.clientY - dn[1]) > 5) return;
      const r = R.domElement.getBoundingClientRect(); mp.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      rc.setFromCamera(mp, C);
      const vivos = pick.filter(m => m.visible && m.parent!.visible);
      if (modoRef.current === 'trena') {
        const h = rc.intersectObjects([...vivos, chao], false)[0]; if (!h) return;
        const v = h.point.clone(); ponto(v);
        if (!pA) { pA = v; setPend(true); setSel('Trena: clique no segundo ponto (Esc ou “Desfazer ponto” para tirar)'); return; }
        const d = pA.distanceTo(v), dh = Math.hypot(v.x - pA.x, v.y - pA.y), dz = Math.abs(v.z - pA.z);
        const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pA, v]), LM); ln.renderOrder = 10; gM.add(ln); cur.push(ln);
        const t = `${d.toFixed(2).replace('.', ',')} m`; rotulo(t, pA.clone().add(v).multiplyScalar(0.5));
        const txt = `${t} (na horizontal ${dh.toFixed(2).replace('.', ',')} m · desnível ${dz.toFixed(2).replace('.', ',')} m)`;
        feitas.push(cur); cur = []; setMedidas(ms => [...ms, txt]); setSel(`Trena: ${txt}`); pA = null; setPend(false); return;
      }
      const h = rc.intersectObjects(vivos, false)[0];
      const t = h ? (h.object.userData.txt as string) : null; setSel(t); marcar(h ? h.object.userData.cod : null); setSelCod(h ? h.object.userData.cod : null);
    };
    R.domElement.addEventListener('pointerdown', down); R.domElement.addEventListener('pointerup', up);
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); O.update(); R.render(S, C); }; loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); O.dispose(); R.dispose(); box.dispose(); aresta.dispose(); Object.values(M).forEach(m => m.dispose()); EM.dispose(); chao.geometry.dispose(); grade.dispose(); el.removeChild(R.domElement); api.current = null; bola.dispose(); MM.dispose(); LM.dispose(); };
  }, [cx, props.pavs, props.fund]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.current?.numeros(verN); }, [verN, cx, props.fund]);
  // visibilidade e separação
  useEffect(() => {
    const a = api.current; if (!a) return;
    props.pavs.forEach((pv, i) => { const g = a.grupos.get(pv.id)!; const v = so ? so === pv.id : vis[pv.id] !== false;
      g.p.visible = v && verP; g.l.visible = v && verL; g.p.position.z = g.l.position.z = i * sep + a.zc; });
    // fundação ligada: chão meio transparente e dá para olhar por baixo
    const f = !!props.fund && verF && (so ? so === props.pavs[0]?.id : vis[props.pavs[0]?.id] !== false);
    a.gF.visible = f; const cm = a.chao.material as THREE.MeshStandardMaterial; cm.opacity = f ? 0.35 : 1; cm.depthWrite = !f; cm.needsUpdate = true; a.grade.visible = !f;
    a.O.maxPolarAngle = f ? Math.PI : Math.PI * 0.495;
  }, [vis, so, verL, verP, verF, sep, props.pavs, props.fund, cx]);

  const achar = () => {
    const k = busca.trim().toUpperCase(); if (!k) return;
    const c = cx.find(x => x.cod.toUpperCase() === k); if (!c) { setSel(`Não achei a peça ${k}`); return; }
    setSo(null); setVis(v => ({ ...v, [c.pav]: true })); if (c.tipo === 'laje') setVerL(true); else setVerP(true);
    api.current?.marcar(c.cod); setSel(c.txt); setSelCod(c.cod);
  };
  useEffect(() => { setFerr(null); setVerDet(true); }, [selCod]);

  const ligado = (pv: string) => so ? so === pv : vis[pv] !== false;
  return <div className={'vista3d' + (cheia ? ' cheia' : '')} ref={raiz}>
    <aside className="v3-barra noprint">
      <button className="v3-cheia" onClick={telaCheia}>{cheia ? '⤡ Sair da tela cheia' : '⤢ Tela cheia'}</button>
      <h4>Ver</h4>
      <div className="botoes">{props.pavs.map(pv => <button key={pv.id} className={ligado(pv.id) ? 'on' : ''}
        onClick={() => so ? setSo(pv.id) : setVis(v => ({ ...v, [pv.id]: v[pv.id] === false }))}>{pv.nome}</button>)}</div>
      <div className="botoes">
        <button className={verP ? 'on' : ''} onClick={() => setVerP(!verP)}>Paredes</button>
        <button className={verL ? 'on' : ''} onClick={() => setVerL(!verL)}>Lajes</button>
        {props.fund && <button className={verF ? 'on' : ''} onClick={() => setVerF(!verF)}>Fundação</button>}
        <button className={so ? 'on' : ''} onClick={() => setSo(so ? null : props.pavs[0]?.id ?? null)} title="Mostra um pavimento por vez (toque no nome para trocar)">Um pavimento só</button>
        <button className={verN ? 'on' : ''} onClick={() => setVerN(!verN)} title="Número de cada parede e laje">Números</button>
        <button onClick={() => api.current?.centrar()}>Centralizar</button>
      </div>
      {props.pavs.length > 1 && <label className="v3-sep">Separar pavimentos <input type="range" min={0} max={6} step={0.1} value={sep} onChange={e => setSep(+e.target.value)} /></label>}
      <h4>Ferramentas</h4>
      <div className="botoes">
        <button className={modo === 'sel' ? 'on' : ''} onClick={() => setModo('sel')} title="Clique numa peça para ver medidas, espessura e ferragem">Selecionar</button>
        <button className={modo === 'trena' ? 'on' : ''} onClick={() => { setModo('trena'); setSel('Trena: clique no primeiro ponto'); }} title="Clique em dois pontos para medir">📏 Trena</button>
        <button disabled={!selCod} onClick={() => { if (selCod) { api.current?.tirar(selCod); api.current?.marcar(null); setSelCod(null); setSel(null); } }} title="Esconde a peça marcada">Tirar peça</button>
        <button disabled={!nTiradas} onClick={() => api.current?.recolocar()}>Recolocar tudo{nTiradas ? ` (${nTiradas})` : ''}</button>
        <button disabled={!pend && !medidas.length} onClick={() => api.current?.desfazerTrena()} title="Tira o ponto que ficou marcado ou a última medida (atalho: Esc ou Ctrl+Z)">↶ {pend ? 'Desfazer ponto' : 'Desfazer medida'}</button>
        <button disabled={!medidas.length && !pend} onClick={() => api.current?.limparTrena()}>Limpar medidas</button>
      </div>
      {medidas.length > 0 && <ol className="v3-medidas">{medidas.map((m, i) => <li key={i}>{m} <button className="v3-x" title="Apagar esta medida" onClick={() => api.current?.apagarMedida(i)}>✕</button></li>)}</ol>}
      <div className="botoes"><input placeholder="Achar peça (ex.: T-P41, T-L49)" value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && achar()} /><button onClick={achar}>Achar</button></div>
      <div className="v3-leg"><span><i style={{ background: '#ece6db' }} />parede</span><span><i style={{ background: '#ddd3c2' }} />parede com porta/janela</span><span><i style={{ background: '#a7afb8' }} />laje</span><span><i style={{ background: '#87929e' }} />laje 16 cm ou mais</span>{props.fund && <><span><i style={{ background: '#9c968c' }} />bloco e estaca</span>{props.fund.can && <span><i style={{ background: '#b5aea2' }} />canaleta 14×19 (treliça + concreto)</span>}</>}</div>
      <p className="dica">Arraste para girar · roda/pinça para zoom · botão direito ou dois dedos para mover · clique numa peça para ver o detalhamento.</p>
    </aside>
    <div className="v3-tela" ref={ref}>{sel && <div className="v3-info">{sel}</div>}</div>
    {info && verDet && <aside className="v3-det noprint">
      <div className="v3-det-topo"><b>{info.titulo}</b><button onClick={() => setVerDet(false)} title="Fechar">✕</button></div>
      <table><tbody>{info.linhas.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
      <div className="botoes">
        {info.ferragem && <button className="on" onClick={verFerragem} disabled={ferr?.carregando}>{ferr?.carregando ? 'Detalhando…' : 'Detalhamento da ferragem'}</button>}
        <button onClick={() => { if (selCod) { api.current?.tirar(selCod); api.current?.marcar(null); setSelCod(null); setSel(null); } }}>Tirar esta peça</button>
      </div>
      {ferr?.cod === selCod && ferr.erro && <p className="aviso">Não consegui detalhar: {ferr.erro}</p>}
      {ferr?.cod === selCod && ferr.svg && <>
        <p className="dica">{ferr.resumo}</p>
        <div className="v3-ferr" onClick={abrirGrande} title="Clique para abrir grande" dangerouslySetInnerHTML={{ __html: ferr.svg }} />
        <button onClick={abrirGrande}>Abrir grande</button>
      </>}
    </aside>}
  </div>;
}
