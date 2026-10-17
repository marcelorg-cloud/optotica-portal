/**
 * Regente v0.8: pure, advisory governance contracts for coordination agents.
 *
 * A peer cannot grant itself access, approve an external effect or turn model
 * consensus into mission completion. No IO / no AI calls / no DB writes.
 */
import { COORDINATOR_ROLES, type CoordinatorId } from "./cooperative-orchestra.ts";

export const GOVERNANCE_VERSION = "0.1.0";

export const COORDINATION_EVENT_KINDS = [
  "observation", "proposal", "dissonance", "readiness",
  "rehearsal", "detour", "decision", "outcome",
] as const;
export type EventKind = (typeof COORDINATION_EVENT_KINDS)[number];
export type ProposedOperation =
  | "coordinate"
  | "read_only"
  | "external_effect"
  | "institutional_change";

export type PeerMessage = {
  eventId: string;
  missionId: string;
  actor: CoordinatorId;
  generalScoreVersion: string;
  missionScoreVersion: string;
  kind: EventKind;
  topic: string;
  evidenceRefs: string[];
  proposedAction: string;
  affectedTaskIds: string[];
  dataClass: "public" | "internal_redacted" | "restricted";
  operation: ProposedOperation;
};
export type GovernanceContext = {
  missionId: string;
  generalScoreVersion: string;
  missionScoreVersion: string;
  authorizedActors: readonly CoordinatorId[];
  readableDataClasses: readonly ("public" | "internal_redacted")[];
};

/** Validate a coordination message, without granting execution authority. */
export function reviewPeerMessage(message: PeerMessage, context: GovernanceContext) {
  const actors = new Set<string>(COORDINATOR_ROLES.map(r => r.id));
  if (!message || !context ||
    !actors.has(message.actor) || !context.authorizedActors.includes(message.actor) ||
    !context.missionId || !message.missionId || message.missionId !== context.missionId ||
    !message.generalScoreVersion || message.generalScoreVersion !== context.generalScoreVersion ||
    !message.missionScoreVersion || message.missionScoreVersion !== context.missionScoreVersion
  ) {
    return { status:"blocked_context" as const, evidenceOnly:true as const,
      requiresHumanApproval:false as const, executable:false as const };
  }
  if (!message.eventId || !message.topic || !message.proposedAction ||
      !COORDINATION_EVENT_KINDS.includes(message.kind) ||
      message.topic.length > 500 || message.proposedAction.length > 1500 ||
      !Array.isArray(message.evidenceRefs) || message.evidenceRefs.length > 20 ||
      message.evidenceRefs.some(x => typeof x !== "string" || !x || x.length > 240) ||
      !Array.isArray(message.affectedTaskIds) || message.affectedTaskIds.length > 80 ||
      !["coordinate", "read_only", "external_effect", "institutional_change"].includes(message.operation)) {
    return { status:"invalid_message" as const, evidenceOnly:true as const,
      requiresHumanApproval:false as const, executable:false as const };
  }
  // No restricted data may be passed through organizational peer messages.
  if (message.dataClass === "restricted" ||
      !context.readableDataClasses.includes(message.dataClass)) {
    return { status:"blocked_data_access" as const, evidenceOnly:true as const,
      requiresHumanApproval:false as const, executable:false as const };
  }
  if (!message.evidenceRefs.length) {
    return { status:"needs_evidence" as const, evidenceOnly:true as const,
      requiresHumanApproval:false as const, executable:false as const };
  }
  if (message.operation === "external_effect" || message.operation === "institutional_change") {
    return { status:"requires_human_and_runtime_gate" as const, evidenceOnly:true as const,
      requiresHumanApproval:true as const, executable:false as const };
  }
  return { status:"coordination_advisory" as const, evidenceOnly:true as const,
    requiresHumanApproval:false as const, executable:false as const };
}

export type Dissent = {
  actor: CoordinatorId;
  missionId: string;
  generalScoreVersion: string;
  missionScoreVersion: string;
  kind: "creative" | "evidence" | "integration" | "safety" | "uncertain";
  reason: string;
  evidenceRefs: string[];
};
/**
 * Dissent remains visible. No consensus-by-vote, no self-authorized effect.
 * Unsafe or invalid peer reports block only the affected decision context.
 */
export function evaluateDissonance(reports: readonly Dissent[], context: GovernanceContext) {
  if (!reports.length) return {
    state:"not_assessed" as const, unresolved:[] as Dissent[],
    grantsExecution:false as const
  };
  const known = new Set(COORDINATOR_ROLES.map(r=>r.id));
  const invalid = reports.some(x=>
    !known.has(x.actor) || !context.authorizedActors.includes(x.actor) ||
    x.missionId !== context.missionId ||
    x.generalScoreVersion !== context.generalScoreVersion ||
    x.missionScoreVersion !== context.missionScoreVersion ||
    !x.reason.trim() ||
    !Array.isArray(x.evidenceRefs)
  );
  if (invalid) return { state:"blocked_context" as const,
    unresolved:[...reports],grantsExecution:false as const };
  if (reports.some(x=>x.kind==="safety")) return { state:"safety_conflict" as const,
    unresolved:reports.filter(x=>x.kind==="safety"),grantsExecution:false as const };
  if (reports.some(x=>!x.evidenceRefs.length)) return { state:"needs_evidence" as const,
    unresolved:reports.filter(x=>!x.evidenceRefs.length),grantsExecution:false as const };
  if (reports.some(x=>x.kind==="evidence" || x.kind==="integration" || x.kind==="uncertain")) {
    return { state:"needs_investigation" as const,
      unresolved:[...reports],grantsExecution:false as const };
  }
  return { state:"productive_dissonance" as const,
    unresolved:[...reports],grantsExecution:false as const };
}
