import { createAuthSupabaseClient } from "../lib/supabase";
import {
  getWorkflowSecretForInternalRequest,
  unsealWorkflowSession,
} from "../lib/workflow-auth";

export type TaskExecutionWorkflowInput = {
  taskId: string;
  userId: string;
  sealedSession: string;
  origin: string;
};

function safeOrigin(value: string) {
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Origem insegura para execução durável.");
  }
  return url.origin;
}

async function executeTaskRequest(input: TaskExecutionWorkflowInput) {
  "use step";

  console.log("regente_workflow_step_started", {
    taskId: input.taskId,
    userId: input.userId,
  });

  const storedSession = unsealWorkflowSession(input.sealedSession);
  const authClient = createAuthSupabaseClient();
  const { data, error } = await authClient.auth.setSession({
    access_token: storedSession.accessToken,
    refresh_token: storedSession.refreshToken,
  });

  const accessToken = data.session?.access_token;
  if (error || !accessToken) {
    throw new Error(
      error?.message || "Não foi possível renovar a sessão Master para o Workflow.",
    );
  }

  const response = await fetch(
    `${safeOrigin(input.origin)}/api/tasks/${encodeURIComponent(input.taskId)}/execute`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Regent-Workflow": getWorkflowSecretForInternalRequest(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "vercel_workflow" }),
    },
  );

  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      payload = { message: raw.slice(0, 500) };
    }
  }

  if (response.status >= 500 || response.status === 429) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `Execução interna respondeu HTTP ${response.status}.`;
    throw new Error(message);
  }

  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `Execução interna foi recusada com HTTP ${response.status}.`;
    throw new Error(message);
  }

  console.log("regente_workflow_step_finished", {
    taskId: input.taskId,
    httpStatus: response.status,
    taskStatus: payload.status,
  });

  return {
    httpStatus: response.status,
    payload,
  };
}

export async function taskExecutionWorkflow(input: TaskExecutionWorkflowInput) {
  "use workflow";

  console.log("regente_workflow_started", {
    taskId: input.taskId,
    userId: input.userId,
  });

  const result = await executeTaskRequest(input);

  console.log("regente_workflow_finished", {
    taskId: input.taskId,
    httpStatus: result.httpStatus,
  });

  return result;
}
