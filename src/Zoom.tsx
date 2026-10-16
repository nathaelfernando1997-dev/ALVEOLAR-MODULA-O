import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// SVG com zoom (roda do mouse, botões, pinça no celular) e arrastar para mover.
export function ZoomSvg({ vb, children }: { vb: string; children: ReactNode }) {
  const base = vb.split(' ').map(Number) as [number, number, number, number];
  const [v, setV] = useState(base);
  const ref = useRef<SVGSVGElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const arrastou = useRef(false);
  const ini = useRef<{ v: typeof v; dist: number; cx: number; cy: number } | null>(null);
  useEffect(() => { setV(base); }, [vb]);

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
        {children}
      </svg>
    </div>
  );
}
