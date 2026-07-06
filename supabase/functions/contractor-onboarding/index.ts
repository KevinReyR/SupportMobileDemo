import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  colombiaNow,
  POLICY_BUCKET,
  POLICY_PATH,
  PROFILE_LOGO_PATH,
  PROFILE_PHOTO_BUCKET,
  publicPolicyUrl,
  sha256Hex,
} from "../_shared/onboarding.ts";

const MAX_SELFIE_BYTES = 2_097_152;
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

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function createFaceProtectionMask(selfieBytes: Uint8Array) {
  const source = await Image.decode(selfieBytes);
  const size = Math.max(source.width, source.height);
  const mask = new Image(size, size);
  const opaqueWhite = Image.rgbaToColor(255, 255, 255, 255);
  const centerX = size * 0.5;
  const centerY = size * 0.34;
  const radiusX = size * 0.23;
  const radiusY = size * 0.24;
  const neckLeft = size * 0.36;
  const neckRight = size * 0.64;
  const neckTop = size * 0.47;
  const neckBottom = size * 0.62;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const normalizedFaceX = (x - centerX) / radiusX;
      const normalizedFaceY = (y - centerY) / radiusY;
      const insideFaceProtection = normalizedFaceX * normalizedFaceX + normalizedFaceY * normalizedFaceY <= 1;
      const insideNeckProtection = x >= neckLeft && x <= neckRight && y >= neckTop && y <= neckBottom;
      if (insideFaceProtection || insideNeckProtection) {
        mask.setPixelAt(x + 1, y + 1, opaqueWhite);
      }
    }
  }

  return await mask.encodePNG();
}

async function generateCorporateProfilePhoto(serviceClient: any, selfieBytes: Uint8Array) {
  const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!openAiKey) return null;

  const form = new FormData();
  form.append("model", Deno.env.get("OPENAI_IMAGE_MODEL") ?? "gpt-image-1");
  form.append("image[]", new File([selfieBytes], "selfie-original.jpg", { type: "image/jpeg" }));
  try {
    const maskBytes = await createFaceProtectionMask(selfieBytes);
    form.append("mask", new File([maskBytes], "face-protection-mask.png", { type: "image/png" }));
  } catch (maskError) {
    console.error("Face protection mask generation failed", maskError);
  }
  form.append(
    "prompt",
    [
      "Create a professional corporate employee profile photo from the selfie.",
      "The face must remain pixel-identical in identity: do not change facial structure, eyes, nose, mouth, jaw, cheeks, forehead, ears, hairline, skin texture, skin tone, expression, age, or any identifying facial detail.",
      "Do not beautify, retouch, smooth skin, reshape, age, de-age, stylize, replace, or redraw the face.",
      "Only change non-facial context: background, lighting balance, clothing from neck down, and shirt branding.",
      "Use a clean studio background, business-ready lighting, and a neat corporate shirt while keeping the original head and face unchanged.",
      "Place the Support Colombia logo naturally on the shirt as a small embroidered company logo.",
      "Head-and-shoulders portrait, centered, realistic, suitable for an employee profile.",
    ].join(" "),
  );
  form.append("size", "1024x1024");
  form.append("quality", "low");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI image edit failed: ${detail}`);
  }
  const result = await response.json();
  const imageBase64 = result?.data?.[0]?.b64_json;
  if (typeof imageBase64 !== "string" || !imageBase64) {
    throw new Error("OpenAI no devolvio imagen generada.");
  }
  const generatedBytes = base64ToBytes(imageBase64);
  try {
    return await addSupportLogoToProfilePhoto(serviceClient, generatedBytes);
  } catch (logoError) {
    console.error("Support logo composition failed", logoError);
    return generatedBytes;
  }
}

async function addSupportLogoToProfilePhoto(serviceClient: any, generatedBytes: Uint8Array) {
  const { data: logoBlob, error: logoError } = await serviceClient.storage
    .from(POLICY_BUCKET)
    .download(PROFILE_LOGO_PATH);
  if (logoError || !logoBlob) throw new Error(logoError?.message ?? "No fue posible cargar el logo.");

  const [profileImage, logoImage] = await Promise.all([
    Image.decode(generatedBytes),
    Image.decode(new Uint8Array(await logoBlob.arrayBuffer())),
  ]);
  const logoWidth = Math.round(profileImage.width * 0.18);
  const logoHeight = Math.round((logoImage.height / logoImage.width) * logoWidth);
  const resizedLogo = logoImage.resize(logoWidth, logoHeight);
  const x = Math.round(profileImage.width * 0.58 - resizedLogo.width / 2);
  const y = Math.round(profileImage.height * 0.62 - resizedLogo.height / 2);

  profileImage.composite(resizedLogo, x, y);
  return await encodeCompressedProfilePhoto(profileImage);
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

async function getInvite(serviceClient: any, token: string) {
  const tokenHash = await sha256Hex(token);
  const { data, error } = await serviceClient
    .from("contractor_onboarding_invites")
    .select("id,contractor_id,email,status,expires_at,contractor(name,last_name,document_number)")
    .eq("token_hash", tokenHash)
    .maybeSingle<InviteRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("El enlace no es valido.");
  if (data.status !== "PENDING") throw new Error("Este enlace ya fue utilizado o no esta disponible.");
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
    const invite = await getInvite(serviceClient, token);

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

    const { error: inviteError } = await serviceClient
      .from("contractor_onboarding_invites")
      .update({
        status: "SUBMITTED",
        used_at: colombiaNow(),
      })
      .eq("id", invite.id);
    if (inviteError) throw new Error(inviteError.message);

    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible procesar el formulario.";
    return jsonResponse({ error: message }, 400);
  }
});
