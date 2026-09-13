// Extração só da armação (sem lente, sem haste, sem fundo) — pedido do
// usuário (13/09/2026, 3ª rodada), depois de ver o primeiro resultado real
// do "Processar com IA": a cor saiu errada e a área da lente (o vidro,
// dentro do aro) continuou visível/opaca no resultado, quando devia ficar
// transparente — junto com qualquer pedaço de haste que aparece atrás em
// fotos um pouco de ângulo.
//
// Causa raiz dos dois problemas: `lib/catalog/background-removal.ts`
// (modelo genérico 851-labs/background-remover) trata o óculos inteiro como
// UM objeto só — ele recorta em volta da silhueta (tira o fundo do
// AMBIENTE), mas não sabe que o vidro da lente, por dentro do aro, devia
// virar um buraco transparente. Isso explica os dois sintomas: (1) a lente
// continua opaca no resultado final; (2) a cor média usada pra recolorir
// (calculada em cima da foto de referência de cor já "sem fundo") incluía os
// pixels acinzentados/embaçados da lente, puxando a cor pro cinza em vez da
// cor real da armação.
//
// Correção: troca o modelo genérico por `schananas/grounded_sam` (Grounding
// DINO + Segment Anything), que aceita um prompt de texto POSITIVO (o que
// entra na máscara) e um NEGATIVO (o que é subtraído dela) — dá pra pedir só
// a armação, já excluindo lente e haste numa passada só. Isso substitui
// `removeBackground()` neste pipeline: resolve fundo + lente + haste ao
// mesmo tempo, e corrige de tabela a amostra de cor (sem mais pixel de
// lente contaminando a média em frame-recolor.ts).
//
// Como qualquer segmentação por IA, a precisão do prompt não é garantida —
// isso PRECISA ser conferido visualmente pelo master no passo de
// Validar/Rejeitar que já existe, principalmente em armações com aro fino
// ou lente muito grande (mais chance de sobra na borda).

import sharp from 'sharp';
import Replicate from 'replicate';

// Versão fixa (mesma razão da versão fixa em background-removal.ts: chamar
// sem versão pode bater no atalho "official models" da API, que devolve 404
// pra modelos que não o habilitaram). Hash pego em
// replicate.com/schananas/grounded_sam/versions em 13/09/2026, confirmado
// resolvendo pra uma página de versão válida.
const MODEL_VERSION = 'schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c';

// Prompts em inglês (o modelo é treinado em inglês — testes com prompt em
// português tendem a sair pior nesse tipo de modelo). "eyeglasses frame,
// glasses rim, eyewear" tenta pegar só a armação (frente + aro); a lista
// negativa tenta excluir o vidro da lente e a haste.
const MASK_PROMPT = 'eyeglasses frame, glasses rim, eyewear';
const NEGATIVE_MASK_PROMPT = 'lens, glass, lenses, temple, temple arm, hinge';

/**
 * Baixa a foto original (por URL assinada, temporária — mesmo padrão de
 * `removeBackground`) e devolve só a armação: fundo, lente e haste
 * transparentes. Pronta pra entrar em `buildProcessedFrameImage`
 * (frame-recolor.ts) no lugar do resultado de `removeBackground`.
 */
export async function extractFrameOnly(imageUrl: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN não configurado.');
  }
  const replicate = new Replicate({ auth: token });

  const [originalResponse, output] = await Promise.all([
    fetch(imageUrl),
    replicate.run(MODEL_VERSION, {
      input: {
        image: imageUrl,
        mask_prompt: MASK_PROMPT,
        negative_mask_prompt: NEGATIVE_MASK_PROMPT
      }
    })
  ]);
  if (!originalResponse.ok) {
    throw new Error(`Não foi possível baixar a foto original (status ${originalResponse.status}).`);
  }
  const originalBuffer = Buffer.from(await originalResponse.arrayBuffer());

  // O código-fonte deste modelo (github.com/schananas/grounded_sam_replicate)
  // devolve 4 imagens, sempre nesta ordem: imagem anotada com a máscara
  // positiva, imagem anotada com a negativa, a MÁSCARA final (positiva menos
  // negativa, em preto e branco) e a máscara invertida. Só a 3ª (índice 2)
  // interessa aqui.
  const maskUrl = resolveMaskUrl(output);
  const maskResponse = await fetch(maskUrl);
  if (!maskResponse.ok) {
    throw new Error(`Não foi possível baixar a máscara da armação (status ${maskResponse.status}).`);
  }
  const maskBuffer = Buffer.from(await maskResponse.arrayBuffer());

  return applyMaskAsAlpha(originalBuffer, maskBuffer);
}

function resolveMaskUrl(output: unknown): string {
  if (Array.isArray(output)) {
    if (output.length < 3) throw new Error('Resposta inesperada do modelo de máscara (menos de 3 imagens).');
    return resolveOne(output[2]);
  }
  throw new Error('Formato de resposta do modelo de máscara não reconhecido.');
}

function resolveOne(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && 'url' in item) {
    const urlMember = (item as { url: unknown }).url;
    const resolved = typeof urlMember === 'function' ? (urlMember as () => unknown)() : urlMember;
    if (typeof resolved === 'string') return resolved;
    if (resolved instanceof URL) return resolved.toString();
  }
  throw new Error('Formato de item de máscara não reconhecido.');
}

/**
 * Usa o cinza da máscara (0=preto/fora da armação, 255=branco/armação) como
 * canal alfa da foto original — onde a máscara é preta, o resultado fica
 * transparente (fundo, lente, haste); onde é branca, mantém a cor real da
 * foto (a recoloração entra depois, em frame-recolor.ts).
 */
export async function applyMaskAsAlpha(originalBuffer: Buffer, maskBuffer: Buffer): Promise<Buffer> {
  const original = sharp(originalBuffer).ensureAlpha();
  const { width, height } = await original.metadata();
  if (!width || !height) throw new Error('Não foi possível ler as dimensões da foto original.');

  const { data: originalData } = await original.raw().toBuffer({ resolveWithObject: true });

  // A máscara pode sair em resolução diferente da foto original (o modelo
  // pode redimensionar internamente) — ajusta pro mesmo tamanho antes de
  // combinar.
  const { data: maskData } = await sharp(maskBuffer)
    .resize(width, height)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(originalData);
  for (let i = 0; i < maskData.length; i++) {
    out[i * 4 + 3] = maskData[i];
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
