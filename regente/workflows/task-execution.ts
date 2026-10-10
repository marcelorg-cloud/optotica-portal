import { randomUUID } from "node:crypto";
import { FatalError } from "workflow";
import { createAuthSupabaseClient, createBearerSupabaseClient } from "../lib/supabase";
import {
  safeWorkflowOrigin,
  workflowFailureKind,
  workflowFailureMessage,
  workflowHttpFailure,
  type WorkflowFailureKind,
} from "../lib/workflow-state";
import {
  getWorkflowSecretForInternalRequest,
  sealWorkflowSession,
  unsealWorkflowSession,
} from "../lib/workflow-auth";

export type TaskExecutionWorkflowInput = {
  taskId: string;
  userId: string;
  sealedSession: string;
  origin: string;
  executionId: string;
};

async function prepareWorkflowSession(input: TaskExecutionWorkflowInput) {
  "use step";

  console.log("regente_workflow_session_started", { taskId: input.taskId });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (![input.taskId, input.userId, input.executionId].every((value) => typeof value === "string" && uuid.test(value)) ||
      !safeWorkflowOrigin(input.origin, process.env.NODE_ENV === "production")) {
    throw new FatalError(workflowFailureMessage("configuration"));
  }
  try { getWorkflowSecretForInternalRequest(); } catch {
    throw new FatalError(workflowFailureMessage("configuration"));
  }
  try {
    const storedSession = unsealWorkflowSession(input.sealedSession);
    const authClient = createAuthSupabaseClient();
    const { data, error } = await authClient.auth.setSession({
      access_token: storedSession.accessToken,
      refresh_token: storedSession.refreshToken,
    });
    if (error || !data.session?.access_token || !data.session.refresh_token || data.user?.id !== input.userId) {
      throw new FatalError(workflowFailureMessage("session"));
    }
    console.log("regente_workflow_session_prepared", { taskId: input.taskId });
    return sealWorkflowSession({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  } catch {
    // No raw auth/provider exception is persisted: it may contain credentials.
    throw new FatalError(workflowFailureMessage("session"));
  }
}
prepareWorkflowSession.maxRetries = 0;

async function executeTaskRequest(
  input: TaskExecutionWorkflowInput,
  preparedSession: string,
) {
  "use step";

  console.log("regente_workflow_step_started", {
    taskId: input.taskId,
    userId: input.userId,
  });

  let session;
  let workflowSecret: string;
  try {
    session = unsealWorkflowSession(preparedSession);
    workflowSecret = getWorkflowSecretForInternalRequest();
  } catch {
    throw new FatalError(workflowFailureMessage("configuration"));
  }
  const origin = safeWorkflowOrigin(input.origin, process.env.NODE_ENV === "production");
  if (!origin) throw new FatalError(workflowFailureMessage("configuration"));
  const invocationId = randomUUID();
  // Below the 800s Function limit; the worker's 810s lease still fences recovery.
  // Aborting this HTTP request does not prove that the server stopped its phase.
  const signal = AbortSignal.timeout(770_000);
  try {
    const response = await fetch(
      `${origin}/api/tasks/${encodeURIComponent(input.taskId)}/execute`,
      {
        method: "POST", cache: "no-store", redirect: "error", signal,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "X-Regent-Workflow": workflowSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "vercel_workflow",
          executionId: input.executionId,
          invocationId,
        }),
      },
    );
    if (!response.ok) throw new FatalError(workflowFailureMessage(workflowHttpFailure(response.status)));
    let payload: Record<string, unknown>;
    try { payload = await response.json() as Record<string, unknown>; } catch {
      throw new FatalError(workflowFailureMessage("response_invalid"));
    }
    const statuses = ["awaiting_validation", "succeeded", "blocked", "failed", "rejected", "needs_revision"];
    if (!payload || typeof payload !== "object" || !statuses.includes(String(payload.status))) {
      throw new FatalError(workflowFailureMessage("response_invalid"));
    }
    console.log("regente_workflow_step_finished", {
      taskId: input.taskId, httpStatus: response.status, taskStatus: payload.status,
    });
    // Outputs are in the authenticated task store, not duplicated into Workflow IO.
    return {
      httpStatus: response.status,
      payload: { taskId: input.taskId, status: String(payload.status), checkpointPreserved: payload.checkpointPreserved === true },
    };
  } catch (error) {
    if (FatalError.is(error)) throw error;
    throw new FatalError(workflowFailureMessage(signal.aborted ? "timeout" : "dispatch_unknown"));
  }
}
// HTTP can fail after an external effect. A retry must be a new human decision,
// never the SDK's default blind redelivery of this POST.
executeTaskRequest.maxRetries = 0;

async function recordWorkflowFailure(input: TaskExecutionWorkflowInput, preparedSession: string | null, kind: WorkflowFailureKind) {
  "use step";
  console.warn("regente_workflow_failed", { taskId: input.taskId, kind });
  try {
    const session = unsealWorkflowSession(preparedSession || input.sealedSession);
    const supabase = createBearerSupabaseClient(session.accessToken);
    const { data: { user }, error: authError } = await supabase.auth.getUser(session.accessToken);
    if (authError || !user || user.id !== input.userId) return { recorded: false };
    const master = await supabase.from("system_admins").select("user_id")
      .eq("user_id", user.id).eq("active", true).maybeSingle();
    if (master.error || !master.data) return { recorded: false };
    const task = await supabase.from("regent_tasks").select("id")
      .eq("id", input.taskId).eq("user_id", user.id).eq("execution_id", input.executionId).maybeSingle();
    if (task.error || !task.data) return { recorded: false };
    const saved = await supabase.from("regent_task_events").insert({
      task_id: input.taskId, user_id: user.id, event_type: "workflow_execution_failed",
      payload: {
        kind, message: workflowFailureMessage(kind), execution_id: input.executionId,
        human_recovery_required: true, checkpoint_preserved: true, version: "0.7.0",
      },
    });
    if (saved.error) console.warn("regente_workflow_failure_event_unconfirmed", { taskId: input.taskId });
    return { recorded: !saved.error };
  } catch {
    // Invalid/expired normal session is a stop condition, not permission to use a
    // service key. The SDK failure remains visible through metadata-only status.
    return { recorded: false };
  }
}
recordWorkflowFailure.maxRetries = 0;

export async function taskExecutionWorkflow(input: TaskExecutionWorkflowInput) {
  "use workflow";

  console.log("regente_workflow_started", {
    taskId: input.taskId,
    userId: input.userId,
  });

  let preparedSession: string | null = null;
  try {
    preparedSession = await prepareWorkflowSession(input);
    const result = await executeTaskRequest(input, preparedSession);
    console.log("regente_workflow_finished", { taskId: input.taskId, httpStatus: result.httpStatus });
    return result;
  } catch (error) {
    const kind = workflowFailureKind(error);
    await recordWorkflowFailure(input, preparedSession, kind);
    throw error;
  }
}
