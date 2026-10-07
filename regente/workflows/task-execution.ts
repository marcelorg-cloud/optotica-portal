import { createAuthSupabaseClient } from "../lib/supabase";
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
};

function safeOrigin(value: string) {
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Origem insegura para execução durável.");
  }
  return url.origin;
}

async function prepareWorkflowSession(sealedSession: string) {
  "use step";

  const storedSession = unsealWorkflowSession(sealedSession);
  const authClient = createAuthSupabaseClient();
  const { data, error } = await authClient.auth.setSession({
    access_token: storedSession.accessToken,
    refresh_token: storedSession.refreshToken,
  });

  if (
    error ||
    !data.session?.access_token ||
    !data.session.refresh_token
  ) {
    throw new Error(
      error?.message || "Não foi possível renovar a sessão Master para o Workflow.",
    );
  }

  console.log("regente_workflow_session_prepared");

  return sealWorkflowSession({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  });
}

async function executeTaskRequest(
  input: TaskExecutionWorkflowInput,
  preparedSession: string,
) {
  "use step";

  console.log("regente_workflow_step_started", {
    taskId: input.taskId,
    userId: input.userId,
  });

  const session = unsealWorkflowSession(preparedSession);
  const response = await fetch(
    `${safeOrigin(input.origin)}/api/tasks/${encodeURIComponent(input.taskId)}/execute`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
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

  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `Execução interna respondeu HTTP ${response.status}.`;
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

  const preparedSession = await prepareWorkflowSession(input.sealedSession);
  const result = await executeTaskRequest(input, preparedSession);

  console.log("regente_workflow_finished", {
    taskId: input.taskId,
    httpStatus: result.httpStatus,
  });

  return result;
}
