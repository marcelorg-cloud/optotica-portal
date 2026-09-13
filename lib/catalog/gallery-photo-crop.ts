// Segundo prompt de IA do catálogo (13/09/2026, pedido do usuário depois de
// ver a seção 0.52 funcionando): "vao ser dois prompts diferente pra IA: 1
// para o catalogo de fotos e 2 para a foto de prova online... para o
// catalogo de fotos a IA tem que identificar a cor do óculos em questao,
// recortar a parte só da cor certa, gerar as sugestoes recortadas." A
// prova online (lib/catalog/frame-colorize.ts) fica INTOCADA nesta rodada —
// usuário pediu explicitamente pra ajustar aquele prompt depois, separado.
//
// Diferente da seção 0.52 (que só ESCOLHIA, sem alterar, a foto geral do
// anúncio mais parecida em cor — lib/catalog/color-swatch.ts), este prompt
// pede pra IA (mesmo modelo, google/nano-banana, já em uso na prova online)
// fazer o trabalho completo: olhar a foto geral do anúncio (que pode
// mostrar a armação em qualquer ângulo, com fundo, sendo usada por alguém,
// ou junto de embalagem) e a foto de referência desta cor, e devolver uma
// imagem NOVA — só a armação, recortada, sem fundo/pessoa/outros objetos —
// SE a cor bater; se não bater, devolve a foto original sem mudar nada (o
// código que chama isso sempre confere a cor do resultado antes de salvar —
// ver `MAX_MATCH_DISTANCE` em color-swatch.ts — então mesmo que a IA erre
// esse julgamento, o resultado errado é descartado antes de aparecer pro
// master).
//
// Importante sobre limite de chamadas: esta conta do Replicate só suporta
// UMA chamada de cada vez (achado em rodadas anteriores desta sessão,
// documentado em frame-colorize.ts — "risco de colisão de burst de 1"), por
// isso quem chama esta função (process/route.ts) faz uma foto de cada vez,
// nunca em paralelo, e para depois de um número pequeno de tentativas.
//
// IMPORTANTE — não testado nesta sessão (mesma ressalva já registrada em
// frame-colorize.ts): sem acesso à rede de verdade pro Replicate por aqui,
// não dá pra confirmar como o modelo reage a este prompt específico na
// prática (ele pode recortar demais, de menos, ou não seguir a instrução de
// "não mudar nada se a cor não bater"). Se o recorte sair ruim com
// frequência, me manda um exemplo (a foto geral usada + o resultado) que eu
// ajusto o texto do prompt.
import Replicate from 'replicate';

const MODEL = 'google/nano-banana';

const CROP_PROMPT = `You will be given two images related to a pair of eyeglasses.
Image 1 is a photo from an online product listing. It may show the eyeglasses frame alone, being worn by a person, next to packaging or other items, from any angle, and may include background clutter.
Image 2 is a reference photo showing one specific color of this same eyeglasses frame model.
First, check whether Image 1 shows this frame in the exact same color as Image 2 (same color, material and pattern — not just a similar style).
If it does: output a new image that is Image 1 cropped tightly around just the eyeglasses frame itself — remove any person, face, hands, background, packaging or other objects, centering and zooming in on the frame. Preserve the frame's true color, material, shine and pattern exactly as shown in Image 1 — do not recolor or alter it.
If it does NOT show the frame in that same color (a different color, or no eyeglasses frame clearly visible): output Image 1 completely unchanged, with no cropping at all.`;

/**
 * Manda a foto geral do anúncio (crua, pode ter fundo/pessoa/qualquer
 * ângulo) + a foto de referência desta cor pro nano-banana, pedindo pra
 * identificar se a cor bate e, se sim, recortar só a armação. Devolve o
 * PNG do resultado — quem chama decide se o resultado ficou bom o
 * suficiente pra salvar (comparando a cor do resultado com a referência,
 * ver lib/catalog/color-swatch.ts), já que a IA pode errar esse
 * julgamento.
 */
export async function cropGalleryPhotoForColor(galleryImageUrl: string, colorReferenceImageUrl: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN não configurado.');
  const replicate = new Replicate({ auth: token });

  const output = await replicate.run(MODEL, {
    input: {
      prompt: CROP_PROMPT,
      image_input: [galleryImageUrl, colorReferenceImageUrl]
    }
  });

  const aiUrl = resolveOutputUrl(output);
  const response = await fetch(aiUrl);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar o resultado da IA (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Mesmo tratamento defensivo de formato de saída já usado em
// background-removal.ts, frame-mask.ts e frame-colorize.ts (duplicado aqui
// de propósito, não importado de lá — mesmo padrão já usado entre esses
// arquivos, cada um cuidando da sua própria chamada ao Replicate).
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
