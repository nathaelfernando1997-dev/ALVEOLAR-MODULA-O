// IFC 4 (texto STEP) das peças da modulação: paredes (com portas e janelas recortadas) e lajes,
// um pavimento em cima do outro, cada peça com o código da etiqueta. Abre no Revit, BIMvision,
// no visualizador 3D do sistema de gestão etc.
import type { Painel, Pavimento } from './model.ts';
import type { PainelLaje } from './lajes.ts';

export interface OpIfc {
  nome: string;                                   // nome do projeto
  pavs: Pavimento[];                              // todos os pavimentos ativos, de baixo para cima
  so?: string[];                                  // só estes pavimentos (vazio = todos)
  desloc: Record<string, { dx: number; dy: number }>;   // somado às coordenadas do pavimento (encaixe sobre o de baixo)
  ps: Painel[]; pl: PainelLaje[];
  espLaje: (p: PainelLaje) => number;             // espessura da laje (m)
  espParede: number;                              // espessura das paredes (m)
  sg: Map<string, string>;                        // sigla do pavimento na etiqueta (T, 1, 2…)
  peLaje?: (p: PainelLaje) => number | undefined; // altura da laje no ambiente com pé-direito próprio
}

// texto IFC: ASCII; acentos em \X2\hhhh\X0\
const txt = (s: string) => "'" + [...s.replace(/'/g, "''")].map(c => c.charCodeAt(0) < 128 ? c : `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`).join('') + "'";
const num = (v: number) => { const s = (Math.round(v * 1e6) / 1e6).toString(); return s.includes('.') || s.includes('e') ? s : s + '.'; };
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
function guid() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
  let s = ''; for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; }
  return "'" + s + "'";
}

export function gerarIfc(o: OpIfc): string {
  const L: string[] = []; let id = 0;
  const e = (s: string) => { L.push(`#${++id}=${s};`); return `#${id}`; };
  const pt = (x: number, y: number, z?: number) => e(`IFCCARTESIANPOINT((${num(x)},${num(y)}${z === undefined ? '' : ',' + num(z)}))`);
  const dir = (x: number, y: number, z?: number) => e(`IFCDIRECTION((${num(x)},${num(y)}${z === undefined ? '' : ',' + num(z)}))`);
  const Z = dir(0, 0, 1), X = dir(1, 0, 0), Y = dir(0, 1, 0), O = pt(0, 0, 0), O2 = pt(0, 0);
  const ax3 = (x: number, y: number, z: number, xd = X) => e(`IFCAXIS2PLACEMENT3D(${x || y || z ? pt(x, y, z) : O},${Z},${xd})`);
  const loc = (rel: string | null, x: number, y: number, z: number, xd = X) => e(`IFCLOCALPLACEMENT(${rel ?? '$'},${ax3(x, y, z, xd)})`);
  // unidades e contexto
  const un = [e(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`), e(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`), e(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`), e(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`)];
  const ua = e(`IFCUNITASSIGNMENT((${un.join(',')}))`);
  const ctx = e(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ax3(0, 0, 0)},$)`);
  const body = e(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const proj = e(`IFCPROJECT(${guid()},$,${txt(o.nome)},$,$,$,$,(${ctx}),${ua})`);
  const plSite = loc(null, 0, 0, 0);
  const site = e(`IFCSITE(${guid()},$,${txt('Terreno')},$,$,${plSite},$,$,.ELEMENT.,$,$,$,$,$)`);
  const plBld = loc(plSite, 0, 0, 0);
  const bld = e(`IFCBUILDING(${guid()},$,${txt(o.nome)},$,$,${plBld},$,$,.ELEMENT.,$,$,$)`);
  e(`IFCRELAGGREGATES(${guid()},$,$,$,${proj},(${site}))`);
  e(`IFCRELAGGREGATES(${guid()},$,$,$,${site},(${bld}))`);
  // cores
  const estilo = (nome: string, r: number, g: number, b: number, tr = 0) =>
    e(`IFCSURFACESTYLE(${txt(nome)},.BOTH.,(${e(`IFCSURFACESTYLESHADING(${e(`IFCCOLOURRGB($,${num(r)},${num(g)},${num(b)})`)},${num(tr)})`)}))`);
  const S = { parede: estilo('Painel de parede', 0.86, 0.84, 0.80), parAb: estilo('Painel com abertura', 0.88, 0.64, 0.35), laje: estilo('Painel de laje', 0.56, 0.66, 0.78),
    laje16: estilo('Laje 16 cm ou mais', 0.37, 0.53, 0.71), porta: estilo('Porta', 0.55, 0.36, 0.20), vidro: estilo('Vidro', 0.55, 0.75, 0.90, 0.55) };
  // caixa: retângulo L × W (W centrado no eixo, ou a partir de y0) extrudado H, com cor
  const caixa = (L0: number, W: number, H: number, st: string, cx = L0 / 2, cy = 0) => {
    const prof = e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${e(`IFCAXIS2PLACEMENT2D(${pt(cx, cy)},$)`)},${num(L0)},${num(W)})`);
    const sol = e(`IFCEXTRUDEDAREASOLID(${prof},${e(`IFCAXIS2PLACEMENT3D(${O},$,$)`)},${Z},${num(H)})`);
    e(`IFCSTYLEDITEM(${sol},(${st}),$)`);
    return e(`IFCPRODUCTDEFINITIONSHAPE($,$,(${e(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${sol}))`)}))`);
  };
  const props = (alvo: string, nome: string, v: [string, string][]) => {
    const pr = v.map(([k, val]) => e(`IFCPROPERTYSINGLEVALUE(${txt(k)},$,${val},$)`));
    e(`IFCRELDEFINESBYPROPERTIES(${guid()},$,$,$,(${alvo}),${e(`IFCPROPERTYSET(${guid()},$,${txt(nome)},$,(${pr.join(',')}))`)})`);
  };
  const lab = (s: string) => `IFCLABEL(${txt(s)})`, len = (v: number) => `IFCLENGTHMEASURE(${num(v)})`;
  const mat = e(`IFCMATERIAL(${txt('Concreto pré-moldado alveolar')},$,'Concreto')`);
  const comMat: string[] = [];
  const pavsSaem = o.pavs.filter(p => !o.so?.length || o.so.includes(p.id));
  const T = o.espParede;
  // cotas dos pavimentos: pé-direito da parede + laje de cima
  let z = 0;
  const lajeMax = (pid: string) => Math.max(0, ...o.pl.filter(q => q.pav === pid).map(o.espLaje));
  const storeys: string[] = [];
  for (const pav of o.pavs) {
    const zPav = z;
    z += pav.altura + lajeMax(pav.id);
    if (!pavsSaem.includes(pav)) continue;
    const plSt = loc(plBld, 0, 0, zPav);
    const st = e(`IFCBUILDINGSTOREY(${guid()},$,${txt(pav.nome)},$,$,${plSt},$,$,.ELEMENT.,${num(zPav)})`);
    storeys.push(st);
    const { dx, dy } = o.desloc[pav.id] ?? { dx: 0, dy: 0 };
    const sig = o.sg.get(pav.id) ?? '';
    const dentro: string[] = [];
    for (const p of o.ps.filter(q => q.pav === pav.id)) {
      const a = Math.min(p.a, p.b), b = Math.max(p.a, p.b), Lp = b - a, cod = `${sig}-P${p.num}`;
      const [x, y, xd] = p.o === 'H' ? [a + dx, p.c + dy, X] : [p.c + dx, a + dy, Y];
      const plW = loc(plSt, x, y, p.z0 ?? 0, xd);
      const w = e(`IFCWALL(${guid()},$,${txt(`${cod} · painel ${Lp.toFixed(2).replace('.', ',')} × ${p.H.toFixed(2).replace('.', ',')} m`)},$,$,${plW},${caixa(Lp - 0.006, T, p.H, p.recortes.length ? S.parAb : S.parede, (Lp - 0.006) / 2 + 0.003)},${txt(cod)},.SOLIDWALL.)`);
      dentro.push(w); comMat.push(w);
      props(w, 'Alveolar_Painel', [['Codigo', lab(cod)], ['Pavimento', lab(pav.nome)], ['Comprimento', len(Lp)], ['Altura', len(p.H)], ['Espessura', len(T)], ['Aberturas', lab(p.recortes.map(r => r.tipo).join(', ') || 'nenhuma')]]);
      for (const r of p.recortes) {
        const plO = loc(plW, r.dl, 0, r.base);
        const op = e(`IFCOPENINGELEMENT(${guid()},$,${txt('Abertura ' + r.tipo)},$,$,${plO},${caixa(r.w, T + 0.1, r.h, S.vidro)},$,.OPENING.)`);
        e(`IFCRELVOIDSELEMENT(${guid()},$,$,$,${w},${op})`);
        const porta = /^P/i.test(r.tipo);
        const plF = loc(plW, r.dl + 0.01, 0, r.base + (porta ? 0 : 0.01));
        const fw = r.w - 0.02, fh = r.h - (porta ? 0.01 : 0.02);
        const fl = porta ? e(`IFCDOOR(${guid()},$,${txt(`${r.tipo} · ${cod}`)},$,$,${plF},${caixa(fw, 0.04, fh, S.porta)},$,${num(fh)},${num(fw)},.DOOR.,.SINGLE_SWING_LEFT.,$)`)
          : e(`IFCWINDOW(${guid()},$,${txt(`${r.tipo} · ${cod}`)},$,$,${plF},${caixa(fw, 0.04, fh, S.vidro)},$,${num(fh)},${num(fw)},.WINDOW.,.SINGLEPANEL.,$)`);
        e(`IFCRELFILLSELEMENT(${guid()},$,$,$,${op},${fl})`);
        dentro.push(fl);
      }
    }
    const hPav = pav.altura;
    for (const q of o.pl.filter(q => q.pav === pav.id)) {
      const x0 = Math.min(q.x0, q.x1), x1 = Math.max(q.x0, q.x1), y0 = Math.min(q.y0, q.y1), y1 = Math.max(q.y0, q.y1), esp = o.espLaje(q), cod = `${sig}-L${q.num}`;
      const plL = loc(plSt, x0 + dx, y0 + dy, o.peLaje?.(q) ?? hPav);
      const s = e(`IFCSLAB(${guid()},$,${txt(`${cod} · laje ${q.comp.toFixed(2).replace('.', ',')} × ${q.larg.toFixed(2).replace('.', ',')} m`)},$,$,${plL},${caixa(x1 - x0 - 0.006, y1 - y0 - 0.006, esp, esp >= 0.16 - 1e-6 ? S.laje16 : S.laje, (x1 - x0) / 2, (y1 - y0) / 2)},${txt(cod)},.FLOOR.)`);
      dentro.push(s); comMat.push(s);
      props(s, 'Alveolar_Painel', [['Codigo', lab(cod)], ['Laje sobre', lab(pav.nome)], ['Comprimento', len(q.comp)], ['Largura', len(q.larg)], ['Espessura', len(esp)], ['Sentido dos alveolos', lab(q.sentido === 'H' ? 'X' : 'Y')]]);
    }
    if (dentro.length) e(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},$,$,$,(${dentro.join(',')}),${st})`);
  }
  if (storeys.length) e(`IFCRELAGGREGATES(${guid()},$,$,$,${bld},(${storeys.join(',')}))`);
  if (comMat.length) e(`IFCRELASSOCIATESMATERIAL(${guid()},$,$,$,(${comMat.join(',')}),${mat})`);
  void O2;
  const agora = new Date().toISOString().slice(0, 19);
  return ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME(${txt(o.nome + '.ifc')},'${agora}',(''),(''),'Alveolar Modulacao','Alveolar Modulacao','');`, "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}
