// Combinação automática de "foto geral do anúncio X cor" (pedido do usuário,
// 13/09/2026: "ao clicar em processar com IA deve acrescentar até mais 3
// fotos da mesma cor do produto na mesma cor"). Escolhido de propósito para
// NÃO depender de mais um modelo de IA generativa/classificação no
// Replicate: o usuário já tinha sugerido antes, numa conversa parecida
// ("como é só uma alteração de cor, poderia ser outra ferramenta?"), que uma
// tarefa que é só "achar a cor" não precisa de IA generativa — aqui vai um
// passo além, comparando cor de forma determinística (sem chamada de rede
// nenhuma além de baixar as próprias fotos), o que também evita o risco (já
// visto nesta sessão, seções 0.40/0.41) de um modelo do Replicate sem versão
// fixa devolver 404.
//
// Ideia: extrair uma "amostra de cor" (RGB médio da região central da foto,
// ignorando pixels quase brancos — fundo típico de anúncio) tanto da foto de
// referência já enviada pra essa cor (`original_image_path`) quanto de cada
// foto geral do anúncio (`catalog_product_gallery_images`), e comparar a
// distância entre elas. As fotos gerais mais parecidas em cor with a
// referência desta cor viram sugestão de foto de exibição extra.
//
// Isso é só uma SUGESTÃO — o master vê o resultado na tela do produto e pode
// remover qualquer foto que tenha vindo errada (mesmo cuidado já registrado
// na migração da galeria geral: "aplicar uma foto errada de cor sem o master
// ver antes seria pior do que manter a foto atual").
import sharp from 'sharp';

export type Swatch = { r: number; g: number; b: number };

const NEAR_WHITE_THRESHOLD = 235; // pixels com R,G,B todos acima disso são tratados como fundo do anúncio, não a armação.
// Fundos pretos de estúdio às vezes SÃO a cor certa (armações pretas) — não
// dá pra distinguir um do outro só pelo pixel, então preto NÃO é filtrado
// como "fundo" (diferente do branco acima, que é sempre fundo de anúncio).

/**
 * Baixa uma imagem (URL pública ou assinada) e calcula a cor média da
 * região central (50% da largura/altura, onde a armação normalmente está
 * centralizada em foto de produto), ignorando pixels quase brancos (fundo).
 * Devolve `null` se não for possível ler/decodificar a imagem.
 */
export async function fetchSwatch(imageUrl: string, timeoutMs = 8000): Promise<Swatch | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return await swatchFromBuffer(buffer);
  } catch {
    return null;
  }
}

export async function swatchFromBuffer(buffer: Buffer): Promise<Swatch | null> {
  try {
    const image = sharp(buffer).ensureAlpha();
    const { width, height } = await image.metadata();
    if (!width || !height) return null;

    const cropWidth = Math.max(1, Math.round(width * 0.5));
    const cropHeight = Math.max(1, Math.round(height * 0.5));
    const left = Math.round((width - cropWidth) / 2);
    const top = Math.round((height - cropHeight) / 2);

    const { data } = await image
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];
      if (alpha < 20) continue; // pixel transparente — não conta.
      if (r > NEAR_WHITE_THRESHOLD && g > NEAR_WHITE_THRESHOLD && b > NEAR_WHITE_THRESHOLD) continue; // fundo branco típico.
      sumR += r;
      sumG += g;
      sumB += b;
      count += 1;
    }
    if (count === 0) return null; // imagem toda branca/transparente na região central — não dá pra estimar.
    return { r: sumR / count, g: sumG / count, b: sumB / count };
  } catch {
    return null;
  }
}

export function colorDistance(a: Swatch, b: Swatch): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// Distância máxima (em RGB, 0-441) pra considerar que uma foto geral do
// anúncio "bate" com a cor de referência — acima disso, melhor não sugerir
// nada do que sugerir uma foto claramente de outra cor. Valor escolhido por
// bom senso (não testado contra fotos reais nesta sessão, sem acesso à rede
// de verdade pra baixar imagens do AliExpress) — se na prática vier
// sugestão errada com frequência, é só apertar esse número; se vier pouca
// coisa sugerida, é só afrouxar.
export const MAX_MATCH_DISTANCE = 90;

export type GalleryMatch = { imageUrl: string; distance: number };

/**
 * Ordena as fotos gerais do anúncio pela distância de cor até a referência,
 * mantendo só as que passam no limite `MAX_MATCH_DISTANCE`, e devolve até
 * `limit` (padrão 3). Fotos que já foram usadas por OUTRA cor deste mesmo
 * produto (`excludeUrls`) são descartadas antes de comparar.
 */
export async function pickMatchingGalleryPhotos(
  referenceSwatch: Swatch,
  galleryUrls: string[],
  excludeUrls: Set<string>,
  limit = 3
): Promise<GalleryMatch[]> {
  const candidates = galleryUrls.filter((url) => !excludeUrls.has(url));
  const results = await Promise.all(
    candidates.map(async (imageUrl) => {
      const swatch = await fetchSwatch(imageUrl);
      if (!swatch) return null;
      return { imageUrl, distance: colorDistance(referenceSwatch, swatch) };
    })
  );
  return results
    .filter((r): r is GalleryMatch => r !== null && r.distance <= MAX_MATCH_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
