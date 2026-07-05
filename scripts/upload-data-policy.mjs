import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const POLICY_BUCKET = "supplies";
const POLICY_PATH = "policies/politica-tratamiento-datos-personales-support-colombia.pdf";

function loadEnv() {
  try {
    const content = readFileSync(".env", "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match && !process.env[match[1]]) {
        const value = match[2].trim().replace(/^['"]|['"]$/g, "");
        process.env[match[1]] = value;
      }
    }
  } catch {
    // .env is optional; CI can pass env vars directly.
  }
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const attempt = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(attempt, size) <= maxWidth) {
        current = attempt;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    lines.push("");
  }
  return lines;
}

async function createPolicyPdf() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 52;
  const size = 10;
  const lineHeight = 15;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const maxWidth = pageWidth - margin * 2;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function nextPageIfNeeded(height = lineHeight) {
    if (y - height < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  }

  function heading(text) {
    nextPageIfNeeded(28);
    page.drawText(text, { x: margin, y, size: 14, font: bold, color: rgb(0.08, 0.16, 0.35) });
    y -= 22;
  }

  function paragraph(text) {
    const lines = wrapText(text, regular, size, maxWidth);
    for (const line of lines) {
      nextPageIfNeeded();
      if (line) page.drawText(line, { x: margin, y, size, font: regular, color: rgb(0.1, 0.13, 0.22) });
      y -= line ? lineHeight : 8;
    }
  }

  heading("Politica de Tratamiento de Datos Personales - Support Colombia");
  paragraph(
    "Support Colombia, en calidad de responsable del tratamiento, informa a sus contratistas, colaboradores, aspirantes y titulares que sus datos personales seran tratados conforme a la Ley 1581 de 2012, el Decreto 1377 de 2013 y las normas que los modifiquen o complementen.",
  );
  heading("Finalidades del tratamiento");
  paragraph(
    "Los datos seran usados para gestionar vinculacion contractual, administracion de personal temporal, asignacion a operaciones, seguridad social, ARL, control de dotacion, comunicaciones laborales, cumplimiento de obligaciones legales, reportes internos, atencion de solicitudes, gestion de clientes y prevencion de riesgos operativos.",
  );
  heading("Datos sensibles e imagen");
  paragraph(
    "El titular entiende que algunos datos pueden ser sensibles, como informacion de salud, tipo de sangre, seguridad social, imagen fotografica y datos biometricos derivados de la selfie. La entrega de estos datos es facultativa, salvo cuando sea necesaria para cumplir obligaciones legales, contractuales o de seguridad laboral. La selfie sera usada como foto de perfil e identificacion operativa.",
  );
  heading("Derechos del titular");
  paragraph(
    "El titular puede conocer, actualizar, rectificar y solicitar supresion de sus datos; solicitar prueba de la autorizacion; ser informado sobre el uso dado a sus datos; presentar quejas ante la Superintendencia de Industria y Comercio; revocar la autorizacion cuando sea procedente; y acceder gratuitamente a sus datos personales.",
  );
  heading("Canales de atencion");
  paragraph(
    "Las consultas, reclamos o solicitudes relacionadas con datos personales podran ser enviadas al correo de contacto definido por Support Colombia para proteccion de datos personales. La empresa atendera las solicitudes dentro de los terminos legales aplicables.",
  );
  heading("Transferencias, seguridad y conservacion");
  paragraph(
    "Support Colombia podra compartir datos con clientes, proveedores tecnologicos, entidades de seguridad social, autoridades y terceros necesarios para las finalidades autorizadas. La informacion sera protegida mediante medidas administrativas, tecnicas y organizacionales razonables. Los datos se conservaran durante el tiempo necesario para cumplir las finalidades informadas y obligaciones legales.",
  );
  heading("Autorizacion");
  paragraph(
    "Al marcar la casilla de aceptacion en el formulario digital, el titular declara que le fue informada esta politica, que conoce sus derechos y que autoriza de manera previa, expresa e informada el tratamiento de sus datos personales, datos sensibles e imagen para las finalidades descritas.",
  );
  paragraph("Documento demo generado para validacion funcional. Debe ser revisado por asesoria juridica antes de uso en produccion.");

  return await pdf.save();
}

loadEnv();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Configura EXPO_PUBLIC_SUPABASE_URL/SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir la politica.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const bytes = await createPolicyPdf();

const upload = await supabase.storage.from(POLICY_BUCKET).upload(POLICY_PATH, bytes, {
  contentType: "application/pdf",
  upsert: true,
});
if (upload.error) throw upload.error;

const upsert = await supabase.from("app_files").upsert(
  {
    provider: "supabase",
    bucket: POLICY_BUCKET,
    path: POLICY_PATH,
    original_name: "politica-tratamiento-datos-personales-support-colombia.pdf",
    mime_type: "application/pdf",
    size_bytes: bytes.byteLength,
  },
  { onConflict: "provider,bucket,path" },
);
if (upsert.error) throw upsert.error;

console.log(`Politica subida a ${POLICY_BUCKET}/${POLICY_PATH}`);
