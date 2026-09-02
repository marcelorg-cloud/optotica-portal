function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: () => required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
};

export const serverEnv = {
  supabaseSecretKey: () => required('SUPABASE_SECRET_KEY'),
  metaVerifyToken: () => required('META_WEBHOOK_VERIFY_TOKEN'),
  metaAppSecret: () => required('META_APP_SECRET'),
  metaAccessToken: () => required('META_WHATSAPP_TOKEN'),
  metaPhoneNumberId: () => required('META_PHONE_NUMBER_ID'),
  metaGraphVersion: () => process.env.META_GRAPH_API_VERSION || 'v23.0'
};
