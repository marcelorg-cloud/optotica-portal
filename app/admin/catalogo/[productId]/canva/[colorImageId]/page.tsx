import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireMaster } from '@/lib/catalog/require-master';
import { CanvaTryonWorkspace } from '@/components/catalog/canva-tryon-workspace';

export const metadata: Metadata = { title: 'Foto de prova no Canva — Optótica' };
export default async function CanvaTryonPage({ params }: {
  params: Promise<{ productId: string; colorImageId: string }>;
}) {
  const auth = await requireMaster();
  if (!auth.ok) redirect(auth.status === 401 ? '/entrar?profissional=1' : '/profissional');
  const { productId, colorImageId } = await params;
  return <div className="page-shell"><CanvaTryonWorkspace productId={productId} colorId={colorImageId} /></div>;
}
