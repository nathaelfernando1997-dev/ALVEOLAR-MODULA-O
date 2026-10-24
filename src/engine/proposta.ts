// Propostas em Word a partir dos modelos da Alveolar (public/modelos): troca os campos {{...}} pelos valores
import JSZip from 'jszip';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function gerarProposta(modelo: 'proposta-paredes-lajes' | 'proposta-obra-cinza', campos: Record<string, string>): Promise<Blob> {
  const r = await fetch(`${import.meta.env.BASE_URL}modelos/${modelo}.docx`);
  if (!r.ok) throw new Error('Não encontrei o modelo da proposta.');
  const zip = await JSZip.loadAsync(await r.arrayBuffer());
  const doc = await zip.file('word/document.xml')!.async('string');
  const novo = doc.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, k: string) => k in campos ? xml(campos[k]) : m);
  zip.file('word/document.xml', novo);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
