type MeasurementValue = number | string | null;

export type CanvaReferenceProduct = {
  model_name: string;
  sku_optotica: string;
  lens_width_mm: MeasurementValue;
  lens_height_mm: MeasurementValue;
  bridge_mm: MeasurementValue;
  lens_diagonal_mm: MeasurementValue;
  temple_length_mm: MeasurementValue;
  rim_mm: MeasurementValue;
  frame_total_width_mm: MeasurementValue;
  standard_height_mm: MeasurementValue;
};

function millimeters(value: MeasurementValue) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mm';
}

export function measurementLines(product: CanvaReferenceProduct) {
  const values: Array<[string, MeasurementValue]> = [
    ['largura total da frente (D)', product.frame_total_width_mm],
    ['largura de cada lente (A)', product.lens_width_mm],
    ['altura de cada lente (B)', product.lens_height_mm],
    ['largura da ponte (C)', product.bridge_mm],
    ['diagonal maior da lente', product.lens_diagonal_mm],
    ['comprimento das hastes (não desenhar as hastes no resultado)', product.temple_length_mm],
    ['medida do aro', product.rim_mm],
    ['altura padrão da armação', product.standard_height_mm]
  ];
  return values.flatMap(([label, value]) => {
    const formatted = millimeters(value);
    return formatted ? [`- ${label}: ${formatted}`] : [];
  });
}

export function buildCanvaEditPrompt(product: CanvaReferenceProduct, colorName: string) {
  const measurements = measurementLines(product);
  const measurementList = measurements.length
    ? measurements.join('\n')
    : '- leia e respeite todas as cotas visíveis na imagem de medidas';

  return `Crie a foto de prova online do modelo “${product.model_name}” (SKU ${product.sku_optotica}), na cor “${colorName}”.

Medidas cadastradas do modelo:
${measurementList}

Considere as três imagens selecionadas. Cada uma tem uma função diferente:

1. IMAGEM MAIOR — MODELO DA PROVA ONLINE
Use somente como referência de enquadramento, posição, centralização, orientação, transparência e largura final. Não copie o formato, a cor nem os detalhes do óculos dessa imagem.

2. FOTO REAL DA COR — IMAGEM PEQUENA NO CANTO SUPERIOR DIREITO
É a referência principal para a identidade do produto. Reproduza fielmente o formato real da frente, a cor, o material, a espessura dos aros, a ponte, os acabamentos, ornamentos e demais detalhes visíveis. A foto pode estar em perspectiva: corrija-a para uma vista perfeitamente frontal.

3. IMAGEM DE MEDIDAS — IMAGEM PEQUENA NO CANTO SUPERIOR ESQUERDO
É a referência principal para a geometria e as proporções. Leia também todas as cotas visíveis nessa imagem, inclusive medidas que não apareçam na lista acima. Use o desenho cotado e os valores para manter corretas as relações entre largura total, largura e altura das lentes, ponte e demais proporções frontais. Não copie para o resultado setas, linhas, letras, números, textos, o fundo da folha nem a cor da armação mostrada nessa imagem.

Gere somente a frente do óculos, em vista frontal ortográfica, reta, horizontal, centralizada e simétrica. Remova completamente as duas hastes e qualquer parte lateral visível. Preserve os componentes frontais reais do modelo, inclusive plaquetas ou ornamentos quando existirem.

A frente deve ocupar exatamente a mesma largura horizontal da armação mostrada na imagem maior, com as extremidades esquerda e direita alinhadas à referência e o mesmo centro. Não deixe a armação menor, não deixe margens laterais e não corte nenhuma parte. Defina a altura e todas as demais proporções pela imagem de medidas e pelas cotas, sem esticar nem deformar.

Remova lentes, reflexos, brilhos sobre as lentes, sombras e fundo. O fundo e o interior dos aros devem ter transparência real: não use branco nem desenhe um quadriculado.

Entregue uma única armação, com bordas limpas e alta definição. Não misture os três óculos, não invente detalhes, não altere a cor e não deixe nenhuma das duas imagens auxiliares no resultado final.

Em caso de diferença entre as referências, siga esta prioridade:
- geometria e proporções: imagem de medidas, cotas visíveis e valores cadastrados;
- formato, cor, material e detalhes: foto real da cor;
- posição, centralização e largura final: imagem maior da prova online.`;
}
