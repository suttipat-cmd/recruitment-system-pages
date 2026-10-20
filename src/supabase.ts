import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

// No global session: requests use only the configured project's public/anon permissions.
export function createSupabaseClient(
  env: NodeJS.ProcessEnv = process.env,
  transport?: typeof fetch,
) {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key || key === "your-project-anon-key") {
    throw new Error("Configure SUPABASE_URL and SUPABASE_ANON_KEY");
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname === "your-project-ref.supabase.co"
  ) {
    throw new Error("Use the actual HTTPS URL of the Supabase project");
  }
  if (key.startsWith("sb_secret_"))
    throw new Error("Use a public anon/publishable key, not a secret key");
  // Reject the legacy privileged JWT as well. This check is a configuration guard, not JWT auth.
  if (key.split(".").length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(key.split(".")[1]!, "base64url").toString("utf8"),
      ) as { role?: string };
      if (payload.role === "service_role")
        throw new Error("Use an anon key, not service_role");
    } catch (error) {
      if (error instanceof Error && error.message.includes("service_role"))
        throw error;
    }
  }
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: transport ?? fetch },
  });
}
