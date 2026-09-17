import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { optoticaOperator, professionalTermsVersion } from './optotica-operator';

export type DeclarationProfessional = {
  name: string; category: string; document: string; registration: string;
  address: string; email: string;
};

export async function createVerificationDeclaration(professional: DeclarationProfessional, now = new Date()) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.17, 0.26);
  const muted = rgb(0.35, 0.40, 0.46);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 786;
  const margin = 48;
  const width = 499;
  function clean(text: string) {
    return Array.from(text.replace(/[\r\n\t]+/g, ' ')).map(char => {
      try { regular.encodeText(char); return char; } catch { return '?'; }
    }).join('');
  }
  function line(text: string, font: PDFFont, size: number) {
    if (y < 70) { page = pdf.addPage([595.28, 841.89]); y = 786; }
    page.drawText(text, { x: margin, y, font, size, color: ink });
    y -= size + 4;
  }
  function paragraph(text: string, size = 10, font = regular) {
    let current = '';
    for (const word of clean(text).split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && current) { line(current, font, size); current = ''; }
      // Long identifiers must wrap too, rather than running outside the page.
      for (const char of word) {
        const candidate = current ? current + char : char;
        if (font.widthOfTextAtSize(candidate, size) > width) { line(current, font, size); current = ''; }
        current += char;
      }
      current += ' ';
    }
    if (current.trim()) line(current.trim(), font, size);
    y -= 6;
  }
  pdf.setTitle('Declaração de veracidade - Optótica');
  pdf.setAuthor(optoticaOperator.legalName);
  pdf.setCreationDate(now);
  paragraph('OPTÓTICA / VERIFICAÇÃO PROFISSIONAL', 10, bold);
  paragraph('Declaração de veracidade', 22, bold);
  paragraph('Documento para assinatura eletrônica do profissional pelo gov.br', 10);
  y -= 8;
  paragraph('IDENTIFICAÇÃO DO PROFISSIONAL', 10, bold);
  paragraph(`${professional.name} | ${professional.category}`, 11, bold);
  paragraph(`CPF: ${professional.document} | Registro no conselho: ${professional.registration}`);
  paragraph(`Endereço profissional: ${professional.address}`);
  paragraph(`E-mail: ${professional.email}`);
  y -= 4;
  paragraph('DESTINATÁRIA / CONTROLADORA DA PLATAFORMA', 10, bold);
  paragraph(`${optoticaOperator.legalName} | CNPJ ${optoticaOperator.cnpj}`, 10, bold);
  paragraph(`${optoticaOperator.address}. Representante: ${optoticaOperator.representative}.`);
  paragraph(`${optoticaOperator.email} | ${optoticaOperator.phone} | ${optoticaOperator.mobile}`);
  y -= 4;
  paragraph('DECLARAÇÃO', 10, bold);
  paragraph('Declaro, sob minha responsabilidade, que os dados do meu cadastro e os documentos apresentados à Optótica correspondem à minha identidade, formação e registro profissional, são autênticos e não foram adulterados.');
  paragraph('Declaro que o diploma ou certificado e o comprovante de registro apresentados se referem a mim. Comprometo-me a comunicar alterações, suspensão ou cancelamento do registro e a apresentar esclarecimentos ou documentos atualizados quando solicitado.');
  paragraph('Estou ciente de que a Optótica poderá conferir as informações com as instituições e entidades emissoras. O selo depende dessa análise, não amplia minhas atribuições profissionais e não representa certificação do gov.br.');
  paragraph(`A publicação das versões conferidas do diploma/certificado e do registro depende de autorização específica no portal. Os originais desta declaração e o aceite dos termos (versão ${professionalTermsVersion}) permanecem privados.`);
  paragraph(`Documento gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' }).format(now)}. A data da assinatura será registrada pelo assinador gov.br.`);
  if (y < 165) { page = pdf.addPage([595.28, 841.89]); y = 786; }
  page.drawRectangle({ x: margin, y: y - 85, width, height: 74, borderColor: rgb(0.75, 0.79, 0.83), borderWidth: 0.7 });
  page.drawText('Área reservada à assinatura eletrônica do profissional no gov.br', { x: margin + 12, y: y - 30, font: regular, size: 9, color: muted });
  for (const [index, sheet] of pdf.getPages().entries()) {
    sheet.drawLine({ start: { x: margin, y: 48 }, end: { x: 547, y: 48 }, color: rgb(0.83, 0.86, 0.89), thickness: 0.5 });
    sheet.drawText(`Optótica | CNPJ ${optoticaOperator.cnpj} | ${index + 1}/${pdf.getPageCount()}`, { x: margin, y: 32, size: 8, font: regular, color: muted });
  }
  return pdf.save();
}
