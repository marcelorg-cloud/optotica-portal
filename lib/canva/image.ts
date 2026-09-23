import sharp from 'sharp';
import { CanvaError, canvaUrl } from './security';

export async function downloadExport(url: string) {
  const response = await fetch(canvaUrl(url), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25000) });
  if (!response.ok || !response.body) throw new CanvaError('Não foi possível baixar a imagem do Canva.', 502);
  const max = 20 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > max) throw new CanvaError('Imagem maior que 20 MB.', 422);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new CanvaError('Imagem maior que 20 MB.', 422);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

// The try-on geometry uses the entire PNG width as the real frame width.
// Remove only empty alpha margins, then center the unchanged frame in a square.
export async function prepareTryonPng(input: Buffer) {
  const metadata = await sharp(input, { limitInputPixels: 16000000 }).metadata();
  if (metadata.format !== 'png' || !metadata.hasAlpha || (metadata.pages || 1) !== 1) {
    throw new CanvaError('Exporte uma única página em PNG com fundo transparente.', 422);
  }
  const { data, info } = await sharp(input, { limitInputPixels: 16000000 })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1, transparent = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * info.channels + info.channels - 1];
    if (alpha <= 4) { transparent++; continue; }
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left || transparent < info.width * info.height * 0.01) {
    throw new CanvaError('A imagem está vazia ou sem transparência. Remova o fundo e o interior das lentes no Canva.', 422);
  }
  const width = right - left + 1, height = bottom - top + 1;
  if (height > width) throw new CanvaError('Confira se a página contém somente a frente dos óculos, na horizontal.', 422);
  const targetHeight = Math.max(1, Math.round(height * 1080 / width));
  const padTop = Math.floor((1080 - targetHeight) / 2);
  return sharp(input, { limitInputPixels: 16000000 }).extract({ left, top, width, height })
    .resize(1080, targetHeight).extend({ left: 0, right: 0, top: padTop,
      bottom: 1080 - targetHeight - padTop, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}
