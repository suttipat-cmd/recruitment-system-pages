import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

const columns = "id,title,created_at";

export async function selectItems(
  client: SupabaseClient<Database>,
  limit = 20,
) {
  return client
    .from("items")
    .select(columns)
    .order("created_at", { ascending: false })
    .limit(limit)
    .abortSignal(AbortSignal.timeout(5_000));
}

export async function insertItem(
  client: SupabaseClient<Database>,
  title: string,
) {
  // .select() returns the inserted row. Both INSERT and SELECT permission are needed.
  return client
    .from("items")
    .insert({ title })
    .select(columns)
    .abortSignal(AbortSignal.timeout(5_000))
    .single();
}
