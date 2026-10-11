/** Deterministic assertions only. This never fetches URLs or certifies generative claims. */
export function deliveryAcceptance(output: unknown, node: string) {
  const value = output as { result?: unknown; reviewEvidence?: unknown; catalog?: { complete?: boolean; sha256?: string; bytes?: number; width?: number; height?: number; originalPreserved?: boolean; fidelity?: unknown } } | null;
  const catalog = value?.catalog;
  const checks = [
    { id: "output_present", state: output != null ? "verified" : "blocked", evidence: "checkpoint payload" },
    { id: "recipient_access", state: "not_verified", evidence: "Requer teste autenticado de abertura ou download; um link no texto não comprova acesso." },
    { id: "human_acceptance", state: "pending", evidence: "Aprovação persistida da revisão atual é necessária." },
  ];
  if (node === "F4") {
    checks.push({ id: "image_contract", state: catalog?.complete === true && catalog.width === 1040 && catalog.height === 320 &&
      Number(catalog.bytes) > 0 && Number(catalog.bytes) <= 200 * 1024 && /^[a-f0-9]{64}$/.test(catalog.sha256 || "") ? "verified" : "blocked", evidence: "Contrato do Portal: decodificação, dimensões, bytes e hash do arquivo persistido." });
    checks.push({ id: "original_preserved", state: catalog?.originalPreserved === true ? "verified" : "blocked", evidence: "Original somente lido; saída em caminho separado." });
    checks.push({ id: "product_fidelity", state: "pending", evidence: "Enquadramento determinístico não certifica cor, máscara ou fidelidade comercial. Conferência humana com original é necessária." });
  }
  return { version: "2026-10-11.1", checks, technicalAccepted: !checks.some((check) => check.state === "blocked"),
    deliveredToRecipient: false, publicationPerformed: false, humanAccepted: false };
}
