import sharp from 'sharp';

export const DISPLAY_VIEWS = ['front', 'side', 'three_quarter', 'detail'] as const;
export type DisplayView = typeof DISPLAY_VIEWS[number];
export type DisplayReference = { url: string; view: DisplayView; buffer: Buffer };

// Normalize canvas and scale without stretching the frame. References belong
// to one product and one view; they must never transfer color or texture.
async function cropWhitespace(input: Buffer) {
  const flat = await sharp(input).rotate().flatten({ background: '#ffffff' }).png().toBuffer();
  const { data, info } = await sharp(flat).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const corners = [0, (info.width - 1) * 3, (info.height - 1) * info.width * 3, (info.width * info.height - 1) * 3];
  const samples = corners.map((i) => [data[i], data[i + 1], data[i + 2]]);
  const neutral = samples.every((p) => Math.min(...p) >= 180 && Math.max(...p) - Math.min(...p) < 12);
  const uniform = samples.every((p) => p.every((v, channel) => Math.abs(v - samples[0][channel]) < 12));
  let result = flat;
  if (neutral && uniform) {
    const [r, g, b] = samples[0];
    result = await sharp(result).trim({ background: { r, g, b }, threshold: 10 }).png().toBuffer();
  }
  result = await sharp(result).trim({ background: '#ffffff', threshold: 10 }).png().toBuffer();
  const metadata = await sharp(result).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 8 || metadata.height < 8) throw new Error('Imagem sem armação identificável para padronizar.');
  return { buffer: result, width: metadata.width, height: metadata.height };
}

export async function standardizeDisplayPhoto(input: Buffer, reference?: Buffer): Promise<Buffer> {
  const photo = await cropWhitespace(input);
  const template = reference ? await cropWhitespace(reference) : photo;
  const ratio = photo.width / photo.height;
  const templateRatio = template.width / template.height;
  if (reference && Math.abs(ratio / templateRatio - 1) > 0.18) {
    throw new Error('O ângulo não corresponde bem à referência deste modelo. Revise a foto antes de padronizar.');
  }
  const targetWidth = Math.min(976, Math.floor(264 * templateRatio));
  const targetHeight = Math.round(targetWidth / ratio);
  if (targetHeight > 296) throw new Error('A foto precisa de um ângulo mais próximo da referência.');
  const frame = await sharp(photo.buffer).resize({ width: targetWidth }).png().toBuffer();
  const pipeline = sharp({ create: { width: 1040, height: 320, channels: 3, background: '#ffffff' } })
    .composite([{ input: frame, left: Math.floor((1040 - targetWidth) / 2), top: Math.floor((320 - targetHeight) / 2) }]);
  for (const quality of [90, 82, 72, 62, 52, 42, 32]) {
    const output = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (output.length <= 200 * 1024) return output;
  }
  throw new Error('Não foi possível manter a foto no limite de 200 KB.');
}
