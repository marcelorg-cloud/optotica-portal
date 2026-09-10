// Cálculo de DNP (distância nasopupilar) a partir de uma foto com um cartão de
// crédito/documento como referência de escala — mesma lógica das calculadoras de
// "PD" por foto disponíveis na internet: cartão no formato ISO/IEC 7810 ID-1 tem
// largura padronizada, então a proporção entre a largura do cartão em pixels e
// sua largura real em mm dá a escala (pixels por mm) usada para converter
// qualquer outra distância na mesma foto.
//
// Convenção adotada para não depender de qual índice do MediaPipe é "olho
// direito"/"olho esquerdo" (isso pode inverter dependendo de espelhamento da
// câmera): em uma foto frontal do paciente, sem espelhar, o olho DIREITO dele
// aparece do lado ESQUERDO da imagem (x menor) — convenção padrão de fotografia
// clínica. Por isso o ponto com menor x é sempre tratado como OD, e o de maior
// x como OE, recalculado a cada ajuste manual, nunca fixado por índice do
// modelo de IA.

export const CREDIT_CARD_WIDTH_MM = 85.6; // ISO/IEC 7810 ID-1

export type Point = { x: number; y: number };

export type DnpPoints = {
  /** Um dos dois pontos de pupila (papel OD/OE decidido pela posição, não por qual é qual aqui). */
  pupilA: Point;
  pupilB: Point;
  /** Ponto de referência nasal/central, usado para dividir a distância total em OD/OE. */
  nasalCenter: Point;
  /** Bordas esquerda e direita do cartão, na mesma foto (a régua de referência). */
  cardLeft: Point;
  cardRight: Point;
};

export type DnpResult = {
  pxPerMm: number;
  odMm: number;
  oeMm: number;
  totalMm: number;
};

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Calcula o resultado em mm a partir dos 5 pontos marcados na foto (em pixels).
 * Não faz nenhuma suposição sobre qual câmera/modelo gerou os pontos — só
 * geometria. Retorna null se o cartão estiver com largura ~0 (pontos
 * coincidentes), o que indicaria marcação inválida.
 */
export function calculateDnp(points: DnpPoints): DnpResult | null {
  const cardWidthPx = distance(points.cardLeft, points.cardRight);
  if (cardWidthPx < 1) return null;

  const pxPerMm = cardWidthPx / CREDIT_CARD_WIDTH_MM;

  // Decide qual pupila é OD (menor x = lado esquerdo da imagem = olho direito
  // do paciente numa foto frontal não espelhada) de forma dinâmica, a cada
  // cálculo — assim um ajuste manual que troque a posição relativa dos pontos
  // nunca inverte OD/OE silenciosamente.
  const [odPupil, oePupil] = points.pupilA.x <= points.pupilB.x
    ? [points.pupilA, points.pupilB]
    : [points.pupilB, points.pupilA];

  const odMm = distance(odPupil, points.nasalCenter) / pxPerMm;
  const oeMm = distance(points.nasalCenter, oePupil) / pxPerMm;

  return {
    pxPerMm,
    odMm: round1(odMm),
    oeMm: round1(oeMm),
    totalMm: round1(odMm + oeMm)
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
