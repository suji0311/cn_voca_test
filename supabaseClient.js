function requireSupabaseConfig() {
  const missing =
    typeof SUPABASE_CONFIG === "undefined" ||
    !SUPABASE_CONFIG.url ||
    !SUPABASE_CONFIG.anonKey ||
    SUPABASE_CONFIG.url.includes("YOUR_PROJECT_ID") ||
    SUPABASE_CONFIG.anonKey.includes("YOUR_SUPABASE_ANON_KEY") ||
    SUPABASE_CONFIG.url.includes("/dashboard/");

  if (missing) {
    throw new Error("config.js에 Supabase Project URL과 anon public key를 입력해야 합니다.");
  }
}

function createSupabaseClient() {
  requireSupabaseConfig();

  if (!window.supabase?.createClient) {
    throw new Error("Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.");
  }

  return window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
}

window.requireSupabaseConfig = requireSupabaseConfig;

try {
  window.supabaseApp = createSupabaseClient();
} catch (error) {
  window.supabaseApp = null;
  window.supabaseInitError = error;
}
