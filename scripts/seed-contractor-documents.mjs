import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = "contractor-documents";

if (!url || !serviceRoleKey) {
  throw new Error(
    "Define SUPABASE_URL (o EXPO_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const documentTypes = [
  { code: "CEDULA", name: "Cédula" },
  { code: "CERTIFICADO_ARL", name: "Certificado ARL" },
  { code: "CERTIFICADO_EPS", name: "Certificado EPS" },
];

function deterministicUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const id = hex.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function safeFilePart(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function createDemoPdf(contractor, type) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 0,
    y: 710,
    width: 595.28,
    height: 132,
    color: rgb(0.082, 0.157, 0.353),
  });
  page.drawText("SUPPORT COLOMBIA", {
    x: 48,
    y: 785,
    size: 22,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText("DOCUMENTO DEMO", {
    x: 48,
    y: 745,
    size: 30,
    font: bold,
    color: rgb(0.941, 0.267, 0.118),
  });
  page.drawText(type.name, {
    x: 48,
    y: 650,
    size: 26,
    font: bold,
    color: rgb(0.09, 0.13, 0.23),
  });

  const rows = [
    ["Contratista", `${contractor.name} ${contractor.last_name}`],
    ["Documento", contractor.document_number],
    ["Tipo", type.name],
    ["Código", type.code],
    ["Generado", new Date().toISOString().slice(0, 10)],
  ];
  let y = 590;
  for (const [label, value] of rows) {
    page.drawText(label, {
      x: 48,
      y,
      size: 11,
      font: bold,
      color: rgb(0.4, 0.44, 0.53),
    });
    page.drawText(String(value), {
      x: 180,
      y,
      size: 12,
      font: regular,
      color: rgb(0.09, 0.13, 0.23),
    });
    y -= 36;
  }

  page.drawRectangle({
    x: 48,
    y: 255,
    width: 499,
    height: 150,
    borderWidth: 1,
    borderColor: rgb(0.88, 0.9, 0.94),
    color: rgb(0.97, 0.98, 1),
  });
  page.drawText("Este archivo contiene información ficticia para validar el flujo", {
    x: 72,
    y: 350,
    size: 13,
    font: bold,
    color: rgb(0.09, 0.13, 0.23),
  });
  page.drawText("de documentos del prototipo. No tiene validez legal.", {
    x: 72,
    y: 320,
    size: 13,
    font: regular,
    color: rgb(0.4, 0.44, 0.53),
  });
  page.drawText("DOCUMENTO DEMO", {
    x: 150,
    y: 185,
    size: 38,
    font: bold,
    color: rgb(0.94, 0.27, 0.12),
    opacity: 0.18,
  });

  return pdf.save();
}

async function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

const contractors = await requireData(
  await supabase
    .from("contractor")
    .select("id,name,last_name,document_number")
    .order("id"),
  "No fue posible consultar contratistas",
);
const types = await requireData(
  await supabase
    .from("contractor_document_types")
    .select("id,code,name")
    .in(
      "code",
      documentTypes.map((type) => type.code),
    ),
  "No fue posible consultar tipos de documento",
);
const typesByCode = new Map(types.map((type) => [type.code, type]));

if (contractors.length === 0 || types.length !== documentTypes.length) {
  throw new Error("Aplica primero la migración de documentos y verifica los datos demo.");
}

let uploaded = 0;
for (const contractor of contractors) {
  for (const desiredType of documentTypes) {
    const type = typesByCode.get(desiredType.code);
    const stableId = deterministicUuid(
      `support-colombia-demo:${contractor.id}:${desiredType.code}`,
    );
    const originalName = `${safeFilePart(desiredType.name)}-${contractor.document_number}.pdf`;
    const path = `contractor/${contractor.id}/${desiredType.code}/${stableId}.pdf`;
    const bytes = await createDemoPdf(contractor, desiredType);
    const tempPath = join(tmpdir(), originalName);

    await writeFile(tempPath, bytes);
    try {
      const upload = await supabase.storage.from(bucket).upload(path, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (upload.error) throw upload.error;

      const fileResult = await supabase
        .from("app_files")
        .upsert(
          {
            id: stableId,
            provider: "supabase",
            bucket,
            path,
            original_name: originalName,
            mime_type: "application/pdf",
            size_bytes: bytes.byteLength,
          },
          { onConflict: "provider,bucket,path" },
        )
        .select("id")
        .single();
      if (fileResult.error) throw fileResult.error;

      const documentResult = await supabase.from("contractor_documents").upsert(
        {
          id: stableId,
          contractor_id: contractor.id,
          document_type_id: type.id,
          file_id: fileResult.data.id,
        },
        { onConflict: "file_id" },
      );
      if (documentResult.error) throw documentResult.error;
      uploaded += 1;
    } finally {
      await rm(tempPath, { force: true });
    }
  }
}

console.log(`Documentos demo listos: ${uploaded}.`);
