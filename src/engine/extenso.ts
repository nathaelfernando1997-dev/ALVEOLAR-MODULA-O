// valor em reais por extenso, como nas propostas: "Cento e Dezesseis Mil, Seiscentos e Quarenta e Quatro Reais"
const U = ['', 'Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove', 'Dez', 'Onze', 'Doze', 'Treze', 'Quatorze', 'Quinze', 'Dezesseis', 'Dezessete', 'Dezoito', 'Dezenove'];
const D = ['', '', 'Vinte', 'Trinta', 'Quarenta', 'Cinquenta', 'Sessenta', 'Setenta', 'Oitenta', 'Noventa'];
const C = ['', 'Cento', 'Duzentos', 'Trezentos', 'Quatrocentos', 'Quinhentos', 'Seiscentos', 'Setecentos', 'Oitocentos', 'Novecentos'];

function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'Cem';
  const c = Math.floor(n / 100), r = n % 100, p: string[] = [];
  if (c) p.push(C[c]);
  if (r < 20) { if (r) p.push(U[r]); }
  else { p.push(D[Math.floor(r / 10)]); if (r % 10) p.push(U[r % 10]); }
  return p.join(' e ');
}

export function numeroPorExtenso(n: number): string {
  if (n === 0) return 'Zero';
  const grupos: [number, string, string][] = [[1e9, 'Bilhão', 'Bilhões'], [1e6, 'Milhão', 'Milhões'], [1e3, 'Mil', 'Mil'], [1, '', '']];
  const partes: { t: string; v: number }[] = [];
  let r = n;
  for (const [g, s, pl] of grupos) {
    const q = Math.floor(r / g); r %= g;
    if (!q) continue;
    const t = g === 1e3 && q === 1 ? 'Mil' : `${ate999(q)}${s ? ' ' + (q > 1 ? pl : s) : ''}`;
    partes.push({ t, v: q });
  }
  // último grupo ligado com "e" quando é só centena redonda ou menor que 100
  return partes.map((p, i) => i === 0 ? p.t : (i === partes.length - 1 && (p.v < 100 || p.v % 100 === 0) ? ' e ' : ', ') + p.t).join('');
}

export function reaisPorExtenso(v: number): string {
  const reais = Math.floor(v + 1e-9), cent = Math.round((v - reais) * 100);
  const r = reais ? `${numeroPorExtenso(reais)}${reais % 1e6 === 0 ? ' de' : ''} ${reais === 1 ? 'Real' : 'Reais'}` : '';
  const c = cent ? `${numeroPorExtenso(cent)} ${cent === 1 ? 'Centavo' : 'Centavos'}` : '';
  return [r, c].filter(Boolean).join(' e ') || 'Zero Reais';
}
