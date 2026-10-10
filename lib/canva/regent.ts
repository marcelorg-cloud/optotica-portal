import JSZip from "jszip";
import { access, api, type Admin } from "./api";
import { listPages } from "./pages";
import { CanvaError, canvaUrl } from "./security";

export type RegentCanvaSpec = {
  title: string;
  width: number;
  height: number;
  pages: Array<{
    eyebrow?: string;
    headline: string;
    body?: string;
    cta?: string;
    visualDirection?: string;
    emphasis?: "identity" | "content" | "urgency" | "cta" | "neutral";
  }>;
};

export type RegentCanvaProgress = {
  mode: "create" | "inspect";
  complete: boolean;
  designs: Array<Record<string, unknown> & { id: string }>;
  jobs: Array<{ kind: "import" | "export"; id: string; status: string; variant?: number; designId?: string; designIds?: string[] }>;
  externalEffect: "none" | "unknown" | "known";
  account?: { userId: string; teamId: string };
};

type ProgressOptions = {
  onProgress?: (progress: RegentCanvaProgress) => Promise<void>;
  assertAuthorized?: () => Promise<void>;
  deadline?: number;
  expectedAccount?: { userId: string; teamId: string };
};

/** Every bridge call belongs to one live, explicitly approved phase and invocation. */
export function regentCanvaRunIsAuthorized(input: {
  task: { status?: unknown; human_decision?: unknown; execution_id?: unknown; execution_invocation_id?: unknown; execution_lease_until?: unknown; current_step?: unknown } | null;
  step: { status?: unknown; revision?: unknown; step_number?: unknown } | null;
  run: { step_number?: unknown; input?: unknown };
  now?: number;
}) {
  const { task, step, run } = input;
  const value = run.input as { stepRevision?: unknown; executionId?: unknown; executionInvocationId?: unknown } | null;
  const decision = task?.human_decision as { approval_scope?: unknown; approved_steps?: unknown; phase_revision?: unknown } | null;
  const approved = decision?.approved_steps;
  const lease = typeof task?.execution_lease_until === "string" ? Date.parse(task.execution_lease_until) : NaN;
  return Boolean(task && step && task.status === "executing" && step.status === "running" &&
    Number.isInteger(run.step_number) && run.step_number === step.step_number && task.current_step === step.step_number &&
    decision?.approval_scope === "single_phase" && Array.isArray(approved) && approved.length === 1 && approved[0] === run.step_number &&
    Number.isInteger(value?.stepRevision) && value?.stepRevision === step.revision && decision?.phase_revision === step.revision &&
    typeof value?.executionId === "string" && value.executionId.length > 0 && value.executionId === task.execution_id &&
    typeof value?.executionInvocationId === "string" && value.executionInvocationId.length > 0 && value.executionInvocationId === task.execution_invocation_id &&
    lease > (input.now ?? Date.now()));
}

/** A validated earlier phase is usable without falsely finalizing its entire mission. */
export function regentCanvaSourceIsValidated(input: {
  run: { status?: unknown; step_number?: unknown; input?: unknown };
  task: { status?: unknown; engine_version?: unknown; validated_steps?: unknown } | null;
  step: { status?: unknown; revision?: unknown; validated_at?: unknown; step_number?: unknown } | null;
  reviews: Array<{ step_number?: unknown; revision?: unknown; decision?: unknown }>;
}) {
  const { run, task, step, reviews } = input;
  if (!task || run.status !== "succeeded") return false;
  const legacy = typeof task.engine_version !== "string" || /^0\.[0-6](?:\.|$)/.test(task.engine_version);
  const declaredRevision = (run.input as { stepRevision?: unknown } | null)?.stepRevision;
  const revision = declaredRevision === undefined && legacy ? 1 : declaredRevision;
  if (!Number.isInteger(revision) || reviews.some((review) => review.step_number === run.step_number &&
    review.revision === revision && review.decision === "superseded")) return false;
  if (step && (step.status !== "succeeded" || step.step_number !== run.step_number || Number(step.revision || 1) !== revision)) return false;
  if (legacy) return task.status === "succeeded";
  return Boolean(step && typeof step.validated_at === "string" && Number.isFinite(Date.parse(step.validated_at)) &&
    Array.isArray(task.validated_steps) && task.validated_steps.includes(run.step_number) &&
    reviews.some((review) => review.step_number === run.step_number && review.revision === revision && review.decision === "accepted"));
}

function designId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,80}$/.test(value);
}

function safeDesign(value: unknown, expectedId: string) {
  const design = value as { id?: unknown; title?: unknown; urls?: { edit_url?: unknown; view_url?: unknown } } | null;
  if (!design || !designId(design.id) || design.id !== expectedId || typeof design.urls?.edit_url !== "string" ||
    typeof design.urls?.view_url !== "string") throw new CanvaError("O Canva retornou metadados inválidos para o design.", 502);
  return { id: design.id, title: typeof design.title === "string" ? design.title : undefined,
    editUrl: canvaUrl(design.urls.edit_url), viewUrl: canvaUrl(design.urls.view_url) };
}

async function checkpoint(progress: RegentCanvaProgress, options: ProgressOptions) {
  // Snapshot before awaiting persistence: a failure must retain every known external ID.
  await options.onProgress?.(structuredClone(progress));
}

async function withinScope(options: ProgressOptions) {
  if (Date.now() >= (options.deadline ?? Infinity)) {
    throw new CanvaError("O prazo desta invocação terminou. Confira os jobs preservados, sem repetir a criação.", 409, "canva_job_pending");
  }
  await options.assertAuthorized?.();
}

const ODP_MIME = "application/vnd.oasis.opendocument.presentation";

function xml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clip(value: string | undefined, max: number) {
  return Array.from(value || "").slice(0, max).join("");
}

function textFrame(name: string, text: string, x: number, y: number, width: number, height: number, paragraphStyle: string) {
  if (!text.trim()) return "";
  return `<draw:frame draw:name="${xml(name)}" draw:style-name="textbox" svg:x="${x}in" svg:y="${y}in" svg:width="${width}in" svg:height="${height}in"><draw:text-box><text:p text:style-name="${paragraphStyle}">${xml(text)}</text:p></draw:text-box></draw:frame>`;
}

function pageBackground(style: string, width: number, height: number) {
  return `<draw:rect draw:style-name="${style}" svg:x="0in" svg:y="0in" svg:width="${width}in" svg:height="${height}in"/>`;
}

export async function regentDesignDocument(spec: RegentCanvaSpec, variant: number) {
  const widthIn = 6;
  const heightIn = widthIn * (spec.height / spec.width);
  const zip = new JSZip();
  const namespaces =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
    'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';

  zip.file("mimetype", ODP_MIME, { compression: "STORE" });
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODP_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
  );

  zip.file(
    "styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${namespaces} office:version="1.2"><office:styles/><office:automatic-styles><style:page-layout style:name="portrait"><style:page-layout-properties fo:page-width="${widthIn}in" fo:page-height="${heightIn}in" style:print-orientation="portrait" fo:margin="0in"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="portrait"/></office:master-styles></office:document-styles>`,
  );

  const pageXml = spec.pages
    .map((page, index) => {
      const strong = page.emphasis === "urgency" || page.emphasis === "cta";
      const bgStyle = strong ? "bgDark" : index % 2 === 0 ? "bgLight" : "bgSoft";
      const textStyle = strong ? "textLight" : "textDark";
      const mutedStyle = strong ? "mutedLight" : "mutedDark";
      const ctaStyle = strong ? "ctaLight" : "ctaDark";
      const bodyTop = page.eyebrow ? 3.2 : 2.85;
      return `<draw:page draw:name="${xml(`Tela ${index + 1}`)}" draw:style-name="page" draw:master-page-name="Default">
        ${pageBackground(bgStyle, widthIn, heightIn)}
        ${textFrame("Marcador", clip(page.eyebrow, 90), 0.55, 0.65, 4.9, 0.5, mutedStyle)}
        ${textFrame("Título", clip(page.headline, 180), 0.55, page.eyebrow ? 1.35 : 1.0, 4.9, 1.65, textStyle)}
        ${textFrame("Corpo", clip(page.body, 500), 0.55, bodyTop, 4.9, 2.0, mutedStyle)}
        ${textFrame("Direção visual", clip(page.visualDirection, 260), 0.55, heightIn - 2.65, 4.9, 1.15, mutedStyle)}
        ${textFrame("CTA", clip(page.cta, 80), 0.55, heightIn - 1.15, 4.9, 0.55, ctaStyle)}
      </draw:page>`;
    })
    .join("");

  zip.file(
    "content.xml",
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${namespaces} office:version="1.2"><office:automatic-styles>
      <style:style style:name="page" style:family="drawing-page"><style:drawing-page-properties draw:fill="none"/></style:style>
      <style:style style:name="bgLight" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#F7F7F2" draw:stroke="none"/></style:style>
      <style:style style:name="bgSoft" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#EAF0EC" draw:stroke="none"/></style:style>
      <style:style style:name="bgDark" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#16211D" draw:stroke="none"/></style:style>
      <style:style style:name="textbox" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/></style:style>
      <style:style style:name="textDark" style:family="paragraph"><style:paragraph-properties fo:text-align="left"/><style:text-properties fo:font-size="28pt" fo:font-weight="bold" fo:color="#18201D"/></style:style>
      <style:style style:name="textLight" style:family="paragraph"><style:paragraph-properties fo:text-align="left"/><style:text-properties fo:font-size="28pt" fo:font-weight="bold" fo:color="#FFFFFF"/></style:style>
      <style:style style:name="mutedDark" style:family="paragraph"><style:text-properties fo:font-size="12pt" fo:color="#59645F"/></style:style>
      <style:style style:name="mutedLight" style:family="paragraph"><style:text-properties fo:font-size="12pt" fo:color="#D8E1DD"/></style:style>
      <style:style style:name="ctaDark" style:family="paragraph"><style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#176C5B"/></style:style>
      <style:style style:name="ctaLight" style:family="paragraph"><style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#D7EF58"/></style:style>
    </office:automatic-styles><office:body><office:presentation>${pageXml}</office:presentation></office:body></office:document-content>`,
  );

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

type ImportJob = {
  id?: string;
  status: "success" | "failed" | "in_progress";
  result?: { designs?: Array<{ id: string }> };
  error?: { code?: string; message?: string };
};

type ExportJob = {
  id?: string;
  status: "success" | "failed" | "in_progress";
  urls?: string[];
  error?: { code?: string; message?: string };
};

function checkedJob<T extends ImportJob | ExportJob>(value: unknown, expectedId?: string): T {
  const job = value as T | null;
  if (!job || typeof job.id !== "string" || !/^[A-Za-z0-9_-]{6,100}$/.test(job.id) ||
    (expectedId && job.id !== expectedId) || !["success", "failed", "in_progress"].includes(job.status)) {
    throw new CanvaError("O Canva retornou um job inválido. Confira a operação original antes de retomá-la.", 502, "invalid_canva_job");
  }
  return job;
}

async function waitForExport(token: string, jobId: string, progress: RegentCanvaProgress, options: ProgressOptions) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await withinScope(options);
    const body = await api<{ job: ExportJob }>(token, "/exports/" + encodeURIComponent(jobId));
    const job = checkedJob<ExportJob>(body?.job, jobId);
    const known = progress.jobs.find((value) => value.kind === "export" && value.id === jobId)!;
    if (known.status !== job.status) { known.status = job.status; await checkpoint(progress, options); }
    if (job.status === "success") return job;
    if (job.status === "failed") {
      throw new CanvaError(job.error?.message || "O Canva recusou a exportação para inspeção.", 422, job.error?.code);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  throw new CanvaError("O Canva ainda está preparando as imagens para inspeção. O job foi preservado para conferência.", 409, "canva_job_pending");
}

async function exportDesignPages(token: string, designId: string, pageNumbers: number[], progress: RegentCanvaProgress, options: ProgressOptions) {
  await withinScope(options);
  progress.externalEffect = "unknown";
  await checkpoint(progress, options);
  const body = await api<{ job: ExportJob }>(token, "/exports", {
    method: "POST",
    body: JSON.stringify({
      design_id: designId,
      format: { type: "png", pages: pageNumbers },
    }),
  });
  const job = checkedJob<ExportJob>(body?.job);
  progress.externalEffect = "known";
  progress.jobs.push({ kind: "export", id: job.id!, status: job.status, designId });
  await checkpoint(progress, options);
  if (job.status === "failed") throw new CanvaError(job.error?.message || "O Canva recusou a exportação para inspeção.", 422, job.error?.code);
  const complete = job.status === "success" ? job : await waitForExport(token, job.id!, progress, options);
  if (!Array.isArray(complete.urls) || !complete.urls.length) {
    throw new CanvaError("O Canva não retornou imagens para inspeção.", 502);
  }
  return complete.urls.map(canvaUrl);
}

export async function inspectRegentCanvaDesigns(admin: Admin, userId: string, designIds: string[], options: ProgressOptions = {}) {
  const requested = [...new Set(designIds.map((value) => value.trim()))];
  if (!requested.length || requested.length > 10 || requested.some((id) => !/^[A-Za-z0-9_-]{6,80}$/.test(id))) {
    throw new CanvaError("As referências Canva solicitadas são inválidas.", 422);
  }

  const { token, connection } = await access(admin, userId);
  if (options.expectedAccount && (options.expectedAccount.userId !== connection.canva_user_id || options.expectedAccount.teamId !== connection.canva_team_id)) {
    throw new CanvaError("Os designs de origem pertencem a outra conta ou equipe Canva. Reconecte a conta correta antes de inspecionar.", 403, "canva_account_mismatch");
  }
  const progress: RegentCanvaProgress = { mode: "inspect", complete: false, designs: [], jobs: [], externalEffect: "none",
    account: { userId: connection.canva_user_id, teamId: connection.canva_team_id } };
  await checkpoint(progress, options);
  for (const designId of requested) {
    await withinScope(options);
    const [body, pages] = await Promise.all([
      api<{ design: { id: string; title?: string; urls: { edit_url: string; view_url: string } } }>(
        token,
        "/designs/" + encodeURIComponent(designId),
      ),
      listPages(token, designId),
    ]);
    const design = safeDesign(body?.design, designId);
    const pageNumbers = pages
      .map((page) => page.page_number)
      .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0 && pageNumber <= 500);
    if (!pageNumbers.length || pageNumbers.length !== pages.length || new Set(pageNumbers).size !== pageNumbers.length) {
      throw new CanvaError("O Canva não retornou páginas estáveis para inspeção.", 409);
    }
    // Preserve the canonical design even if export or a later design fails.
    progress.designs.push({ ...design, title: design.title || `Design ${design.id}`, pageCount: pages.length, inspectionComplete: false });
    await checkpoint(progress, options);
    const previewUrls = await exportDesignPages(token, designId, pageNumbers, progress, options);
    progress.designs[progress.designs.length - 1] = {
      id: design.id,
      title: design.title || `Design ${design.id}`,
      editUrl: design.editUrl,
      viewUrl: design.viewUrl,
      pageCount: pages.length,
      inspectionComplete: true,
      previewPagesMapped: previewUrls.length === pages.length,
      pages: pages.map((page, index) => ({
        id: page.id || null,
        pageNumber: page.page_number,
        dimensions: page.dimensions || null,
        previewUrl: previewUrls.length === pages.length ? previewUrls[index] : null,
      })),
      previewUrls,
    };
    await checkpoint(progress, options);
  }
  progress.complete = true;
  await checkpoint(progress, options);
  return progress.designs;
}

async function waitForImport(token: string, jobId: string, progress: RegentCanvaProgress, options: ProgressOptions) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    await withinScope(options);
    const body = await api<{ job: ImportJob }>(token, "/imports/" + encodeURIComponent(jobId));
    const job = checkedJob<ImportJob>(body?.job, jobId);
    const known = progress.jobs.find((value) => value.kind === "import" && value.id === jobId)!;
    if (known.status !== job.status) { known.status = job.status; await checkpoint(progress, options); }
    if (job.status === "success") return job;
    if (job.status === "failed") {
      throw new CanvaError(job.error?.message || "O Canva recusou a importação do design.", 422, job.error?.code);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  throw new CanvaError("O Canva ainda está processando a importação. Confira o job preservado; não repita a criação.", 409, "canva_job_pending");
}

export async function createRegentCanvaDesigns(
  admin: Admin,
  userId: string,
  spec: RegentCanvaSpec,
  variants: number,
  options: ProgressOptions = {},
) {
  const { token, connection } = await access(admin, userId);
  const count = Math.max(1, Math.min(3, Math.trunc(variants || 1)));
  const progress: RegentCanvaProgress = { mode: "create", complete: false, designs: [], jobs: [], externalEffect: "none",
    account: { userId: connection.canva_user_id, teamId: connection.canva_team_id } };
  await checkpoint(progress, options);

  for (let variant = 1; variant <= count; variant += 1) {
    const document = await regentDesignDocument(spec, variant);
    const title = Array.from(`${spec.title} — V${variant}`).slice(0, 50).join("");
    await withinScope(options);
    // Persist uncertainty BEFORE a non-idempotent POST. A lost response never authorizes another import.
    progress.externalEffect = "unknown";
    await checkpoint(progress, options);
    const body = await api<{ job: ImportJob }>(token, "/imports", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Import-Metadata": JSON.stringify({
          title_base64: Buffer.from(title).toString("base64"),
          mime_type: ODP_MIME,
        }),
      },
      body: new Uint8Array(document),
    });
    const job = checkedJob<ImportJob>(body?.job);
    const known = { kind: "import" as const, id: job.id!, status: job.status, variant, designIds: [] as string[] };
    progress.externalEffect = "known";
    progress.jobs.push(known);
    await checkpoint(progress, options);
    if (job.status === "failed") throw new CanvaError(job.error?.message || "O Canva recusou a importação do design.", 422, job.error?.code);
    const complete = job.status === "success" ? job : await waitForImport(token, job.id!, progress, options);
    const ids = complete.result?.designs?.map((design) => design.id).filter(designId) || [];
    known.designIds = [...new Set(ids)];
    for (const id of known.designIds) progress.designs.push({ id, title, variant, metadataComplete: false });
    await checkpoint(progress, options);
    if (known.designIds.length !== 1) throw new CanvaError("O Canva não retornou exatamente um design para esta variante. Confira os IDs preservados antes de continuar.", 502);
    await withinScope(options);
    const designBody = await api<{ design: { id: string; title?: string; urls: { edit_url: string; view_url: string } } }>(
      token,
      "/designs/" + encodeURIComponent(known.designIds[0]),
    );
    const design = safeDesign(designBody?.design, known.designIds[0]);
    progress.designs[progress.designs.length - 1] = {
      id: design.id,
      editUrl: design.editUrl,
      viewUrl: design.viewUrl,
      title: design.title || title,
      variant,
      metadataComplete: true,
    };
    await checkpoint(progress, options);
  }
  progress.complete = true;
  await checkpoint(progress, options);
  return progress.designs;
}
