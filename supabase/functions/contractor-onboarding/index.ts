import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  colombiaNow,
  POLICY_BUCKET,
  POLICY_PATH,
  PROFILE_PHOTO_BUCKET,
  PROFILE_SHIRT_TEMPLATE_PATH,
  publicPolicyUrl,
  sha256Hex,
} from "../_shared/onboarding.ts";

const MAX_SELFIE_BYTES = 2_097_152;
const CONTRACT_BUCKET = "contractor-contracts";
const CONTRACT_TEMPLATE_PATH = "templates/plantilla_contrato_contratistas_supportV1.docx";
const CONTRACT_ACCEPTANCE_TEXT =
  "El firmante declaró haber leído, entendido y aceptado el contenido del documento antes de firmar";
const ACCEPTANCE_TEXT =
  "Acepto la politica de tratamiento de datos personales de Support Colombia y autorizo el tratamiento de mis datos personales, datos sensibles e imagen para las finalidades informadas.";

type InviteRow = {
  id: string;
  contractor_id: number;
  email: string;
  status: string;
  expires_at: string;
  contractor: { name: string; last_name: string; document_number: string } | null;
};

type EvidencePayload = {
  browser?: string;
  operatingSystem?: string;
  deviceFingerprint?: string;
  userAgent?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
  };
};

function decodeBase64(value: string) {
  const clean = value.includes(",") ? value.split(",").pop() ?? "" : value;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requireString(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} es obligatorio.`);
  return text;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function dataUrlToBytes(value: string) {
  const clean = value.includes(",") ? value.split(",").pop() ?? "" : value;
  return base64ToBytes(clean);
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addMonthsMinusOneDay(value: string, months: number) {
  const date = parseIsoDate(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
}

function dateParts(value: string) {
  const date = parseIsoDate(value);
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const months = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  return {
    day,
    dayText: String(day),
    month,
    monthText: months[month - 1],
    year,
  };
}

function todayColombiaDate() {
  return colombiaNow().slice(0, 10);
}

function monthDurationText() {
  return { text: "un mes", number: "1 mes" };
}

async function registerAppFile(
  serviceClient: any,
  bucket: string,
  path: string,
  originalName: string,
  mimeType: string,
  sizeBytes: number,
) {
  const { data, error } = await serviceClient
    .from("app_files")
    .insert({
      provider: "supabase",
      bucket,
      path,
      original_name: originalName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function normalizeSelfieForOpenAi(selfieBytes: Uint8Array) {
  const source = await Image.decode(selfieBytes);
  const normalized = source.width === 1024 && source.height === 1024 ? source : source.cover(1024, 1024);
  return await normalized.encodeJPEG(78);
}

function blendChannel(source: number, target: number, alpha: number) {
  return Math.round(source * alpha + target * (1 - alpha));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const ratio = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return ratio * ratio * (3 - 2 * ratio);
}

function facePatchAlpha(x: number, y: number, width: number, height: number) {
  const faceDistance = Math.sqrt(((x - width * 0.5) / (width * 0.42)) ** 2 + ((y - height * 0.39) / (height * 0.38)) ** 2);
  const faceAlpha = smoothstep(1.13, 0.82, faceDistance);
  const neckDistance = Math.sqrt(((x - width * 0.5) / (width * 0.15)) ** 2 + ((y - height * 0.72) / (height * 0.16)) ** 2);
  const neckAlpha = smoothstep(1.15, 0.62, neckDistance) * 0.82;
  return Math.max(faceAlpha, neckAlpha);
}

async function loadShirtTemplate(serviceClient: any) {
  const { data, error } = await serviceClient.storage
    .from(POLICY_BUCKET)
    .download(PROFILE_SHIRT_TEMPLATE_PATH);
  if (error || !data) {
    throw new Error(`No fue posible cargar la plantilla de camisa: ${error?.message ?? "archivo no disponible"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

function createShirtTemplateBase(template: Image) {
  const width = 1024;
  const height = 1024;
  const templateWidth = 1024;
  const templateHeight = Math.round(template.height * (templateWidth / template.width));
  const resizedTemplate = template.resize(templateWidth, templateHeight);
  const result = new Image(width, height);
  const background = Image.rgbaToColor(235, 235, 235, 255);
  const templateOffsetY = 110;

  for (let y = 1; y <= height; y += 1) {
    for (let x = 1; x <= width; x += 1) {
      result.setPixelAt(x, y, background);
    }
  }

  for (let sourceY = 1; sourceY <= resizedTemplate.height; sourceY += 1) {
    const targetY = sourceY + templateOffsetY;
    if (targetY < 1 || targetY > height) continue;
    for (let sourceX = 1; sourceX <= resizedTemplate.width; sourceX += 1) {
      if (sourceX > width) continue;
      result.setPixelAt(sourceX, targetY, resizedTemplate.getPixelAt(sourceX, sourceY));
    }
  }

  return result;
}

function composeFaceAndNeckOnTemplate(template: Image, selfie: Image) {
  const base = createShirtTemplateBase(template);
  const source = selfie.width === 1024 && selfie.height === 1024 ? selfie : selfie.cover(1024, 1024);
  const cropX = Math.round(source.width * 0.22);
  const cropY = 0;
  const cropWidth = Math.round(source.width * 0.56);
  const cropHeight = Math.round(source.height * 0.62);
  const facePatch = source.clone().crop(cropX, cropY, cropWidth, cropHeight).resize(430, 495);
  const offsetX = Math.round((base.width - facePatch.width) / 2);
  const offsetY = 64;
  const result = base.clone();

  for (let patchY = 1; patchY <= facePatch.height; patchY += 1) {
    const targetY = offsetY + patchY;
    if (targetY < 1 || targetY > result.height) continue;
    for (let patchX = 1; patchX <= facePatch.width; patchX += 1) {
      const targetX = offsetX + patchX;
      if (targetX < 1 || targetX > result.width) continue;
      const alpha = facePatchAlpha(patchX - 1, patchY - 1, facePatch.width, facePatch.height);
      if (alpha <= 0) continue;
      const [sourceR, sourceG, sourceB] = Image.colorToRGBA(facePatch.getPixelAt(patchX, patchY));
      const [targetR, targetG, targetB] = Image.colorToRGBA(result.getPixelAt(targetX, targetY));
      result.setPixelAt(
        targetX,
        targetY,
        Image.rgbaToColor(
          blendChannel(sourceR, targetR, alpha),
          blendChannel(sourceG, targetG, alpha),
          blendChannel(sourceB, targetB, alpha),
          255,
        ),
      );
    }
  }

  return result;
}

async function createCorporatePhotoComposite(serviceClient: any, normalizedSelfieBytes: Uint8Array) {
  const [templateBytes, selfie] = await Promise.all([
    loadShirtTemplate(serviceClient),
    Image.decode(normalizedSelfieBytes),
  ]);
  const template = await Image.decode(templateBytes);
  return composeFaceAndNeckOnTemplate(template, selfie);
}

function buildPhotoHarmonizationForm(preliminaryBytes: Uint8Array, selfieBytes: Uint8Array, includeInputFidelity: boolean) {
  const form = new FormData();
  form.append("model", Deno.env.get("OPENAI_IMAGE_MODEL") ?? "gpt-image-1");
  form.append("image[]", new File([preliminaryBytes], "shirt-template-composite.jpg", { type: "image/jpeg" }));
  form.append("image[]", new File([selfieBytes], "selfie-reference.jpg", { type: "image/jpeg" }));
  if (includeInputFidelity) form.append("input_fidelity", "high");
  form.append(
    "prompt",
    [
      "Improve only the natural integration of this already-composited corporate portrait.",
      "Preserve the exact person's face, ears, eyes, mouth, nose, eyebrows, facial hair, skin tone, head shape, expression, age, and identity from the selfie reference.",
      "Do not redraw, replace, beautify, retouch, smooth, reshape, age, de-age, or stylize the face.",
      "Preserve the shirt template exactly: white Support Colombia shirt, logo, collar, buttons, proportions, and clean light background.",
      "Only harmonize the seam between neck and shirt, subtle shadows, exposure, and lighting so the portrait looks natural.",
      "Do not add a tie, do not change the logo, do not change the shirt color, and do not create a different person.",
      "Final image must remain a centered head-and-shoulders employee profile photo with a clear professional background.",
    ].join(" "),
  );
  form.append("size", "1024x1024");
  form.append("quality", "low");
  return form;
}

async function requestOpenAiPhotoHarmonization(openAiKey: string, preliminaryBytes: Uint8Array, selfieBytes: Uint8Array) {
  const sendRequest = async (includeInputFidelity: boolean) => {
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: buildPhotoHarmonizationForm(preliminaryBytes, selfieBytes, includeInputFidelity),
    });
    const detail = await response.text();
    return { ok: response.ok, detail };
  };

  let result = await sendRequest(true);
  if (!result.ok && result.detail.toLowerCase().includes("input_fidelity")) {
    result = await sendRequest(false);
  }
  if (!result.ok) {
    throw new Error(`OpenAI image edit failed: ${result.detail}`);
  }

  const payload = JSON.parse(result.detail);
  const imageBase64 = payload?.data?.[0]?.b64_json;
  if (typeof imageBase64 !== "string" || !imageBase64) {
    throw new Error("OpenAI no devolvio imagen generada.");
  }
  return base64ToBytes(imageBase64);
}

async function generateCorporateProfilePhoto(serviceClient: any, selfieBytes: Uint8Array) {
  const normalizedSelfieBytes = await normalizeSelfieForOpenAi(selfieBytes);
  const compositeImage = await createCorporatePhotoComposite(serviceClient, normalizedSelfieBytes);
  const preliminaryBytes = await compositeImage.encodeJPEG(80);
  const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!openAiKey) return await encodeCompressedProfilePhoto(compositeImage);

  try {
    const generatedBytes = await requestOpenAiPhotoHarmonization(openAiKey, preliminaryBytes, normalizedSelfieBytes);
    return await encodeCompressedProfilePhoto(await Image.decode(generatedBytes));
  } catch (error) {
    console.error("Corporate profile photo harmonization failed", error);
    return await encodeCompressedProfilePhoto(compositeImage);
  }
}

async function encodeCompressedProfilePhoto(image: Image) {
  const attempts = [
    { size: 768, quality: 78 },
    { size: 640, quality: 70 },
    { size: 512, quality: 66 },
  ];
  let current = image;
  let lastBytes: Uint8Array | null = null;

  for (const attempt of attempts) {
    if (current.width > attempt.size || current.height > attempt.size) {
      current = current.contain(attempt.size, attempt.size);
    }
    lastBytes = await current.encodeJPEG(attempt.quality);
    if (lastBytes.byteLength <= 1_500_000) return lastBytes;
  }

  return lastBytes ?? await image.encodeJPEG(66);
}

function wrapText(text: string, font: any, fontSize: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function createContractPdf(contract: Record<string, string>, signature?: {
  bytes: Uint8Array;
  evidenceLines: string[];
}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 52;
  const fontSize = 10.2;
  const lineHeight = 14;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };
  const drawWrapped = (text: string, options: { font?: any; size?: number; gap?: number } = {}) => {
    const activeFont = options.font ?? regular;
    const activeSize = options.size ?? fontSize;
    const lines = wrapText(text, activeFont, activeSize, pageWidth - margin * 2);
    for (const line of lines) {
      if (y < margin + 34) newPage();
      page.drawText(line, { x: margin, y, size: activeSize, font: activeFont, color: rgb(0.08, 0.13, 0.22) });
      y -= lineHeight;
    }
    y -= options.gap ?? 8;
  };

  page.drawText("CONTRATO DE PRESTACION DE SERVICIOS PROFESIONALES INDEPENDIENTES", {
    x: margin,
    y,
    size: 12,
    font: bold,
    color: rgb(0.08, 0.16, 0.35),
  });
  y -= 28;

  drawWrapped(
    `Entre los suscritos a saber, JEFERSON ARLEY PALACIO HERRERA, mayor de edad, vecino y con domicilio en la ciudad de Bucaramanga, identificado con cedula de ciudadania numero 1075677084, actuando en nombre y representacion de SUPPORT COLOMBIA SAS, sociedad comercial identificada con NIT No. 901482879-2, quien en adelante se denominara EL CONTRATANTE, por una parte, y por el otro extremo ${contract.nombrecontratista}, mayor de edad, identificado(a) con ${contract.tipodocumentocontratista} No. ${contract.numerodocumentocontratista}, actuando en nombre propio, quien para los efectos del presente documento se denominara EL CONTRATISTA, acuerdan celebrar el presente contrato.`,
  );
  drawWrapped(
    `PRIMERA. OBJETO. EL CONTRATISTA es un trabajador independiente, experto en proporcionar servicios de ${contract.serviciocontratista}, respecto de los cuales manifiesta contar con amplia experiencia y capacidad para ejecutarlos de manera autonoma.`,
    { font: regular },
  );
  drawWrapped(
    "SEGUNDA. AUTONOMIA. EL CONTRATISTA ejecutara las actividades contratadas con autonomia tecnica y administrativa, sin subordinacion laboral, y respondera por la correcta prestacion del servicio contratado.",
  );
  drawWrapped(
    "TERCERA. OBLIGACIONES. EL CONTRATISTA se obliga a prestar el servicio con responsabilidad, diligencia, oportunidad y calidad; cumplir las instrucciones operativas razonables del servicio; conservar la confidencialidad de la informacion; y cumplir la normatividad aplicable.",
  );
  drawWrapped(
    `CUARTA. DURACION O PLAZO. El presente contrato tendra una duracion de ${contract.duracioncontrato} (${contract.duracioncontratonro}), contados a partir del dia ${contract.iniciocontratodia} del mes ${contract.mesiniciocontrato} del ano ${contract.iniciocontratoanio} hasta el dia ${contract.fincontratodia} del mes ${contract.fincontratomes} (${contract.fincontratomesnro}) del ano ${contract.fincontratoanio}. Cualquiera de las partes podra darlo por terminado conforme a las condiciones pactadas entre las partes.`,
  );
  drawWrapped(
    "QUINTA. NATURALEZA. Las partes declaran que el presente contrato es de naturaleza civil/comercial de prestacion de servicios independientes y no constituye relacion laboral.",
  );
  drawWrapped(
    "SEXTA. SEGURIDAD SOCIAL. EL CONTRATISTA declara conocer y asumir las obligaciones que le correspondan en materia de seguridad social, de acuerdo con el tipo de vinculacion y los acuerdos operativos aplicables.",
  );
  drawWrapped(
    "SEPTIMA. CONFIDENCIALIDAD Y DATOS PERSONALES. EL CONTRATISTA autoriza el tratamiento de sus datos personales para fines contractuales, administrativos, operativos y legales, conforme a la politica de tratamiento de datos personales informada por SUPPORT COLOMBIA SAS.",
  );
  drawWrapped(
    `OCTAVA. NOTIFICACIONES. Por EL CONTRATISTA en la direccion ${contract.direccioncontratista}; Telefono: ${contract.telefonocontratista}; Correo electronico: ${contract.correoelectronicocontratista}.`,
  );
  drawWrapped(
    `Las partes suscriben el presente documento en la ciudad de ${contract.ciudadcontrato} el dia ${contract.diacontrato} (${contract.diacontratonro}) del mes de ${contract.mescontrato}, del ano ${contract.aniocontrato}.`,
  );

  if (y < 220) newPage();
  y -= 18;
  page.drawText("EL CONTRATISTA", { x: margin, y, size: 10, font: bold, color: rgb(0.08, 0.13, 0.22) });
  y -= 88;

  if (signature) {
    const embeddedSignature = await pdf.embedPng(signature.bytes);
    page.drawImage(embeddedSignature, { x: margin, y: y + 12, width: 178, height: 62 });
    let evidenceY = y + 68;
    page.drawText("Evidencia de firma", { x: margin + 230, y: evidenceY, size: 8.7, font: bold, color: rgb(0.08, 0.16, 0.35) });
    evidenceY -= 12;
    for (const line of signature.evidenceLines) {
      const evidenceWrapped = wrapText(line, regular, 7.2, pageWidth - margin - (margin + 230));
      for (const evidenceLine of evidenceWrapped) {
        page.drawText(evidenceLine, { x: margin + 230, y: evidenceY, size: 7.2, font: regular, color: rgb(0.18, 0.22, 0.32) });
        evidenceY -= 9;
      }
    }
  } else {
    page.drawLine({ start: { x: margin, y: y + 36 }, end: { x: margin + 190, y: y + 36 }, thickness: 0.8, color: rgb(0.3, 0.35, 0.45) });
  }
  y -= 8;
  page.drawText(`Nombre: ${contract.nombrecontratista}`, { x: margin, y, size: 9, font: regular, color: rgb(0.08, 0.13, 0.22) });
  y -= 14;
  page.drawText(`C.C. ${contract.numerodocumentocontratista}`, { x: margin, y, size: 9, font: regular, color: rgb(0.08, 0.13, 0.22) });

  return await pdf.save();
}

async function getContractValues(serviceClient: any, contractorId: number, inviteEmail: string) {
  const { data: contractor, error: contractorError } = await serviceClient
    .from("contractor")
    .select("id,name,last_name,document_number,address,phone_number,email,document_type(name)")
    .eq("id", contractorId)
    .single();
  if (contractorError) throw new Error(contractorError.message);

  const { data: currentContract, error: contractError } = await serviceClient
    .from("contractor_contract")
    .select("id,start_date,end_date")
    .eq("contractor_id", contractorId)
    .order("start_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (contractError) throw new Error(contractError.message);

  const startDate = currentContract?.start_date ?? todayColombiaDate();
  const endDate = currentContract?.end_date ?? addMonthsMinusOneDay(startDate, 1);
  const start = dateParts(startDate);
  const end = dateParts(endDate);
  const signed = dateParts(todayColombiaDate());
  const duration = monthDurationText();

  return {
    contractorContractId: currentContract?.id ?? null,
    values: {
      nombrecontratista: `${contractor.name ?? ""} ${contractor.last_name ?? ""}`.trim(),
      tipodocumentocontratista: firstRelation<{ name?: string }>(contractor.document_type)?.name ?? "cedula de ciudadania",
      numerodocumentocontratista: contractor.document_number ?? "",
      direccioncontratista: contractor.address ?? "",
      telefonocontratista: contractor.phone_number ?? "",
      correoelectronicocontratista: contractor.email ?? inviteEmail,
      serviciocontratista: "apoyo logistico",
      ciudadcontrato: "Bucaramanga",
      duracioncontrato: duration.text,
      duracioncontratonro: duration.number,
      iniciocontratodia: String(start.day),
      mesiniciocontrato: start.monthText,
      iniciocontratoanio: String(start.year),
      fincontratodia: String(end.day),
      fincontratomes: end.monthText,
      fincontratomesnro: String(end.month),
      fincontratoanio: String(end.year),
      diacontrato: String(signed.day),
      diacontratonro: String(signed.day),
      mescontrato: signed.monthText,
      aniocontrato: String(signed.year),
    },
  };
}

async function uploadContractArtifact(
  serviceClient: any,
  contractorId: number,
  folder: string,
  bytes: Uint8Array,
  originalName: string,
  mimeType: string,
) {
  const extension = mimeType === "application/pdf" ? "pdf" : "png";
  const path = `contractor/${contractorId}/contracts/${folder}/${crypto.randomUUID()}.${extension}`;
  const upload = await serviceClient.storage.from(CONTRACT_BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message);
  return await registerAppFile(serviceClient, CONTRACT_BUCKET, path, originalName, mimeType, bytes.byteLength);
}

async function createPendingContract(serviceClient: any, invite: InviteRow) {
  const contract = await getContractValues(serviceClient, invite.contractor_id, invite.email);
  const pdfBytes = await createContractPdf(contract.values);
  const fileId = await uploadContractArtifact(
    serviceClient,
    invite.contractor_id,
    "unsigned",
    pdfBytes,
    "contrato-pendiente-firma.pdf",
    "application/pdf",
  );

  const { error } = await serviceClient
    .from("contractor_contract_signatures")
    .upsert({
      contractor_id: invite.contractor_id,
      contractor_contract_id: contract.contractorContractId,
      invite_id: invite.id,
      unsigned_contract_file_id: fileId,
      status: "PENDING",
      acceptance_text: CONTRACT_ACCEPTANCE_TEXT,
    }, { onConflict: "invite_id" });
  if (error) throw new Error(error.message);
  return fileId;
}

async function getInvite(serviceClient: any, token: string, allowedStatuses = ["PENDING"]) {
  const tokenHash = await sha256Hex(token);
  const { data, error } = await serviceClient
    .from("contractor_onboarding_invites")
    .select("id,contractor_id,email,status,expires_at,contractor(name,last_name,document_number)")
    .eq("token_hash", tokenHash)
    .maybeSingle<InviteRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("El enlace no es valido.");
  if (!allowedStatuses.includes(data.status)) throw new Error("Este enlace ya fue utilizado o no esta disponible.");
  if (data.expires_at < colombiaNow()) {
    await serviceClient
      .from("contractor_onboarding_invites")
      .update({ status: "EXPIRED" })
      .eq("id", data.id);
    throw new Error("El enlace ya vencio. Solicita uno nuevo a Support Colombia.");
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase Edge Function environment is incomplete" }, 500);
  }
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json();
    const action = body?.action;
    const token = requireString(body?.token, "Token");
    const allowedStatuses =
      action === "get" || action === "get-contract"
        ? ["PENDING", "DATA_SUBMITTED"]
        : action === "sign-contract"
          ? ["DATA_SUBMITTED"]
          : ["PENDING"];
    const invite = await getInvite(serviceClient, token, allowedStatuses);

    if (action === "get") {
      const [civilStates, transportTypes, educationLevels, policyFile] = await Promise.all([
        serviceClient.from("civil_state_type").select("id,name").order("id"),
        serviceClient.from("transport_type").select("id,name").order("id"),
        serviceClient.from("education_level_type").select("id,name").eq("is_active", true).order("id"),
        serviceClient
          .from("app_files")
          .select("id")
          .eq("bucket", POLICY_BUCKET)
          .eq("path", POLICY_PATH)
          .maybeSingle(),
      ]);

      if (civilStates.error) throw new Error(civilStates.error.message);
      if (transportTypes.error) throw new Error(transportTypes.error.message);
      if (educationLevels.error) throw new Error(educationLevels.error.message);

      return jsonResponse({
        contractor: {
          id: invite.contractor_id,
          name: `${invite.contractor?.name ?? ""} ${invite.contractor?.last_name ?? ""}`.trim(),
          document: invite.contractor?.document_number ?? "",
          email: invite.email,
        },
        status: invite.status,
        catalogs: {
          civilStates: civilStates.data ?? [],
          transportTypes: transportTypes.data ?? [],
          educationLevels: educationLevels.data ?? [],
          bloodTypes: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
          stratum: ["1", "2", "3", "4", "5", "6"],
          shirtSizes: ["XS", "S", "M", "L", "XL", "XXL"],
          pantSizes: ["28", "30", "32", "34", "36", "38", "40", "42"],
          shoeSizes: ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44"],
        },
        policy: {
          fileId: policyFile.data?.id ?? null,
          url: publicPolicyUrl(supabaseUrl),
          acceptanceText: ACCEPTANCE_TEXT,
        },
      });
    }

    if (action === "get-contract") {
      const { data: signatureRow, error: signatureError } = await serviceClient
        .from("contractor_contract_signatures")
        .select("id,unsigned_contract_file_id,app_files:unsigned_contract_file_id(bucket,path)")
        .eq("invite_id", invite.id)
        .maybeSingle();
      if (signatureError) throw new Error(signatureError.message);
      const unsignedFile = firstRelation<{ bucket?: string; path?: string }>(signatureRow?.app_files);
      if (!unsignedFile?.bucket || !unsignedFile?.path) {
        throw new Error("El contrato aun no esta disponible.");
      }
      const signed = await serviceClient.storage
        .from(unsignedFile.bucket)
        .createSignedUrl(unsignedFile.path, 300);
      if (signed.error) throw new Error(signed.error.message);
      return jsonResponse({
        contractUrl: signed.data.signedUrl,
        acceptanceText: CONTRACT_ACCEPTANCE_TEXT,
      });
    }

    if (action === "sign-contract") {
      const signatureBase64 = requireString(body?.signatureBase64, "Firma");
      const signatureBytes = dataUrlToBytes(signatureBase64);
      if (signatureBytes.byteLength <= 0 || signatureBytes.byteLength > 1_000_000) {
        throw new Error("La firma no es valida.");
      }
      const evidence = (body?.evidence ?? {}) as EvidencePayload;
      const latitude = Number(evidence.location?.latitude);
      const longitude = Number(evidence.location?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("Debes permitir la ubicacion para firmar el contrato.");
      }

      const contract = await getContractValues(serviceClient, invite.contractor_id, invite.email);
      const signedAt = colombiaNow();
      const ipAddress = req.headers.get("x-forwarded-for") ?? null;
      const userAgent = req.headers.get("user-agent") ?? evidence.userAgent ?? null;
      const evidenceLines = [
        `IP: ${ipAddress ?? "No disponible"}`,
        `Fecha y hora: ${signedAt} America/Bogota`,
        `Navegador: ${evidence.browser ?? "No disponible"}`,
        `Sistema operativo: ${evidence.operatingSystem ?? "No disponible"}`,
        `Huella dispositivo: ${evidence.deviceFingerprint ?? "No disponible"}`,
        `Ubicacion: ${latitude}, ${longitude}`,
        `Precision: ${Number.isFinite(Number(evidence.location?.accuracy)) ? `${evidence.location?.accuracy} m` : "No disponible"}`,
        CONTRACT_ACCEPTANCE_TEXT,
      ];
      const signedPdfBytes = await createContractPdf(contract.values, { bytes: signatureBytes, evidenceLines });
      const signatureFileId = await uploadContractArtifact(
        serviceClient,
        invite.contractor_id,
        "signatures",
        signatureBytes,
        "firma-contratista.png",
        "image/png",
      );
      const signedContractFileId = await uploadContractArtifact(
        serviceClient,
        invite.contractor_id,
        "signed",
        signedPdfBytes,
        "contrato-firmado.pdf",
        "application/pdf",
      );

      const { error: signatureError } = await serviceClient
        .from("contractor_contract_signatures")
        .update({
          contractor_contract_id: contract.contractorContractId,
          signature_file_id: signatureFileId,
          signed_contract_file_id: signedContractFileId,
          status: "SIGNED",
          signed_at: signedAt,
          ip_address: ipAddress,
          browser: evidence.browser ?? null,
          operating_system: evidence.operatingSystem ?? null,
          user_agent: userAgent,
          device_fingerprint: evidence.deviceFingerprint ?? null,
          location_latitude: latitude,
          location_longitude: longitude,
          location_accuracy: Number.isFinite(Number(evidence.location?.accuracy)) ? Number(evidence.location?.accuracy) : null,
          evidence: {
            ...evidence,
            ipAddress,
            signedAt,
            acceptanceText: CONTRACT_ACCEPTANCE_TEXT,
          },
          acceptance_text: CONTRACT_ACCEPTANCE_TEXT,
        })
        .eq("invite_id", invite.id);
      if (signatureError) throw new Error(signatureError.message);

      const { error: inviteError } = await serviceClient
        .from("contractor_onboarding_invites")
        .update({
          status: "SUBMITTED",
          used_at: signedAt,
        })
        .eq("id", invite.id);
      if (inviteError) throw new Error(inviteError.message);

      return jsonResponse({ ok: true });
    }

    if (action !== "submit") return jsonResponse({ error: "Accion no valida." }, 400);

    const payload = body?.payload ?? {};
    if (!payload.acceptsDataPolicy) {
      throw new Error("Debes aceptar la politica de tratamiento de datos personales.");
    }

    const selfieBase64 = requireString(payload.selfieBase64, "Selfie");
    const selfieBytes = decodeBase64(selfieBase64);
    if (selfieBytes.byteLength <= 0 || selfieBytes.byteLength > MAX_SELFIE_BYTES) {
      throw new Error("La selfie no es valida o supera el tamano permitido.");
    }

    const civilStateId = Number(payload.civilStateId);
    const transportTypeId = Number(payload.transportTypeId);
    const educationLevelId = Number(payload.educationLevelId);
    if (!Number.isFinite(civilStateId) || !Number.isFinite(transportTypeId) || !Number.isFinite(educationLevelId)) {
      throw new Error("Selecciona estado civil, transporte y grado de escolaridad.");
    }

    const photoPath = `contractor/${invite.contractor_id}/profile/original/${crypto.randomUUID()}.jpg`;
    const upload = await serviceClient.storage
      .from(PROFILE_PHOTO_BUCKET)
      .upload(photoPath, selfieBytes, {
        contentType: "image/jpeg",
        upsert: false,
      });
    if (upload.error) throw new Error(upload.error.message);

    const { data: photoFile, error: photoFileError } = await serviceClient
      .from("app_files")
      .insert({
        provider: "supabase",
        bucket: PROFILE_PHOTO_BUCKET,
        path: photoPath,
        original_name: "selfie-original.jpg",
        mime_type: "image/jpeg",
        size_bytes: selfieBytes.byteLength,
      })
      .select("id")
      .single();
    if (photoFileError) throw new Error(photoFileError.message);

    let profilePhotoFileId = photoFile.id;
    try {
      const generatedBytes = await generateCorporateProfilePhoto(serviceClient, selfieBytes);
      if (generatedBytes) {
        const generatedPath = `contractor/${invite.contractor_id}/profile/generated/${crypto.randomUUID()}.jpg`;
        const generatedUpload = await serviceClient.storage
          .from(PROFILE_PHOTO_BUCKET)
          .upload(generatedPath, generatedBytes, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (generatedUpload.error) throw new Error(generatedUpload.error.message);

        const { data: generatedFile, error: generatedFileError } = await serviceClient
          .from("app_files")
          .insert({
            provider: "supabase",
            bucket: PROFILE_PHOTO_BUCKET,
            path: generatedPath,
            original_name: "foto-perfil-empresarial.jpg",
            mime_type: "image/jpeg",
            size_bytes: generatedBytes.byteLength,
          })
          .select("id")
          .single();
        if (generatedFileError) throw new Error(generatedFileError.message);
        profilePhotoFileId = generatedFile.id;
      }
    } catch (photoError) {
      console.error("Corporate profile photo generation failed", photoError);
    }

    const { data: policyFile } = await serviceClient
      .from("app_files")
      .select("id")
      .eq("bucket", POLICY_BUCKET)
      .eq("path", POLICY_PATH)
      .maybeSingle();

    const { error: contractorError } = await serviceClient
      .from("contractor")
      .update({
        rh: requireString(payload.bloodType, "Tipo de sangre"),
        birth_date: requireString(payload.birthDate, "Fecha de nacimiento"),
        birth_place: requireString(payload.birthPlace, "Lugar de nacimiento"),
        civil_state_id: civilStateId,
        residence_department: requireString(payload.residenceDepartment, "Departamento de residencia"),
        residence_city: requireString(payload.residenceCity, "Ciudad de residencia"),
        address: requireString(payload.address, "Direccion de residencia"),
        stratum: requireString(payload.stratum, "Estrato"),
        phone_number: requireString(payload.phone, "Telefono"),
        type_transport_id: transportTypeId,
        education_level_id: educationLevelId,
        eps: requireString(payload.eps, "EPS"),
        shirt_size: requireString(payload.shirtSize, "Talla de camisa"),
        pant_size: requireString(payload.pantSize, "Talla de pantalon"),
        shoe_size: requireString(payload.shoeSize, "Talla de zapatos"),
        pension_fund: requireString(payload.pensionFund, "Fondo de pensiones"),
        emergency_contact_name: requireString(payload.emergencyContactName, "Contacto de emergencia"),
        emergency_contact_relationship: requireString(payload.emergencyContactRelationship, "Parentesco"),
        emergency_contact_phone: requireString(payload.emergencyContactPhone, "Telefono de emergencia"),
        profile_photo_file_id: profilePhotoFileId,
        data_policy_accepted_at: colombiaNow(),
      })
      .eq("id", invite.contractor_id);
    if (contractorError) throw new Error(contractorError.message);

    const { error: acceptanceError } = await serviceClient
      .from("contractor_data_policy_acceptances")
      .insert({
        contractor_id: invite.contractor_id,
        invite_id: invite.id,
        policy_file_id: policyFile?.id ?? null,
        acceptance_text: ACCEPTANCE_TEXT,
        ip_address: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      });
    if (acceptanceError) throw new Error(acceptanceError.message);

    await createPendingContract(serviceClient, invite);

    const { error: inviteError } = await serviceClient
      .from("contractor_onboarding_invites")
      .update({
        status: "DATA_SUBMITTED",
      })
      .eq("id", invite.id);
    if (inviteError) throw new Error(inviteError.message);

    return jsonResponse({ ok: true, nextStep: "CONTRACT_SIGNATURE" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible procesar el formulario.";
    return jsonResponse({ error: message }, 400);
  }
});
