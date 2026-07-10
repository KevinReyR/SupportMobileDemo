import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const redirectTo = Deno.env.get("ONBOARDING_WEB_URL") ?? Deno.env.get("EXPO_PUBLIC_WEB_URL") ?? undefined;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase Edge Function environment is incomplete" }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "No autorizado" }, 401);

  const { data: isAdmin, error: roleError } = await userClient.rpc("has_role", { role_code: "ADMIN" });
  if (roleError || !isAdmin) return jsonResponse({ error: "Solo el Administrador puede crear usuarios." }, 403);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const roleCode = String(body.roleCode ?? "").trim().toUpperCase();
  const clientIds = Array.isArray(body.clientIds)
    ? body.clientIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0)
    : [];

  if (!email || !email.includes("@")) return jsonResponse({ error: "Correo no válido." }, 400);
  if (!name || !lastName) return jsonResponse({ error: "Nombre y apellido son obligatorios." }, 400);

  const { data: role, error: roleLookupError } = await serviceClient
    .from("roles")
    .select("id")
    .eq("code", roleCode)
    .eq("is_active", true)
    .single();
  if (roleLookupError || !role) return jsonResponse({ error: "Rol no válido." }, 400);

  const { data: created, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { name, last_name: lastName, phone_number: phone },
    redirectTo,
  });
  if (inviteError) {
    return jsonResponse({
      error: `No fue posible enviar la invitación. Verifica el SMTP de Supabase/Resend. Detalle: ${inviteError.message}`,
    }, 400);
  }

  const userId = created.user?.id;
  if (!userId) return jsonResponse({ error: "No fue posible crear el usuario." }, 500);

  const { error: profileError } = await serviceClient.from("user_profiles").upsert({
    id: userId,
    name,
    last_name: lastName,
    email,
    phone_number: phone || null,
    is_active: true,
  });
  if (profileError) return jsonResponse({ error: profileError.message }, 400);

  await serviceClient.from("user_roles").delete().eq("user_id", userId);
  const { error: userRoleError } = await serviceClient.from("user_roles").insert({
    user_id: userId,
    role_id: role.id,
  });
  if (userRoleError) return jsonResponse({ error: userRoleError.message }, 400);

  await serviceClient.from("user_clients").delete().eq("user_id", userId);
  if (clientIds.length > 0) {
    const { error: clientsError } = await serviceClient.from("user_clients").insert(
      clientIds.map((clientId: number) => ({ user_id: userId, client_id: clientId })),
    );
    if (clientsError) return jsonResponse({ error: clientsError.message }, 400);
  }

  return jsonResponse({ userId, email });
});
