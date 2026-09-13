// Cor de verdade (hex aproximado) pra cada opção do vocabulário controlado
// de cor (`COLOR_VOCABULARY`, lib/catalog/sku-standard.ts) — pedido do
// usuário (13/09/2026): "colorir cada checkbox de cor (C1) etc. de acordo
// com a cor correspondente", pra identificar visualmente qual bolinha é qual
// cor em "Todas as fotos do anúncio" (e, de brinde, o círculo pequeno ao
// lado do nome da cor em cada card, que antes era sempre cinza/neutro).
//
// São aproximações visuais (não existe "o" tom exato de "Tartaruga" ou
// "Fumê" — cada armação varia) — só pra dar uma pista visual rápida de qual
// cor é qual, nunca usadas em nenhum cálculo/processamento de imagem.
export const COLOR_SWATCH_HEX: Record<string, string> = {
  Preto: '#1c1c1c',
  Cinza: '#9a9a9a',
  Grafite: '#4a4a4a',
  Prata: '#c7c9cc',
  Dourado: '#cda434',
  Rosé: '#e6b8a2',
  Branco: '#f4f4f2',
  Cristal: '#eaf6f6',
  Fumê: '#6e6a63',
  Champanhe: '#f1dfb9',
  Bege: '#e8dcc7',
  Marrom: '#6b4226',
  Tartaruga: '#8a5a2b',
  Caramelo: '#c68642',
  Amarelo: '#f2c94c',
  Laranja: '#f2994a',
  Vermelho: '#d64545',
  Vinho: '#6e1423',
  Rosa: '#f3b6c9',
  Lilás: '#cbb3e3',
  Roxo: '#6a3fa0',
  Azul: '#3b6bc9',
  'Azul-marinho': '#1f2a5c',
  Verde: '#3f9142',
  'Verde-oliva': '#6b6f2b',
  Turquesa: '#2fb3ab',
  Multicolorido: 'conic-gradient(from 0deg, #d64545, #f2c94c, #3f9142, #3b6bc9, #6a3fa0, #d64545)'
};

// Cores muito claras (fica difícil ler texto escuro OU claro sem contraste
// mínimo) — usadas pra decidir a cor do texto/borda por cima do swatch.
const LIGHT_COLORS = new Set(['Branco', 'Cristal', 'Champanhe', 'Bege', 'Amarelo', 'Rosé', 'Rosa', 'Prata']);

/** Fundo CSS (sólido, gradiente cônico pra "Multicolorido", ou metade/metade
 * quando há cor secundária — armação bicolor) pra representar esta cor. */
export function colorSwatchBackground(colorPrincipal: string | null, colorSecondary?: string | null): string {
  const primaryHex = (colorPrincipal && COLOR_SWATCH_HEX[colorPrincipal]) || '#cccccc';
  if (colorSecondary && COLOR_SWATCH_HEX[colorSecondary] && colorSecondary !== colorPrincipal) {
    const secondaryHex = COLOR_SWATCH_HEX[colorSecondary];
    return `linear-gradient(135deg, ${primaryHex} 0%, ${primaryHex} 48%, ${secondaryHex} 52%, ${secondaryHex} 100%)`;
  }
  return primaryHex;
}

/** true se o texto/borda por cima do swatch deve ser escuro (swatch claro demais pra texto branco). */
export function colorSwatchIsLight(colorPrincipal: string | null): boolean {
  return Boolean(colorPrincipal && LIGHT_COLORS.has(colorPrincipal));
}

/** Cor sólida (ignora secundária/gradiente) — usada em borda de botão/ícone,
 * onde um degradê não é uma propriedade CSS simples de aplicar. */
export function colorSwatchSolidHex(colorPrincipal: string | null): string {
  const hex = colorPrincipal && COLOR_SWATCH_HEX[colorPrincipal];
  return hex && !hex.startsWith('conic-gradient') ? hex : '#999999';
}
