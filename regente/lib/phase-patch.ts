const EXECUTORS = new Set(["A1", "A2", "A3", "A4", "A5", "A6", "F6", "F9"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Small explicit human plan amendment, not arbitrary JSON or an automatic model rewrite. */
export function validatePhasePatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Configuração de fase inválida.");
  const patch = value as Record<string, unknown>;
  if (Object.keys(patch).some((key) => !["nodes", "canvaMode", "canvaSourceRunIds", "canvaDesignIds"].includes(key))) throw new Error("A alteração contém campos não autorizados.");
  if (!Array.isArray(patch.nodes) || patch.nodes.length !== 1 || !EXECUTORS.has(patch.nodes[0])) throw new Error("Escolha somente um executor para esta fase.");
  const nodes = patch.nodes as string[];
  if (nodes[0] !== "F6") return { nodes };
  if (!["inspect", "create"].includes(String(patch.canvaMode))) throw new Error("Declare inspecionar ou criar no Canva.");
  if (patch.canvaMode === "create") return { nodes, canvaMode: "create" };
  const sourceIds = patch.canvaSourceRunIds;
  const designIds = patch.canvaDesignIds;
  if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.length > 20 || sourceIds.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    !Array.isArray(designIds) || !designIds.length || designIds.length > 10 || designIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{6,80}$/.test(id))) {
    throw new Error("Inspeção exige IDs dos runs de origem e IDs Canva correspondentes, copiados dos outputs preservados.");
  }
  return { nodes, canvaMode: "inspect", canvaSourceRunIds: [...new Set(sourceIds as string[])], canvaDesignIds: [...new Set(designIds as string[])] };
}
