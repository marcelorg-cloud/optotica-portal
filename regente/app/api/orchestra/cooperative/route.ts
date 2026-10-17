import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMaster } from "../../../../lib/require-master";
import {
  COOPERATIVE_VERSION, COORDINATOR_ROLES, COOPERATION_CHARTER, KNOWLEDGE_LAYERS,
  nextCoordinationWave, assessDetour,
} from "../../../../lib/cooperative-orchestra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store" };
const Work = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  description: z.string().min(1).max(240),
  dependsOn: z.array(z.string()).max(40),
  state: z.enum(["pending","running","succeeded","blocked","failed","deferred"]),
  priority: z.number().min(0).max(100),
  effect: z.enum(["read","write","irreversible"]),
  approved: z.boolean(),
  optional: z.boolean(),
}).strict();
const DryRun = z.object({
  dryRun: z.literal(true),
  items: z.array(Work).max(50),
  maxParallel: z.number().int().min(1).max(8).default(3),
  blockedId: z.string().optional(),
}).strict();

/** Only metadata; not a proof that organizers have run or that adapters are healthy. */
export async function GET() {
  const auth=await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" },{status:auth.status,headers:HEADERS});
  return NextResponse.json({
    version: COOPERATIVE_VERSION, mode: "foundation_dry_run",
    coordinationPlane: COORDINATOR_ROLES.map(({id,name,responsibility})=>({id,name,responsibility,operational:false})),
    networkPlane: "v0.7_executor_unchanged",
    knowledgeLayers: KNOWLEDGE_LAYERS,
    charter: COOPERATION_CHARTER,
    limits: { noProviderCalls:true, noPersistence:true, noTaskExecution:true, maxParallel:8 },
  },{headers:HEADERS});
}

/** Deterministic scheduler preview: no AI, no database writes, no external tools. */
export async function POST(request: Request) {
  const auth=await requireMaster();
  if (!auth.ok) return NextResponse.json({ error:"forbidden" },{status:auth.status,headers:HEADERS});
  const origin=request.headers.get("origin");
  if (!origin || origin!==new URL(request.url).origin) {
    return NextResponse.json({ error:"origin_required" },{status:403,headers:HEADERS});
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({error:"json_required"},{status:415,headers:HEADERS});
  }
  const parsed=DryRun.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:"invalid_score"},{status:400,headers:HEADERS});
  try {
    const {items,maxParallel,blockedId}=parsed.data;
    const wave=nextCoordinationWave(items,maxParallel);
    const detour=blockedId?assessDetour(items,blockedId):null;
    return NextResponse.json({
      version:COOPERATIVE_VERSION,mode:"dry_run",execution:"not_started",
      workflowPreserved:true,wave,detour,
    },{headers:HEADERS});
  } catch(error) {
    return NextResponse.json({
      error:"invalid_score_graph",
      detail:error instanceof Error ? error.message : "invalid",
    },{status:400,headers:HEADERS});
  }
}
