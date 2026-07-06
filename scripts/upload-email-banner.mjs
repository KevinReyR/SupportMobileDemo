import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BANNER_BUCKET = "supplies";
const DEFAULT_BANNER_PATH = "images/bannersupport-email.jpg";
const DEFAULT_BANNER_SOURCE = "C:/Users/User/Downloads/bannersupport-email.jpg";

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

loadEnv();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sourcePath = process.env.BANNER_SOURCE_PATH || DEFAULT_BANNER_SOURCE;
const storagePath = process.env.BANNER_STORAGE_PATH || DEFAULT_BANNER_PATH;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Configura EXPO_PUBLIC_SUPABASE_URL/SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir el banner.");
}

const bytes = readFileSync(sourcePath);
const supabase = createClient(supabaseUrl, serviceRoleKey);
const extension = sourcePath.toLowerCase().split(".").pop();
const mimeType = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/png";

const upload = await supabase.storage.from(BANNER_BUCKET).upload(storagePath, bytes, {
  contentType: mimeType,
  upsert: true,
});
if (upload.error) throw upload.error;

const upsert = await supabase.from("app_files").upsert(
  {
    provider: "supabase",
    bucket: BANNER_BUCKET,
    path: storagePath,
    original_name: basename(sourcePath),
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
  },
  { onConflict: "provider,bucket,path" },
);
if (upsert.error) throw upsert.error;

console.log(`Banner subido a ${BANNER_BUCKET}/${storagePath}`);
