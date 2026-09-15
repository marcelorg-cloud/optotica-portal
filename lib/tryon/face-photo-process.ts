// "Foto de rosto para Prova Online" (15/09/2026) — Etapa 1 do atendimento
// vira a fonte principal da foto-base usada na prova virtual de óculos
// (substituindo, quando o profissional usa este card, o upload não
// processado que o próprio paciente podia fazer sozinho na área dele).
//
// Prompt revisado em português com o usuário antes de implementar (ver
// estado-consolidado.md) e traduzido pra inglês aqui só porque todo outro
// prompt de IA deste projeto (ver lib/catalog/gallery-photo-crop.ts) já é
// em inglês — mesmo texto, mesmas 5 regras:
// 1) recorte quadrado DE VERDADE (1:1 exato, preenchendo os 4 lados),
//    rosto centralizado, BEM ZOOMADO — margem pequena (~5-8%) acima do
//    cabelo, abaixo do queixo, E também nas laterais (ombros/braços), sem
//    sobrar fundo vazio grande em volta (regra ajustada 2x em 15/09/2026:
//    1º teste real contra o Replicate veio com espaço de sobra demais em
//    cima da cabeça — regra reescrita com margem quantificada; 2º teste
//    real veio com as margens verticais já boas, mas a imagem NÃO saía
//    quadrada de verdade — vinha um retrato mais estreito/vertical com
//    barras cinzas de padding nas laterais, geradas pela rede de segurança
//    determinística do sharp (`standardizeFacePhoto`, fit:'contain') que
//    só preenche as bordas sem a IA ter enquadrado largo o bastante — regra
//    reescrita de novo pra exigir explicitamente margens pequenas também
//    nas laterais, não só em cima/embaixo);
// 2) fundo trocado por cinza neutro liso (~#D9D9D9);
// 3) iluminação do rosto equalizada pra parecer frontal/uniforme (sem
//    sombra lateral forte), sem estourar pele nem mudar o tom de pele;
// 4) NUNCA mexer em feições/expressão/óculos que a pessoa já usa/cabelo;
// 5) resultado tem que continuar parecendo foto real, nunca ilustração.
//
// Mesmo modelo (`google/nano-banana`) já usado no catálogo — aqui numa
// única imagem por chamada (não precisa de imagem de referência extra,
// diferente do recorte de armação por cor).
//
// IMPORTANTE — ainda não testado NESTA SESSÃO contra o Replicate de verdade
// (mesma ressalva de sempre neste projeto: sem acesso à rede real por
// aqui) depois do ajuste de 15/09/2026 (2ª rodada) acima. Se o novo
// resultado ainda vier com barras cinzas nas laterais (ou cortar demais o
// rosto/ombros), mandar um exemplo real pra afinar de novo — é só questão
// de afinar o texto do prompt.
import Replicate from 'replicate';
import sharp from 'sharp';

const FACE_MODEL = 'google/nano-banana';

// Formato final: quadrado, tamanho generoso o bastante pra um rosto ficar
// nítido depois de composto com o óculos (a Prova Online já escala a
// armação em cima desta foto, ver lib/tryon/geometry.ts) — maior que as
// fotos de produto do catálogo (1040×320) porque aqui o "produto" é o
// rosto inteiro da pessoa, precisa de mais definição.
const OUTPUT_SIZE = 1024;

// Cor de fundo neutra pedida pelo usuário — usada tanto no prompt (pedida à
// IA) quanto como cor de padding do sharp (rede de segurança determinística
// caso a IA não entregue exatamente quadrado ou deixe alguma borda).
const NEUTRAL_GRAY = { r: 217, g: 217, b: 217 }; // #D9D9D9

// Teto de tamanho do arquivo final (maior que o das fotos de produto do
// catálogo — 200KB — porque um rosto tem muito mais detalhe/textura de
// pele, que precisa de mais qualidade de JPEG pra não ficar com blocagem
// visível). Mesma estratégia de qualidades decrescentes até caber.
const MAX_JPEG_BYTES = 400 * 1024;
const JPEG_QUALITY_STEPS = [88, 78, 68, 58, 48, 38];

const FACE_PROMPT = `This is a photo of a patient's face, meant to serve as the base image for a virtual eyeglasses try-on (a pair of eyeglasses will be composited on top of it afterward). Adjust the photo following exactly these rules, without changing the person's identity or real facial features:
1. Re-frame as a TIGHT, centered head-and-shoulders portrait and crop/extend the result to an EXACT 1:1 SQUARE aspect ratio — output width and output height must be equal, this is mandatory, not approximate. Fill the ENTIRE square on all four sides: the top margin above the hair and the bottom margin below the chin/neck must each be small (roughly 5-8% of the image height), AND the left and right margins beside the shoulders/arms must also be small (roughly 5-8% of the image width) — the head and shoulders must be wide enough to reach near the left and right edges of the square, not just tall enough to fill the height. Never deliver a narrower portrait/vertical-oriented crop padded with extra background on the sides to make it square — if the original photo is not square, ZOOM IN and/or EXTEND the background (matching rule 2's gray) so the final image is genuinely square with the face centered and filling it on both axes, not a narrower image sitting inside a square canvas. Center the face horizontally.
2. Replace the background completely with a solid, neutral, uniform gray (no texture, no gradient, no shadow on the background) — approximate color #D9D9D9.
3. Equalize the lighting on the face so it looks like even, soft, frontal lighting, as in a studio portrait — remove strong lateral/side shadows (for example, one side of the face noticeably darker than the other), without blowing out highlights on the skin or changing the person's real skin tone.
4. Do NOT change facial features, expression, any eyewear the person is already wearing, hairstyle, or any other identity detail — only adjust the background, framing, and lighting.
5. The result must still look like a realistic photograph — never a drawing, painting, or illustration.`;

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar a imagem (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Duplicado de propósito (mesmo padrão já usado em gallery-photo-crop.ts,
// frame-mask.ts etc. — cada arquivo de processamento de imagem deste
// projeto tem sua própria cópia pequena destes 2 helpers, em vez de criar
// um módulo compartilhado só pra isso).
async function runReplicate(model: `${string}/${string}`, input: Record<string, unknown>): Promise<unknown> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN não configurado.');
  const replicate = new Replicate({ auth: token });
  return replicate.run(model, { input });
}

function resolveOutputUrl(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    if (!output.length) throw new Error('Resposta vazia do Replicate.');
    return resolveOutputUrl(output[0]);
  }
  if (output && typeof output === 'object' && 'url' in output) {
    const urlMember = (output as { url: unknown }).url;
    const resolved = typeof urlMember === 'function' ? (urlMember as () => unknown)() : urlMember;
    if (typeof resolved === 'string') return resolved;
    if (resolved instanceof URL) return resolved.toString();
  }
  throw new Error('Formato de resposta do Replicate não reconhecido.');
}

/**
 * Garante determinístico o que o prompt só pede de forma aproximada:
 * exatamente quadrado e fundo cinza nas bordas, se a IA deixar alguma
 * sobra fora do quadrado. `fit: 'contain'` nunca corta o rosto que a IA já
 * enquadrou — só adiciona padding (na mesma cor cinza pedida) se a imagem
 * devolvida não vier perfeitamente quadrada.
 */
async function standardizeFacePhoto(buffer: Buffer): Promise<Buffer> {
  const pipeline = sharp(buffer)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'contain', background: NEUTRAL_GRAY });

  let smallest: Buffer | null = null;
  for (const quality of JPEG_QUALITY_STEPS) {
    const out = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (!smallest || out.byteLength < smallest.byteLength) smallest = out;
    if (out.byteLength <= MAX_JPEG_BYTES) return out;
  }
  return smallest as Buffer;
}

/**
 * Processa a foto de rosto crua (URL assinada da foto recém-enviada) pra
 * virar a base padronizada de prova online: quadrada, fundo cinza neutro,
 * iluminação equalizada. Lança erro (sem tratamento especial) se o
 * Replicate falhar — a rota que chama isto decide a mensagem pro usuário.
 */
export async function processFacePhoto(sourceUrl: string): Promise<Buffer> {
  const output = await runReplicate(FACE_MODEL, { prompt: FACE_PROMPT, image_input: [sourceUrl] });
  const aiUrl = resolveOutputUrl(output);
  const raw = await fetchImageBuffer(aiUrl);
  return standardizeFacePhoto(raw);
}
