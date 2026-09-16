// "Foto de rosto para Prova Online" (15/09/2026) — Etapa 1 do atendimento
// vira a fonte principal da foto-base usada na prova virtual de óculos
// (substituindo, quando o profissional usa este card, o upload não
// processado que o próprio paciente podia fazer sozinho na área dele).
//
// O processamento tem três camadas: orientação EXIF física; classificação
// visual da rotação restante; e edição de enquadramento/fundo. O pós-processo
// usa crop real, nunca `contain`, para impedir barras laterais ou horizontais.
//
// Mesmo modelo (`google/nano-banana`) já usado no catálogo — aqui numa
// única imagem por chamada (não precisa de imagem de referência extra,
// diferente do recorte de armação por cor).
//
// IMPORTANTE — ainda não testado NESTA SESSÃO contra o Replicate de verdade
// (mesma ressalva de sempre neste projeto: sem acesso à rede real por
// aqui) depois do ajuste de 15/09/2026 (2ª rodada) acima. Se o novo
// resultado ainda vier com barras cinzas nas laterais (ou cortar demais o
// rosto/ombros), mandar um exemplo real pra afinar de novo — é só questão
// de afinar o texto do prompt.
import Replicate from 'replicate';
import sharp from 'sharp';

const FACE_MODEL = 'google/nano-banana';
const ORIENTATION_MODEL = 'lucataco/moondream2';

// Formato final: quadrado, tamanho generoso o bastante pra um rosto ficar
// nítido depois de composto com o óculos (a Prova Online já escala a
// armação em cima desta foto, ver lib/tryon/geometry.ts) — maior que as
// fotos de produto do catálogo (1040×320) porque aqui o "produto" é o
// rosto inteiro da pessoa, precisa de mais definição.
const OUTPUT_SIZE = 1024;

// Cor de fundo neutra pedida pelo usuário. Ela nunca é usada para encaixar a
// foto com barras: o resultado final usa recorte `cover` e preenche 100% do
// quadrado com a própria fotografia.
const NEUTRAL_GRAY = { r: 217, g: 217, b: 217 }; // #D9D9D9
const SOURCE_MAX_SIDE = 1600;

// Teto de tamanho do arquivo final (maior que o das fotos de produto do
// catálogo — 200KB — porque um rosto tem muito mais detalhe/textura de
// pele, que precisa de mais qualidade de JPEG pra não ficar com blocagem
// visível). Mesma estratégia de qualidades decrescentes até caber.
const MAX_JPEG_BYTES = 400 * 1024;
const JPEG_QUALITY_STEPS = [88, 78, 68, 58, 48, 38];

const FACE_PROMPT = `This is a photo of a patient's face, meant to serve as the base image for a virtual eyeglasses try-on (a pair of eyeglasses will be composited on top of it afterward). Adjust the photo following exactly these rules, without changing the person's identity or real facial features:
1. The person MUST be naturally UPRIGHT: forehead and hair at the top, chin at the bottom, and the line between the eyes approximately horizontal. Never return a sideways, tilted 90-degree, or upside-down face.
2. Make a TIGHT, centered FACE portrait, approximately from the hairline/forehead to just below the chin. Keep the whole face visible and leave only a small safe margin around the hair, ears, and chin. Do not frame the torso and do not leave large empty areas around the head.
3. Output an EXACT 1:1 SQUARE photograph. Obtain the square by ZOOMING AND CROPPING the original framing, especially removing excess area above and below a tall rectangular photo. The photograph itself must fill all four edges. NEVER add gray/white/black bars, padding, letterboxing, pillarboxing, borders, or a smaller rectangular image inside a square canvas.
4. Replace the background completely with a solid, neutral, uniform gray (no texture, no gradient, no shadow on the background) — approximate color #D9D9D9.
5. Equalize the lighting on the face so it looks like even, soft, frontal lighting, without blowing out highlights or changing the person's real skin tone.
6. Do NOT change facial features, expression, any eyewear the person is already wearing, hairstyle, or any other identity detail — only adjust orientation, background, framing, and lighting.
7. The result must still look like a realistic photograph — never a drawing, painting, or illustration.`;

const ORIENTATION_PROMPT = `Look only at the main human face. Which clockwise rotation is required to make the person naturally upright, with the forehead above the eyes, the chin below the mouth, and the eye line horizontal? Reply with exactly one number and nothing else: 0, 90, 180, or 270.`;

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar a imagem (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Duplicado de propósito (mesmo padrão já usado em gallery-photo-crop.ts,
// frame-mask.ts etc. — cada arquivo de processamento de imagem deste
// projeto tem sua própria cópia pequena destes 2 helpers, em vez de criar
// um módulo compartilhado só pra isso).
async function runReplicate(model: `${string}/${string}`, input: Record<string, unknown>): Promise<unknown> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN não configurado.');
  const replicate = new Replicate({ auth: token });
  return replicate.run(model, { input });
}

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

function outputText(output: unknown): string {
  return (Array.isArray(output) ? output.join('') : String(output ?? '')).trim();
}

export function parseFaceRotation(output: unknown): 0 | 90 | 180 | 270 {
  const matches = outputText(output).match(/(?<!\d)(?:0|90|180|270)(?!\d)/g) || [];
  const unique = Array.from(new Set(matches));
  return unique.length === 1 ? Number(unique[0]) as 0 | 90 | 180 | 270 : 0;
}

/** Physically applies EXIF orientation before any AI sees the image. */
export async function normalizeUploadedFacePhoto(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({
      width: SOURCE_MAX_SIDE,
      height: SOURCE_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true
    })
    .flatten({ background: NEUTRAL_GRAY })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function detectRequiredRotation(buffer: Buffer): Promise<0 | 90 | 180 | 270> {
  try {
    const image = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    const output = await runReplicate(ORIENTATION_MODEL, { image, question: ORIENTATION_PROMPT });
    return parseFaceRotation(output);
  } catch (error) {
    // EXIF auto-orientation above already covers the common phone-camera
    // case. If the visual classifier is temporarily unavailable, the editor
    // can still try with that normalized source instead of losing the upload.
    console.error('face_photo_orientation_detection_failed', {
      message: error instanceof Error ? error.message : String(error)
    });
    return 0;
  }
}

async function prepareSourceForAi(sourceUrl: string): Promise<string> {
  const original = await fetchImageBuffer(sourceUrl);
  const autoOriented = await normalizeUploadedFacePhoto(original);
  const requiredRotation = await detectRequiredRotation(autoOriented);
  const upright = requiredRotation === 0
    ? autoOriented
    : await sharp(autoOriented).rotate(requiredRotation).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${upright.toString('base64')}`;
}

/**
 * Garante deterministicamente o quadrado sem barras. Primeiro remove bordas
 * uniformes que o modelo eventualmente tenha deixado e depois usa `cover`,
 * que recorta a sobra da fotografia em vez de completar o canvas com cinza.
 */
export async function standardizeFacePhoto(buffer: Buffer): Promise<Buffer> {
  const oriented = await sharp(buffer)
    .rotate()
    .flatten({ background: NEUTRAL_GRAY })
    .toBuffer();

  let withoutUniformBorder = oriented;
  try {
    const trimmed = await sharp(oriented)
      .trim({ background: NEUTRAL_GRAY, threshold: 20 })
      .toBuffer({ resolveWithObject: true });
    if (trimmed.info.width >= 80 && trimmed.info.height >= 80) withoutUniformBorder = trimmed.data;
  } catch {
    // A crop final ainda é seguro mesmo quando a imagem não tem uma borda
    // uniforme reconhecível.
  }

  const pipeline = sharp(withoutUniformBorder)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'attention' });

  let smallest: Buffer | null = null;
  for (const quality of JPEG_QUALITY_STEPS) {
    const out = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (!smallest || out.byteLength < smallest.byteLength) smallest = out;
    if (out.byteLength <= MAX_JPEG_BYTES) return out;
  }
  return smallest as Buffer;
}

/**
 * Processa a foto de rosto crua (URL assinada da foto recém-enviada) pra
 * virar a base padronizada de prova online: quadrada, fundo cinza neutro,
 * iluminação equalizada. Lança erro (sem tratamento especial) se o
 * Replicate falhar — a rota que chama isto decide a mensagem pro usuário.
 */
export async function processFacePhoto(sourceUrl: string): Promise<Buffer> {
  const uprightSource = await prepareSourceForAi(sourceUrl);
  const output = await runReplicate(FACE_MODEL, { prompt: FACE_PROMPT, image_input: [uprightSource] });
  const aiUrl = resolveOutputUrl(output);
  const raw = await fetchImageBuffer(aiUrl);
  return standardizeFacePhoto(raw);
}
