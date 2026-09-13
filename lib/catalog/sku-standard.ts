// Padrão de identificação de armações (documento "Padrao_SKU_Armacoes_Optotica.docx",
// anexado pelo usuário em 13/09/2026). Regra principal: o SKU do modelo
// identifica o desenho de forma estável (FORMATO-MATERIAL-NÚMERO, número
// global de 3 dígitos, nunca reaproveitado); a variante de cor é só a ordem
// de cadastro (C1, C2, C3...) — a cor real fica num campo padronizado à
// parte (`color_principal`), nunca embutida no nome/SKU.

export const FORMAT_OPTIONS: { code: string; label: string }[] = [
  { code: 'RT', label: 'Retangular' },
  { code: 'QT', label: 'Quadrado' },
  { code: 'RD', label: 'Redondo' },
  { code: 'OV', label: 'Oval' },
  { code: 'CT', label: 'Gatinho / Cat-eye' },
  { code: 'AV', label: 'Aviador' },
  { code: 'GE', label: 'Geométrico' },
  { code: 'BR', label: 'Browline' },
  { code: 'ES', label: 'Esportivo' },
  { code: 'PA', label: 'Panto' }
];

export const MATERIAL_OPTIONS: { code: string; label: string }[] = [
  { code: 'AC', label: 'Acetato' },
  { code: 'TR', label: 'TR90' },
  { code: 'PC', label: 'Policarbonato' },
  { code: 'PL', label: 'Plástico / termoplástico' },
  { code: 'MT', label: 'Metal' },
  { code: 'AI', label: 'Aço inoxidável' },
  { code: 'TI', label: 'Titânio' },
  { code: 'MX', label: 'Misto (dois ou mais materiais)' }
];

// Vocabulário controlado pro campo "Cor principal" (e "Cor secundária").
export const COLOR_VOCABULARY: string[] = [
  'Preto', 'Cinza', 'Grafite', 'Prata', 'Dourado', 'Rosé', 'Branco', 'Cristal',
  'Fumê', 'Champanhe', 'Bege', 'Marrom', 'Tartaruga', 'Caramelo', 'Amarelo',
  'Laranja', 'Vermelho', 'Vinho', 'Rosa', 'Lilás', 'Roxo', 'Azul', 'Azul-marinho',
  'Verde', 'Verde-oliva', 'Turquesa', 'Multicolorido'
];

const FORMAT_LABEL_BY_CODE = new Map(FORMAT_OPTIONS.map((f) => [f.code, f.label]));
const MATERIAL_LABEL_BY_CODE = new Map(MATERIAL_OPTIONS.map((m) => [m.code, m.label]));

export function isValidFormatCode(code: string): boolean {
  return FORMAT_LABEL_BY_CODE.has(code);
}

export function isValidMaterialCode(code: string): boolean {
  return MATERIAL_LABEL_BY_CODE.has(code);
}

export function isValidColor(color: string): boolean {
  return COLOR_VOCABULARY.includes(color);
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

// "Retangular em acetato 042" — nome público do modelo, gerado por extenso.
export function buildModelName(formatCode: string, materialCode: string, modelNumber: number): string {
  const formatLabel = FORMAT_LABEL_BY_CODE.get(formatCode) || formatCode;
  const materialLabel = (MATERIAL_LABEL_BY_CODE.get(materialCode) || materialCode).toLowerCase();
  return `${formatLabel} em ${materialLabel} ${pad3(modelNumber)}`;
}

// "RT-AC-042" — SKU do modelo.
export function buildModelSku(formatCode: string, materialCode: string, modelNumber: number): string {
  return `${formatCode}-${materialCode}-${pad3(modelNumber)}`;
}

// "Retangular em acetato 042 - Cor 2" — nome público da variante (nunca
// embute a cor real, só a ordem — a cor real vai no campo `color_principal`).
export function buildVariantName(modelName: string, variantNumber: number): string {
  return `${modelName} - Cor ${variantNumber}`;
}

// "RT-AC-042-C2" — SKU da variante.
export function buildVariantSku(modelSku: string, variantNumber: number): string {
  return `${modelSku}-C${variantNumber}`;
}

// Sugestão automática de "Cor principal" a partir do texto bruto do
// fornecedor (ex.: "leopard with clear", "dark brown frame") — sempre uma
// SUGESTÃO editável, nunca a gravação final; tradução automática de nome de
// cor erra às vezes, por isso o master sempre confirma/ajusta antes de
// salvar (ver conversa 13/09/2026 sobre "colar JSON do AliExpress").
const KEYWORD_TO_COLOR: Array<{ keywords: string[]; color: string }> = [
  { keywords: ['leopard', 'tortoise', 'havana', 'demi'], color: 'Tartaruga' },
  { keywords: ['black'], color: 'Preto' },
  { keywords: ['grey', 'gray'], color: 'Cinza' },
  { keywords: ['graphite'], color: 'Grafite' },
  { keywords: ['silver'], color: 'Prata' },
  { keywords: ['gold'], color: 'Dourado' },
  { keywords: ['rose gold', 'rose-gold', 'rosé', 'rose'], color: 'Rosé' },
  { keywords: ['white'], color: 'Branco' },
  { keywords: ['clear', 'crystal', 'transparent'], color: 'Cristal' },
  { keywords: ['smoke', 'smoky'], color: 'Fumê' },
  { keywords: ['champagne'], color: 'Champanhe' },
  { keywords: ['beige', 'sand', 'nude'], color: 'Bege' },
  { keywords: ['amber', 'honey', 'caramel'], color: 'Caramelo' },
  { keywords: ['brown'], color: 'Marrom' },
  { keywords: ['yellow'], color: 'Amarelo' },
  { keywords: ['orange', 'coral'], color: 'Laranja' },
  { keywords: ['burgundy', 'wine'], color: 'Vinho' },
  { keywords: ['red'], color: 'Vermelho' },
  { keywords: ['pink'], color: 'Rosa' },
  { keywords: ['lavender', 'lilac'], color: 'Lilás' },
  { keywords: ['purple', 'violet'], color: 'Roxo' },
  { keywords: ['navy'], color: 'Azul-marinho' },
  { keywords: ['blue'], color: 'Azul' },
  { keywords: ['olive'], color: 'Verde-oliva' },
  { keywords: ['teal'], color: 'Turquesa' },
  { keywords: ['green'], color: 'Verde' }
];

export function suggestPrincipalColor(supplierColorName: string): string | null {
  const text = supplierColorName.toLowerCase();
  for (const entry of KEYWORD_TO_COLOR) {
    if (entry.keywords.some((k) => text.includes(k))) return entry.color;
  }
  return null;
}
