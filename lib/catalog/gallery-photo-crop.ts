// Prompt de IA do catálogo de fotos (13/09/2026 — 2ª versão, depois de um
// mockup do usuário mudar a abordagem): "vao ser dois prompts diferente pra
// IA: 1 para o catalogo de fotos e 2 para a foto de prova online... para o
// catalogo de fotos a IA tem que identificar a cor do óculos em questao,
// recortar a parte só da cor certa". Na 1ª versão (mesmo dia, antes deste
// mockup) a IA tinha DOIS trabalhos numa foto só: julgar se a cor batia E
// recortar. O mockup mudou isso: agora o MASTER marca manualmente, numa
// seção nova da tela, quais fotos gerais do anúncio pertencem a cada cor
// (tabela `catalog_product_gallery_image_colors`, migração
// 202609131400) — então quando esta função é chamada, a foto JÁ é sabida
// como sendo daquela cor. A IA passa a ter UM trabalho só: recortar a
// armação, sem mais julgar cor nenhuma — prompt mais simples e mais
// confiável (menos coisa pra IA decidir errado).
//
// A prova online (lib/catalog/frame-colorize.ts) continua com seu próprio
// prompt, intocada — usuário pediu pra ajustar aquele separadamente depois.
//
// Importante sobre limite de chamadas: esta conta do Replicate só suporta
// UMA chamada de cada vez (achado em rodadas anteriores desta sessão,
// documentado em frame-colorize.ts — "risco de colisão de burst de 1"), por
// isso quem chama esta função (process/route.ts) faz uma foto de cada vez,
// nunca em paralelo.
//
// IMPORTANTE — não testado nesta sessão (mesma ressalva já registrada em
// frame-colorize.ts): sem acesso à rede de verdade pro Replicate por aqui,
// não dá pra confirmar como o modelo reage a este prompt na prática. Se o
// recorte sair ruim (cortando parte da armação, ou deixando fundo/pessoa),
// me manda um exemplo (a foto usada + o resultado) que eu ajusto o texto.
import Replicate from 'replicate';

const MODEL = 'google/nano-banana';

const CROP_PROMPT = `You will be given one photo of a pair of eyeglasses from an online product listing.
The photo may show the eyeglasses frame alone, being worn by a person, next to packaging or other items, from any angle, and may include background clutter.
Output a new image that is this photo cropped tightly around just the eyeglasses frame itself — remove any person, face, hands, background, packaging or other objects, centering and zooming in on the frame.
Preserve the frame's true color, material, shine and pattern exactly as shown in the original photo — do not recolor, retouch or otherwise alter its appearance, only crop.`;

/**
 * Manda uma foto geral do anúncio (crua, pode ter fundo/pessoa/qualquer
 * ângulo) já sabida como sendo desta cor (marcada manualmente pelo master —
 * ver migração 202609131400) pro nano-banana, pedindo só pra recortar,
 * isolando a armação. Devolve o PNG do resultado.
 */
export async function cropGalleryPhoto(galleryImageUrl: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN não configurado.');
  const replicate = new Replicate({ auth: token });

  const output = await replicate.run(MODEL, {
    input: {
      prompt: CROP_PROMPT,
      image_input: [galleryImageUrl]
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
// de propósito, mesmo padrão já usado entre esses arquivos).
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
