import { NextResponse } from "next/server";
import { REGENT_VERSION } from "../../../lib/phase-control";

export function GET() {
  return NextResponse.json({
    name: "Regente Optótica", version: REGENT_VERSION,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.REGENT_SOURCE_COMMIT || null,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    policy: "single_phase_human_validation", deepSeekVersion: "0.8",
  }, { headers: { "Cache-Control": "no-store" } });
}
