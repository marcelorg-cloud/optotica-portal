import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireMaster } from '@/lib/catalog/require-master';
import { CanvaBatchWorkspace } from '@/components/catalog/canva-batch-workspace';

export const metadata: Metadata = { title: 'Lote de fotos de prova no Canva — Optótica' };
export default async function CanvaBatchPage({ params }: { params: Promise<{ productId: string }> }) {
  const auth = await requireMaster();
  if (!auth.ok) redirect(auth.status === 401 ? '/entrar?profissional=1' : '/profissional');
  const { productId } = await params;
  return <div className="page-shell"><CanvaBatchWorkspace productId={productId} /></div>;
}
