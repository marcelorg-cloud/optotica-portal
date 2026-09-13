// Recoloração da foto de posição via IA generativa com prompt — pedido do
// usuário (13/09/2026, 4ª rodada), depois de testar a segmentação
// automática da 3ª rodada (schananas/grounded_sam, lib/catalog/
// frame-mask.ts) na prática e ela não segmentar bem o suficiente ("nao esta
// funcionando bem").
//
// Ideia nova, mais simples e mais robusta: em vez de pedir pra uma IA
// adivinhar onde é fundo/lente/haste (o que estava saindo impreciso), o
// master agora sobe a foto de POSIÇÃO já recortada por fora do sistema
// (Photoshop, remove.bg, etc.) — fundo e lente já transparentes, só uma vez
// por produto, mesmo upload/rota de sempre ("Foto de posição do produto",
// migração 202609130009). A foto de CADA COR continua sendo a foto crua de
// sempre (com fundo, sem nenhum recorte) — a IA passa a ter um único
// trabalho: olhar as duas fotos e recolorir a armação da foto de posição
// pra bater com a cor/brilho/estampa reais da foto da cor.
//
// Por que isso é mais confiável que a abordagem da 3ª rodada
// (grounded_sam + recolor matemático por luminância, lib/catalog/
// frame-mask.ts): a transparência (fundo, lente, haste) deixa de depender
// de qualquer IA — é a mesma máscara alfa que o master já recortou à mão,
// então nunca sai errada. A IA só decide a COR dos pixels que já sabemos
// que são armação (reaplicamos a máscara alfa ORIGINAL por cima do
// resultado da IA no final, descartando qualquer coisa que ela pinte fora
// da forma já recortada — inclusive se ela invadir a área da lente ou
// pintar um fundo).
//
// Modelo: google/nano-banana (Gemini 2.5 Flash Image, hospedado no
// Replicate) — aceita várias imagens de entrada de uma vez + um prompt de
// texto livre, o tipo de tarefa "pega a cor/textura desta outra foto e
// aplica nesta aqui, mantendo o resto igual". Chamado SEM versão fixa, ao
// contrário de 851-labs/background-remover e schananas/grounded_sam (seções
// 0.40/0.41 — modelos comunitários, sem o atalho de "official models" da
// API do Replicate): google/nano-banana é um modelo "oficial" de parceiro
// grande (Google), e esses são feitos pra funcionar justamente por esse
// atalho sem precisar de hash de versão.
//
// IMPORTANTE — o que NÃO foi testado nesta sessão (sem REPLICATE_API_TOKEN
// aqui, chamada direta à API do Replicate bloqueada pelo proxy do sandbox):
// (1) o nome exato dos campos de entrada do modelo (`prompt`/`image_input`
// — usados aqui pela documentação/exemplos públicos consultados, mas o
// schema completo em JSON não pôde ser lido); (2) a qualidade real da
// recoloração em fotos de óculos de verdade. Se o teste real der um erro
// de campo de entrada não reconhecido (ex.: "Invalid input" citando um
// nome de campo), o nome certo pode ser visto na própria mensagem de erro
// (o Replicate normalmente informa quais campos existem) — me manda a
// mensagem que eu ajusto. Se dar 404, é o mesmo sintoma das seções
// 0.40/0.41: aí sim precisa achar um hash de versão em
// replicate.com/google/nano-banana/versions e chamar
// 'google/nano-banana:HASH' em vez do nome nu.
import sharp from 'sharp';
import Replicate from 'replicate';
import { cropToSquareEdgeToEdge } from './frame-recolor';

const MODEL = 'google/nano-banana';

const PROMPT = `You will be given two images of eyeglasses.
Image 1 is an eyeglasses frame seen from the front, already cut out with a transparent background — this is the target shape, pose and framing.
Image 2 shows the same frame model's real color, seen from a different angle, with its own background.
Recolor the frame in Image 1 so its color, material, shine, highlights, reflections and any pattern (such as tortoiseshell, leopard print or marble) exactly match the frame shown in Image 2.
Do not change the shape, angle, pose, size, proportions or framing of Image 1. Do not add, remove or alter the background or the lens area of Image 1 — keep those exactly as they are.
Only change the color and surface appearance of the frame material itself. Output an image with the same dimensions as Image 1.`;

/**
 * Recebe a URL assinada da foto de posição (já recortada pelo master — PNG
 * com fundo/lente transparentes) e da foto de referência de cor (crua, com
 * fundo). Devolve o PNG final: a forma/transparência vêm sempre da foto de
 * posição original; só a cor dos pixels da armação vem do resultado da IA.
 * Já sai recortado e enquadrado no formato quadrado (reaproveita
 * `cropToSquareEdgeToEdge` de frame-recolor.ts).
 */
export async function recolorFrameWithReference(positionImageUrl: string, colorReferenceImageUrl: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN não configurado.');
  }
  const replicate = new Replicate({ auth: token });

  // Só UMA chamada ao Replicate nesta versão (ao contrário das seções
  // 0.40/0.41, que precisavam de duas — uma pra cada foto — e por isso
  // tinham que rodar em sequência pra não colidir com o limite de "burst de
  // 1" da conta). Aqui dá pra baixar a foto de posição (Supabase, não
  // Replicate) em paralelo com a única chamada à IA, sem esse risco.
  const [positionResponse, output] = await Promise.all([
    fetch(positionImageUrl),
    replicate.run(MODEL, {
      input: {
        prompt: PROMPT,
        image_input: [positionImageUrl, colorReferenceImageUrl]
      }
    })
  ]);
  if (!positionResponse.ok) {
    throw new Error(`Não foi possível baixar a foto de posição (status ${positionResponse.status}).`);
  }
  const positionBuffer = Buffer.from(await positionResponse.arrayBuffer());

  const aiUrl = resolveOutputUrl(output);
  const aiResponse = await fetch(aiUrl);
  if (!aiResponse.ok) {
    throw new Error(`Não foi possível baixar o resultado da IA (status ${aiResponse.status}).`);
  }
  const aiBuffer = Buffer.from(await aiResponse.arrayBuffer());

  const combined = await applyOriginalAlphaOverAiColor(positionBuffer, aiBuffer);
  return cropToSquareEdgeToEdge(combined);
}

// Mesmo tratamento defensivo de formato de saída já usado em
// background-removal.ts e frame-mask.ts: o SDK do Replicate pode devolver
// uma URL simples, um array de URLs, ou um objeto "FileOutput" com .url().
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
 * Usa a COR (RGB) do resultado da IA, mas mantém a TRANSPARÊNCIA (canal
 * alfa) exatamente igual à foto de posição original recortada pelo master —
 * assim, fundo, lente, ou qualquer borda que a IA pinte por engano fora da
 * armação nunca aparecem no resultado final, não importa o que a IA gerar
 * ali fora.
 */
export async function applyOriginalAlphaOverAiColor(positionBuffer: Buffer, aiBuffer: Buffer): Promise<Buffer> {
  const position = sharp(positionBuffer).ensureAlpha();
  const { width, height } = await position.metadata();
  if (!width || !height) throw new Error('Não foi possível ler as dimensões da foto de posição.');

  const { data: positionData } = await position.raw().toBuffer({ resolveWithObject: true });

  // A imagem da IA pode sair em resolução/proporção diferente da foto de
  // posição original — redimensiona (achatando, sem cortar) pro mesmo
  // tamanho antes de combinar.
  const { data: aiData } = await sharp(aiBuffer)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(positionData); // começa com a foto de posição — mantém o alfa dela intacto
  for (let i = 0; i < out.length; i += 4) {
    out[i] = aiData[i];
    out[i + 1] = aiData[i + 1];
    out[i + 2] = aiData[i + 2];
    // out[i + 3] (alfa) não é tocado — continua o da foto de posição original.
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
