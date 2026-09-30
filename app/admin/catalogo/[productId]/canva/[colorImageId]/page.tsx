import { redirect } from 'next/navigation';
import { requireMaster } from '@/lib/catalog/require-master';

export default async function CanvaTryonPage({ params }: {
  params: Promise<{ productId: string; colorImageId: string }>;
}) {
  const auth = await requireMaster();
  if (!auth.ok) redirect(auth.status === 401 ? '/entrar?profissional=1' : '/profissional');
  const { productId, colorImageId } = await params;
  redirect(`/admin/catalogo/${productId}/canva#cor-${colorImageId}`);
}
