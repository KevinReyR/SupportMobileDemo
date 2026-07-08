export const POLICY_BUCKET = "supplies";
export const POLICY_PATH = "policies/politica-tratamiento-datos-personales-support-colombia.pdf";
export const PROFILE_LOGO_PATH = "images/logo_support.png";
export const PROFILE_SHIRT_TEMPLATE_PATH = "images/camisaconlogo.png";
export const PROFILE_PHOTO_BUCKET = "contractor-profile-photos";
export const ONBOARDING_DAYS = 7;

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function colombiaNow() {
  return new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).replace(" ", "T");
}

export function addDaysColombia(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleString("sv-SE", { timeZone: "America/Bogota" }).replace(" ", "T");
}

export function publicPolicyUrl(supabaseUrl: string) {
  return `${supabaseUrl}/storage/v1/object/public/${POLICY_BUCKET}/${POLICY_PATH}`;
}
