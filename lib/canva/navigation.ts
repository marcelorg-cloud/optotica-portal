export function withCanvaSession(href: string, sessionId: string) {
  const url = new URL(href);
  url.searchParams.set('session', sessionId);
  url.searchParams.delete('redo');
  url.searchParams.delete('canva_error');
  return url.toString();
}

export function withCanvaRedo(href: string, sessionId: string) {
  const url = new URL(href);
  url.searchParams.set('redo', sessionId);
  url.searchParams.delete('session');
  url.searchParams.delete('canva_error');
  return url.toString();
}

export function canvaImageUrl(productId: string, colorId: string, kind: 'original' | 'current' | 'preview', sessionId?: string,
  version?: string) {
  const params = new URLSearchParams({ productId, colorId, kind });
  if (sessionId) params.set('sessionId', sessionId);
  if (version) params.set('v', version);
  return '/api/admin/catalog/canva/image?' + params.toString();
}
