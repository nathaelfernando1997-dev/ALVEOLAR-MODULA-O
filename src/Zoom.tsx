import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// SVG com zoom (roda do mouse, botões, pinça no celular) e arrastar para mover.
// painel da esquerda escondido (planta em tela cheia); fica guardado no aparelho
export function alternarPainel(forcar?: boolean) {
  const r = document.documentElement, on = forcar ?? !r.classList.contains('lado-off');
  r.classList.toggle('lado-off', on);
  try { localStorage.setItem('alv-painel-off', on ? '1' : '0'); } catch { /* sem armazenamento */ }
}
try { if (localStorage.getItem('alv-painel-off') === '1') document.documentElement.classList.add('lado-off'); } catch { /* sem armazenamento */ }

type Pt = { x: number; y: number };
// metro = unidades do desenho por metro (plantas: 100); sem ele a trena não aparece
export function ZoomSvg({ vb, children, metro }: { vb: string; children: ReactNode; metro?: number }) {
  const b0 = vb.split(' ').map(Number) as [number, number, number, number];
  // girar o desenho de 90 em 90° (fica guardado neste aparelho)
  const [giro, setGiro] = useState(() => { try { return Number(localStorage.getItem('alv-giro')) || 0; } catch { return 0; } });
  const gcx = b0[0] + b0[2] / 2, gcy = b0[1] + b0[3] / 2;
  const base: [number, number, number, number] = giro % 180 ? [gcx - b0[3] / 2, gcy - b0[2] / 2, b0[3], b0[2]] : b0;
  const girar = () => setGiro(g => { const n = (g + 90) % 360; try { localStorage.setItem('alv-giro', String(n)); } catch { /* sem armazenamento */ } return n; });
  const [v, setV] = useState(base);
  const ref = useRef<SVGSVGElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const arrastou = useRef(false);
  const ini = useRef<{ v: typeof v; dist: number; cx: number; cy: number } | null>(null);
  useEffect(() => { setV(base); }, [vb, giro]);
  // trena: dois cliques medem a distância; o ponto gruda nas pontas de linhas, cantos e centros do desenho
  const gRef = useRef<SVGGElement>(null);
  const [trena, setTrena] = useState(false);
  const [medidas, setMedidas] = useState<{ a: Pt; b: Pt }[]>([]);
  const [aberta, setAberta] = useState<Pt | null>(null);
  const [mouse, setMouse] = useState<Pt | null>(null);
  const alvos = useRef<Pt[]>([]);
  const juntarAlvos = () => {
    const g = gRef.current; if (!g) return;
    const inv = g.getScreenCTM()?.inverse(); if (!inv) return;
    const out: Pt[] = []; const svg = ref.current!;
    // primeiro as peças (retângulos e polígonos das lajes/painéis), depois as linhas do desenho
    const els = [...g.querySelectorAll('rect, polygon, circle'), ...g.querySelectorAll('line, polyline')];
    for (let i = 0; i < els.length && i < 120000; i++) {
      const el = els[i] as SVGGraphicsElement; if (el.closest('.trena')) continue;
      const m = el.getScreenCTM(); if (!m) continue;
      const M = inv.multiply(m);
      const pt = (x: number, y: number) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; const r = q.matrixTransform(M); out.push({ x: r.x, y: r.y }); };
      const n = (a: string) => +(el.getAttribute(a) || 0);
      if (el.tagName === 'line') { pt(n('x1'), n('y1')); pt(n('x2'), n('y2')); }
      else if (el.tagName === 'rect') { const x = n('x'), y = n('y'), w = n('width'), h = n('height'); if (w < 5000 && h < 5000) { pt(x, y); pt(x + w, y); pt(x, y + h); pt(x + w, y + h); } }
      else if (el.tagName === 'circle') pt(n('cx'), n('cy'));
      else { const ps = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number); for (let k = 0; k + 1 < ps.length; k += 2) pt(ps[k], ps[k + 1]); }
    }
    alvos.current = out;
  };
  const noDesenho = (cx: number, cy: number): Pt => {
    const g = gRef.current!, inv = g.getScreenCTM()!.inverse(), q = ref.current!.createSVGPoint(); q.x = cx; q.y = cy;
    const r = q.matrixTransform(inv); let p = { x: r.x, y: r.y };
    // gruda no ponto do desenho mais perto (até 8 px na tela)
    const esc = Math.hypot(inv.a, inv.b), lim = 8 * esc; let bd = lim;
    for (const a of alvos.current) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; p = a; } }
    return p;
  };
  const br = (m: number) => m.toFixed(2).replace('.', ',');
  // a área da planta mudou de tamanho (painel escondido/mostrado, tablet girado): enquadra de novo
  const largura = useRef(0);
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (largura.current && Math.abs(w - largura.current) > 30) setV(base);
      largura.current = w;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [vb, giro]);

  const paraSvg = (cx: number, cy: number, vv = v) => {
    const r = ref.current!.getBoundingClientRect();
    const s = Math.max(vv[2] / r.width, vv[3] / r.height);
    const ox = (r.width * s - vv[2]) / 2, oy = (r.height * s - vv[3]) / 2;
    return { x: vv[0] - ox + (cx - r.left) * s, y: vv[1] - oy + (cy - r.top) * s, s };
  };
  const zoom = (f: number, cx?: number, cy?: number) => {
    setV(vv => {
      const r = ref.current!.getBoundingClientRect();
      const p = paraSvg(cx ?? r.left + r.width / 2, cy ?? r.top + r.height / 2, vv);
      const w = Math.min(base[2] * 1.5, Math.max(base[2] / 40, vv[2] * f)), k = w / vv[2], h = vv[3] * k;
      return [p.x - (p.x - vv[0]) * k, p.y - (p.y - vv[1]) * k, w, h];
    });
  };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <div className="zoom">
      <div className="zoom-bt">
        <button onClick={() => zoom(1 / 1.4)} title="Aproximar">+</button>
        <button onClick={() => zoom(1.4)} title="Afastar">−</button>
        <button onClick={() => setV(base)} title="Ver tudo">⤢</button>
        <button onClick={girar} title="Girar o desenho 90°">↻</button>
        <button onClick={() => alternarPainel()} title="Planta em tela cheia (esconder/mostrar o painel)">⛶</button>
        {metro && <button className={trena ? 'on' : ''} onClick={() => { const on = !trena; setTrena(on); setAberta(null); setMouse(null); if (on) juntarAlvos(); else setMedidas([]); }} title="Trena: clique em dois pontos para medir (clique de novo aqui para sair)">📏</button>}
      </div>
      {trena && <div className="trena-aviso">{aberta ? 'Clique no segundo ponto' : 'Trena: clique no primeiro ponto'}{medidas.length ? <> · <a href="#" onClick={e => { e.preventDefault(); setMedidas([]); }}>limpar</a></> : null}</div>}
      <svg ref={ref} viewBox={v.join(' ')}
        onPointerDown={e => { ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); arrastou.current = false;
          const ps = [...ptrs.current.values()];
          ini.current = { v, dist: ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0, cx: e.clientX, cy: e.clientY }; }}
        onPointerMove={e => {
          if (!ptrs.current.has(e.pointerId) || !ini.current) return;
          ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const ps = [...ptrs.current.values()];
          if (ps.length > 1 && ini.current.dist > 0) {
            const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
            const f = ini.current.dist / d; ini.current.dist = d; arrastou.current = true;
            zoom(f, (ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2);
            return;
          }
          const dx = e.clientX - ini.current.cx, dy = e.clientY - ini.current.cy;
          if (!arrastou.current && Math.hypot(dx, dy) < 5) return;
          if (!arrastou.current) (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          arrastou.current = true;
          const s = paraSvg(0, 0, ini.current.v).s;
          setV([ini.current.v[0] - dx * s, ini.current.v[1] - dy * s, ini.current.v[2], ini.current.v[3]]);
        }}
        onPointerUp={e => { ptrs.current.delete(e.pointerId); if (ptrs.current.size === 0) ini.current = null; }}
        onPointerCancel={e => { ptrs.current.delete(e.pointerId); }}
        onClickCapture={e => {
          if (arrastou.current) { e.stopPropagation(); arrastou.current = false; return; }
          if (!trena) return;
          e.stopPropagation();
          if (!aberta) juntarAlvos();
          const p = noDesenho(e.clientX, e.clientY);
          if (!aberta) setAberta(p); else { setMedidas(m => [...m.slice(-7), { a: aberta, b: p }]); setAberta(null); setMouse(null); }
        }}
        onMouseMove={e => { if (trena && aberta) setMouse(noDesenho(e.clientX, e.clientY)); }}
        style={{ touchAction: 'none' }}>
        <g ref={gRef} transform={giro ? `rotate(${giro} ${gcx} ${gcy})` : undefined}>{children}
          {trena && metro && (() => {
            // tamanho fixo na tela, qualquer zoom
            const r = ref.current?.getBoundingClientRect(), s = r ? Math.max(v[2] / r.width, v[3] / r.height) : 1;
            const linha = (a: Pt, b: Pt, k: number, prov = false) => {
              const d = Math.hypot(b.x - a.x, b.y - a.y) / metro, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              const dx = Math.abs(b.x - a.x) / metro, dy = Math.abs(b.y - a.y) / metro;
              const txt = `${br(d)} m` + (dx > 0.005 && dy > 0.005 ? `  (↔ ${br(dx)} · ↕ ${br(dy)})` : '');
              return <g key={k} className="trena" style={{ pointerEvents: 'none' }}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e8590c" strokeWidth={2.5 * s} strokeDasharray={prov ? `${6 * s} ${4 * s}` : undefined} />
                {[a, b].map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={4 * s} fill="#e8590c" />)}
                <text x={mx} y={my - 8 * s} fontSize={14 * s} fontWeight="bold" textAnchor="middle" fill="#e8590c" stroke="#fff" strokeWidth={4 * s} paintOrder="stroke"
                  transform={giro ? `rotate(${-giro} ${mx} ${my - 8 * s})` : undefined}>{txt}</text>
              </g>;
            };
            return <>{medidas.map((m, i) => linha(m.a, m.b, i))}{aberta && <circle className="trena" cx={aberta.x} cy={aberta.y} r={4 * s} fill="#e8590c" />}{aberta && mouse && linha(aberta, mouse, 99, true)}</>;
          })()}
        </g>
      </svg>
    </div>
  );
}
