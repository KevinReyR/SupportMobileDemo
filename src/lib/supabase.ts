import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import { createClient, processLock } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const message = "Faltan EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY.";
  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F6FA;font-family:Arial,sans-serif;padding:24px;color:#17213A">
        <div style="max-width:520px;background:white;border:1px solid #E4E8F0;border-radius:20px;padding:28px;box-shadow:0 18px 45px rgba(23,33,58,.08)">
          <h1 style="margin:0 0 12px;font-size:24px;color:#15285A">Configuración incompleta</h1>
          <p style="margin:0 0 10px;line-height:1.5">${message}</p>
          <p style="margin:0;line-height:1.5;color:#677187">Configura estas variables en Netlify y vuelve a desplegar el sitio.</p>
        </div>
      </div>
    `;
  }
  throw new Error(message);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
