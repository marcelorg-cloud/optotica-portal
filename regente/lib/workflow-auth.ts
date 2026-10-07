import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type WorkflowSession = {
  accessToken: string;
  refreshToken: string;
};

function workflowSecret() {
  const value = process.env.REGENT_WORKFLOW_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("REGENT_WORKFLOW_SECRET não configurado ou muito curto.");
  }
  return value;
}

function encryptionKey() {
  return createHash("sha256").update(workflowSecret()).digest();
}

export function sealWorkflowSession(session: WorkflowSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function unsealWorkflowSession(value: string): WorkflowSession {
  const [version, ivPart, tagPart, encryptedPart] = value.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !encryptedPart) {
    throw new Error("Sessão durável inválida.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const clear = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  const parsed = JSON.parse(clear) as Partial<WorkflowSession>;
  if (!parsed.accessToken || !parsed.refreshToken) {
    throw new Error("Sessão durável incompleta.");
  }

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
  };
}

export function isValidWorkflowSecret(candidate: string | null) {
  if (!candidate) return false;

  const expected = Buffer.from(workflowSecret());
  const received = Buffer.from(candidate);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function getWorkflowSecretForInternalRequest() {
  return workflowSecret();
}
