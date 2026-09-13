// "Processar com IA" — segunda etapa, além da remoção de fundo já existente
// em background-removal.ts (pedido do usuário, 13/09/2026): a partir de
// agora cada cor tem DUAS fotos de entrada — "posição" (o ângulo/pose que a
// prova online precisa) e "referência de cor" (só pra mostrar a cor real,
// pode ser de qualquer ângulo) — e o processamento precisa (1) trocar a cor
// da foto de posição pela cor da foto de referência, (2) recortar rente à
// armação (sem fundo, sem sobra) e (3) enquadrar num canvas quadrado com a
// frente indo de ponta a ponta — no padrão do PNG de exemplo que o usuário
// enviou (fundo transparente, só a frente, sem hastes).
//
// Por que "só a frente, sem hastes" normalmente não precisa de um passo à
// parte: numa foto de posição bem escolhida (de frente, reta — igual ao
// exemplo), as hastes ficam escondidas atrás da própria frente por
// perspectiva; elas só aparecem como uma sobra fina nas bordas em fotos um
// pouco de lado. O recorte rente à armação (bounding box do que sobrou depois
// da remoção de fundo) já resolve os dois casos: numa foto reta, não há
// haste visível pra recortar; numa foto um pouco de lado, a sobra fina é
// cortada junto com as bordas vazias. Não há remoção de haste "de verdade"
// (não é um modelo treinado pra reconhecer partes da armação) — é uma
// escolha de foto de entrada + recorte, mais simples e mais previsível do
// que tentar apagar hastes com IA generativa.
//
// A recoloração é uma técnica clássica de "hue replace preservando
// luminância": pra cada pixel visível da foto de posição, mede-se o quão
// claro/escuro ele é (a luminância) e se pinta esse mesmo brilho com a cor
// alvo — preserva reflexos e sombras da armação original, troca só a matiz.
// Funciona bem pra cores sólidas; pra cores de duas camadas/estampadas (ex.:
// tartaruga, onça) o resultado é uma aproximação (uma cor sólida média), não
// a estampa real — o passo de Validar/Rejeitar que já existe é o lugar pra
// pegar esses casos.

import sharp from 'sharp';

const ALPHA_THRESHOLD = 16; // pixel considerado "parte da armação" acima disso (0-255)

type RawRgba = { data: Buffer; width: number; height: number };

async function toRawRgba(pngBuffer: Buffer): Promise<RawRgba> {
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Cor média (R,G,B) dos pixels visíveis (alpha acima do limiar) de uma
 * imagem já sem fundo. Lança erro se a imagem não tiver nenhum pixel visível
 * (remoção de fundo pode ter apagado tudo, ex.: foto de entrada ruim).
 */
async function averageVisibleColor(pngBuffer: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data } = await toRawRgba(pngBuffer);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha > ALPHA_THRESHOLD) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }
  }
  if (count === 0) throw new Error('A foto de referência de cor ficou sem nenhum pixel visível depois de remover o fundo.');
  return { r: r / count, g: g / count, b: b / count };
}

/**
 * Troca a cor da imagem de posição (já sem fundo) pela cor alvo, preservando
 * a luminância original pixel a pixel (reflexos/sombras da armação continuam
 * visíveis, só a matiz muda).
 */
async function recolorPreservingLuminance(pngBuffer: Buffer, target: { r: number; g: number; b: number }): Promise<Buffer> {
  const { data, width, height } = await toRawRgba(pngBuffer);
  const out = Buffer.from(data); // cópia — não mexe no buffer original
  for (let i = 0; i < out.length; i += 4) {
    const alpha = out[i + 3];
    if (alpha <= ALPHA_THRESHOLD) continue; // deixa fundo transparente como está
    const luminance = (0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]) / 255;
    out[i] = Math.min(255, Math.round(target.r * luminance));
    out[i + 1] = Math.min(255, Math.round(target.g * luminance));
    out[i + 2] = Math.min(255, Math.round(target.b * luminance));
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Recorta rente ao conteúdo visível (bounding box dos pixels com alpha
 * acima do limiar) e depois preenche o lado mais curto com transparência até
 * virar um quadrado — a armação fica indo de ponta a ponta no lado mais
 * comprido, centralizada no lado mais curto, igual ao exemplo enviado pelo
 * usuário. Lança erro se não houver nenhum pixel visível.
 */
async function cropToSquareEdgeToEdge(pngBuffer: Buffer): Promise<Buffer> {
  const { data, width, height } = await toRawRgba(pngBuffer);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('A foto de posição ficou sem nenhum pixel visível depois de remover o fundo.');

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const cropped = sharp(pngBuffer).extract({ left: minX, top: minY, width: cropWidth, height: cropHeight });

  const side = Math.max(cropWidth, cropHeight);
  const extraWidth = side - cropWidth;
  const extraHeight = side - cropHeight;
  return cropped
    .extend({
      left: Math.floor(extraWidth / 2),
      right: Math.ceil(extraWidth / 2),
      top: Math.floor(extraHeight / 2),
      bottom: Math.ceil(extraHeight / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

/**
 * Junta os três passos: recolore a foto de posição (já sem fundo) com a cor
 * média da foto de referência (já sem fundo) e recorta pro formato quadrado
 * de ponta a ponta.
 */
export async function buildProcessedFrameImage(positionCutout: Buffer, colorReferenceCutout: Buffer): Promise<Buffer> {
  const target = await averageVisibleColor(colorReferenceCutout);
  const recolored = await recolorPreservingLuminance(positionCutout, target);
  return cropToSquareEdgeToEdge(recolored);
}
