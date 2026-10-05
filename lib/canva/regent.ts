import JSZip from "jszip";
import { access, api, type Admin } from "./api";
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

function textFrame(name: string, text: string, x: number, y: number, width: number, height: number, style: string) {
  if (!text.trim()) return "";
  return `<draw:frame draw:name="${xml(name)}" draw:style-name="${style}" svg:x="${x}in" svg:y="${y}in" svg:width="${width}in" svg:height="${height}in"><draw:text-box><text:p>${xml(text)}</text:p></draw:text-box></draw:frame>`;
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
      <style:style style:name="textDark" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:paragraph-properties fo:text-align="left"/><style:text-properties fo:font-size="28pt" fo:font-weight="bold" fo:color="#18201D"/></style:style>
      <style:style style:name="textLight" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:paragraph-properties fo:text-align="left"/><style:text-properties fo:font-size="28pt" fo:font-weight="bold" fo:color="#FFFFFF"/></style:style>
      <style:style style:name="mutedDark" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="12pt" fo:color="#59645F"/></style:style>
      <style:style style:name="mutedLight" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="12pt" fo:color="#D8E1DD"/></style:style>
      <style:style style:name="ctaDark" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#176C5B"/></style:style>
      <style:style style:name="ctaLight" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#D7EF58"/></style:style>
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

async function waitForImport(token: string, jobId: string) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const { job } = await api<{ job: ImportJob }>(token, "/imports/" + encodeURIComponent(jobId));
    if (job.status === "success") return job;
    if (job.status === "failed") {
      throw new CanvaError(job.error?.message || "O Canva recusou a importação do design.", 422, job.error?.code);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  throw new CanvaError("O Canva ainda está processando a importação. Tente executar novamente para conferir.", 409);
}

export async function createRegentCanvaDesigns(
  admin: Admin,
  userId: string,
  spec: RegentCanvaSpec,
  variants: number,
) {
  const { token } = await access(admin, userId);
  const count = Math.max(1, Math.min(3, Math.trunc(variants || 1)));
  const designs: Array<{ id: string; editUrl: string; viewUrl: string; title: string; variant: number }> = [];

  for (let variant = 1; variant <= count; variant += 1) {
    const document = await regentDesignDocument(spec, variant);
    const title = Array.from(`${spec.title} — V${variant}`).slice(0, 50).join("");
    const { job } = await api<{ job: ImportJob }>(token, "/imports", {
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
    if (!job.id) throw new CanvaError("O Canva não confirmou o início da importação.", 502);
    const complete = job.status === "success" ? job : await waitForImport(token, job.id);
    const designId = complete.result?.designs?.[0]?.id;
    if (!designId) throw new CanvaError("O Canva não retornou o design criado.", 502);
    const { design } = await api<{ design: { id: string; title?: string; urls: { edit_url: string; view_url: string } } }>(
      token,
      "/designs/" + encodeURIComponent(designId),
    );
    designs.push({
      id: design.id,
      editUrl: canvaUrl(design.urls.edit_url),
      viewUrl: canvaUrl(design.urls.view_url),
      title: design.title || title,
      variant,
    });
  }

  return designs;
}
