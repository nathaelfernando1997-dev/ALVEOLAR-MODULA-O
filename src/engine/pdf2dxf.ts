// Converte um projeto em PDF vetorial (exportado do AutoCAD, Revit, ArchiCAD...) em um DXF simples,
// para seguir o mesmo caminho do DXF. Cada combinação de cor/espessura (ou camada do PDF, quando existe)
// vira uma camada; a escala sai das cotas escritas no desenho (texto "4,11" junto de uma linha do mesmo tamanho).
// PDF escaneado (imagem) não tem linhas e não serve.

export interface PdfLib {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<any> };
  OPS: Record<string, number>;
}

type P = [number, number];
type M6 = [number, number, number, number, number, number];
const mul = (m: M6, n: M6): M6 => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m: M6, x: number, y: number): P => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const hex = (c: number[] | undefined) => c ? '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : '#000000';

interface Linha { pts: P[]; layer: string; fechada: boolean }
interface Arco { c: P; r: number; a0: number; a1: number; layer: string }
interface Texto { s: string; x: number; y: number; h: number; rot: number }
export interface ResultadoPdf { dxf: string; escala: number; camadas: { nome: string; n: number }[]; avisos: string[] }

// círculo pelos três pontos (para transformar a curva da porta em arco)
function circulo(a: P, b: P, c: P): { c: P; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const s = (p: P) => p[0] * p[0] + p[1] * p[1];
  const ux = (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d;
  const uy = (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}
const bez = (p0: P, p1: P, p2: P, p3: P, t: number): P => {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
};

export async function pdfParaDxf(lib: PdfLib, data: Uint8Array, escalaManual?: number): Promise<ResultadoPdf> {
  const OPS = lib.OPS;
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  const linhas: Linha[] = [], arcos: Arco[] = [], textos: Texto[] = [];
  const avisos: string[] = [];
  // nomes das camadas do PDF (conteúdo opcional), quando o programa exporta
  const ocNome = new Map<string, string>();
  try { const oc = await doc.getOptionalContentConfig(); for (const id of Object.keys((oc as any)._groups ? Object.fromEntries((oc as any)._groups) : {})) ocNome.set(id, (oc as any).getGroup(id)?.name ?? id); } catch { /* sem camadas */ }
  let dx = 0, maxPag = 0;
  for (let pg = 1; pg <= doc.numPages; pg++) {
    const page = await doc.getPage(pg);
    const vp = page.getViewport({ scale: 1 });
    // espaço do PDF -> página em pé (como aparece na tela), com y para cima e as páginas lado a lado
    const V: M6 = mul([1, 0, 0, -1, dx, vp.height], vp.transform as M6);
    const ops = await page.getOperatorList();
    let ctm: M6 = [1, 0, 0, 1, 0, 0], lw = 1, cs = [0, 0, 0], cf = [0, 0, 0];
    const pilha: { ctm: M6; lw: number; cs: number[]; cf: number[] }[] = [];
    const formas: M6[] = [];
    const oc: string[] = [];
    let caminho: { pts: P[]; fechada: boolean; arcos: { p0: P; p1: P; p2: P; p3: P }[] }[] = [];
    const T = (x: number, y: number) => ap(mul(V, ctm), x, y);
    const esc = () => { const m = mul(V, ctm); return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); };
    for (let i = 0; i < ops.fnArray.length; i++) {
      const f = ops.fnArray[i], a = ops.argsArray[i];
      switch (f) {
        case OPS.save: pilha.push({ ctm, lw, cs, cf }); break;
        case OPS.restore: { const s = pilha.pop(); if (s) ({ ctm, lw, cs, cf } = s); break; }
        case OPS.transform: ctm = mul(ctm, a as M6); break;
        case OPS.paintFormXObjectBegin: formas.push(ctm); if (a?.[0]) ctm = mul(ctm, a[0] as M6); break;
        case OPS.paintFormXObjectEnd: ctm = formas.pop() ?? ctm; break;
        case OPS.setLineWidth: lw = a[0]; break;
        case OPS.setStrokeRGBColor: cs = [a[0], a[1], a[2]]; break;
        case OPS.setFillRGBColor: cf = [a[0], a[1], a[2]]; break;
        case OPS.setStrokeGray: cs = [a[0] * 255, a[0] * 255, a[0] * 255]; break;
        case OPS.setFillGray: cf = [a[0] * 255, a[0] * 255, a[0] * 255]; break;
        case OPS.beginMarkedContentProps: oc.push(a?.[0] === 'OC' && a?.[1]?.id ? (ocNome.get(a[1].id) ?? '') : ''); break;
        case OPS.beginMarkedContent: oc.push(''); break;
        case OPS.endMarkedContent: oc.pop(); break;
        case OPS.constructPath: {
          const [o, arg] = a as [number[], number[]];
          let j = 0, cur: P = [0, 0], ini: P = [0, 0];
          let atual: (typeof caminho)[number] | null = caminho[caminho.length - 1] ?? null;
          const novo = (p: P) => { atual = { pts: [T(...p)], fechada: false, arcos: [] }; caminho.push(atual); };
          for (const op of o) {
            if (op === OPS.moveTo) { cur = [arg[j++], arg[j++]]; ini = cur; novo(cur); }
            else if (op === OPS.lineTo) { cur = [arg[j++], arg[j++]]; if (!atual) novo(ini); atual!.pts.push(T(...cur)); }
            else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
              let p1: P, p2: P, p3: P;
              if (op === OPS.curveTo) { p1 = [arg[j++], arg[j++]]; p2 = [arg[j++], arg[j++]]; p3 = [arg[j++], arg[j++]]; }
              else if (op === OPS.curveTo2) { p1 = cur; p2 = [arg[j++], arg[j++]]; p3 = [arg[j++], arg[j++]]; }
              else { p1 = [arg[j++], arg[j++]]; p3 = [arg[j++], arg[j++]]; p2 = p3; }
              if (!atual) novo(cur);
              const q0 = T(...cur), q1 = T(...p1), q2 = T(...p2), q3 = T(...p3);
              atual!.arcos.push({ p0: q0, p1: q1, p2: q2, p3: q3 });
              for (let k = 1; k <= 8; k++) atual!.pts.push(bez(q0, q1, q2, q3, k / 8));
              cur = p3;
            } else if (op === OPS.closePath) { if (atual) { atual.fechada = true; atual.pts.push(atual.pts[0]); } cur = ini; }
            else if (op === OPS.rectangle) {
              const x = arg[j++], y = arg[j++], w = arg[j++], h = arg[j++];
              caminho.push({ pts: [T(x, y), T(x + w, y), T(x + w, y + h), T(x, y + h), T(x, y)], fechada: true, arcos: [] });
              atual = null; cur = [x, y]; ini = cur;
            }
          }
          break;
        }
        case OPS.stroke: case OPS.closeStroke: case OPS.fill: case OPS.eoFill: case OPS.fillStroke: case OPS.eoFillStroke:
        case OPS.closeFillStroke: case OPS.closeEOFillStroke: case OPS.endPath: {
          if (f !== OPS.endPath) {
            const preench = f !== OPS.stroke && f !== OPS.closeStroke;
            const camOc = oc.filter(Boolean).pop();
            const lwM = lw * esc();
            const contorno = f === OPS.fillStroke || f === OPS.eoFillStroke || f === OPS.closeFillStroke || f === OPS.closeEOFillStroke;
            const layer = camOc ? camOc : !preench ? `LINHA ${hex(cs)} ${lwM.toFixed(2)}` : contorno ? `PREENCHIMENTO ${hex(cf)} LINHA ${hex(cs)} ${lwM.toFixed(2)}` : `PREENCHIMENTO ${hex(cf)}`;
            for (const c of caminho) {
              // curvas que formam um arco de círculo (folha de porta) viram ARC; o resto, polilinha
              let soArco = c.arcos.length > 0 && c.pts.length === 1 + 8 * c.arcos.length;
              const arcs: Arco[] = [];
              if (soArco) for (const b of c.arcos) {
                const ci = circulo(b.p0, bez(b.p0, b.p1, b.p2, b.p3, 0.5), b.p3);
                if (!ci || [0.25, 0.75].some(t => { const q = bez(b.p0, b.p1, b.p2, b.p3, t); return Math.abs(Math.hypot(q[0] - ci.c[0], q[1] - ci.c[1]) - ci.r) > ci.r * 0.02; })) { soArco = false; break; }
                let a0 = Math.atan2(b.p0[1] - ci.c[1], b.p0[0] - ci.c[0]) * 180 / Math.PI, a1 = Math.atan2(b.p3[1] - ci.c[1], b.p3[0] - ci.c[0]) * 180 / Math.PI;
                const m = bez(b.p0, b.p1, b.p2, b.p3, 0.5), am = Math.atan2(m[1] - ci.c[1], m[0] - ci.c[0]) * 180 / Math.PI;
                const norm = (x: number) => ((x % 360) + 360) % 360;
                // sentido anti-horário de a0 a a1 passando pelo meio
                if (norm(am - a0) > norm(a1 - a0)) [a0, a1] = [a1, a0];
                arcs.push({ c: ci.c, r: ci.r, a0: norm(a0), a1: norm(a1), layer });
              }
              if (soArco && !c.fechada) arcos.push(...arcs);
              else if (c.pts.length > 1) linhas.push({ pts: c.pts, layer, fechada: c.fechada });
            }
          }
          caminho = [];
          break;
        }
      }
    }
    const tc = await page.getTextContent();
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      const s = it.str?.trim(); if (!s) continue;
      const m = mul(V, it.transform as M6);
      const h = Math.hypot(m[2], m[3]);
      textos.push({ s, x: m[4], y: m[5], h, rot: Math.atan2(m[1], m[0]) * 180 / Math.PI });
    }
    maxPag = Math.max(maxPag, Math.min(vp.width, vp.height));
    dx += vp.width + 200;
  }
  // ---- escala: cotas escritas (ex.: 4,11 ou 2,98) junto de uma linha reta do mesmo comprimento
  let escala = escalaManual ?? 0;
  if (!escala) {
    const segs: { a: P; b: P; L: number }[] = [];
    for (const l of linhas) for (let k = 0; k < l.pts.length - 1; k++) {
      const a = l.pts[k], b = l.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 8) segs.push({ a, b, L });
    }
    const votos = new Map<number, number>();
    for (const t of textos) {
      if (!/^\d{1,2},\d{2}$/.test(t.s)) continue;
      const v = parseFloat(t.s.replace(',', '.')); if (v < 0.3) continue;
      for (const s of segs) {
        // linha paralela ao texto, passando perto dele
        const ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180 / Math.PI;
        const dAng = Math.abs((((ang - t.rot) % 180) + 180) % 180);
        if (Math.min(dAng, 180 - dAng) > 3) continue;
        const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
        if (Math.hypot(mx - t.x, my - t.y) > Math.max(25, s.L * 0.6)) continue;
        const k = Math.round(v / s.L * 1e6) / 1e6;
        // agrupa em faixas de 0,5%
        const chave = Math.round(Math.log(k) / Math.log(1.005));
        votos.set(chave, (votos.get(chave) || 0) + 1);
      }
    }
    let melhor = 0, n = 0;
    for (const [c, v] of votos) { const tot = v + (votos.get(c - 1) || 0) + (votos.get(c + 1) || 0); if (tot > n) { n = tot; melhor = c; } }
    if (n >= 3) {
      escala = Math.pow(1.005, melhor);
      // arredonda para a escala padrão mais próxima (1:50, 1:75, 1:100...) quando estiver a menos de 2,5%
      const den = escala / (0.0254 / 72);
      const pad = [20, 25, 50, 75, 100, 125, 150, 200].find(d => Math.abs(den / d - 1) < 0.025);
      if (pad) escala = 0.0254 / 72 * pad;
    }
    else {
      // sem cotas: escala escrita no desenho (1:50, 1:75, 1:100), papel em pontos (1 pt = 0,3528 mm)
      const e = textos.map(t => /1\s*[:/]\s*(\d{2,3})\b/.exec(t.s)).filter(Boolean).map(m => +m![1]).filter(x => x >= 20 && x <= 200);
      const freq = new Map<number, number>(); for (const x of e) freq.set(x, (freq.get(x) || 0) + 1);
      const den = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 100;
      escala = 0.0254 / 72 * den;
      avisos.push(`Escala não encontrada pelas cotas; usada a escala 1:${den} do desenho — confira as medidas.`);
    }
  }
  // ---- camada das paredes: a que tem mais pares de linhas paralelas na distância de uma parede (12 a 27 cm)
  const pontos = new Map<string, { o: 'H' | 'V'; c: number; a: number; b: number }[]>();
  for (const l of linhas) for (let k = 0; k < l.pts.length - 1; k++) {
    const [u, w] = [l.pts[k], l.pts[k + 1]].map(p => [p[0] * escala, p[1] * escala] as P);
    const L = Math.hypot(w[0] - u[0], w[1] - u[1]); if (L < 0.3) continue;
    const arr = pontos.get(l.layer) ?? []; pontos.set(l.layer, arr);
    if (Math.abs(u[1] - w[1]) < 0.01) arr.push({ o: 'H', c: u[1], a: Math.min(u[0], w[0]), b: Math.max(u[0], w[0]) });
    else if (Math.abs(u[0] - w[0]) < 0.01) arr.push({ o: 'V', c: u[0], a: Math.min(u[1], w[1]), b: Math.max(u[1], w[1]) });
  }
  let parede = '', melhorPar = 0;
  const stats: { lay: string; par: number; tot: number }[] = [];
  for (const [lay, arr] of pontos) {
    if (arr.length > 20000) continue;   // hachuras
    let par = 0;
    for (const o of ['H', 'V'] as const) {
      const s = arr.filter(x => x.o === o).sort((x, y) => x.c - y.c);
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length && s[j].c - s[i].c <= 0.27; j++) {
        const d = s[j].c - s[i].c; if (d < 0.12) continue;
        const sob = Math.min(s[i].b, s[j].b) - Math.max(s[i].a, s[j].a);
        if (sob > 0.3) par += sob;
      }
    }
    // parede de verdade: boa parte das linhas da camada forma par (mobília, hachuras e preenchimentos não)
    const tot = arr.reduce((t, x) => t + x.b - x.a, 0);
    stats.push({ lay, par, tot });
  }
  {
    // entre as camadas com bastante linha em par (paredes), fica a que tem mais par; e a proporção decide o empate
    // a camada com nome de parede (PDF com camadas) ganha; senão, a linha visível (escura) com mais pares.
    // Preenchimentos claros (fundo dos cômodos, grama) acompanham as paredes, mas não são as paredes.
    const lum = (h: string) => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); return 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]; };
    const visivel = (l: string) => { const m = /LINHA (#[0-9a-f]{6}) ([\d.]+)$/.exec(l); return m ? lum(m[1]) < 0.6 && parseFloat(m[2]) > 0.01 : !/^PREENCHIMENTO/.test(l); };
    const nomeado = stats.filter(x => /parede|wall|alven/i.test(x.lay) && x.par > 0).sort((a, b) => b.par - a.par)[0];
    const cand = nomeado ? [nomeado] : stats.filter(x => visivel(x.lay));
    for (const c of cand) if (c.par > melhorPar) { melhorPar = c.par; parede = c.lay; }
    if (typeof process !== 'undefined' && process.env?.PDF_DEBUG) console.log(stats.sort((a, b) => b.par - a.par).slice(0, 8).map(x => `${x.lay}: par ${x.par.toFixed(0)} tot ${x.tot.toFixed(0)}`).join('\n'));
  }
  if (parede) {
    // a moldura da folha e as linhas que atravessam a prancha ficam de fora
    const lim = maxPag * 0.45;
    for (const l of linhas) if (l.layer === parede) {
      const xs = l.pts.map(p => p[0]), ys = l.pts.map(p => p[1]);
      if (Math.max(...xs) - Math.min(...xs) < lim && Math.max(...ys) - Math.min(...ys) < lim) l.layer = 'PAREDE';
    }
    for (const a of arcos) if (a.layer === parede) a.layer = 'PAREDE';
    avisos.push(`Paredes reconhecidas pelas linhas "${parede}" — se estiver errado, escolha outra camada em "2. Desenhos".`);
  }
  // ---- DXF
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const f = (v: number) => (v * escala).toFixed(4);
  const camadas = new Map<string, number>();
  const conta = (l: string) => camadas.set(l, (camadas.get(l) || 0) + 1);
  for (const l of linhas) {
    conta(l.layer);
    out.push('0', 'LWPOLYLINE', '8', l.layer, '90', String(l.pts.length - (l.fechada ? 1 : 0)), '70', l.fechada ? '1' : '0');
    for (const p of (l.fechada ? l.pts.slice(0, -1) : l.pts)) out.push('10', f(p[0]), '20', f(p[1]));
  }
  for (const a of arcos) { conta(a.layer); out.push('0', 'ARC', '8', a.layer, '10', f(a.c[0]), '20', f(a.c[1]), '40', f(a.r), '50', a.a0.toFixed(3), '51', a.a1.toFixed(3)); }
  for (const t of textos) out.push('0', 'TEXT', '8', 'TEXTO', '10', f(t.x), '20', f(t.y), '40', f(t.h), '50', t.rot.toFixed(2), '1', t.s.replace(/\r?\n/g, ' '));
  out.push('0', 'ENDSEC', '0', 'EOF');
  if (!linhas.length) avisos.push('O PDF não tem linhas de desenho (provavelmente é escaneado ou uma imagem). Use o DXF do projeto.');
  return { dxf: out.join('\n'), escala, camadas: [...camadas].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n), avisos };
}
