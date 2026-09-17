import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { verificationCodePattern } from '@/lib/prescription-verification';
import { verificationBucket } from '@/lib/verification-auth';
import { isCurrentVerification, publicVerificationDocument } from '@/lib/public-verification';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' };
export async function GET(_request: Request, { params }: { params: Promise<{ code: string; kind: string }> }) {
  const { code, kind } = await params;
  if (!verificationCodePattern.test(code) || !['diploma', 'registration'].includes(kind)) return new NextResponse('Não encontrado.', { status: 404, headers });
  try {
    const admin = createAdminSupabaseClient();
    const { data: rx, error } = await admin.from('issued_prescriptions').select('professional_profile_id,order_id,status').eq('verification_code', code).maybeSingle();
    if (error) throw error;
    if (!rx || rx.status !== 'active') return new NextResponse('Documento não disponível para esta prescrição.', { status: 404, headers });
    const [profileResult, reviewResult, orderResult] = await Promise.all([
      admin.from('professional_profiles').select('status,display_name,council_registration').eq('id', rx.professional_profile_id).maybeSingle(),
      admin.from('professional_verification_requests').select('id,status,professional_name,registration,valid_until,public_documents_consent_at,public_documents_checked,public_documents').eq('professional_profile_id', rx.professional_profile_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('orders').select('status').eq('id', rx.order_id).maybeSingle(),
    ]);
    if (profileResult.error || reviewResult.error || orderResult.error) throw new Error('Lookup failed');
    const review = reviewResult.data;
    if (!orderResult.data || orderResult.data.status === 'cancelled' || !review || !isCurrentVerification(profileResult.data, review)) return new NextResponse('Verificação não vigente.', { status: 404, headers });
    const document = publicVerificationDocument(rx.professional_profile_id, review, kind);
    if (!document) return new NextResponse('Versão pública indisponível.', { status: 404, headers });
    const { data, error: downloadError } = await admin.storage.from(verificationBucket).download(document.path);
    if (downloadError || !data) throw new Error('Download failed');
    const buffer = Buffer.from(await data.arrayBuffer());
    if (createHash('sha256').update(buffer).digest('hex') !== document.sha256) throw new Error('Integrity check failed');
    return new NextResponse(buffer, { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${kind === 'diploma' ? 'formacao' : 'registro-conselho'}-verificado.pdf"`, 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new NextResponse('Consulta temporariamente indisponível.', { status: 503, headers }); }
}
