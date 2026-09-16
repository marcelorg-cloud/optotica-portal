import { photoWorkflow } from '@/lib/tryon/photo-workflow';
export const maxDuration = 300;
export async function POST(request: Request) { return photoWorkflow(request); }
export async function PATCH(request: Request) { return photoWorkflow(request); }
