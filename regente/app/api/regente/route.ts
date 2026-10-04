import { NextResponse } from "next/server";
import { askRegent } from "../../../lib/regente";
import { requireMaster } from "../../../lib/require-master";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMaster();

  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.status === 401 ? "unauthorized" : "forbidden",
        message: auth.message,
      },
      { status: auth.status },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error: "setup_required",
        message: "OPENAI_API_KEY ainda não foi configurada no ambiente do Regente.",
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const objective =
      typeof body.objective === "string" ? body.objective.trim() : "";
    const context =
      typeof body.context === "string" ? body.context.trim() : "";
    const budgetTier = ["minimal", "controlled", "flexible"].includes(
      body.budgetTier,
    )
      ? body.budgetTier
      : "minimal";

    if (!objective) {
      return NextResponse.json(
        { error: "objective_required" },
        { status: 400 },
      );
    }

    const output = await askRegent({ objective, context, budgetTier });
    return NextResponse.json({ mode: "advisory", output });
  } catch (error) {
    console.error("Regente error", error);
    return NextResponse.json(
      { error: "regent_failed", message: "Falha ao consultar o Regente." },
      { status: 500 },
    );
  }
}
