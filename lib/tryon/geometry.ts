// Geometria da prova online (mecanismo confirmado 11/09/2026 — ver seção 0.29
// do estado consolidado): mesma "regra de três" da Ui! Gafas/Codecia_Provaonline,
// só que a largura real da armação vem de um campo estruturado
// (catalog_products.lens_width_mm) em vez de escondida no nome do arquivo.
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

export function computeOverlayGeometry(params: {
  pupilA: Point;
  pupilB: Point;
  dnpTotalMm: number;
  frameWidthMm: number;
  frameAspectRatio: number;
}): OverlayGeometry | null {
  const { pupilA, pupilB, dnpTotalMm, frameWidthMm, frameAspectRatio } = params;
  if (!(dnpTotalMm > 0) || !(frameWidthMm > 0)) return null;

  const dx = pupilB.x - pupilA.x;
  const dy = pupilB.y - pupilA.y;
  const pupilDistancePx = Math.hypot(dx, dy);
  if (pupilDistancePx < 1) return null;

  const pxPerMm = pupilDistancePx / dnpTotalMm;
  const widthPx = frameWidthMm * pxPerMm;
  const heightPx = widthPx * frameAspectRatio;

  return {
    pxPerMm,
    widthPx,
    heightPx,
    centerX: (pupilA.x + pupilB.x) / 2,
    centerY: (pupilA.y + pupilB.y) / 2,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI
  };
}
