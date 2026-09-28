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

export function buildCanvaBatchPrompt(product: CanvaReferenceProduct, colors: { name: string; filename: string }[]) {
  return `Prepare as fotos de prova online do modelo “${product.model_name}” (SKU ${product.sku_optotica}), uma por página, mantendo cada cor na sua própria página.

Identifique cada página pelo nome preparado, independentemente da ordem no design:
${colors.map((color, index) => `${index + 1}. ${color.filename} — cor “${color.name}”`).join('\n')}

Medidas deste modelo, iguais para todas as cores:
${measurementLines(product).join('\n') || '- leia as cotas na imagem de medidas de cada página'}

Em CADA página, selecione somente as três imagens daquela página. A imagem grande é a referência de posição, centralização e largura horizontal; não copie dela a forma ou a cor. A foto pequena da cor, no canto superior direito, define exclusivamente a forma real, cor, material e detalhes da armação daquela página. A foto de medidas, no canto superior esquerdo, define geometria e proporções; leia as cotas também quando não estiverem listadas acima. Nunca use a foto de outra página como referência.

Transforme a armação real numa vista frontal ortográfica, reta e simétrica. Mostre somente a frente, sem hastes. A frente deve ocupar toda a largura marcada pelo modelo grande, sem cortar nem deformar. Mantenha as proporções das lentes e ponte dadas pelas medidas. Fundo e interior dos aros devem ter transparência real. Remova reflexos, lentes, sombras e os dois quadros de referência pequenos do resultado final.

Confira separadamente cada página: uma armação por página, com o nome/SKU da cor correspondente. Não misture características de cores diferentes. Se o Pede pro Canva editar apenas a página atual, execute estas mesmas instruções em cada página, selecionando sempre as três imagens da própria página.`;
}
