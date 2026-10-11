import Replicate from 'replicate';
import sharp from 'sharp';
import { standardizeDisplayPhoto } from './display-photo-standard';

const BACKGROUND_REMOVAL_MODEL =
  'sprited/birefnet:21f2c4a9159af128ab9b9126401eebe7f8c5310841ed628b74a4c462df00da67' as const;

const MASK_ALPHA_FLOOR = 16;
const MASK_ASPECT_TOLERANCE = 0.01;
export const MIN_FRAME_BBOX_RATIO = 1.3;

type ProcessCatalogDisplayPhotoResult = {
  buffer: Buffer;
  aiDurationMs: number;
  totalDurationMs: number;
  visibleBoxRatio: number;
};

async function runReplicate(input: Record<string, unknown>): Promise<unknown> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN não configurado.');

  const replicate = new Replicate({ auth: token });
  return replicate.run(BACKGROUND_REMOVAL_MODEL, { input });
}

function resolveOutputUrl(output: unknown): string {
  if (typeof output === 'string') return output;

  if (Array.isArray(output)) {
    if (!output.length) throw new Error('Resposta vazia do BiRefNet.');
    return resolveOutputUrl(output[0]);
  }

  if (output && typeof output === 'object' && 'url' in output) {
    const urlMember = (output as { url: unknown }).url;
    const resolved = typeof urlMember === 'function'
      ? (urlMember as () => unknown)()
      : urlMember;

    if (typeof resolved === 'string') return resolved;
    if (resolved instanceof URL) return resolved.toString();
  }

  throw new Error('Formato de resposta do BiRefNet não reconhecido.');
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar a imagem (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function aspectDifference(a: number, b: number) {
  return Math.abs(a / b - 1);
}

export async function applyBackgroundMaskToOriginal(
  originalBuffer: Buffer,
  maskBuffer: Buffer
): Promise<{ buffer: Buffer; visibleBoxRatio: number }> {
  const originalMetadata = await sharp(originalBuffer).metadata();
  const orientation = originalMetadata.orientation ?? 1;

  if (orientation !== 1) {
    throw new Error(
      `A foto possui orientação EXIF ${orientation}. Normalize a orientação da imagem antes de processar.`
    );
  }

  const width = originalMetadata.width;
  const height = originalMetadata.height;
  if (!width || !height) {
    throw new Error('Não foi possível identificar as dimensões da foto original.');
  }

  const maskMetadata = await sharp(maskBuffer).metadata();
  const maskWidth = maskMetadata.width;
  const maskHeight = maskMetadata.height;
  if (!maskWidth || !maskHeight) {
    throw new Error('Não foi possível identificar as dimensões da máscara do BiRefNet.');
  }

  const originalRatio = width / height;
  const maskRatio = maskWidth / maskHeight;
  if (aspectDifference(maskRatio, originalRatio) > MASK_ASPECT_TOLERANCE) {
    throw new Error(
      'A máscara retornada pela IA tem proporção diferente da foto original (>1%). A foto não foi alterada.'
    );
  }

  const maskPipeline = sharp(maskBuffer)
    .removeAlpha()
    .greyscale();

  if (maskWidth !== width || maskHeight !== height) {
    maskPipeline.resize({
      width,
      height,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    });
  }

  const { data: alpha, info: alphaInfo } = await maskPipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (alphaInfo.channels !== 1 || alphaInfo.width !== width || alphaInfo.height !== height) {
    throw new Error('A máscara não pôde ser normalizada para as dimensões da foto original.');
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] < MASK_ALPHA_FLOOR) {
      alpha[index] = 0;
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('A remoção de fundo não encontrou uma armação visível.');
  }

  const visibleWidth = maxX - minX + 1;
  const visibleHeight = maxY - minY + 1;
  const visibleBoxRatio = visibleWidth / visibleHeight;

  if (visibleBoxRatio < MIN_FRAME_BBOX_RATIO) {
    throw new Error('a foto parece conter uma pessoa ou algo além da armação');
  }

  const originalRgb = await sharp(originalBuffer)
    .removeAlpha()
    .png()
    .toBuffer();

  const rgba = await sharp(originalRgb)
    .joinChannel(alpha, {
      raw: {
        width,
        height,
        channels: 1
      }
    })
    .png()
    .toBuffer();

  return { buffer: rgba, visibleBoxRatio };
}

/**
 * Processamento novo do botão "Processar com IA":
 * - exatamente UMA chamada de IA por foto;
 * - BiRefNet devolve somente a máscara;
 * - RGB vem exclusivamente da foto original;
 * - nenhum nano-banana/moondream é chamado aqui;
 * - a padronização final continua no display-photo-standard.ts sem alteração.
 */
export async function processCatalogDisplayPhoto(
  candidateUrl: string
): Promise<ProcessCatalogDisplayPhotoResult> {
  const totalStartedAt = Date.now();
  const aiStartedAt = Date.now();

  // O download da foto original e a chamada ao Replicate são aguardados no
  // mesmo Promise.all para que nenhuma rejeição fique sem tratamento.
  const [originalBuffer, maskOutput] = await Promise.all([
    fetchImageBuffer(candidateUrl),
    runReplicate({
      image: candidateUrl,
      variant: 'general-hr',
      resolution: 0,
      output_format: 'mask',
      mask_blur: 0,
      mask_offset: 0,
      refine_fg: false,
      precision: 'fp32'
    })
  ]);

  const aiDurationMs = Date.now() - aiStartedAt;
  const maskUrl = resolveOutputUrl(maskOutput);
  const maskBuffer = await fetchImageBuffer(maskUrl);

  const masked = await applyBackgroundMaskToOriginal(originalBuffer, maskBuffer);
  const buffer = await standardizeDisplayPhoto(masked.buffer);

  return {
    buffer,
    aiDurationMs,
    totalDurationMs: Date.now() - totalStartedAt,
    visibleBoxRatio: masked.visibleBoxRatio
  };
}
