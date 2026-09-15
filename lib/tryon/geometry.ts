// Geometria da prova online (mecanismo confirmado 11/09/2026 — ver seção 0.29
// do estado consolidado): mesma "regra de três" da Ui! Gafas/Codecia_Provaonline,
// só que a largura real da armação vem de um campo estruturado do banco em
// vez de escondida no nome do arquivo — hoje `catalog_products.
// frame_total_width_mm` ("Frente Total", quando o master já preencheu, mais
// precisa) com fallback pra `lens_width_mm` (13/09/2026, 8ª rodada); essa
// função em si só recebe `frameWidthMm` já resolvido por quem chama, não
// sabe de onde ele veio.
//
// Puro/sem DOM e sem Node — roda igual no navegador (preview ao vivo, canvas)
// e no servidor (composição final via `sharp`, rota /api/client/tryon/compose).
// A régua (distância em pixel entre as pupilas) só pode ser medida onde a
// foto existe como imagem carregada — por isso quem chama esta função sempre
// já rodou lib/dnp-vision.ts (detectFacePoints) antes, no navegador.

export type Point = { x: number; y: number };

export type OverlayGeometry = {
  /** pixels por milímetro, calibrado pela DNP real do paciente nesta foto específica */
  pxPerMm: number;
  /** largura final do PNG da armação, em pixel, já escalada pra esta foto */
  widthPx: number;
  /** altura final, mantendo a proporção original do PNG (frameAspectRatio = altura/largura) */
  heightPx: number;
  /** centro da armação = ponto médio entre as duas pupilas detectadas */
  centerX: number;
  centerY: number;
  /** inclinação da linha entre as pupilas, em graus — cabeça raramente está 100% nivelada na foto */
  angleDeg: number;
};

// 15/09/2026 — comparado contra o JS original de verdade da Ui!Gafas
// (embed-glass.js, "Rsvtg", cedido pelo usuário para conferência). O mecanismo
// central (regra de três + rotação pelo ângulo entre as pupilas) já batia. Uma
// diferença real encontrada: lá o centro da armação não é a média simples
// entre as duas pupilas — é a projeção do ponto "midwayBetweenEyes" (do
// FaceMesh) sobre a própria linha que liga as pupilas
// (`calculateMidPointInLine`), corrigindo o centro pra o ponto central real do
// rosto (ponte do nariz) em vez de assumir que os dois olhos estão sempre
// perfeitamente simétricos em relação a ele. `lib/dnp-vision.ts` já detecta o
// equivalente (`nasalCenter`, landmark 168 do MediaPipe) mas ele não era usado
// aqui — agora é, como refinamento opcional (sem esse ponto, cai pra média
// simples de antes, então nada quebra pra quem já chamava sem ele).
function projectPointOntoLine(point: Point, lineA: Point, lineB: Point): Point {
  const abx = lineB.x - lineA.x;
  const aby = lineB.y - lineA.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < 1e-6) return { x: (lineA.x + lineB.x) / 2, y: (lineA.y + lineB.y) / 2 };
  const t = ((point.x - lineA.x) * abx + (point.y - lineA.y) * aby) / lengthSq;
  return { x: lineA.x + t * abx, y: lineA.y + t * aby };
}

export function computeOverlayGeometry(params: {
  pupilA: Point;
  pupilB: Point;
  /** Ponto de referência nasal (ponte do nariz) opcional — quando informado, refina o
   * centro da armação projetando-o sobre a linha entre as pupilas, em vez da média simples. */
  nasalCenter?: Point;
  dnpTotalMm: number;
  frameWidthMm: number;
  frameAspectRatio: number;
}): OverlayGeometry | null {
  const { pupilA, pupilB, nasalCenter, dnpTotalMm, frameWidthMm, frameAspectRatio } = params;
  if (!(dnpTotalMm > 0) || !(frameWidthMm > 0)) return null;

  const dx = pupilB.x - pupilA.x;
  const dy = pupilB.y - pupilA.y;
  const pupilDistancePx = Math.hypot(dx, dy);
  if (pupilDistancePx < 1) return null;

  const pxPerMm = pupilDistancePx / dnpTotalMm;
  const widthPx = frameWidthMm * pxPerMm;
  const heightPx = widthPx * frameAspectRatio;

  const center = nasalCenter
    ? projectPointOntoLine(nasalCenter, pupilA, pupilB)
    : { x: (pupilA.x + pupilB.x) / 2, y: (pupilA.y + pupilB.y) / 2 };

  return {
    pxPerMm,
    widthPx,
    heightPx,
    centerX: center.x,
    centerY: center.y,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI
  };
}
