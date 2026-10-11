import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { standardizeDisplayPhoto } from './display-photo-standard';

export const CATALOG_FIDELITY_POLICY = {
  version: '2026-10-11.1', methods: ['standardize'], generativeReconstruction: false,
  angleTransformation: false, automaticPublication: false, originalOverwrite: false,
  colorTolerance: null, colorToleranceState: 'requires_approved_reference_set',
  limitations: ['Não remove fundo complexo nesta operação.', 'Não inventa ângulos nem partes ocultas.',
    'Não certifica cor absoluta da fotografia.', 'Recorte, resize e JPEG alteram pixels; original fica preservado.'],
} as const;

export function catalogSourcePath(productId: string, value: unknown) {
  if (typeof value !== 'string' || !value.startsWith(`${productId}/`) || value.includes('..') || value.includes('\\') || /^https?:/i.test(value)) {
    throw new Error('Origem de catálogo inválida: use a foto original armazenada deste produto.');
  }
  return value;
}

export async function prepareFaithfulCatalogPhoto(original: Buffer) {
  if (!original.length || original.length > 20 * 1024 * 1024) throw new Error('A foto original deve ter entre 1 byte e 20 MB.');
  const sourceMeta = await sharp(original, { limitInputPixels: 40_000_000 }).metadata();
  if (!sourceMeta.width || !sourceMeta.height || !['png', 'jpeg', 'webp'].includes(sourceMeta.format || '')) throw new Error('Foto original inválida ou formato não suportado.');
  // No reference from another product/color and no generative angle alignment.
  const image = await standardizeDisplayPhoto(original);
  const decoded = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== 1040 || decoded.info.height !== 320 || image.length > 200 * 1024) throw new Error('O arquivo não atende ao contrato de entrega.');
  return { image, evidence: { complete: true, width: decoded.info.width, height: decoded.info.height,
    bytes: image.length, sha256: createHash('sha256').update(image).digest('hex'),
    originalSha256: createHash('sha256').update(original).digest('hex'), originalPreserved: true,
    method: 'deterministic_standardize', paidGenerationPerformed: false, published: false,
    fidelity: CATALOG_FIDELITY_POLICY, colorVerified: false, humanReviewRequired: true } };
}
