import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  colombiaNow,
  POLICY_BUCKET,
  POLICY_PATH,
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

    const photoPath = `contractor/${invite.contractor_id}/profile/${crypto.randomUUID()}.jpg`;
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
        original_name: "selfie-perfil.jpg",
        mime_type: "image/jpeg",
        size_bytes: selfieBytes.byteLength,
      })
      .select("id")
      .single();
    if (photoFileError) throw new Error(photoFileError.message);

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
        profile_photo_file_id: photoFile.id,
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
