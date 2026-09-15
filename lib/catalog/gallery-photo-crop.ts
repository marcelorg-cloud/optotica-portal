// Prompt de IA do catálogo de fotos — 3ª versão (15/09/2026, pedido do
// usuário depois de decidir tirar a recolorização de vez — ver
// estado-consolidado.md seção 0.67): "Processar com IA" deixa de pintar a
// armação (isso saiu de vez, ver lib/catalog/frame-colorize.ts, removido) e
// passa a fazer só limpeza/recorte/padronização de fotos que já mostram a
// cor certa (marcadas manualmente pelo master em "Todas as fotos do
// anúncio", ou a própria "Foto da cor"). Pedido explícito: (1) fundo branco
// de verdade (a versão anterior só tirava fundo/pessoa, sem garantir
// branco); (2) tamanho padrão fixo; (3) limpar adesivo/etiqueta do
// fornecedor colado na lente (comum vir com texto/logo por cima do vidro);
// (4) se a foto mostrar a armação em duas posições/ângulos diferentes,
// dividir em duas fotos de saída — aqui isso é uma escolha do MASTER no
// momento de processar (marca "esta foto tem 2 posições" antes de clicar
// "Processar com IA"), não uma detecção automática: pedir duas gerações
// (uma pra cada posição) em toda foto, sem saber de antemão se há duas
// posições de verdade, arriscava criar um "quase duplicado" toda vez (o
// modelo generativo não é determinístico, then duas chamadas da MESMA foto
// tendem a sair levemente diferentes mesmo quando só há uma posição) — pior
// que não ter a função. Com a marcação manual, as duas chamadas só
// acontecem quando o master já viu que há duas posições de verdade.
//
// O que a IA ainda faz (não determinístico, prompt-based): recortar isolando
// a armação, remover pessoa/fundo/embalagem, tentar já deixar fundo branco e
// limpar adesivo da lente. O que passou a ser feito em código, de forma
// determinística (função `standardizeDisplayImage` abaixo, via `sharp`, MESMO
// padrão já usado em frame-recolor.ts): garantir fundo 100% branco (flatten
// por cima do que a IA devolver) e o tamanho final padrão — não dá pra
// confiar só no prompt pra isso.
//
// IMPORTANTE — não testado nesta sessão (mesma ressalva já registrada nas
// versões anteriores deste arquivo e em frame-colorize.ts): sem acesso à
// rede de verdade pro Replicate por aqui, não dá pra confirmar como o
// modelo reage a este prompt na prática (principalmente a limpeza do
// adesivo na lente e a divisão em duas posições). Se o resultado sair
// diferente do esperado, me manda um exemplo (a foto usada + o resultado)
// que eu ajusto o texto do prompt.
import Replicate from 'replicate';
import sharp from 'sharp';

const MODEL = 'google/nano-banana';

// Tamanho final padrão de toda foto de exibição — quadrado, fundo branco,
// a armação ocupando a maior área possível sem cortar nada (`fit: 'contain'`).
const STANDARD_SIZE = 1024;

const CROP_PROMPT_BASE = `You will be given one photo of a pair of eyeglasses from an online product listing.
The photo may show the eyeglasses frame alone, being worn by a person, next to packaging or other items, from any angle, and may include background clutter.
Output a new image that is this photo cropped tightly around just the eyeglasses frame itself:
- Remove any person, face, hands, background, packaging or other objects.
- Fill the entire background with solid pure white (#FFFFFF), studio product-photo style.
- Center the frame and zoom in so it fills most of the image.
- If there is a sticker, label, or printed text stuck on top of a lens (common in supplier photos), remove it and restore that lens to look clear/transparent like the rest of the lens.
- Preserve the frame's true color, material, shine and pattern exactly as shown in the original photo — do not recolor, retouch, or otherwise change its appearance. Only clean and crop.`;

const CROP_PROMPT_SINGLE = `${CROP_PROMPT_BASE}
If the photo happens to show the frame in two different positions or angles, just pick the clearer one and crop only that.`;

const CROP_PROMPT_DUAL_FIRST = `${CROP_PROMPT_BASE}
This photo shows the eyeglasses frame in two clearly different positions or angles (for example, a front view and a side view laid out in the same photo). Crop and output only the FIRST one — the leftmost or topmost position. Ignore the second position entirely.`;

const CROP_PROMPT_DUAL_SECOND = `${CROP_PROMPT_BASE}
This photo shows the eyeglasses frame in two clearly different positions or angles (for example, a front view and a side view laid out in the same photo). Crop and output only the SECOND one — the rightmost or bottommost position, different from the first. Ignore the first position entirely.`;

async function runNanoBanana(imageUrl: string, prompt: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN não configurado.');
  const replicate = new Replicate({ auth: token });

  const output = await replicate.run(MODEL, {
    input: {
      prompt,
      image_input: [imageUrl]
    }
  });

  const aiUrl = resolveOutputUrl(output);
  const response = await fetch(aiUrl);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar o resultado da IA (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Garante determinístico (não depende da IA acertar) o que o prompt só pede
 * de forma aproximada: fundo 100% branco e um tamanho final padrão,
 * quadrado, sem cortar nada da armação (`fit: 'contain'`, sobra vira
 * padding branco). Mesmo padrão já usado em frame-recolor.ts (sharp pra
 * pós-processamento previsível por cima do resultado da IA generativa).
 */
async function standardizeDisplayImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(STANDARD_SIZE, STANDARD_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}

/**
 * Manda uma foto (geral do anúncio, já sabida como sendo desta cor — ver
 * migração 202609131400 — ou a própria "Foto da cor") pro nano-banana,
 * pedindo pra recortar/limpar/padronizar. `dual: true` quando o MASTER já
 * viu que esta foto mostra a armação em duas posições diferentes — nesse
 * caso devolve 2 imagens (uma chamada de IA por posição, nunca em
 * paralelo — ver nota de limite de 1 chamada por vez em frame-colorize.ts);
 * caso contrário devolve só 1.
 */
export async function cropGalleryPhoto(imageUrl: string, dual: boolean = false): Promise<Buffer[]> {
  if (!dual) {
    const raw = await runNanoBanana(imageUrl, CROP_PROMPT_SINGLE);
    return [await standardizeDisplayImage(raw)];
  }
  const first = await runNanoBanana(imageUrl, CROP_PROMPT_DUAL_FIRST);
  const second = await runNanoBanana(imageUrl, CROP_PROMPT_DUAL_SECOND);
  return [await standardizeDisplayImage(first), await standardizeDisplayImage(second)];
}

// Mesmo tratamento defensivo de formato de saída já usado em
// background-removal.ts, frame-mask.ts e (antes de ser removido)
// frame-colorize.ts (duplicado aqui de propósito, mesmo padrão já usado
// entre esses arquivos).
function resolveOutputUrl(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    if (!output.length) throw new Error('Resposta vazia do Replicate.');
    return resolveOutputUrl(output[0]);
  }
  if (output && typeof output === 'object' && 'url' in output) {
    const urlMember = (output as { url: unknown }).url;
    const resolved = typeof urlMember === 'function' ? (urlMember as () => unknown)() : urlMember;
    if (typeof resolved === 'string') return resolved;
    if (resolved instanceof URL) return resolved.toString();
  }
  throw new Error('Formato de resposta do Replicate não reconhecido.');
}
