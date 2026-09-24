import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { CanvaError, sameOrigin } from '@/lib/canva/security';
import { saveTemplate } from '@/lib/canva/template';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  if (!sameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  try {
    if (Number(request.headers.get('content-length')) > 1500000) throw new CanvaError('Arquivo maior que 1 MB.', 413);
    const form = await request.formData(), file = form.get('file');
    if (!(file instanceof File) || file.size > 1024 * 1024) throw new CanvaError('Envie um PNG de até 1 MB.');
    return NextResponse.json(await saveTemplate(auth.admin, auth.userId, Buffer.from(await file.arrayBuffer())));
  } catch (error) {
    return NextResponse.json({ message: error instanceof CanvaError ? error.message : 'Não foi possível cadastrar a imagem modelo.' },
      { status: error instanceof CanvaError ? error.status : 500 });
  }
}
