const TEMPLATE_SHA256 = "02e6346a3324281eb0163300d6647dbfc2af57af1fcca21085869bdca5a3c96b";
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function assertPages(pdf) {
  const pages = pdf.getPages();
  if (pages.length !== 2 || pages.some((page) => Math.abs(page.getWidth() - PAGE_WIDTH) > 0.1 || Math.abs(page.getHeight() - PAGE_HEIGHT) > 0.1)) {
    throw new Error("La plantilla del contrato cambió de diseño; se deben recalibrar sus campos.");
  }
  return pages;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function drawField(page, font, rgb, label, value, x, top, coverWidth, maxWidth = coverWidth, maxSize = 9.6, minSize = 8) {
  const text = cleanText(value);
  let size = maxSize;
  while (text && size >= minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.2;
  if (text && size < minSize) {
    throw new Error(`${label} es demasiado largo para el espacio del contrato. Corrige el dato antes de continuar.`);
  }
  page.drawRectangle({ x: x - 0.3, y: PAGE_HEIGHT - top - 12.5, width: coverWidth + 0.6, height: 12.8, color: rgb(1, 1, 1) });
  if (text) page.drawText(text, { x, y: PAGE_HEIGHT - top - 9.9, font, size, color: rgb(0, 0, 0) });
}

function fillSignatureDate(page, font, rgb, signedDate) {
  const [year, month, day] = signedDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error("La fecha de firma no es válida.");
  const monthName = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][month - 1];
  if (!monthName) throw new Error("La fecha de firma no es válida.");
  const line = `${day} días del mes de ${monthName} del año ${year}.`;
  if (font.widthOfTextAtSize(line, 9.6) > 275) throw new Error("La fecha de firma no cabe en la plantilla.");
  page.drawRectangle({ x: 50, y: PAGE_HEIGHT - 426, width: 275, height: 16.5, color: rgb(1, 1, 1) });
  page.drawText(line, { x: 57.6, y: PAGE_HEIGHT - 421.4, font, size: 9.6, color: rgb(0, 0, 0) });
}

function wrapLine(value, font, size, maxWidth) {
  const result = [];
  let line = "";
  for (const word of cleanText(value).split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) result.push(line);
    line = "";
    for (const char of word) {
      if (font.widthOfTextAtSize(line + char, size) > maxWidth) {
        if (line) result.push(line);
        line = char;
      } else {
        line += char;
      }
    }
  }
  if (line) result.push(line);
  return result;
}

function drawEvidence(page, evidenceLines, regular, bold, rgb) {
  const x = 311.4;
  const width = 241;
  const size = 7.4;
  const lineHeight = 8.7;
  const lines = evidenceLines.flatMap((line) => wrapLine(line, regular, size, width));
  const firstLineY = 138;
  if (firstLineY - (lines.length - 1) * lineHeight < 16) {
    throw new Error("La evidencia de firma no cabe debajo de la firma en esta plantilla.");
  }
  page.drawText("Evidencia de firma", { x, y: 151, size: 8.8, font: bold, color: rgb(0.08, 0.16, 0.35) });
  lines.forEach((line, index) => {
    page.drawText(line, { x, y: firstLineY - index * lineHeight, size, font: regular, color: rgb(0.08, 0.13, 0.22) });
  });
}

export async function createIndependentPendingPdf(templateBytes, values, pdfLib) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", templateBytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== TEMPLATE_SHA256) throw new Error("La plantilla del contrato no coincide con la versión calibrada.");

  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const pdf = await PDFDocument.load(templateBytes);
  const [first, second] = assertPages(pdf);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const name = cleanText(values.name);
  const documentNumber = cleanText(values.documentNumber);
  const address = cleanText(values.address);
  const phone = cleanText(values.phone);
  const email = cleanText(values.email);
  const documentType = cleanText(values.documentType).toLocaleLowerCase("es-CO");
  const foreignId = documentType.includes("extranjer");
  if (!documentType.includes("ciudadan") && !foreignId) throw new Error("El tipo de documento no tiene una etiqueta compatible con esta plantilla.");
  if (![name, documentNumber, address, phone, email].every(Boolean)) throw new Error("Faltan datos obligatorios para generar el contrato.");

  drawField(first, regular, rgb, "Nombre", name, 87.1, 192.8, 257, 257);
  drawField(first, regular, rgb, "Documento", documentNumber, 240.1, 206.9, 119, 119);
  drawField(first, regular, rgb, "Domicilio", address, 57.6, 220.9, 259, 259);
  if (foreignId) drawField(first, regular, rgb, "Tipo de documento", "extranjería", 57.6, 206.9, 51, 100);
  drawField(first, regular, rgb, "Forma de pago", "quincenal,", 141.7, 547.8, 158, 158);

  drawField(second, regular, rgb, "Duración", "un mes", 57.6, 261.1, 88, 88);
  drawField(second, regular, rgb, "Dirección", address, 57.6, 363.4, 259, 259);
  drawField(second, regular, rgb, "Teléfono", phone, 396.7, 363.4, 100, 100);
  drawField(second, regular, rgb, "Correo", `${email}.`, 57.6, 377.3, 183, 490);
  drawField(second, regular, rgb, "Nombre de firma", name, 344.1, 574.9, 136, 208, 8.7, 8);
  drawField(second, regular, rgb, "Documento de firma", documentNumber, 343.1, 586.3, 132, 208, 8.7, 8);
  drawField(second, regular, rgb, "Teléfono de firma", phone, 346.1, 597.7, 128, 205, 8.7, 8);
  if (foreignId) drawField(second, regular, rgb, "Tipo de documento de firma", "C.E.", 311.4, 586.3, 14, 30, 8.5, 8);
  drawField(second, regular, rgb, "Año de firma", "", 282.8, 411.5, 38.5);

  return await pdf.save();
}

export async function signIndependentPendingPdf(pendingBytes, signatureBytes, evidenceLines, signedDate, pdfLib) {
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const pdf = await PDFDocument.load(pendingBytes);
  const [, page] = assertPages(pdf);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  fillSignatureDate(page, italic, rgb, signedDate);
  drawEvidence(page, evidenceLines, regular, bold, rgb);
  const signature = await pdf.embedPng(signatureBytes);
  const size = signature.scaleToFit(181, 48);
  page.drawImage(signature, { x: 313, y: 245, width: size.width, height: size.height });
  return await pdf.save();
}
