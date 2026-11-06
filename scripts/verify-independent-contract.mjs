import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pdfLib from "pdf-lib";
import { createIndependentPendingPdf, signIndependentPendingPdf } from "../supabase/functions/_shared/independent-contract.mjs";

const templatePath = process.argv[2];
if (!templatePath) throw new Error("Indica la ruta de la plantilla PDF.");
const template = await readFile(templatePath);
const values = {
  name: "María Fernanda López García",
  documentType: "Cédula de ciudadanía",
  documentNumber: "1095921642",
  address: "Calle 10 # 20-30, Floridablanca",
  phone: "3001234567",
  email: "maria.lopez@example.com",
};
const pending = await createIndependentPendingPdf(template, values, pdfLib);
assert.equal((await pdfLib.PDFDocument.load(pending)).getPageCount(), 2);

const signaturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y8O1QAAAABJRU5ErkJggg==",
  "base64",
);
const evidence = [
  "IP: 181.234.92.243",
  "Fecha y hora: 2026-11-03T15:30:00 America/Bogota",
  "Navegador: Chrome",
  "Sistema operativo: Android",
  `Huella dispositivo: ${"a".repeat(64)}`,
  "Ubicacion: 7.1193, -73.1227",
  "Precision: 12 m",
  "El firmante declaró haber leído, entendido y aceptado el contenido del documento antes de firmar",
];
const signed = await signIndependentPendingPdf(pending, signaturePng, evidence, "2026-11-03", pdfLib);
assert.equal((await pdfLib.PDFDocument.load(signed)).getPageCount(), 2);

const foreign = await createIndependentPendingPdf(template, { ...values, documentType: "Cédula de extranjería" }, pdfLib);
assert.equal((await pdfLib.PDFDocument.load(foreign)).getPageCount(), 2);
await assert.rejects(
  createIndependentPendingPdf(template, { ...values, name: "Nombre ".repeat(30) }, pdfLib),
  /demasiado largo/,
);

const pendingPath = join(tmpdir(), "support-independent-contract-pending.pdf");
const signedPath = join(tmpdir(), "support-independent-contract-signed.pdf");
const foreignPath = join(tmpdir(), "support-independent-contract-foreign.pdf");
await writeFile(pendingPath, pending);
await writeFile(signedPath, signed);
await writeFile(foreignPath, foreign);
console.log(JSON.stringify({ pendingPath, signedPath, foreignPath }));
