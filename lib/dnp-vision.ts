// Lógica de visão computacional para a ferramenta "Medir com foto" (cálculo de
// DNP via cartão de referência). Tudo neste módulo só pode rodar no navegador
// — nunca no servidor (SSR) — porque depende de APIs de browser (canvas,
// WebAssembly) e carrega os runtimes de MediaPipe/OpenCV via CDN em tempo de
// execução. Por isso este arquivo nunca deve ser importado estaticamente por
// nenhum componente/rota que renderize no servidor: sempre via
// `await import('@/lib/dnp-vision')` dentro de um handler de clique/efeito,
// só quando a ferramenta é realmente aberta.
//
// IA aqui é só um ponto de partida: todo ponto que ela sugerir é
// pré-marcação, ajustável manualmente pelo profissional antes de salvar (ver
// components/order/dnp-photo-tool.tsx). Se a detecção falhar, as funções
// retornam null e a UI cai para marcação 100% manual.

import type { Point } from '@/lib/dnp';

// Carregado via CDN (jsdelivr), não empacotado no bundle — mantém o build
// rápido e evita baixar ~15MB (opencv) / modelo do MediaPipe em toda página.
const MEDIAPIPE_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Índices do modelo de 478 pontos do MediaPipe Face Landmarker (com
// refine_landmarks / iris habilitado): 468 e 473 são os centros das íris; 168
// é o ponto entre os olhos na ponte do nariz — bom ponto de referência
// "nasal" para dividir a distância total em OD/OE. Não importa aqui qual
// índice é "olho esquerdo"/"direito" do modelo: essa decisão é feita de forma
// dinâmica em lib/dnp.ts, pela posição x dos pontos na foto.
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;
const NASAL_BRIDGE = 168;

export type FacePointsResult = {
  pupilA: Point;
  pupilB: Point;
  nasalCenter: Point;
};

export type CardPointsResult = {
  cardLeft: Point;
  cardRight: Point;
};

export type ImageSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

// ---------------------------------------------------------------------------
// MediaPipe FaceLandmarker (detecção das pupilas + ponto nasal)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let faceLandmarkerPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFaceLandmarker(): Promise<any> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import(
        '@mediapipe/tasks-vision'
      );
      const filesetResolver = await FilesetResolver.forVisionTasks(
        MEDIAPIPE_WASM_CDN
      );
      return FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
          delegate: 'GPU'
        },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false
      });
    })().catch((err) => {
      // Se falhar (ex.: sem WebGL/GPU, CDN bloqueado), permite tentar de novo
      // na próxima chamada em vez de ficar travado numa promise rejeitada.
      faceLandmarkerPromise = null;
      throw err;
    });
  }
  return faceLandmarkerPromise;
}

/**
 * Detecta os centros das duas íris e um ponto de referência nasal numa
 * imagem/frame. Retorna coordenadas em pixels da própria imagem (largura x
 * altura reais do `source`), prontas para desenhar sobre um canvas do mesmo
 * tamanho. Retorna null se nenhum rosto for detectado.
 */
export async function detectFacePoints(
  source: ImageSource
): Promise<FacePointsResult | null> {
  const landmarker = await loadFaceLandmarker();
  const result = landmarker.detect(source);
  const landmarks = result?.faceLandmarks?.[0];
  if (!landmarks || landmarks.length <= RIGHT_IRIS_CENTER) return null;

  const width = 'videoWidth' in source ? source.videoWidth : source.width;
  const height = 'videoHeight' in source ? source.videoHeight : source.height;
  if (!width || !height) return null;

  const toPoint = (index: number): Point => ({
    x: landmarks[index].x * width,
    y: landmarks[index].y * height
  });

  return {
    pupilA: toPoint(LEFT_IRIS_CENTER),
    pupilB: toPoint(RIGHT_IRIS_CENTER),
    nasalCenter: toPoint(NASAL_BRIDGE)
  };
}

// ---------------------------------------------------------------------------
// OpenCV.js (detecção best-effort do retângulo do cartão)
// ---------------------------------------------------------------------------

const CARD_ASPECT_RATIO = 85.6 / 53.98; // ISO/IEC 7810 ID-1 ≈ 1.586
const CARD_ASPECT_TOLERANCE = 0.35;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let openCvPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOpenCv(): Promise<any> {
  if (!openCvPromise) {
    openCvPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cvModule = (await import('@techstark/opencv-js')).default as any;
      if (cvModule?.Mat) return cvModule;
      await new Promise<void>((resolve) => {
        cvModule.onRuntimeInitialized = () => resolve();
      });
      return cvModule;
    })().catch((err) => {
      openCvPromise = null;
      throw err;
    });
  }
  return openCvPromise;
}

/**
 * Tenta detectar automaticamente o retângulo do cartão de crédito/documento
 * na foto usando visão computacional clássica (bordas + contornos), filtrando
 * por proporção de aspecto de um cartão ISO/IEC 7810 ID-1. Retorna os pontos
 * extremos esquerdo/direito do retângulo encontrado, ou null se nada
 * suficientemente confiante for encontrado — a UI deve então cair para
 * marcação manual (arrastar os pontos), nunca travar a ferramenta.
 */
export async function detectCardEdges(
  source: ImageSource
): Promise<CardPointsResult | null> {
  const cv = await loadOpenCv();

  const width = 'videoWidth' in source ? source.videoWidth : source.width;
  const height = 'videoHeight' in source ? source.videoHeight : source.height;
  if (!width || !height) return null;

  // cv.imread aceita um elemento canvas/img/video diretamente no browser.
  const src = cv.imread(source as unknown as HTMLCanvasElement);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const dilated = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 2);
    cv.findContours(
      dilated,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );

    const imageArea = width * height;
    let best: { left: number; right: number; y: number; score: number } | null =
      null;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const approx = new cv.Mat();
      const perimeter = cv.arcLength(contour, true);
      cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

      if (approx.rows === 4) {
        const rect = cv.boundingRect(approx);
        const area = rect.width * rect.height;
        const areaRatio = area / imageArea;
        // O cartão deve ocupar uma fração razoável da foto (nem um pixel
        // perdido, nem a foto inteira) e ter a proporção de aspecto de um
        // cartão ID-1, em qualquer orientação (retrato ou paisagem).
        if (areaRatio > 0.01 && areaRatio < 0.85) {
          const aspect = rect.width / rect.height;
          const aspectDiff = Math.min(
            Math.abs(aspect - CARD_ASPECT_RATIO),
            Math.abs(1 / aspect - CARD_ASPECT_RATIO)
          );
          if (aspectDiff < CARD_ASPECT_TOLERANCE) {
            // Prioriza contornos maiores (mais confiantes) entre os que
            // passam no filtro de proporção.
            const score = areaRatio - aspectDiff * 0.1;
            if (!best || score > best.score) {
              best = {
                left: rect.x,
                right: rect.x + rect.width,
                y: rect.y + rect.height / 2,
                score
              };
            }
          }
        }
      }
      approx.delete();
      contour.delete();
    }

    if (!best) return null;

    return {
      cardLeft: { x: best.left, y: best.y },
      cardRight: { x: best.right, y: best.y }
    };
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    dilated.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
}
