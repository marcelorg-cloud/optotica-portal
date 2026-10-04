import { redirect } from "next/navigation";
import { requireMaster } from "../lib/require-master";
import { RegenteClient } from "./regente-client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await requireMaster();

  if (!auth.ok) {
    if (auth.status === 401) {
      redirect("/entrar/master");
    }

    redirect("/acesso-negado");
  }

  return <RegenteClient />;
}
