import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { addDaysColombia, colombiaNow, ONBOARDING_DAYS, randomToken, sha256Hex } from "../_shared/onboarding.ts";

type ContractorRow = {
  id: number;
  name: string;
  last_name: string;
  email: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromEmail = Deno.env.get("ONBOARDING_FROM_EMAIL") ?? "Support Colombia <onboarding@supportcolombia.com>";
  const webUrl = Deno.env.get("ONBOARDING_WEB_URL") ?? Deno.env.get("EXPO_PUBLIC_WEB_URL") ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase Edge Function environment is incomplete" }, 500);
  }
  if (!resendApiKey || !webUrl) {
    return jsonResponse({ error: "Faltan RESEND_API_KEY u ONBOARDING_WEB_URL para enviar el correo." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "No autorizado" }, 401);

  const { data: isDirector, error: roleError } = await userClient.rpc("has_role", { role_code: "DIRECTOR" });
  if (roleError || !isDirector) return jsonResponse({ error: "Solo el Director puede enviar este formulario." }, 403);

  const body = await req.json().catch(() => ({}));
  const contractorId = Number(body.contractorId);
  if (!Number.isFinite(contractorId) || contractorId <= 0) {
    return jsonResponse({ error: "Contratista no válido." }, 400);
  }

  const { data: status, error: statusError } = await serviceClient.rpc("contractor_current_status", {
    p_contractor_id: contractorId,
  });
  if (statusError) return jsonResponse({ error: statusError.message }, 400);
  if (status !== "ACTIVO") {
    return jsonResponse({ error: "El contratista debe estar ACTIVO para enviar el formulario." }, 400);
  }

  const { data: contractor, error: contractorError } = await serviceClient
    .from("contractor")
    .select("id,name,last_name,email")
    .eq("id", contractorId)
    .single<ContractorRow>();
  if (contractorError || !contractor) return jsonResponse({ error: "Contratista no encontrado." }, 404);
  if (!contractor.email) return jsonResponse({ error: "El contratista no tiene correo registrado." }, 400);

  await serviceClient
    .from("contractor_onboarding_invites")
    .update({ status: "EXPIRED", updated_at: colombiaNow() })
    .eq("contractor_id", contractorId)
    .eq("status", "PENDING");

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = addDaysColombia(ONBOARDING_DAYS);
  const fullName = `${contractor.name ?? ""} ${contractor.last_name ?? ""}`.trim();
  const link = `${webUrl.replace(/\/$/, "")}/onboarding?token=${encodeURIComponent(token)}`;
  const bannerUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/supplies/images/bannersupport-email.jpg`;

  const { error: inviteError } = await serviceClient.from("contractor_onboarding_invites").insert({
    contractor_id: contractorId,
    email: contractor.email,
    token_hash: tokenHash,
    expires_at: expiresAt,
    sent_at: colombiaNow(),
    created_by: userData.user.id,
  });
  if (inviteError) return jsonResponse({ error: inviteError.message }, 400);

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: contractor.email,
      subject: "Completa tus datos - Support Colombia",
      html: `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#F4F6FA;font-family:Arial,sans-serif;color:#17213A">
          <tr>
            <td align="center" style="padding:16px 10px">
              <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid #E2E7F0;border-radius:14px;overflow:hidden">
                <tr>
                  <td>
                    <img src="${bannerUrl}" width="640" alt="Support Colombia" style="display:block;width:100%;max-width:640px;height:auto;border:0" />
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 26px 24px">
                    <h1 style="margin:0 0 10px;font-size:24px;line-height:1.2;color:#15285A">Hola ${fullName || "contratista"},</h1>
                    <p style="margin:0 0 18px;font-size:15px;line-height:1.45;color:#39445C">Completa tus datos personales y acepta la política de tratamiento de datos para finalizar tu registro.</p>
                    <a href="${link}" style="display:inline-block;background:#15285A;color:#FFFFFF;padding:12px 18px;border-radius:9px;text-decoration:none;font-size:15px;font-weight:bold">Diligenciar formulario</a>
                    <p style="margin:16px 0 0;font-size:12px;line-height:1.4;color:#6B7280">Este enlace vence en ${ONBOARDING_DAYS} días y solo puede usarse una vez.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    }),
  });

  if (!emailResponse.ok) {
    const detail = await emailResponse.text();
    console.error("Resend rejected onboarding email", {
      status: emailResponse.status,
      detail,
      from: fromEmail,
      to: contractor.email,
    });
    return jsonResponse({
      ok: false,
      error: `No fue posible enviar el correo: ${detail}`,
    });
  }

  return jsonResponse({ ok: true, email: contractor.email });
});
