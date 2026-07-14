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
const CONTRACTOR_DOCUMENT_BUCKET = "contractor-documents";
const PENDING_CONTRACT_DOCUMENT_CODE = "CONTRATO_PENDIENTE";
const SIGNED_CONTRACT_DOCUMENT_CODE = "CONTRATO_FIRMADO";
const CONTRACT_TEMPLATE_PATH = "templates/plantilla_contrato_contratistas_supportV2_acroform.pdf";
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

function dayTextSpanish(day: number) {
  const map: Record<number, string> = {
    1: "uno",
    2: "dos",
    3: "tres",
    4: "cuatro",
    5: "cinco",
    6: "seis",
    7: "siete",
    8: "ocho",
    9: "nueve",
    10: "diez",
    11: "once",
    12: "doce",
    13: "trece",
    14: "catorce",
    15: "quince",
    16: "dieciséis",
    17: "diecisiete",
    18: "dieciocho",
    19: "diecinueve",
    20: "veinte",
    21: "veintiuno",
    22: "veintidós",
    23: "veintitrés",
    24: "veinticuatro",
    25: "veinticinco",
    26: "veintiséis",
    27: "veintisiete",
    28: "veintiocho",
    29: "veintinueve",
    30: "treinta",
    31: "treinta y uno",
  };
  return map[day] ?? String(day);
}

function yearTextSpanish(year: number) {
  const map: Record<number, string> = {
    2025: "dos mil veinticinco",
    2026: "dos mil veintiséis",
    2027: "dos mil veintisiete",
    2028: "dos mil veintiocho",
    2029: "dos mil veintinueve",
    2030: "dos mil treinta",
    2031: "dos mil treinta y uno",
    2032: "dos mil treinta y dos",
    2033: "dos mil treinta y tres",
    2034: "dos mil treinta y cuatro",
    2035: "dos mil treinta y cinco",
  };
  return map[year] ?? String(year);
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

async function createContractPdf(
  serviceClient: any,
  contract: Record<string, string>,
  signature?: {
    bytes: Uint8Array;
    evidenceLines: string[];
  },
) {
  const { data, error } = await serviceClient.storage.from(POLICY_BUCKET).download(CONTRACT_TEMPLATE_PATH);
  if (error || !data) {
    throw new Error(`No fue posible cargar la plantilla PDF del contrato: ${error?.message ?? "archivo no disponible"}`);
  }

  const pdf = await PDFDocument.load(new Uint8Array(await data.arrayBuffer()));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const pages = pdf.getPages();
  const contractFieldFontSize = 19;

  const setTextField = (name: string, value: string) => {
    try {
      const field = form.getTextField(name);
      field.setText(value ?? "");
      field.setFontSize(contractFieldFontSize);
      const widgets = (field as any).acroField?.getWidgets?.() ?? [];
      for (const widget of widgets) {
        const appearance = widget.getAppearanceCharacteristics?.();
        appearance?.setBackgroundColor?.([1, 1, 1]);
        appearance?.setBorderColor?.([1, 1, 1]);
        widget.getBorderStyle?.()?.setWidth?.(0);
      }
    } catch (error) {
      throw new Error(`El campo ${name} no existe en la plantilla AcroForm.`);
    }
  };

  const fieldNames = [
    "nombrecontratista",
    "tipodocumentocontratista",
    "numerodocumentocontratista",
    "serviciocontratista",
    "duracioncontrato",
    "duracioncontratonro",
    "iniciocontratodia",
    "iniciocontratodianro",
    "mesiniciocontrato",
    "mesiniciocontratonro",
    "iniciocontratoanio",
    "fincontratodia",
    "fincontratodianro",
    "fincontratomes",
    "fincontratomesnro",
    "fincontratoanio",
    "direccioncontratista",
    "telefonocontratista",
    "correoelectronicocontratista",
    "ciudadcontrato",
    "diacontrato",
    "diacontratonro",
    "mescontrato",
    "aniocontratotexto",
    "aniocontratonro",
    "nombrecontratista_firma",
    "numerodocumentocontratista_firma",
  ];

  for (const name of fieldNames) {
    setTextField(name, String(contract[name] ?? ""));
  }
  setTextField("firma_contratista", "");

  form.updateFieldAppearances(regular);
  form.flatten();

  if (signature) {
    const page = pages[4];
    if (!page) throw new Error("La pagina de firma no esta disponible en la plantilla.");
    const embeddedSignature = await pdf.embedPng(signature.bytes);
    const signatureY = 126;
    page.drawImage(embeddedSignature, { x: 153.9, y: signatureY, width: 250, height: 82 });
    let evidenceY = 200;
    const evidenceX = Math.min(page.getWidth() - 170, 650);
    const evidenceWidth = Math.max(120, page.getWidth() - evidenceX - 24);
    page.drawText("Evidencia de firma", { x: evidenceX, y: evidenceY, size: 13, font: bold, color: rgb(0.08, 0.16, 0.35) });
    evidenceY -= 16;
    for (const line of signature.evidenceLines) {
      const evidenceWrapped = wrapText(line, regular, 10, evidenceWidth);
      for (const evidenceLine of evidenceWrapped) {
        if (evidenceY < 40) break;
        page.drawText(evidenceLine, { x: evidenceX, y: evidenceY, size: 10, font: regular, color: rgb(0.08, 0.13, 0.22) });
        evidenceY -= 12;
      }
    }
  }

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
  const contractorFullName = `${contractor.name ?? ""} ${contractor.last_name ?? ""}`.trim();

  return {
    contractorContractId: currentContract?.id ?? null,
    values: {
      nombrecontratista: contractorFullName,
      tipodocumentocontratista: firstRelation<{ name?: string }>(contractor.document_type)?.name ?? "cedula de ciudadania",
      numerodocumentocontratista: contractor.document_number ?? "",
      direccioncontratista: contractor.address ?? "",
      telefonocontratista: contractor.phone_number ?? "",
      correoelectronicocontratista: contractor.email ?? inviteEmail,
      serviciocontratista: "apoyo logistico",
      ciudadcontrato: "Bucaramanga",
      duracioncontrato: duration.text,
      duracioncontratonro: duration.number,
      iniciocontratodia: dayTextSpanish(start.day),
      iniciocontratodianro: String(start.day),
      mesiniciocontrato: start.monthText,
      mesiniciocontratonro: String(start.month),
      iniciocontratoanio: String(start.year),
      fincontratodia: dayTextSpanish(end.day),
      fincontratodianro: String(end.day),
      fincontratomes: end.monthText,
      fincontratomesnro: String(end.month),
      fincontratoanio: String(end.year),
      diacontrato: dayTextSpanish(signed.day),
      diacontratonro: String(signed.day),
      mescontrato: signed.monthText,
      aniocontrato: String(signed.year),
      aniocontratotexto: yearTextSpanish(signed.year),
      aniocontratonro: String(signed.year),
      nombrecontratista_firma: contractorFullName,
      numerodocumentocontratista_firma: contractor.document_number ?? "",
    },
  };
}

async function uploadContractSignatureArtifact(
  serviceClient: any,
  contractorId: number,
  bytes: Uint8Array,
) {
  const path = `contractor/${contractorId}/FIRMA_CONTRATO/${crypto.randomUUID()}.png`;
  const upload = await serviceClient.storage.from(CONTRACTOR_DOCUMENT_BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message);
  return await registerAppFile(
    serviceClient,
    CONTRACTOR_DOCUMENT_BUCKET,
    path,
    "firma-contratista.png",
    "image/png",
    bytes.byteLength,
  );
}

async function uploadContractPdfArtifact(
  serviceClient: any,
  contractorId: number,
  documentCode: string,
  bytes: Uint8Array,
  originalName: string,
) {
  const path = `contractor/${contractorId}/${documentCode}/${crypto.randomUUID()}.pdf`;
  const upload = await serviceClient.storage.from(CONTRACTOR_DOCUMENT_BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message);
  return await registerAppFile(serviceClient, CONTRACTOR_DOCUMENT_BUCKET, path, originalName, "application/pdf", bytes.byteLength);
}

async function registerSignedContractDocument(
  serviceClient: any,
  contractorId: number,
  fileId: string,
) {
  const { data: documentType, error: typeError } = await serviceClient
    .from("contractor_document_types")
    .select("id")
    .eq("code", SIGNED_CONTRACT_DOCUMENT_CODE)
    .eq("is_active", true)
    .single();
  if (typeError) throw new Error(typeError.message);

  const { error } = await serviceClient
    .from("contractor_documents")
    .upsert({
      contractor_id: contractorId,
      document_type_id: documentType.id,
      file_id: fileId,
    }, { onConflict: "file_id" });
  if (error) throw new Error(error.message);
}

async function createPendingContract(serviceClient: any, invite: InviteRow) {
  const contract = await getContractValues(serviceClient, invite.contractor_id, invite.email);
  const pdfBytes = await createContractPdf(serviceClient, contract.values);
  const fileId = await uploadContractPdfArtifact(
    serviceClient,
    invite.contractor_id,
    PENDING_CONTRACT_DOCUMENT_CODE,
    pdfBytes,
    "contrato-pendiente-firma.pdf",
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
      const signedPdfBytes = await createContractPdf(serviceClient, contract.values, { bytes: signatureBytes, evidenceLines });
      const signatureFileId = await uploadContractSignatureArtifact(
        serviceClient,
        invite.contractor_id,
        signatureBytes,
      );
      const signedContractFileId = await uploadContractPdfArtifact(
        serviceClient,
        invite.contractor_id,
        SIGNED_CONTRACT_DOCUMENT_CODE,
        signedPdfBytes,
        "contrato-firmado.pdf",
      );
      await registerSignedContractDocument(serviceClient, invite.contractor_id, signedContractFileId);

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
