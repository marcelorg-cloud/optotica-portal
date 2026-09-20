// Prompt de IA do catálogo de fotos — 6ª versão (15/09/2026, 5ª rodada do
// dia — ver estado-consolidado.md seção 0.73): usuário mandou 2 prints reais
// de um resultado processado onde a armação saiu pequena, com margem branca
// enorme dos dois lados, e pediu pra IA deixar a foto maior (margem pequena
// nas laterais). Corrigido com `sharp().trim()` em `standardizeDisplayImage`
// (recorta a sobra de fundo branco antes de encaixar no tamanho fixo, não
// depende só da IA obedecer o prompt) — ver comentário dessa função.
//
// Histórico anterior (5ª versão): pedido do usuário, depois de
// várias rodadas revisando o texto do prompt em português antes de colocar
// no sistema (ver spec-ajustes-fotos-cor.md e a conversa registrada):
//
// (1) A IA agora recebe DUAS imagens em toda chamada: a foto candidata
//     (de "Todas as fotos do anúncio", ou a própria "Foto da cor") e a
//     "Foto da cor" da cor sendo processada, como REFERÊNCIA visual da
//     cor/estampa certa — em vez de tentar descrever a cor em texto (que
//     não funciona bem pra estampas). A referência nunca aparece no
//     resultado, só serve pra identificar qual armação/posição da foto
//     candidata tem a cor certa.
// (2) Se a foto candidata mostrar mais de uma cor de armação, a IA
//     descarta as que não batem com a referência e recorta só a que bate.
// (3) Se a cor certa aparecer em mais de uma posição/ângulo na mesma foto,
//     gera um resultado pra cada posição (mesmo mecanismo de "2 posições"
//     de rodadas anteriores, agora amarrado à cor certa em vez de "duas
//     posições de qualquer cor").
// (4) Reforçado: não mudar cor, material, brilho, padrão, PROPORÇÃO nem
//     formato/desenho do óculos — só recortar/limpar.
//
// Arquitetura pra (1)-(3): o `google/nano-banana` (edição de imagem) já
// aceita várias imagens numa chamada (`image_input: [...]`), então as duas
// fotos (candidata + referência) vão juntas em cada chamada de recorte. Já
// o `lucataco/moondream2` (só pergunta-e-resposta sobre imagem, usado pra
// CONTAR quantas vezes a cor certa aparece antes de decidir 1 ou 2 recortes)
// é tipicamente um modelo de UMA imagem só — não dá pra confiar que ele
// aceite duas imagens numa pergunta só, e não dá pra testar isso contra o
// Replicate de verdade nesta sessão. Pra não depender dessa capacidade
// incerta, `buildComparisonImage()` MONTA (por código, via `sharp`, nada de
// IA nesse passo) uma única imagem com a referência à esquerda e a foto
// candidata à direita, e o prompt de detecção explica esse layout — assim a
// detecção funciona com qualquer modelo de UMA imagem.
//
// IMPORTANTE — não testado nesta sessão (mesma ressalva de sempre neste
// projeto): sem acesso à rede de verdade pro Replicate por aqui, não dá pra
// confirmar como os dois modelos se saem na prática com esta versão do
// prompt (principalmente: o nano-banana usando a segunda imagem só como
// referência sem "vazar" ela pro resultado, e o moondream2 lendo a imagem
// composta corretamente). Se o resultado sair diferente do esperado, me
// manda um exemplo (a foto usada + a foto da cor + o resultado) que eu
// ajusto o prompt.
import Replicate from 'replicate';
import sharp from 'sharp';
import { DISPLAY_VIEWS, standardizeDisplayPhoto, type DisplayReference, type DisplayView } from './display-photo-standard';

const CROP_MODEL = 'google/nano-banana';
// Modelo de VQA (Visual Question Answering — pergunta em texto sobre uma
// imagem, resposta em texto) só pra contar quantas vezes a cor de
// referência aparece na foto candidata, antes de decidir quantas vezes
// chamar o CROP_MODEL. Mais leve/rápido que usar o próprio nano-banana (que
// nem devolve texto) pra essa decisão.
const DETECT_MODEL = 'lucataco/moondream2';

// Tamanho final padrão de toda foto de exibição (15/09/2026, 3ª rodada —
// pedido do usuário: "1040x320 (larguraxaltura) é a proporção das fotos do
// produto"). `fit: 'contain'` centraliza a armação sem cortar nada, sobra
// vira padding branco (normalmente em cima/embaixo, já que a proporção é
// bem mais larga que alta).


// Teto de tamanho do arquivo final, em bytes (200KB — pedido do usuário).
// Como a qualidade do JPEG é o único jeito prático de controlar o tamanho
// final sem reduzir a resolução, tenta uma lista de qualidades decrescentes
// até caber no teto; se nem a menor qualidade testada couber (foto muito
// detalhada), usa o menor resultado mesmo assim — melhor entregar uma foto
// um pouco acima do teto do que travar o processamento inteiro por causa
// disso.


// Altura de cada metade da imagem composta usada só pra detecção (não é o
// resultado final — isso nunca é salvo nem mostrado, é só o que o modelo de
// detecção enxerga). Não precisa ser grande, só legível o suficiente pra
// comparar cor/estampa.
const COMPARISON_HEIGHT = 480;

const CROP_PROMPT_BASE = `You will be given TWO images.
The FIRST image is a candidate product-listing photo that needs to be cropped.
The SECOND image is a reference photo showing the exact correct color/pattern of the eyeglasses frame — use it ONLY to visually identify which frame (or which position) in the first image has the correct color/pattern. Do not copy from, blend with, or base the crop on the second image in any other way — it is only a color reference and must NEVER appear in the output.

The first image may show the frame alone, being worn by a person, next to packaging or other items, from any angle, may include background clutter, and may show the correct color/pattern together with other, different-colored frames in the same photo.

Output a new image that is the first photo cropped, following these rules:
- Do not change the frame's color, material, shine, pattern, proportions, or shape/design — keep it exactly faithful to how it looks in the first photo. Only crop and clean; never redraw, resize/distort, retouch, or repaint the frame's appearance.
- Remove any person, face, hands, background, packaging or other objects completely.
- Fill the entire background with solid pure white (#FFFFFF), studio product-photo style. Remove ALL gray borders, gradient panels, cast shadows and decorative frames. Keep the complete eyeglasses visible and centered with a consistent small safety margin. Keep front views straight and symmetric; preserve lateral and oblique views as their own views, never combine different angles.
- The frame should occupy as much of the final image as possible — crop in tightly, leaving only a thin margin (a few percent of the image size) between the frame and the top/left/right edges. Do not leave large empty white areas around the frame. Do not let the frame touch the edges, but err on the side of cropping too tight rather than leaving extra empty space.
- The final image must have the fixed wide, short rectangular proportion already defined (1040×320 pixels — much wider than tall).
- If there is a sticker, label, or printed text stuck on top of a lens (common in supplier photos), remove it and restore that lens to look clear/transparent like the rest of the lens.
- If the first image shows more than one frame color, use the second image (reference) to identify which one matches the correct color/pattern, and use ONLY that one — completely ignore and discard any frame with a different color/pattern.`;

const CROP_PROMPT_SINGLE = `${CROP_PROMPT_BASE}
If the correct-colored frame happens to appear in two different positions or angles in the first photo, just pick the clearer one and crop only that.`;

const CROP_PROMPT_FIRST_OF_TWO = `${CROP_PROMPT_BASE}
The correct-colored frame (matching the reference) appears in the first photo in two clearly different positions or angles (for example, a front view and a side view laid out in the same photo). Crop and output only the FIRST one — the leftmost or topmost matching position. Ignore the second matching position entirely.`;

const CROP_PROMPT_SECOND_OF_TWO = `${CROP_PROMPT_BASE}
The correct-colored frame (matching the reference) appears in the first photo in two clearly different positions or angles (for example, a front view and a side view laid out in the same photo). Crop and output only the SECOND one — the rightmost or bottommost matching position, different from the first. Ignore the first matching position entirely.`;

const DETECT_PROMPT = `This is a single composite image made of two photos placed side by side, separated by a thin gap.
The LEFT photo is a REFERENCE showing the correct color/pattern of an eyeglasses frame.
The RIGHT photo is a product photo that may show one or more eyeglasses frames, possibly in different colors/patterns and/or in different positions or angles.
Count how many times a frame with the SAME color/pattern as the LEFT reference photo appears in the RIGHT photo. If that same color/pattern appears twice, in two different positions or angles, count each occurrence separately. Completely ignore any frame in the RIGHT photo whose color/pattern is clearly different from the LEFT reference — do not count those.
Reply with ONLY a single digit:
0 = no frame in the right photo matches the reference color/pattern
1 = it appears exactly once
2 = it appears twice (or more — reply 2 for two or more)
If unsure, reply 1.`;

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar a imagem (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Monta, por código (sem IA), uma única imagem com a foto de referência
 * (Foto da cor) à esquerda e a foto candidata à direita, devolvida como
 * data URI base64 — o Replicate aceita imagem embutida assim, sem precisar
 * hospedar em lugar nenhum. Usada só pra alimentar `detectMatchingFrameCount`
 * (nunca é salva nem vira parte do resultado final). Ver comentário no topo
 * do arquivo sobre por que isso existe em vez de mandar duas imagens
 * separadas pro modelo de detecção.
 */
async function buildComparisonImage(referenceUrl: string, candidateUrl: string): Promise<string> {
  const [referenceBuf, candidateBuf] = await Promise.all([
    fetchImageBuffer(referenceUrl),
    fetchImageBuffer(candidateUrl)
  ]);

  const [referenceResized, candidateResized] = await Promise.all([
    sharp(referenceBuf).resize({ height: COMPARISON_HEIGHT, withoutEnlargement: false }).toBuffer(),
    sharp(candidateBuf).resize({ height: COMPARISON_HEIGHT, withoutEnlargement: false }).toBuffer()
  ]);
  const [referenceMeta, candidateMeta] = await Promise.all([
    sharp(referenceResized).metadata(),
    sharp(candidateResized).metadata()
  ]);
  const referenceWidth = referenceMeta.width || COMPARISON_HEIGHT;
  const candidateWidth = candidateMeta.width || COMPARISON_HEIGHT;
  const gap = 24;

  const composite = await sharp({
    create: {
      width: referenceWidth + gap + candidateWidth,
      height: COMPARISON_HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite([
      { input: referenceResized, left: 0, top: 0 },
      { input: candidateResized, left: referenceWidth + gap, top: 0 }
    ])
    .jpeg({ quality: 85 })
    .toBuffer();

  return `data:image/jpeg;base64,${composite.toString('base64')}`;
}

// `replicate.run` só aceita o formato "owner/modelo" tipado como template
// literal (não `string` genérico) — daí o tipo explícito aqui, em vez de só
// `string`, pra `CROP_MODEL`/`DETECT_MODEL` (const strings literais) baterem
// certo quando passadas por este helper compartilhado.
async function runReplicate(model: `${string}/${string}`, input: Record<string, unknown>): Promise<unknown> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN não configurado.');
  const replicate = new Replicate({ auth: token });
  return replicate.run(model, { input });
}

async function runNanoBanana(candidateUrl: string, referenceUrl: string, prompt: string): Promise<Buffer> {
  // Ordem [candidata, referência] combina com o prompt ("FIRST image" /
  // "SECOND image" acima).
  const output = await runReplicate(CROP_MODEL, { prompt, image_input: [candidateUrl, referenceUrl] });
  const aiUrl = resolveOutputUrl(output);
  const response = await fetch(aiUrl);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar o resultado da IA (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Decide, ANTES de recortar, quantas vezes a cor/estampa de referência
 * aparece na foto candidata (0, 1 ou 2) — pra saber se `cropGalleryPhoto`
 * deve pular a foto (0), chamar o CROP_MODEL uma vez (1) ou duas vezes (2).
 * Nunca lança erro pra fora: qualquer falha (rede, modelo indisponível,
 * resposta fora do esperado) vira `1` — mais conservador que arriscar
 * pular uma foto que já foi manualmente marcada como sendo desta cor, ou
 * arriscar duplicar.
 */
async function detectMatchingFrameCount(referenceUrl: string, candidateUrl: string): Promise<0 | 1 | 2> {
  try {
    const comparisonImage = await buildComparisonImage(referenceUrl, candidateUrl);
    const output = await runReplicate(DETECT_MODEL, { image: comparisonImage, question: DETECT_PROMPT });
    const text = Array.isArray(output) ? output.join('') : String(output ?? '');
    const match = text.match(/[012]/);
    if (!match) return 1;
    return Number(match[0]) as 0 | 1 | 2;
  } catch (err) {
    console.error('catalog_detect_matching_frame_count_failed', { message: err instanceof Error ? err.message : String(err) });
    return 1;
  }
}

/**
 * Garante determinístico (não depende da IA acertar) o que o prompt só pede
 * de forma aproximada: fundo 100% branco e o tamanho/proporção final fixos.
 * Mesmo padrão já usado antes em frame-recolor.ts (sharp pra
 * pós-processamento previsível por cima do resultado da IA generativa).
 * Devolve sempre JPEG, tentando qualidades decrescentes até caber no teto
 * de `MAX_JPEG_BYTES`.
 *
 * Correção (15/09/2026 — usuário reportou com print real: "a foto processada
 * por IA ficou com a imagem do óculos muito pequena... seria bom que a IA
 * deixasse a foto maior, com uma pequena margem aos lados"): o problema não
 * era só o texto do prompt pedindo "margem pequena" — o passo determinístico
 * de encaixar no tamanho fixo (1040×320, `fit: 'contain'`) preserva qualquer
 * sobra de fundo branco que a IA deixou ao redor da armação, então mesmo uma
 * margem "pequena" da IA virava uma faixa branca enorme dos dois lados ao
 * encaixar numa proporção bem mais larga (3.25:1) do que a foto recortada
 * pela IA costuma sair. Corrigido com `sharp().trim()` ANTES do resize —
 * corta automaticamente toda a borda branca ao redor da armação (não importa
 * quanto a IA deixou), garantindo a armação sempre do tamanho máximo possível
 * dentro do retângulo final — não depende mais só da IA "obedecer" o prompt.
 */
export async function classifyDisplayView(buffer: Buffer): Promise<DisplayView | null> {
  const image = await sharp(buffer).resize({ width: 640, withoutEnlargement: true }).jpeg().toBuffer();
  const output = await runReplicate(DETECT_MODEL, { image: `data:image/jpeg;base64,${image.toString('base64')}`, question: 'Classify this eyeglasses product photo. Reply with exactly one label: front (straight frontal symmetric view), side (strict lateral/profile), three_quarter (oblique perspective), detail (closeup), unknown (multiple frames, unclear or other angle). Do not guess front for an oblique view.' });
  const text = (Array.isArray(output) ? output.join('') : String(output ?? '')).trim().toLowerCase();
  return DISPLAY_VIEWS.find((view) => text === view) || null;
}

async function finishDisplayPhoto(raw: Buffer, references: DisplayReference[]): Promise<Buffer> {
  if (!references.length) return standardizeDisplayPhoto(raw);
  const view = await classifyDisplayView(raw);
  const reference = references.find((item) => item.view === view);
  if (!reference) return standardizeDisplayPhoto(raw);
  // The generated photo is the sole source of product identity. The layout
  // reference may have another color and must never recolor the result.
  const sourcePng = await sharp(raw).png().toBuffer();
  const source = `data:image/png;base64,${sourcePng.toString('base64')}`;
  const aligned = await runNanoBanana(source, reference.url, `The FIRST image is the product to preserve exactly. The SECOND is a layout reference of the SAME MODEL in the SAME ${view} view, possibly a DIFFERENT COLOR. Match only its framing, camera angle, centering and relative size. Never transfer its color, pattern, material, logos or texture. Do not invent hidden parts, distort proportions or mirror asymmetric details. Keep one complete frame, remove gray borders, shadows and external objects, use a solid pure white #FFFFFF background. Preserve transparent and light-colored frame edges. Output a clean product photo in a 1040x320 canvas.`);
  return standardizeDisplayPhoto(aligned, reference.buffer);
}

/**
 * Manda uma foto candidata (geral do anúncio, já sabida como marcada pra
 * esta cor — ver migração 202609131400 — ou a própria "Foto da cor") pro
 * nano-banana, junto com a "Foto da cor" desta cor como REFERÊNCIA visual,
 * pedindo pra identificar a cor certa (se a foto tiver mais de uma),
 * recortar/limpar/padronizar. Detecta sozinha (via `detectMatchingFrameCount`)
 * quantas vezes a cor certa aparece na foto candidata:
 * - 0 vezes: devolve lista vazia (esta foto não tem a cor certa — não gera
 *   nenhum resultado, mesmo já estando marcada pra esta cor).
 * - 1 vez: devolve 1 imagem.
 * - 2 vezes: devolve 2 imagens (uma chamada de IA por posição, nunca em
 *   paralelo — mesma limitação de conta já documentada em outras partes do
 *   projeto).
 * Sem nenhum parâmetro manual — decisão inteira da IA (ver comentário no
 * topo do arquivo).
 */
export async function cropGalleryPhoto(candidateUrl: string, referenceUrl: string, references: DisplayReference[] = []): Promise<Buffer[]> {
  const matchCount = await detectMatchingFrameCount(referenceUrl, candidateUrl);
  if (matchCount === 0) return [];
  if (matchCount === 1) {
    const raw = await runNanoBanana(candidateUrl, referenceUrl, CROP_PROMPT_SINGLE);
    return [await finishDisplayPhoto(raw, references)];
  }
  const first = await runNanoBanana(candidateUrl, referenceUrl, CROP_PROMPT_FIRST_OF_TWO);
  const second = await runNanoBanana(candidateUrl, referenceUrl, CROP_PROMPT_SECOND_OF_TWO);
  return [await finishDisplayPhoto(first, references), await finishDisplayPhoto(second, references)];
}

export async function normalizeExistingDisplay(candidateUrl: string, references: DisplayReference[], instruction = ''): Promise<Buffer> {
  const prompt = instruction.trim()
    ? `${CROP_PROMPT_SINGLE}\n\nAdditional editing request from the catalog administrator:\n${instruction.trim()}\nApply this request while preserving the actual frame geometry, color, material and details. Remove a requested background by replacing it with clean white, matching the catalog canvas. Do not add text, borders or other objects.`
    : CROP_PROMPT_SINGLE;
  const raw = await runNanoBanana(candidateUrl, candidateUrl, prompt);
  return finishDisplayPhoto(raw, references);
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
