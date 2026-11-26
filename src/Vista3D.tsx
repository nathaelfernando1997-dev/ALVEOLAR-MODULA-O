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
}
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
      const a = Math.min(p.a, p.b), b = Math.max(p.a, p.b), cod = `${sig}-P${p.num}`;
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
        const zb = zp + (p.z0 ?? 0);
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
  const api = useRef<{ grupos: Map<string, { p: THREE.Group; l: THREE.Group }>; marcar: (cod: string | null) => void; centrar: () => void; gF: THREE.Group; chao: THREE.Mesh; grade: THREE.GridHelper; O: OrbitControls; zc: number } | null>(null);
  const [verF, setVerF] = useState(true);

  useEffect(() => {
    const el = ref.current!; const escuro = matchMedia('(prefers-color-scheme: dark)').matches;
    const R = new THREE.WebGLRenderer({ antialias: true, alpha: true }); R.setPixelRatio(Math.min(devicePixelRatio, 2)); R.setClearColor(0x000000, 0);
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 0.9; el.appendChild(R.domElement);
    const S = new THREE.Scene();   // fundo em degradê vem do CSS (.v3-tela)
    const C = new THREE.PerspectiveCamera(35, 1, 0.1, 2000); C.up.set(0, 0, 1);
    const O = new OrbitControls(C, R.domElement); O.enableDamping = true; O.dampingFactor = 0.08; O.maxPolarAngle = Math.PI * 0.495;
    const hemi = new THREE.HemisphereLight(0xf4f7fb, escuro ? 0x2a2f36 : 0xc8c2b6, escuro ? 1.2 : 1.25); hemi.position.set(0, 0, 1); S.add(hemi);
    const sol = new THREE.DirectionalLight(0xfff4e6, escuro ? 2.0 : 2.6); sol.castShadow = true; sol.shadow.mapSize.set(4096, 4096); sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02; sol.shadow.radius = 4; S.add(sol, sol.target);
    const luz2 = new THREE.DirectionalLight(0xdfe8f5, 0.6); luz2.position.set(40, 30, 25); S.add(luz2);   // luz de preenchimento do outro lado
    const box = new THREE.BoxGeometry(1, 1, 1), aresta = new THREE.EdgesGeometry(box);
    const mat = (c: number, r = 0.92) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
    const M = { parede: mat(0xece6db), ab: mat(0xddd3c2), laje: mat(0xa7afb8, 0.85), laje16: mat(0x87929e, 0.85), sel: mat(0x2f7de1, 0.6) };
    const EM = new THREE.LineBasicMaterial({ color: escuro ? 0x0d1014 : 0x55524c, transparent: true, opacity: escuro ? 0.5 : 0.32 });
    const grupos = new Map<string, { p: THREE.Group; l: THREE.Group }>(); const pick: THREE.Mesh[] = []; const gF = new THREE.Group(); S.add(gF);
    for (const pv of props.pavs) { const g = { p: new THREE.Group(), l: new THREE.Group() }; grupos.set(pv.id, g); S.add(g.p, g.l); }
    const G = 0.006, bb = new THREE.Box3();
    for (const c of cx) {
      const m = new THREE.Mesh(box, c.tipo === 'laje' ? (c.grossa ? M.laje16 : M.laje) : c.ab ? M.ab : M.parede);
      m.scale.set(Math.max(c.x1 - c.x0 - G, 0.01), Math.max(c.y1 - c.y0 - G, 0.01), c.z1 - c.z0);
      m.position.set((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, (c.z0 + c.z1) / 2);
      m.castShadow = true; m.receiveShadow = c.tipo === 'laje';   // parede não recebe sombra: a luz rasante fazia riscos (acne) nas faces
      m.userData = { cod: c.cod, txt: c.txt, mat: m.material };
      m.add(new THREE.LineSegments(aresta, EM));
      const g = grupos.get(c.pav)!; (c.tipo === 'laje' ? g.l : g.p).add(m); pick.push(m);
      bb.expandByPoint(new THREE.Vector3(c.x0, c.y0, c.z0)).expandByPoint(new THREE.Vector3(c.x1, c.y1, c.z1));
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
      // canaleta 14 × 19 × 39 em U, com 2 ø10 e concreto dentro
      for (const s of F.can || []) {
        const C = (d0: number, d1: number, z0: number, z1: number, M: THREE.Material, linha = false) => s.o === 'H' ? caixa(M, s.a, s.c + d0, z0, s.b, s.c + d1, z1, 'canaleta', txtC, linha) : caixa(M, s.c + d0, s.a, z0, s.c + d1, s.b, z1, 'canaleta', txtC, linha);
        const txtC = `Canaleta 14 × 19 × 39${s.cortada ? ` cortada com ${Math.round((s.b - s.a) * 100)} cm` : ''} · por dentro 2 ø10 corridos e concreto`;
        C(-0.07, 0.07, 0, 0.03, MC); C(-0.07, -0.045, 0.03, zc, MC); C(0.045, 0.07, 0.03, zc, MC); C(-0.045, 0.045, 0.03, zc, MCon).renderOrder = 2;
        const cont = C(-0.07, 0.07, 0, zc, MC, true); cont.material = new THREE.MeshBasicMaterial({ visible: false });
        for (const d of [-0.025, 0.025]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, s.b - s.a, 6), MA);
          if (s.o === 'H') { f.rotation.z = Math.PI / 2; f.position.set((s.a + s.b) / 2 + dx, s.c + d + dy, 0.07); } else f.position.set(s.c + d + dx, (s.a + s.b) / 2 + dy, 0.07); gF.add(f); }
      }
    }
    const ctr = bb.getCenter(new THREE.Vector3()), tam = bb.getSize(new THREE.Vector3()), raio = Math.max(tam.x, tam.y, tam.z, 1);
    // sol de fim de tarde vindo da frente-esquerda; a sombra cobre o prédio todo
    sol.position.set(ctr.x - raio * 0.8, ctr.y - raio * 1.1, ctr.z + raio * 1.3); sol.target.position.copy(ctr);
    const sc = sol.shadow.camera; sc.left = sc.bottom = -raio * 1.1; sc.right = sc.top = raio * 1.1; sc.near = 0.5; sc.far = raio * 5; sc.updateProjectionMatrix();
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
    api.current = { grupos, marcar, centrar, gF, chao, grade, O, zc };
    const rs = () => { const w = el.clientWidth, h = el.clientHeight; R.setSize(w, h); C.aspect = w / h; C.updateProjectionMatrix(); };
    const ro = new ResizeObserver(rs); ro.observe(el); rs();
    const rc = new THREE.Raycaster(), mp = new THREE.Vector2(); let dn: [number, number] | null = null;
    const down = (e: PointerEvent) => { dn = [e.clientX, e.clientY]; };
    const up = (e: PointerEvent) => {
      if (!dn || Math.hypot(e.clientX - dn[0], e.clientY - dn[1]) > 5) return;
      const r = R.domElement.getBoundingClientRect(); mp.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      rc.setFromCamera(mp, C);
      const h = rc.intersectObjects(pick.filter(m => m.parent!.visible), false)[0];
      const t = h ? (h.object.userData.txt as string) : null; setSel(t); marcar(h ? h.object.userData.cod : null);
    };
    R.domElement.addEventListener('pointerdown', down); R.domElement.addEventListener('pointerup', up);
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); O.update(); R.render(S, C); }; loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); O.dispose(); R.dispose(); box.dispose(); aresta.dispose(); Object.values(M).forEach(m => m.dispose()); EM.dispose(); chao.geometry.dispose(); grade.dispose(); el.removeChild(R.domElement); api.current = null; };
  }, [cx, props.pavs, props.fund]);   // eslint-disable-line react-hooks/exhaustive-deps

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
    api.current?.marcar(c.cod); setSel(c.txt);
  };

  return <div className="vista3d">
    <div className="v3-painel noprint">
      <div className="botoes">{props.pavs.map(pv => <button key={pv.id} className={(so ? so === pv.id : vis[pv.id] !== false) ? 'on' : ''}
        onClick={() => so ? setSo(pv.id) : setVis(v => ({ ...v, [pv.id]: v[pv.id] === false }))}>{pv.nome}</button>)}</div>
      <div className="botoes">
        <button className={verP ? 'on' : ''} onClick={() => setVerP(!verP)}>Paredes</button>
        <button className={verL ? 'on' : ''} onClick={() => setVerL(!verL)}>Lajes</button>
        {props.fund && <button className={verF ? 'on' : ''} onClick={() => setVerF(!verF)}>Fundação</button>}
        <button className={so ? 'on' : ''} onClick={() => setSo(so ? null : props.pavs[0]?.id ?? null)} title="Mostra um pavimento por vez (toque no nome para trocar)">Um pavimento só</button>
        <button onClick={() => api.current?.centrar()}>Centralizar</button>
      </div>
      <label className="v3-sep">Separar pavimentos <input type="range" min={0} max={6} step={0.1} value={sep} onChange={e => setSep(+e.target.value)} /></label>
      <div className="botoes"><input placeholder="Achar peça (ex.: 1-P84, T-L128)" value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && achar()} /><button onClick={achar}>Achar</button></div>
      <div className="v3-leg"><span><i style={{ background: '#ece6db' }} />parede</span><span><i style={{ background: '#ddd3c2' }} />parede com porta/janela</span><span><i style={{ background: '#a7afb8' }} />laje</span><span><i style={{ background: '#87929e' }} />laje 16 cm ou mais</span>{props.fund && <><span><i style={{ background: '#9c968c' }} />bloco e estaca</span>{props.fund.can && <span><i style={{ background: '#b5aea2' }} />canaleta 14×19 (ferro + concreto)</span>}</>}</div>
      <p className="dica">Arraste para girar · roda/pinça para zoom · botão direito ou dois dedos para mover · toque numa peça para ver o código.</p>
    </div>
    <div className="v3-tela" ref={ref}>{sel && <div className="v3-info">{sel}</div>}</div>
  </div>;
}
