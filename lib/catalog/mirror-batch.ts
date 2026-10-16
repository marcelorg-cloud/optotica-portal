import { parseSupplierList, type SupplierListingItem } from './parse-supplier-list';

export type MirrorCandidate = SupplierListingItem & {
  likelyOpticalFrame: boolean;
};
export type MirrorBatch = {
  storeVerified: boolean;
  sourceCount: number;
  filteredCount: number;
  candidates: MirrorCandidate[];
};

const rawRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

function findStoreId(raw: string): string | null {
  let root: Record<string, unknown> | null;
  try { root = rawRecord(JSON.parse(raw)); } catch { return null; }
  const result = rawRecord(root?.result),data = rawRecord(root?.data);
  for (const val of [root?.storeId, result?.storeId, data?.storeId]) {
    if (typeof val === 'string' || typeof val === 'number') {
      const s = String(val).trim();
      if (/^\d{3,30}$/.test(s)) return s;
    }
  }
  return null;
}

// Product-title heuristics are only a TRIAGE filter, not proof of composition
// or a replacement for the material/format review before creating SKU.
export function likelyOpticalFrame(title: string): boolean {
  const s = title.toLowerCase();
  if (/(?:case|cases|pouch|bag|cord|chain|strap|cleaner|cleaning|cloth|nose\s*pads?|replacement\s*parts?|contact\s*lenses?|solu[cç][aã]o|estojo|flanela)/i.test(s)) return false;
  return /(?:eyeglass|spectacle|optical|glasses|eyewear|gafas|óculos|oculos|arma[cç][aã]o|frames?|rimless|half.?rim|acetate|tr90|titanium)/i.test(s);
}

export function parseMirrorBatch(
  raw: string, expectedStoreId: string,
  options: { allListings?: boolean } = {}
): MirrorBatch {
  if (typeof raw !== 'string' || raw.length > 1_000_000) {
    throw new Error('Lista de produtos muito grande. Importe páginas de até 1 MB.');
  }
  const rows = parseSupplierList(raw, expectedStoreId);
  // Keep supplier attribution conservative for manually pasted JSON.
  const storeVerified = findStoreId(raw) === expectedStoreId;
  const all = rows.slice(0, 200);
  const candidates = all
    .map((row) => ({
      ...row,
      title: row.title.replace(/\s+/g, ' ').slice(0, 240),
      supplierSku: row.supplierSku?.slice(0, 120) || null,
      imageUrl: row.imageUrl?.slice(0, 700) || null,
      price: row.price?.slice(0, 50) || null,
      currency: row.currency?.slice(0, 8) || null,
      likelyOpticalFrame: likelyOpticalFrame(row.title)
    }))
    .filter((row) => options.allListings === true || row.likelyOpticalFrame);
  return {
    storeVerified,
    sourceCount: rows.length,
    filteredCount: all.length - candidates.length,
    candidates
  };
}
