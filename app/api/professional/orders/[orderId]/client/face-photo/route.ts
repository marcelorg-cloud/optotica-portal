import { photoWorkflow } from '@/lib/tryon/photo-workflow';
export const maxDuration = 300;
type Context = { params: Promise<{ orderId: string }> };
export async function POST(request: Request, { params }: Context) { return photoWorkflow(request, (await params).orderId); }
export async function PATCH(request: Request, { params }: Context) { return photoWorkflow(request, (await params).orderId); }
