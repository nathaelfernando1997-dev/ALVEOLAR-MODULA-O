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

export function ZoomSvg({ vb, children }: { vb: string; children: ReactNode }) {
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
      </div>
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
        onClickCapture={e => { if (arrastou.current) { e.stopPropagation(); arrastou.current = false; } }}
        style={{ touchAction: 'none' }}>
        <g transform={giro ? `rotate(${giro} ${gcx} ${gcy})` : undefined}>{children}</g>
      </svg>
    </div>
  );
}
