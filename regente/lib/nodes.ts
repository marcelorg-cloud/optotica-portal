export type NetworkNode = {
  id: string;
  type: "agent" | "tool";
  technology: string;
  role: string;
  status: "current" | "assisted" | "integrating" | "confirm";
};

export const NETWORK_NODES: NetworkNode[] = [
  { id: "A1", type: "agent", technology: "ChatGPT", role: "Engenharia Optótica", status: "current" },
  { id: "A2", type: "agent", technology: "ChatGPT", role: "Produto e fluxos Optótica", status: "current" },
  { id: "A3", type: "agent", technology: "ChatGPT", role: "Conteúdo ENSAVIM", status: "current" },
  { id: "A4", type: "agent", technology: "OpenAI", role: "Guardião externo: revisão independente e recovery de segunda linha", status: "assisted" },
  { id: "A5", type: "agent", technology: "Local / Supabase", role: "Afinamento básico e preflight determinístico", status: "current" },
  { id: "A6", type: "agent", technology: "Claude", role: "Guardião externo: contraponto, arquitetura e programação", status: "integrating" },
  { id: "F1", type: "tool", technology: "GitHub", role: "Optótica Portal / repositório", status: "current" },
  { id: "F2", type: "tool", technology: "Vercel", role: "Optótica Portal / execução", status: "current" },
  { id: "F3", type: "tool", technology: "Supabase", role: "Banco e backend Optótica", status: "current" },
  { id: "F4", type: "tool", technology: "Replicate", role: "Imagens do catálogo", status: "current" },
  { id: "F5", type: "tool", technology: "Canva", role: "Prova Online / produtos", status: "assisted" },
  { id: "F6", type: "tool", technology: "Canva", role: "Criativos ENSAVIM", status: "confirm" },
  { id: "F7", type: "tool", technology: "HeyGen", role: "ENSAVIM / Lia", status: "current" },
  { id: "F8", type: "tool", technology: "RapidAPI", role: "AliExpress / catálogo", status: "current" },
  { id: "F9", type: "tool", technology: "Meta / WhatsApp", role: "Optótica", status: "integrating" },
  { id: "F10", type: "tool", technology: "Resend", role: "E-mails Optótica", status: "confirm" },
  { id: "F11", type: "tool", technology: "Cloudflare", role: "Domínio / rede Optótica", status: "confirm" },
  { id: "F12", type: "tool", technology: "Google Drive", role: "Arquivos dos projetos", status: "current" },
  { id: "F13", type: "tool", technology: "Google Docs", role: "Documentação dos projetos", status: "current" },
  { id: "F14", type: "tool", technology: "Google Planilhas", role: "Matriz da rede", status: "current" },
];

export const NODE_SUMMARY = NETWORK_NODES
  .map((node) => `${node.id} | ${node.type} | ${node.technology} | ${node.role} | ${node.status}`)
  .join("\n");
