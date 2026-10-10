import type { AgentInputItem } from "@openai/agents";

/** Planning A2 consumes textual evidence; it does not audit remote images. */
export function textWorkerContext(value: string) {
  return value.replace(/https:\/\/[^\s"'<>`]+/g, (candidate) => {
    try {
      const url = new URL(candidate);
      const ephemeral = /(?:^|\.)canva\.com$/i.test(url.hostname) &&
        /\/api\/design\/|export|preview|download/i.test(url.href);
      const signed = [...url.searchParams.keys()].some((key) => /^(?:x-amz-|x-goog-|signature$|sig$|token$|access_token$|refresh_token$|client_secret$)/i.test(key));
      const image = /(?:preview|export|\.(?:png|jpe?g|webp)(?:\?|$))/i.test(url.href);
      return ephemeral || signed || image ? "[referência de mídia preservada no output original; acesso visual não verificado nesta fase]" : candidate;
    } catch { return candidate; }
  });
}

export function buildWorkerInput(node: string, prompt: string, visualUrls: string[]): string | AgentInputItem[] {
  if (node === "A2") return textWorkerContext(prompt);
  return visualUrls.length ? [{ role: "user", content: [
    { type: "input_text", text: prompt },
    ...visualUrls.map((image) => ({ type: "input_image" as const, image, detail: "high" as const })),
  ] }] : prompt;
}
