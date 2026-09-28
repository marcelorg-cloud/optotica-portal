type GalleryPhoto = { id: string; url: string; colorImageIds: string[]; colorTagsReviewed: boolean };
type ColorReference = { id: string; sourceImageUrl: string | null };

// AliExpress serves the same source file in several sizes (for example,
// .jpg_50x50.jpg and .jpg_800x800.jpg). Compare only a distinctive source
// path, never a color name or a shared product ID in a URL.
function imageIdentity(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const path = url.pathname.toLowerCase().replace(/\.(?:jpg|jpeg|png|webp)(?:_[^/]*)?$/, '');
    const basename = path.split('/').pop() || '';
    return basename.length >= 12 ? path : null;
  } catch { return null; }
}

export function suggestGalleryColors(photos: GalleryPhoto[], colors: ColorReference[]) {
  const references = colors.map(color => ({ id: color.id, identity: imageIdentity(color.sourceImageUrl) }));
  const suggested: Record<string, string[]> = {};
  for (const photo of photos) {
    if (photo.colorTagsReviewed || photo.colorImageIds.length) continue; // Never replace an explicit choice, even an empty one.
    const identity = imageIdentity(photo.url);
    if (!identity) continue;
    const matches = references.filter(reference => reference.identity === identity).map(reference => reference.id);
    if (matches.length === 1) suggested[photo.id] = matches;
  }
  return suggested;
}
