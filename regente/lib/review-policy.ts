/** Conservative deterministic safeguard, independent of the planner's hints. */
export function effectiveReviewRequirement(input: { step: { reviewRequirement?: "separate_context" | "different_model" | "external_human"; action?: string }; risk?: string; objective?: string }) {
  if (input.step.reviewRequirement === "external_human") return "external_human" as const;
  const text = `${input.objective || ""} ${input.step.action || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const critical = ["high", "critical"].includes(input.risk || "") || /juridic|clinic|diagnostic|prescri|saude|dados sensiveis/.test(text);
  return critical ? "different_model" as const : input.step.reviewRequirement || "separate_context" as const;
}
