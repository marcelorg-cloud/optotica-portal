import { redactSecrets } from "./phase-control.ts";

export const OUTPUT_PREVIEW_CHARS = 24_000;
type EvidenceRow = Record<string, unknown>;

/** Mask secrets without truncating the downloadable document. */
export function safeArtifact(value: unknown, depth = 0): unknown {
  if (depth > 40) return "[estrutura excede limite de profundidade]";
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => safeArtifact(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    const sensitive = /^(?:.*[_-])?(?:password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)(?:[_-].*)?$/i.test(normalized);
    return [key, sensitive ? "[campo sensível omitido]" : safeArtifact(item, depth + 1)];
  }));
  return value ?? null;
}

export function artifactDocument(value: unknown) {
  const safe = safeArtifact(value);
  if (typeof safe === "string") return safe;
  if (safe && typeof safe === "object" && !Array.isArray(safe)) {
    const { result, ...metadata } = safe as Record<string, unknown>;
    if (typeof result === "string") return result + (Object.keys(metadata).length ? "\n\n## Evidências e limites registrados\n\n```json\n" + JSON.stringify(metadata, null, 2) + "\n```\n" : "");
  }
  return JSON.stringify(safe, null, 2) || "";
}

export function artifactLinks(text: string) {
  const links = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s\"'<>`]+/g)) {
    if (links.size >= 25) break;
    try {
      const url = new URL(match[0].replace(/[.,;)\]]+$/, ""));
      if (url.username || url.password || /\[segredo|token|client_secret|api_key|authorization/i.test(url.href)) continue;
      if (url.protocol === "https:" || url.protocol === "http:") links.add(url.href);
    } catch { /* Never fetch or treat these links as verified evidence. */ }
  }
  return [...links];
}

export function buildArtifactOutputs(input: { taskId: string; steps: EvidenceRow[]; runs: EvidenceRow[]; reviews: EvidenceRow[] }) {
  const entries = [
    ...input.steps.filter((row) => row.artifact != null).map((row) => ({
      id: `step-${row.step_number}-v${row.revision || 1}`, step: Number(row.step_number), revision: Number(row.revision || 1),
      node: Array.isArray(row.node_ids) ? row.node_ids.join(", ") : "—", kind: String(row.role || "etapa"),
      source: "checkpoint", status: String(row.status), createdAt: row.completed_at || row.updated_at, output: row.artifact,
    })),
    ...input.runs.filter((row) => row.output != null).map((row) => ({
      id: `run-${row.id}`, step: Number(row.step_number), revision: Number((row.input as { stepRevision?: number } | null)?.stepRevision || 1),
      node: String(row.node_id || "—"), kind: String(row.adapter || "execução"), source: "execução",
      status: String(row.status), createdAt: row.updated_at || row.created_at, output: row.output,
    })),
    ...input.reviews.filter((row) => row.output != null && row.decision === "superseded").map((row) => ({
      id: `review-${row.id}`, step: Number(row.step_number), revision: Number(row.revision || 1),
      node: "histórico", kind: "versão anterior preservada", source: "revisão", status: "superseded", createdAt: row.created_at, output: row.output,
    })),
  ].filter((entry) => !(entry.output as { deferred?: boolean } | null)?.deferred);
  return entries.map(({ output, ...entry }) => {
    const fullContent = artifactDocument(output);
    const filename = `etapa-${String(entry.step).padStart(2, "0")}-revisao-${entry.revision}-${entry.id.replace(/[^a-z0-9-]/gi, "")}.md`;
    return { ...entry, filename, fullContent,
      content: fullContent.length > OUTPUT_PREVIEW_CHARS ? fullContent.slice(0, OUTPUT_PREVIEW_CHARS) + "\n… [baixe o arquivo completo]" : fullContent,
      truncated: fullContent.length > OUTPUT_PREVIEW_CHARS, links: artifactLinks(fullContent), linksVerified: false,
      downloadUrl: `/api/tasks/${input.taskId}/outputs?download=${encodeURIComponent(entry.id)}`,
    };
  }).sort((a, b) => a.step - b.step || b.revision - a.revision || a.source.localeCompare(b.source));
}
