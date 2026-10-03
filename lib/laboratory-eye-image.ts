import sharp from 'sharp';
import type { createAdminSupabaseClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

type EyeImageInput = {
  dnpPhotoPath: string | null;
  dnpOd: number | string | null;
  dnpOe: number | string | null;
  heightOd: number | string | null;
  heightOe: number | string | null;
};

type Point = { x: number; y: number };

function num(v: number | string | null) {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mm(v: number | string | null) {
  const n = num(v);
  return n === null ? '—' : `${String(Math.round(n * 10) / 10).replace('.', ',')} mm`;
}

function escapeXml(text: string) {
  return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] || c));
}

function centroid(points: Point[]): Point | null {
  if (!points.length) return null;
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length
  };
}

export async function buildLaboratoryEyeImage(admin: AdminClient, input: EyeImageInput): Promise<Buffer | null> {
  if (!input.dnpPhotoPath) return null;

  const { data, error } = await admin.storage.from('dnp-photos').download(input.dnpPhotoPath);
  if (error || !data) return null;

  const source = Buffer.from(await data.arrayBuffer());
  const normalized = sharp(source).rotate();
  const { data: raw, info } = await normalized.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height || channels < 3) return null;

  const cyan: Point[] = [];
  const green: Point[] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels;
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];
      // Marcadores gravados pelo DnpPhotoTool: ciano #22d3ee e verde #4ade80.
      // Os limiares toleram a compressão JPEG da foto salva.
      if (b > 150 && g > 135 && r < 105 && b > r + 65) cyan.push({ x, y });
      else if (g > 135 && r < 135 && b < 175 && g > r + 35) green.push({ x, y });
    }
  }

  const midX = width / 2;
  const leftPupil = centroid(cyan.filter((p) => p.x < midX));
  const rightPupil = centroid(cyan.filter((p) => p.x >= midX));
  const nasal = centroid(green);

  let centerY = height * 0.38;
  let cropLeft = 0;
  let cropWidth = width;

  if (leftPupil && rightPupil) {
    const eyeDistance = Math.max(1, rightPupil.x - leftPupil.x);
    centerY = (leftPupil.y + rightPupil.y) / 2;
    cropLeft = Math.max(0, Math.floor(leftPupil.x - eyeDistance * 0.42));
    const desiredRight = Math.min(width, Math.ceil(rightPupil.x + eyeDistance * 0.42));
    cropWidth = desiredRight - cropLeft;
  }

  // Relação 3:1 para ocupar pouco espaço na folha e manter somente a faixa dos olhos.
  let cropHeight = Math.round(cropWidth / 3);
  cropHeight = Math.min(cropHeight, height);
  let top = Math.round(centerY - cropHeight * 0.48);
  top = Math.max(0, Math.min(top, height - cropHeight));

  const outputWidth = 1500;
  const outputHeight = 500;
  const scaleX = outputWidth / cropWidth;
  const scaleY = outputHeight / cropHeight;

  const local = (p: Point | null) => p ? ({
    x: (p.x - cropLeft) * scaleX,
    y: (p.y - top) * scaleY
  }) : null;

  const lp = local(leftPupil);
  const rp = local(rightPupil);
  const np = local(nasal);
  const dnpOd = num(input.dnpOd);
  const dnpOe = num(input.dnpOe);
  const total = dnpOd !== null && dnpOe !== null ? dnpOd + dnpOe : null;

  const dnpOdText = `DNP OD  ${mm(input.dnpOd)}`;
  const dnpOeText = `DNP OE  ${mm(input.dnpOe)}`;
  const totalText = total === null ? 'DNP total  —' : `DNP total  ${mm(total)}`;
  const heightsText = `Altura OD  ${mm(input.heightOd)}   ·   Altura OE  ${mm(input.heightOe)}`;

  const lineSvg = lp && rp
    ? `<line x1="${lp.x}" y1="${lp.y}" x2="${rp.x}" y2="${rp.y}" stroke="white" stroke-width="4" opacity=".95"/>
       <circle cx="${lp.x}" cy="${lp.y}" r="13" fill="white" stroke="black" stroke-width="4"/>
       <circle cx="${rp.x}" cy="${rp.y}" r="13" fill="white" stroke="black" stroke-width="4"/>
       ${np ? `<circle cx="${np.x}" cy="${np.y}" r="11" fill="white" stroke="black" stroke-width="4"/>` : ''}`
    : '';

  const overlay = Buffer.from(`
    <svg width="${outputWidth}" height="${outputHeight}" xmlns="http://www.w3.org/2000/svg">
      ${lineSvg}
      <rect x="24" y="24" width="330" height="58" rx="8" fill="black" fill-opacity=".68"/>
      <text x="44" y="62" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="white">${escapeXml(dnpOdText)}</text>

      <rect x="573" y="24" width="354" height="58" rx="8" fill="black" fill-opacity=".68"/>
      <text x="603" y="62" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="white">${escapeXml(totalText)}</text>

      <rect x="1146" y="24" width="330" height="58" rx="8" fill="black" fill-opacity=".68"/>
      <text x="1166" y="62" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="white">${escapeXml(dnpOeText)}</text>

      <rect x="402" y="418" width="696" height="58" rx="8" fill="black" fill-opacity=".68"/>
      <text x="446" y="456" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="white">${escapeXml(heightsText)}</text>
    </svg>
  `);

  return normalized
    .extract({ left: cropLeft, top, width: cropWidth, height: cropHeight })
    .grayscale()
    .resize(outputWidth, outputHeight, { fit: 'fill' })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
