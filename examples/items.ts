import { createSupabaseClient } from "../src/supabase.js";
import { selectItems, insertItem } from "../src/items.js";

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function handleItems(request: Request): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }
  let title = "";
  let limit = 20;
  if (request.method === "GET") {
    const raw = new URL(request.url).searchParams.get("limit");
    if (raw !== null) {
      if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
        return json({ error: "limit must be an integer from 1 to 100" }, 400);
      }
      limit = Number(raw);
    }
  } else {
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      return json({ error: "Use Content-Type: application/json" }, 415);
    }
    let body: unknown;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 16_384)
        return json({ error: "Body too large" }, 413);
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "title") ||
      !("title" in body) ||
      typeof body.title !== "string"
    ) {
      return json(
        { error: "Send an object containing only a string title" },
        400,
      );
    }
    title = body.title.trim();
    if (!title || title.length > 120)
      return json({ error: "title must contain 1–120 characters" }, 400);
  }
  let client: ReturnType<typeof createSupabaseClient>;
  try {
    client = createSupabaseClient();
  } catch {
    return json({ error: "Supabase configuration is missing or invalid" }, 500);
  }
  try {
    const result =
      request.method === "GET"
        ? await selectItems(client, limit)
        : await insertItem(client, title);
    if (result.error) {
      const denied =
        ["42501", "PGRST301", "PGRST302", "PGRST303"].includes(
          result.error.code,
        ) || [401, 403].includes(result.status);
      return json(
        {
          error: denied
            ? "Supabase denied access; ask the project owner to check the key, grants and RLS"
            : "Supabase query failed; check the table schema and project availability",
        },
        denied ? 403 : 502,
      );
    }
    return json({ data: result.data }, request.method === "POST" ? 201 : 200);
  } catch {
    return json({ error: "Supabase request failed or timed out" }, 502);
  }
}

// Vercel Node.js Web Standard handler. Shared code stays outside api/.
export default { fetch: handleItems };
