// 13/09/2026: `required(name)` lia `process.env[name]` (chave dinâmica, via
// variável). Isso funciona no servidor (Node lê process.env de verdade em
// tempo de execução), mas QUEBRA para as variáveis NEXT_PUBLIC_* usadas no
// navegador: o compilador do Next só consegue "gravar" o valor de uma
// variável NEXT_PUBLIC_* dentro do bundle do navegador quando o código-fonte
// tem o acesso literal `process.env.NEXT_PUBLIC_ALGO` escrito por extenso —
// `process.env[name]` com nome vindo de variável não é reconhecido, e no
// navegador `process.env` não existe como objeto de verdade (não é Node),
// então a leitura sempre dava vazio. Resultado: mesmo com a variável
// certinha cadastrada na Vercel e o deploy recompilado do zero, o clique em
// "Salvar foto de posição" (que usa o cliente Supabase do navegador) sempre
// falhava com "Variável obrigatória ausente: NEXT_PUBLIC_SUPABASE_URL" —
// porque essa chamada especificamente roda no navegador, e não no servidor.
// Corrigido escrevendo cada `process.env.NOME_LITERAL` por extenso, para o
// compilador conseguir substituir o valor real em todo bundle (servidor e
// navegador) durante o build.
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: () => required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
};

export const serverEnv = {
  supabaseSecretKey: () => required('SUPABASE_SECRET_KEY', process.env.SUPABASE_SECRET_KEY),
  metaVerifyToken: () => required('META_WEBHOOK_VERIFY_TOKEN', process.env.META_WEBHOOK_VERIFY_TOKEN),
  metaAppSecret: () => required('META_APP_SECRET', process.env.META_APP_SECRET),
  metaAccessToken: () => required('META_WHATSAPP_TOKEN', process.env.META_WHATSAPP_TOKEN),
  metaPhoneNumberId: () => required('META_PHONE_NUMBER_ID', process.env.META_PHONE_NUMBER_ID),
  metaGraphVersion: () => process.env.META_GRAPH_API_VERSION || 'v23.0'
};
