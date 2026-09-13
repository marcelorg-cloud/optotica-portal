// Remoção de fundo/hastes das fotos de armação (Fila de Aprovação IA — decisão
// tomada em 11/09/2026: usar um modelo open-source hospedado no Replicate, em
// vez de uma API paga tipo remove.bg ou recorte 100% manual pelo master).
//
// Modelo escolhido: 851-labs/background-remover (transparent-background,
// ~32M execuções no Replicate, ~$0,00036/execução, output PNG com alpha).
// Requer a variável de ambiente REPLICATE_API_TOKEN configurada na Vercel
// (Project Settings → Environment Variables) — sem ela, esta função lança e
// a rota que a chama devolve uma mensagem pedindo pra configurar.
//
// Este módulo só roda no servidor (rota de API) — ao contrário de
// lib/dnp-vision.ts, aqui não há restrição de rodar no navegador, mas também
// não teria sentido: a chamada precisa da chave secreta do Replicate.

import Replicate from 'replicate';

// Chamar `replicate.run('851-labs/background-remover', ...)` SEM versão faz o
// SDK bater em POST /models/851-labs/background-remover/predictions (o atalho
// "official models" da API do Replicate) — achado em produção (13/09/2026):
// esse endpoint devolve 404 pra este modelo específico (ele não está habilitado
// pra esse atalho, só pro endpoint clássico por versão). A correção é fixar a
// versão e chamar por ela (`owner/nome:hash`), que o SDK roteia pro endpoint
// clássico POST /predictions com `version: hash` — sempre funciona pra
// qualquer modelo público do Replicate.
//
// Hash pego em replicate.com/851-labs/background-remover/versions (página
// pública do modelo) em 13/09/2026. Se o Replicate arquivar essa versão no
// futuro (o modelo passa a rejeitar esse hash), pegue o hash novo na mesma
// página e troque só a constante abaixo.
const MODEL_VERSION = '851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc';

/**
 * Envia a foto original (por URL assinada, temporária) pro modelo de
 * remoção de fundo e devolve os bytes do PNG resultante (fundo transparente).
 * Não faz nenhum upload/gravação — quem chama decide onde salvar.
 */
export async function removeBackground(imageUrl: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN não configurado.');
  }

  const replicate = new Replicate({ auth: token });
  const output = await replicate.run(MODEL_VERSION, { input: { image: imageUrl } });
  const fileUrl = resolveOutputUrl(output);

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Não foi possível baixar a imagem processada (status ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// A saída do SDK do Replicate pode vir em formatos diferentes conforme a
// versão do pacote/modelo: uma URL simples (string), um array de URLs (um
// resultado por imagem de entrada), ou um objeto "FileOutput" mais novo do
// SDK com um método .url(). Tratamos os três pra não travar numa mudança de
// versão do pacote `replicate`.
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
