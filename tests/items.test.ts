import test from "node:test";
import assert from "node:assert/strict";
import { handleItems } from "../examples/items.js";
import { createSupabaseClient } from "../src/supabase.js";

const sample = {
  id: "89f6b58a-1158-4483-9e23-7f97119fb5e3",
  title: "ตัวอย่าง",
  created_at: "2026-10-19T00:00:00Z",
};
const request = (
  method: string,
  body?: string,
  contentType = "application/json",
) =>
  new Request("http://localhost/api/items", {
    method,
    headers: { "Content-Type": contentType },
    ...(body === undefined ? {} : { body }),
  });

// Use the real Supabase SDK/query builder and replace ONLY its network transport.
// No connection or write to anyone's Supabase project is performed by these tests.
async function withTransport(fn: () => Promise<void>, transport: typeof fetch) {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
    fetch: globalThis.fetch,
  };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "sb_publishable_fixture_only";
  globalThis.fetch = transport;
  try {
    await fn();
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previous.key;
  }
}

test("Select uses real SDK with explicit columns, ordering and bounded limit", async () => {
  await withTransport(
    async () => {
      const response = await handleItems(
        new Request("http://localhost/api/items?limit=5"),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { data: [sample] });
      assert.equal(response.headers.get("cache-control"), "no-store");
    },
    async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/items");
      assert.equal(url.searchParams.get("select"), "id,title,created_at");
      assert.equal(url.searchParams.get("limit"), "5");
      assert.equal(url.searchParams.get("order"), "created_at.desc");
      assert.equal(
        new Headers(options?.headers).get("apikey"),
        "sb_publishable_fixture_only",
      );
      return Response.json([sample]);
    },
  );
});

test("Insert sends a trimmed title and returns the inserted row", async () => {
  await withTransport(
    async () => {
      const response = await handleItems(
        request("POST", JSON.stringify({ title: "  ตัวอย่าง  " })),
      );
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { data: sample });
    },
    async (_input, options) => {
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), {
        title: "ตัวอย่าง",
      });
      assert.equal(
        new Headers(options?.headers).get("prefer"),
        "return=representation",
      );
      return Response.json(sample, { status: 201 });
    },
  );
});

test("Invalid input never reaches Supabase", async () => {
  await withTransport(
    async () => {
      for (const body of [
        "{",
        "null",
        "[]",
        "{}",
        '{"title":5}',
        '{"title":" "}',
        JSON.stringify({ title: "a".repeat(121) }),
        '{"title":"a","id":"injected"}',
      ]) {
        assert.equal(
          (await handleItems(request("POST", body))).status,
          400,
          body,
        );
      }
      assert.equal(
        (await handleItems(request("POST", "{}", "text/plain"))).status,
        415,
      );
      assert.equal(
        (await handleItems(request("POST", " ".repeat(16_385)))).status,
        413,
      );
      for (const limit of ["0", "101", "1.5", "abc", ""])
        assert.equal(
          (
            await handleItems(
              new Request("http://localhost/api/items?limit=" + limit),
            )
          ).status,
          400,
        );
      const method = await handleItems(request("DELETE"));
      assert.equal(method.status, 405);
      assert.equal(method.headers.get("allow"), "GET, POST");
    },
    async () => {
      throw new Error("Invalid input must not reach the network");
    },
  );
});

test("RLS denial remains a denial; response does not expose provider error details", async () => {
  await withTransport(
    async () => {
      const response = await handleItems(request("POST", '{"title":"test"}'));
      assert.equal(response.status, 403);
      assert(!JSON.stringify(await response.json()).includes("PRIVATE_DETAIL"));
    },
    async () =>
      Response.json(
        { code: "42501", message: "PRIVATE_DETAIL", details: null, hint: null },
        { status: 403 },
      ),
  );
});

test("Bad config and privileged keys are rejected before network access", () => {
  assert.throws(() => createSupabaseClient({}));
  assert.throws(() =>
    createSupabaseClient({
      SUPABASE_URL: "http://example.com",
      SUPABASE_ANON_KEY: "fixture",
    }),
  );
  assert.throws(() =>
    createSupabaseClient({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "sb_secret_fixture",
    }),
  );
  const token =
    "header." +
    Buffer.from('{"role":"service_role"}').toString("base64url") +
    ".signature";
  assert.throws(() =>
    createSupabaseClient({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: token,
    }),
  );
});
