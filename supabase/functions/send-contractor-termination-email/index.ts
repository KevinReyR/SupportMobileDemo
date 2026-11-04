import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Sin registrar";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatColombiaTimestamp(value: string | null | undefined) {
  if (!value) return "Sin registrar";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromEmail = Deno.env.get("NOTIFICATIONS_FROM_EMAIL")
    ?? Deno.env.get("ONBOARDING_FROM_EMAIL")
    ?? "Support Colombia <onboarding@supportcolombia.com>";

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey) {
    return jsonResponse({ error: "Configuración incompleta para enviar notificaciones." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "No autorizado" }, 401);

  const [{ data: isCoordinator }, { data: isDirector }] = await Promise.all([
    userClient.rpc("has_role", { role_code: "COORDINATOR" }),
    userClient.rpc("has_role", { role_code: "DIRECTOR" }),
  ]);
  if (!isCoordinator && !isDirector) {
    return jsonResponse({ error: "No tienes permisos para notificar desvinculaciones." }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const contractorId = Number(body.contractorId);
  if (!Number.isSafeInteger(contractorId) || contractorId <= 0) {
    return jsonResponse({ error: "Contratista no válido." }, 400);
  }

  const [contractorResult, contractResult, actorResult, directorRoleResult] = await Promise.all([
    serviceClient
      .from("contractor")
      .select("id,name,last_name,document_number,phone_number,email")
      .eq("id", contractorId)
      .single(),
    serviceClient
      .from("contractor_contract")
      .select("id,start_date,end_date,contract_type,termination_reason_id,termination_observations,terminated_by,terminated_at")
      .eq("contractor_id", contractorId)
      .not("terminated_at", "is", null)
      .order("terminated_at", { ascending: false })
      .limit(1)
      .single(),
    serviceClient
      .from("user_profiles")
      .select("name,last_name,email")
      .eq("id", userData.user.id)
      .single(),
    serviceClient
      .from("roles")
      .select("id")
      .eq("code", "DIRECTOR")
      .eq("is_active", true)
      .single(),
  ]);

  if (contractorResult.error || !contractorResult.data) {
    return jsonResponse({ error: "Contratista no encontrado." }, 404);
  }
  if (contractResult.error || !contractResult.data) {
    return jsonResponse({ error: "No se encontró la desvinculación registrada." }, 404);
  }
  if (contractResult.data.terminated_by !== userData.user.id) {
    return jsonResponse({ error: "Solo puedes notificar la desvinculación que acabas de registrar." }, 403);
  }
  if (directorRoleResult.error || !directorRoleResult.data) {
    return jsonResponse({ error: "No existe un perfil Director activo." }, 409);
  }

  const [typeResult, reasonResult, directorUsersResult] = await Promise.all([
    serviceClient
      .from("contract_type")
      .select("name")
      .eq("id", contractResult.data.contract_type)
      .single(),
    serviceClient
      .from("contractor_termination_reasons")
      .select("name")
      .eq("id", contractResult.data.termination_reason_id)
      .single(),
    serviceClient
      .from("user_roles")
      .select("user_id")
      .eq("role_id", directorRoleResult.data.id),
  ]);
  if (directorUsersResult.error) {
    return jsonResponse({ error: "No fue posible consultar los destinatarios." }, 500);
  }

  const directorIds = [...new Set((directorUsersResult.data ?? []).map((row) => row.user_id))];
  if (directorIds.length === 0) {
    return jsonResponse({ error: "No hay directores configurados para recibir la notificación." }, 409);
  }
  const { data: directors, error: directorsError } = await serviceClient
    .from("user_profiles")
    .select("id,name,last_name,email,is_active")
    .in("id", directorIds)
    .eq("is_active", true)
    .not("email", "is", null);
  if (directorsError) return jsonResponse({ error: "No fue posible consultar los directores." }, 500);

  const recipients = (directors ?? []).filter((director) => String(director.email ?? "").includes("@"));
  if (recipients.length === 0) {
    return jsonResponse({ error: "No hay directores activos con correo válido." }, 409);
  }

  const contractor = contractorResult.data;
  const contract = contractResult.data;
  const fullName = `${contractor.name ?? ""} ${contractor.last_name ?? ""}`.trim();
  const actorName = actorResult.data
    ? `${actorResult.data.name ?? ""} ${actorResult.data.last_name ?? ""}`.trim()
    : userData.user.email ?? "Usuario interno";
  const bannerUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/supplies/images/bannersupport-email.jpg`;
  const details = [
    ["Contratista", fullName],
    ["Documento", contractor.document_number],
    ["Teléfono", contractor.phone_number || "Sin registrar"],
    ["Correo", contractor.email || "Sin registrar"],
    ["Tipo de contrato", typeResult.data?.name || "Sin registrar"],
    ["Inicio del contrato", formatDate(contract.start_date)],
    ["Fecha de desvinculación", formatDate(contract.end_date)],
    ["Causa", reasonResult.data?.name || "Sin registrar"],
    ["Observación", contract.termination_observations || "Sin observación"],
    ["Registrado por", actorName],
    ["Fecha de registro", formatColombiaTimestamp(contract.terminated_at)],
  ];
  const detailRows = details.map(([label, value]) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E5EAF2;font-weight:bold;color:#15285A">${escapeHtml(label)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E5EAF2;color:#39445C">${escapeHtml(value)}</td>
    </tr>
  `).join("");
  const html = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#F4F6FA;font-family:Arial,sans-serif;color:#17213A">
      <tr><td align="center" style="padding:16px 10px">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid #E2E7F0;border-radius:14px;overflow:hidden">
          <tr><td><img src="${bannerUrl}" width="640" alt="Support Colombia" style="display:block;width:100%;height:auto;border:0" /></td></tr>
          <tr><td style="padding:22px 26px 26px">
            <h1 style="margin:0 0 10px;font-size:23px;line-height:1.25;color:#15285A">Desvinculación de contratista</h1>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.45;color:#39445C">Se registró la desvinculación de <strong>${escapeHtml(fullName)}</strong>.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E5EAF2;border-radius:9px;border-collapse:collapse">${detailRows}</table>
            <p style="margin:18px 0 0;font-size:12px;line-height:1.4;color:#6B7280">Mensaje informativo generado automáticamente por SupportMobile.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `;

  const deliveries = await Promise.all(recipients.map(async (director) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `contractor-termination/${contract.id}/${director.id}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: director.email,
        subject: `Desvinculación de contratista - ${fullName}`,
        html,
      }),
    });
    if (response.ok) return { ok: true, directorId: director.id };
    const detail = await response.text();
    console.error("Resend rejected termination email", {
      status: response.status,
      directorId: director.id,
      detail,
    });
    return { ok: false, directorId: director.id };
  }));

  const sent = deliveries.filter((delivery) => delivery.ok).length;
  const failed = deliveries.length - sent;
  return jsonResponse({
    ok: failed === 0,
    sent,
    failed,
    error: failed > 0 ? `No se pudo notificar a ${failed} director(es).` : null,
  });
});
