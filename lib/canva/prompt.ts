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

export function canvaColorLabel(color: { color_name: string; color_principal?: string | null; color_secondary?: string | null }) {
  return [color.color_principal, color.color_secondary].filter((value): value is string => Boolean(value)).join(' / ') || color.color_name;
}

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
  return `Crie a foto de prova online do modelo “${product.model_name}” (SKU ${product.sku_optotica}), na cor “${colorName}”.

Considere as três imagens selecionadas. Cada uma tem uma função diferente:

1. IMAGEM MAIOR — MODELO DA PROVA ONLINE
Use somente como referência de enquadramento, posição, centralização, orientação, transparência do fundo e largura final, deixando o óculos de ponta a ponta do enquadramento. Não copie o formato, a cor nem os detalhes do óculos dessa imagem.

2. REFERÊNCIA VISUAL DO FORMATO — IMAGEM GRANDE NA PARTE SUPERIOR
É a referência principal e obrigatória para a geometria, o desenho frontal e todas as proporções. Copie visualmente o mesmo contorno externo, formato das lentes, altura, largura, ponte, espessura relativa dos aros e relação entre todas as partes. Use somente o desenho limpo do óculos e não transfira a cor dessa referência.

3. FOTO REAL DA COR — IMAGEM MAIOR NA PARTE INFERIOR
É a referência principal para a cor, o material e os detalhes do produto. Reproduza fielmente a cor real da frente, o brilho do material, a espessura e acabamento dos aros, a ponte, ornamentos e demais detalhes visíveis. A foto pode estar em perspectiva: corrija-a para uma vista perfeitamente frontal, mas não use sua perspectiva para alterar o formato definido pela imagem superior.

Gere somente a frente do óculos, em vista frontal ortográfica, reta, horizontal, centralizada e simétrica. Remova completamente as duas hastes e qualquer parte lateral visível. Preserve os componentes frontais reais do modelo, inclusive plaquetas ou ornamentos quando existirem.

A frente deve ocupar exatamente a mesma largura horizontal da armação mostrada na imagem maior, com as extremidades esquerda e direita alinhadas à referência e o mesmo centro. Não deixe a armação menor, não deixe margens laterais e não corte nenhuma parte. Defina a altura e todas as demais proporções pela referência de formato na parte superior, sem esticar nem deformar.

Remova lentes, reflexos, brilhos sobre as lentes, sombras e fundo. O fundo e o interior dos aros devem ter transparência real: não use branco nem desenhe um quadriculado.

Entregue uma única armação, com bordas limpas e alta definição. Não misture os três óculos, não invente detalhes e não altere a cor.

IMPORTANTE PARA REFINAMENTO: nesta primeira geração, mantenha na página e sem alterações as duas referências auxiliares, uma acima e outra abaixo. Gere ou substitua somente a armação central. Não apague, recorte, mova nem transforme as referências. Elas serão usadas em um possível segundo comando de refinamento e só serão removidas manualmente depois que o resultado estiver aprovado.

Em caso de diferença entre as referências, siga esta prioridade:
- geometria, formato e proporções: referência visual limpa superior;
- cor, material e detalhes: foto real inferior;
- posição, centralização e largura final: imagem maior da prova online.`;
}

export function buildCanvaRefinementPrompt(product: CanvaReferenceProduct, colorName: string) {
  return `Refine a armação gerada do modelo “${product.model_name}” (SKU ${product.sku_optotica}), na cor “${colorName}”, sem começar novamente e sem alterar as duas imagens de referência mantidas na página.

Compare o resultado atual com as referências:
- copie com mais fidelidade o formato e as proporções da imagem superior, principalmente contorno das lentes, altura, ponte, espessura relativa dos aros e simetria;
- copie com mais fidelidade a cor, o brilho, o material, os acabamentos e ornamentos da foto inferior;
- preserve exatamente a posição, o centro e a largura de ponta a ponta definidos pela imagem-modelo maior.

Corrija somente a armação central. Mostre apenas a frente, perfeitamente frontal, reta e simétrica, sem hastes, partes laterais, lentes, reflexos, sombras ou fundo. O fundo e o interior dos aros devem continuar com transparência real.

Mantenha novamente as duas referências intactas para permitir outro refinamento. Não as apague ainda. Quando o resultado estiver aprovado, elas serão removidas manualmente antes da importação.`;
}

export function buildCanvaBatchPrompt(product: CanvaReferenceProduct, colors: { name: string; filename: string }[]) {
  return `Prepare as fotos de prova online do modelo “${product.model_name}” (SKU ${product.sku_optotica}), uma por página, mantendo cada cor na sua própria página.

Identifique cada página pelo nome preparado, independentemente da ordem no design:
${colors.map((color, index) => `${index + 1}. ${color.filename} — cor “${color.name}”`).join('\n')}

Em CADA página, selecione somente as três imagens daquela página. A imagem grande é a referência de posição, centralização e largura horizontal; não copie dela a forma ou a cor. A referência visual limpa e grande na parte superior define o formato e todas as proporções. A foto real grande na parte inferior define a cor, o material, o brilho e os detalhes. Nunca use a foto de outra página como referência.

Transforme a armação real numa vista frontal ortográfica, reta e simétrica. Mostre somente a frente, sem hastes. A frente deve ocupar toda a largura marcada pelo modelo grande, sem cortar nem deformar. Mantenha exatamente as proporções visuais da referência superior. Fundo e interior dos aros devem ter transparência real. Remova reflexos, lentes e sombras.

Na primeira geração, mantenha as referências superior e inferior intactas na página e altere somente a armação central. Elas precisam continuar disponíveis caso seja necessário um segundo comando de refinamento. Remova-as manualmente somente depois de aprovar o resultado final.

Confira separadamente cada página: uma armação por página, com o nome/SKU da cor correspondente. Não misture características de cores diferentes. Se o Pede pro Canva editar apenas a página atual, execute estas mesmas instruções em cada página, selecionando sempre as três imagens da própria página.`;
}
