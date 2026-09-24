import JSZip from 'jszip';
import sharp from 'sharp';
import { CanvaError } from './security';

export const SIZE = 540;
export const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';
export function photoFilename(sku: string, variant: number, width: number) {
  if (!sku || !Number.isInteger(variant) || variant < 1 || !Number.isFinite(width) || width <= 0 || width >= 1000) {
    throw new CanvaError('Salve o SKU, o número da cor e a Frente Total (mm) no produto.', 422);
  }
  const safeSku = sku.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${safeSku}-C${variant}-${String(width).padStart(3, '0')}mm.png`;
}
export async function inspectTemplate(input: Buffer) {
  if (input.length > 1024 * 1024) throw new CanvaError('A imagem modelo deve ter até 1 MB.', 422);
  const meta = await sharp(input, { limitInputPixels: SIZE * SIZE }).metadata();
  if (meta.format !== 'png' || meta.width !== SIZE || meta.height !== SIZE || (meta.pages || 1) !== 1) {
    throw new CanvaError('Envie uma imagem modelo PNG de 540 × 540 px.', 422);
  }
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0, visible = 0;
  for (let i = info.channels - 1; i < data.length; i += info.channels) {
    if (data[i] <= 4) clear++; else visible++;
  }
  return { hasTransparency: !!meta.hasAlpha && clear > SIZE * SIZE * 0.01 && visible > 0 };
}
function xml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
// Two independent image frames, not a flattened composite. The page background
// has no fill; Canva can export transparency after the reference photo is removed.
export async function colorPageDocument(template: Buffer, original: Buffer, filename: string) {
  if (!(await inspectTemplate(template)).hasTransparency) {
    throw new CanvaError('A imagem modelo cadastrada está sem transparência. Substitua por um PNG transparente.', 422);
  }
  const photo = await sharp(original, { limitInputPixels: 16000000 }).rotate().png().toBuffer();
  const meta = await sharp(photo).metadata();
  const scale = Math.min(184 / meta.width!, 80 / meta.height!);
  const w = meta.width! * scale, h = meta.height! * scale;
  const frame = (name: string, file: string, x: number, y: number, width: number, height: number) =>
    `<draw:frame draw:name="${xml(name)}" draw:style-name="image" svg:x="${x / 96}in" svg:y="${y / 96}in" svg:width="${width / 96}in" svg:height="${height / 96}in"><draw:image xlink:href="Pictures/${file}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
  const namespaces = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
  const zip = new JSZip();
  zip.file('mimetype', ODP_MIME, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODP_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Pictures/model.png" manifest:media-type="image/png"/><manifest:file-entry manifest:full-path="Pictures/color.png" manifest:media-type="image/png"/></manifest:manifest>`);
  zip.file('styles.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${namespaces} office:version="1.2"><office:styles/><office:automatic-styles><style:page-layout style:name="square"><style:page-layout-properties fo:page-width="5.625in" fo:page-height="5.625in" style:print-orientation="portrait" fo:margin="0in"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="square"/></office:master-styles></office:document-styles>`);
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${namespaces} office:version="1.2"><office:automatic-styles><style:style style:name="transparent" style:family="drawing-page"><style:drawing-page-properties draw:fill="none"/></style:style><style:style style:name="image" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/></style:style></office:automatic-styles><office:body><office:presentation><draw:page draw:name="${xml(filename)}" draw:style-name="transparent" draw:master-page-name="Default">${frame('Imagem modelo — substituir pela frente desta cor', 'model.png', 0, 0, SIZE, SIZE)}${frame('Referência da cor — remover antes de exportar', 'color.png', 516 - w, 42, w, h)}</draw:page></office:presentation></office:body></office:document-content>`);
  zip.file('Pictures/model.png', template);
  zip.file('Pictures/color.png', photo);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
