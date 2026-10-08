export function designIdsFromRegentRuns(runs: Array<{ output?: unknown }>) {
  const ids = new Set<string>();
  for (const run of runs) {
    const output = run.output && typeof run.output === "object"
      ? run.output as { design_id?: unknown; designs?: unknown }
      : null;
    if (typeof output?.design_id === "string") ids.add(output.design_id);
    if (Array.isArray(output?.designs)) {
      for (const design of output.designs) {
        if (design && typeof design === "object" && typeof (design as { id?: unknown }).id === "string") {
          ids.add((design as { id: string }).id);
        }
      }
    }
  }
  return [...ids];
}
