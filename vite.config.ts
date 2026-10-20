import { defineConfig, loadEnv, type Plugin } from "vite";
import { createSupabaseClient } from "./src/supabase.ts";

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), "SUPABASE_"), ...process.env };
  const base = process.env.PAGES_BASE_PATH || "/";
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base))
    throw Error("PAGES_BASE_PATH must be / or /Repository-Name/");
  // Public configuration only. Reject privileged keys before any static artifact is emitted.
  const publicConfig = () => {
    createSupabaseClient(env);
    return {
      url: env.SUPABASE_URL!.trim(),
      key: env.SUPABASE_ANON_KEY!.trim(),
    };
  };
  const plugin: Plugin = {
    name: "public-supabase-config",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "config.json",
        source: JSON.stringify(publicConfig()),
      });
      this.emitFile({ type: "asset", fileName: ".nojekyll", source: "" });
    },
    configureServer(server) {
      server.middlewares.use(base + "api/config", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          res.end(JSON.stringify(publicConfig()));
        } catch {
          res.statusCode = 503;
          res.end(
            JSON.stringify({
              error:
                "กรุณาตั้ง SUPABASE_URL และ SUPABASE_ANON_KEY ใน .env.local",
            }),
          );
        }
      });
    },
  };
  if (command === "build") publicConfig();
  return {
    root: "web",
    base,
    envDir: "..",
    build: { outDir: "../dist", emptyOutDir: true },
    server: { host: "127.0.0.1", port: 3000, strictPort: true },
    plugins: [plugin],
  };
});
