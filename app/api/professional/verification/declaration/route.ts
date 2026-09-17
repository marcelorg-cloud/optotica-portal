import { NextResponse } from 'next/server';
import { verificationActor } from '@/lib/verification-auth';
import { createVerificationDeclaration } from '@/lib/verification-declaration-pdf';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const actor = await verificationActor();
  if (!actor) return new NextResponse('Faça login.', { status: 401 });
  if (!actor.profile || actor.profile.account_type !== 'professional') return new NextResponse('Cadastro individual necessário.', { status: 403 });
  const { data: profile, error } = await actor.admin.from('professional_profiles')
    .select('display_name,professional_kind,cnpj,council_registration,technical_responsible_registration,address_line,address_number,address_complement,district,city,state,postal_code,email')
    .eq('id', actor.profile.id).eq('user_id', actor.user.id).maybeSingle();
  if (error || !profile) return new NextResponse('Não foi possível carregar o perfil.', { status: 503 });
  const registration = profile.council_registration || profile.technical_responsible_registration;
  if (!profile.display_name || !profile.cnpj || !registration) return new NextResponse('Preencha nome, CPF e registro no perfil antes de baixar a declaração.', { status: 422 });
  try {
    const bytes = await createVerificationDeclaration({
      name: profile.display_name,
      category: profile.professional_kind === 'optometrist_bachelor' ? 'Optometrista bacharel' : 'Optometrista',
      document: profile.cnpj.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'),
      registration,
      address: [profile.address_line, profile.address_number, profile.address_complement, profile.district, profile.city, profile.state, profile.postal_code].filter(Boolean).join(', '),
      email: profile.email || actor.user.email || 'Não informado',
    });
    return new NextResponse(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="declaracao-veracidade-optotica.pdf"',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return new NextResponse('Não foi possível gerar a declaração. Tente novamente.', { status: 503 }); }
}
