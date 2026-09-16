import { NextResponse } from 'next/server';
import { verificationActor, verificationBucket } from '@/lib/verification-auth';
import { documentKinds } from '@/lib/prescription-verification';
export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string; kind: string }> }) {
  const actor = await verificationActor();
  if (!actor) return new NextResponse('Faça login.', { status: 401 });
  const { requestId, kind } = await params;
  if (!Object.hasOwn(documentKinds, kind) && kind !== 'attestation') return new NextResponse('Não encontrado.', { status: 404 });
  const { data: record } = await actor.admin.from('professional_verification_requests').select('professional_profile_id,documents,attestation_path').eq('id', requestId).maybeSingle();
  if (!record || (!actor.master && actor.profile?.id !== record.professional_profile_id)) return new NextResponse('Não encontrado.', { status: 404 });
  const path = kind === 'attestation' ? record.attestation_path : record.documents[kind]?.path;
  if (!path) return new NextResponse('Não encontrado.', { status: 404 });
  const { data, error } = await actor.admin.storage.from(verificationBucket).download(path);
  if (error || !data) return new NextResponse('Documento indisponível.', { status: 503 });
  return new NextResponse(data, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${kind}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
