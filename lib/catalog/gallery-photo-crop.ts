// Prompt de IA do catálogo de fotos — 4ª versão (15/09/2026, 3ª rodada do
// dia — ver estado-consolidado.md seção 0.69): pedido do usuário mudou três
// coisas nesta rodada:
// (1) Tamanho/proporção final: passou de quadrado 1024×1024 pra 1040×320
//     (largura×altura) — a proporção real das fotos usadas no produto.
// (2) Formato final: passou de PNG pra JPG, com um teto de 200KB por foto
//     (arquivo final tem que caber nesse tamanho, senão fica pesado demais
//     pro que vai carregar essas fotos).
// (3) Divisão em múltiplas fotos quando há mais de um óculos na mesma foto:
//     ANTES (seção 0.67) isso era uma marcação manual do master antes de
//     clicar "Processar com IA" (checkbox "2 posições"), de propósito, pra
//     não arriscar a IA "inventar" uma segunda foto quase-idêntica numa foto
//     que só tinha uma posição (IA generativa não é determinística). Pedido
//     explícito do usuário nesta rodada: "quando a imagem tiver mais de um
//     óculos a IA deve separar em mais imagens" — SEM nenhuma marcação do
//     master, decisão 100% automática da IA. Perguntado antes de implementar
//     (AskUserQuestion) pra confirmar que era isso mesmo, não o checkbox já
//     existente só com a proporção nova — confirmado: automático.
//
// Para (3), como o `google/nano-banana` (modelo usado pra recortar/limpar) é
// só um modelo de EDIÇÃO de imagem — não devolve texto, então não dá pra
// pedir "quantos óculos tem nesta foto, responda com um número" pra ele —
// esta versão adiciona um PASSO NOVO antes do recorte: `detectFrameCount`,
// que chama um modelo de VQA (pergunta e resposta sobre imagem,
// `lucataco/moondream2`) só pra decidir 1 ou 2 chamadas de recorte. Se essa
// detecção falhar por qualquer motivo (rede, modelo indisponível, resposta
// que não dá pra interpretar), assume 1 — era o comportamento antes desta
// função existir, mais conservador que arriscar duplicar foto errado.
//
// IMPORTANTE — não testado nesta sessão (mesma ressalva de sempre neste
// projeto): sem acesso à rede de verdade pro Replicate por aqui, não dá pra
// confirmar como o `moondream2` se sai detectando "mais de um óculos" nem
// como o `nano-banana` se sai recortando pra caber bem numa proporção tão
// larga (1040×320 é bem mais "faixa" que quadrado). Se o resultado sair
// diferente do esperado (detecção errada, armação cortada, fundo não 100%
// branco, adesivo não sumir), me manda um exemplo (a foto usada + o
// resultado) que eu ajusto o prompt/modelo — mesmo processo de sempre.
import Replicate from 'replicate';
import sharp from 'sharp';

const CROP_MODEL = 'google/nano-banana';
// Modelo de VQA (Visual Question Answering — pergunta em texto sobre uma
// imagem, resposta em texto) só pra contar quantos óculos aparecem numa
// foto antes de decidir quantas vezes chamar o CROP_MODEL. Mais leve/rápido
// que usar o próprio nano-banana (que nem devolve texto) pra essa decisão.
const DETECT_MODEL = 'lucataco/moondream2';

// Tamanho final padrão de toda foto de exibição (15/09/2026, 3ª rodada —
// pedido do usuário: "1040x320 (larguraxaltura) é a proporção das fotos do
// produto"). `fit: 'contain'` centraliza a armação sem cortar nada, sobra
// vira padding branco (normalmente em cima/embaixo, já que a proporção é
// bem mais larga que alta).
const OUTPUT_WIDTH = 1040;
const OUTPUT_HEIGHT = 320;

// Teto de tamanho do arquivo final, em bytes (200KB — pedido do usuário).
// Como a qualidade do JPEG é o único jeito prático de controlar o tamanho
// final sem reduzir a resolução, tenta uma lista de qualidades decrescentes
// até caber no teto; se nem a menor qualidade testada couber (foto muito
// detalhada), usa o menor resultado mesmo assim — melhor entregar uma foto
// um pouco acima do teto do que travar o processamento inteiro por causa
// disso.
const MAX_JPEG_BYTES = 200 * 1024;
const JPEG_QUALITY_STEPS = [82, 72, 62, 52, 42, 32];

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

const DETECT_PROMPT = `Look at this product photo of eyeglasses. Count how many separate views of an eyeglasses frame are shown in the photo — if the same physical frame appears twice, in two different positions or angles laid out together in the same photo (for example a front view and a side view), count that as 2. If only one frame/view is shown, answer 1. Reply with ONLY a single digit: 1 or 2. If unsure, reply 1.`;

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

async function runNanoBanana(imageUrl: string, prompt: string): Promise<Buffer> {
  const output = await runReplicate(CROP_MODEL, { prompt, image_input: [imageUrl] });
  const aiUrl = resolveOutputUrl(output);
  const response = await fetch(aiUrl);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar o resultado da IA (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Decide, ANTES de recortar, se uma foto mostra um ou dois óculos (a mesma
 * armação em duas posições/ângulos, ou duas armações diferentes na mesma
 * foto) — pra saber se `cropGalleryPhoto` deve chamar o CROP_MODEL uma ou
 * duas vezes. Nunca lança erro pra fora: qualquer falha (rede, modelo
 * indisponível, resposta fora do esperado) vira `1` (assume uma posição só,
 * o comportamento mais conservador).
 */
async function detectFrameCount(imageUrl: string): Promise<1 | 2> {
  try {
    const output = await runReplicate(DETECT_MODEL, { image: imageUrl, question: DETECT_PROMPT });
    const text = Array.isArray(output) ? output.join('') : String(output ?? '');
    return text.includes('2') ? 2 : 1;
  } catch (err) {
    console.error('catalog_detect_frame_count_failed', { message: err instanceof Error ? err.message : String(err) });
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
 */
async function standardizeDisplayImage(buffer: Buffer): Promise<Buffer> {
  const pipeline = sharp(buffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'contain', background: { r: 255, g: 255, b: 255 } });

  let smallest: Buffer | null = null;
  for (const quality of JPEG_QUALITY_STEPS) {
    const out = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (!smallest || out.byteLength < smallest.byteLength) smallest = out;
    if (out.byteLength <= MAX_JPEG_BYTES) return out;
  }
  // Nem a menor qualidade testada coube no teto — devolve o menor resultado
  // conseguido mesmo assim (ver comentário de MAX_JPEG_BYTES acima).
  return smallest as Buffer;
}

/**
 * Manda uma foto (geral do anúncio, já sabida como sendo desta cor — ver
 * migração 202609131400 — ou a própria "Foto da cor") pro nano-banana,
 * pedindo pra recortar/limpar/padronizar. Detecta sozinha (via
 * `detectFrameCount`) se a foto mostra mais de um óculos; se sim, devolve 2
 * imagens (uma chamada de IA por posição, nunca em paralelo — mesma
 * limitação de conta já documentada em outras partes do projeto); caso
 * contrário devolve só 1. Sem nenhum parâmetro manual — decisão inteira da
 * IA (ver comentário no topo do arquivo).
 */
export async function cropGalleryPhoto(imageUrl: string): Promise<Buffer[]> {
  const frameCount = await detectFrameCount(imageUrl);
  if (frameCount === 1) {
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
