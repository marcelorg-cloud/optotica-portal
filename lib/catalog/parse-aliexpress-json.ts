// Extrai os dados úteis do JSON da API "AliExpress Item Detail" (RapidAPI,
// ecommdatahub/aliexpress-datahub — a mesma que o usuário já usa hoje,
// copiando a resposta na mão) pedido do usuário (13/09/2026): "captar todos
// esses links... e fazer um padrão pra que dentro do portal sempre clique no
// mesmo padrão". Puro/sem rede — só transforma um texto JSON já colado em
// dados prontos pra pré-preencher o formulário "Novo produto" e criar as
// cores + a galeria geral automaticamente, em vez de escrever tudo à mão
// (como foi feito nos 5 modelos "peekaboo" seedados via SQL manual).
//
// Import de cores (`sku.props`): a propriedade de cor não tem nome fixo no
// anúncio ("Color", "Frame Color" etc. variam) — o sinal confiável é ter
// `values[].image` (miniatura por variante). O SKU do fornecedor por cor
// vem de `sku.base[].propMap`, cruzando "pid:vid".

export type ParsedAliexpressColor = {
  colorName: string;
  supplierSku: string | null;
  sourceImageUrl: string | null;
};

export type ParsedAliexpressProduct = {
  supplierItemId: string | null;
  modelName: string | null;
  lensWidthMm: number | null;
  lensHeightMm: number | null;
  colors: ParsedAliexpressColor[];
  galleryImageUrls: string[];
};

function normalizeUrl(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function parseMm(value: string | undefined | null): number | null {
  if (!value) return null;
  const match = value.match(/([\d.]+)\s*mm/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type RawSkuValue = { vid: number | string; name?: string; propTips?: string; image?: string };
type RawSkuProp = { pid: number | string; name?: string; values?: RawSkuValue[] };
type RawSkuBase = { skuId?: number | string; propMap?: string };

export function parseAliexpressJson(raw: string): ParsedAliexpressProduct {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('JSON inválido — confira se copiou a resposta inteira, do "{" inicial ao "}" final.');
  }

  // Tolera colar a resposta inteira (result.item), só o "item", ou variações
  // com/sem o nível "result" — mais robusto do que exigir um formato exato.
  const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
  const root = asRecord(data);
  const item =
    asRecord(asRecord(root?.result)?.item) ||
    asRecord(root?.item) ||
    root;
  if (!item) {
    throw new Error('Não encontrei os dados do produto ("item") nesse JSON.');
  }

  const supplierItemId = item.itemId !== undefined && item.itemId !== null ? String(item.itemId) : null;
  const modelName = typeof item.title === 'string' ? item.title.trim().slice(0, 140) : null;

  const propsList = Array.isArray(asRecord(item.properties)?.list) ? (asRecord(item.properties)!.list as Array<{ name?: string; value?: string }>) : [];
  const findMm = (label: string) => parseMm(propsList.find((p) => (p.name || '').toLowerCase() === label.toLowerCase())?.value);
  const lensWidthMm = findMm('Lens Width');
  const lensHeightMm = findMm('Lens Height');

  const sku = asRecord(item.sku);
  const skuProps: RawSkuProp[] = Array.isArray(sku?.props) ? (sku!.props as RawSkuProp[]) : [];
  const skuBase: RawSkuBase[] = Array.isArray(sku?.base) ? (sku!.base as RawSkuBase[]) : [];
  const skuImages = asRecord(sku?.skuImages) as Record<string, string> | null;

  const colorProp = skuProps.find((p) => Array.isArray(p.values) && p.values.some((v) => typeof v.image === 'string' && v.image));

  const colors: ParsedAliexpressColor[] = [];
  if (colorProp?.values) {
    for (const v of colorProp.values) {
      const pidVid = `${colorProp.pid}:${v.vid}`;
      const matchedSku = skuBase.find((s) => (s.propMap || '').split(';').includes(pidVid));
      const rawImage = v.image || skuImages?.[pidVid];
      const colorName = (v.name || v.propTips || `Cor ${v.vid}`).trim().slice(0, 80);
      if (!colorName) continue;
      colors.push({
        colorName,
        supplierSku: matchedSku?.skuId !== undefined && matchedSku?.skuId !== null ? String(matchedSku.skuId) : null,
        sourceImageUrl: rawImage ? normalizeUrl(rawImage) : null
      });
    }
  }

  const description = asRecord(item.description);
  const rawGallery = [
    ...(Array.isArray(item.images) ? (item.images as unknown[]) : []),
    ...(Array.isArray(description?.images) ? (description!.images as unknown[]) : [])
  ].filter((u): u is string => typeof u === 'string' && u.length > 0);
  const galleryImageUrls = Array.from(new Set(rawGallery.map(normalizeUrl)));

  return { supplierItemId, modelName, lensWidthMm, lensHeightMm, colors, galleryImageUrls };
}
