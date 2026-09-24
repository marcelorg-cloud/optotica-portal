export function withCanvaSession(href: string, sessionId: string) {
  const url = new URL(href);
  url.searchParams.set('session', sessionId);
  url.searchParams.delete('canva_error');
  return url.toString();
}
